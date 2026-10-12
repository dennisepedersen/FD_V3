"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://example.invalid/fielddesk_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || "fielddesk.test";

const pool = require("../backend/src/db/pool");
const audit = require("../backend/src/services/auditService");
const repository = require("../backend/src/modules/notifications/emailOutbox.repository");
const processor = require("../backend/src/modules/notifications/emailOutbox.processor");
const dispatch = require("../backend/src/modules/timeControl/timeControl.dispatch");
const weekly = require("../backend/src/modules/timeControl/timeControl.weekly");
const automation = require("../backend/src/modules/timeControl/timeControl.automation");

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const templates = [
  "time_control.missing_hours.employee",
  "time_control.employee_weekly_reminder_v1",
  "time_control.friday_weekly_summary_v1",
  "time_control.internal_error",
];

async function withPatches(patches, fn) {
  const restores = patches.map(([target, key, value]) => {
    const previous = target[key];
    target[key] = value;
    return () => { target[key] = previous; };
  });
  try { return await fn(); }
  finally { for (const restore of restores.reverse()) restore(); }
}

function mailRow(templateKey = templates[3]) {
  return {
    id: uuid(10), tenant_id: uuid(1), source_type: "time_control", template_key: templateKey,
    recipient_email: "employee@example.test", subject: "Timekontrol", text_body: "Fixture",
    status: "processing", attempt_count: 1, max_attempts: 5,
    idempotency_key: "time_control:fixture:one-attempt",
    payload_json: { sender: "Fielddesk Timekontrol <timekontrol@mail.fielddesk.dk>",
      reply_to: "admin@fielddesk.dk", cc_emails: ["dep@example.test"], friday: "2026-10-09" },
  };
}

async function withProcessorFixture(fn, rows = [mailRow()]) {
  const events = [], dead = [], retried = [], sent = [], calls = [];
  const client = { release() {}, async query(sql) { events.push(sql); return { rows: [] }; } };
  const mark = kind => async (_client, args) => {
    events.push(kind);
    ({ dead, retried, sent })[kind].push(args);
    return { id: args.id };
  };
  await withPatches([
    [pool, "connect", async () => client],
    [audit, "logAuditEvent", async () => {}],
    [repository, "claimDueBatch", async (_client, args) => { calls.push({ kind: "generic", args }); return rows; }],
    [repository, "claimTimeControlBatch", async (_client, args) => { calls.push({ kind: "narrow", args }); return rows; }],
    [repository, "markSent", mark("sent")],
    [repository, "markRetry", mark("retried")],
    [repository, "markDeadLetter", mark("dead")],
    [dispatch, "validateAutomatic", async (guardClient, args) => {
      assert.equal(guardClient, client);
      assert.equal(args.tenantId, uuid(1));
      events.push("automatic");
    }],
    [dispatch, "validateDaily", async () => { events.push("daily"); }],
    [weekly, "validateDispatchSnapshot", async () => { events.push("weekly"); }],
    [weekly, "reminderWindow", () => true],
    [automation, "requireSendingEnabled", () => { events.push("enabled"); }],
  ], async () => fn({ rows, client, events, dead, retried, sent, calls }));
}

test("automatic outbox selection rejects invalid, duplicate and oversized IDs before claiming", async () => {
  let connections = 0;
  await withPatches([[pool, "connect", async () => { connections++; throw new Error("must_not_connect"); }]], async () => {
    const mixedCaseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    for (const ids of [null, "all", ["invalid"], new Array(1), [uuid(10), uuid(10)],
      [mixedCaseId, mixedCaseId.toUpperCase()], Array.from({ length: 101 }, (_, i) => uuid(i))]) {
      await assert.rejects(processor.processDueEmails({ tenantId: uuid(1), timeControlOutboxIds: ids }), /time_control_outbox_ids_invalid/);
    }
    await assert.rejects(processor.processDueEmails({ tenantId: "invalid", timeControlOutboxIds: [] }), /time_control_outbox_tenant_invalid/);
  });
  assert.equal(connections, 0);
});

test("narrow claim is tenant-scoped, exact-ID, allowlisted and first-attempt-only", async () => {
  const calls = [];
  const client = { async query(sql, params) { calls.push({ sql, params }); return { rows: [{ id: uuid(10) }] }; } };
  assert.deepEqual(await repository.claimTimeControlBatch(client, { tenantId: uuid(1), outboxIds: [] }), []);
  assert.equal(calls.length, 0);
  const ids = Array.from({ length: 100 }, (_, i) => uuid(i + 10));
  await repository.claimTimeControlBatch(client, { tenantId: uuid(1), outboxIds: ids });
  const { sql, params } = calls[0];
  assert.deepEqual(params, [uuid(1), ids, templates]);
  assert.match(sql, /tenant_id = \$1 AND id = ANY\(\$2::uuid\[\]\)/);
  assert.match(sql, /source_type = 'time_control' AND template_key = ANY\(\$3::text\[\]\)/);
  assert.match(sql, /status = 'queued' AND attempt_count = 0/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /eo\.id = picked\.id AND eo\.tenant_id = \$1/);
  assert.doesNotMatch(sql, /status IN|status = 'retry'|status = 'processing' AND|processingTimeout/);
});

test("generic claim and retry keep other modules eligible but exclude all previously attempted Timekontrol rows", async () => {
  const calls = [];
  const client = { async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } };
  await repository.claimDueBatch(client, { tenantId: uuid(1), limit: 25 });
  assert.match(calls[0].sql, /\(source_type IS DISTINCT FROM 'time_control' AND template_key !~ '\^time_control\[\.\]'\)\s+OR \(status = 'queued' AND attempt_count = 0\)/);
  assert.match(calls[0].sql, /status = 'processing' AND last_attempt_at </);
  await repository.markRetry(client, { tenantId: uuid(1), id: uuid(10), nextAttemptAt: new Date(), errorCode: "fixture", errorMessage: "fixture" });
  assert.match(calls[1].sql, /source_type IS DISTINCT FROM 'time_control'/);
  assert.match(calls[1].sql, /template_key !~ '\^time_control\[\.\]'/);
  for (const row of [{ source_type: "time_control", template_key: "legacy" },
    { source_type: "other", template_key: "time_control.legacy" }]) {
    assert.equal(processor._test.classifySendError(new Error("timeout"), { ...row, attempt_count: 1, max_attempts: 5 }).retry, false);
  }
});

test("automatic processor uses only exact requested IDs and empty selection never sweeps the queue", async () => {
  for (const ids of [[uuid(10)], []]) {
    await withProcessorFixture(async fixture => {
      await processor.processDueEmails({ tenantId: uuid(1), timeControlOutboxIds: ids,
        sendEmailFn: async () => ({ provider: "resend", providerMessageId: "mock-id" }) });
      assert.deepEqual(fixture.calls, [{ kind: "narrow", args: { tenantId: uuid(1), outboxIds: ids } }]);
    }, ids.length ? [mailRow()] : []);
  }
});

test("every automatic Timekontrol template validates within the send transaction and forwards immutable delivery metadata", async () => {
  for (const template of templates) {
    await withProcessorFixture(async fixture => {
      const before = structuredClone(fixture.rows[0]);
      const result = await processor.processDueEmails({ tenantId: uuid(1), timeControlOutboxIds: [uuid(10)],
        sendEmailFn: async (message, options) => {
          fixture.events.push("provider");
          assert.equal(message.from, before.payload_json.sender);
          assert.equal(message.replyTo, before.payload_json.reply_to);
          assert.deepEqual(message.cc, before.payload_json.cc_emails);
          assert.deepEqual(options, { idempotencyKey: before.idempotency_key, timeoutMs: 15000 });
          assert.equal(fixture.events.at(-2), "enabled");
          assert.equal(fixture.events.filter(event => event === "COMMIT").length, 1);
          return { provider: "resend", providerMessageId: "mock-id" };
        } });
      assert.equal(result.sent, 1);
      assert.equal(fixture.events.filter(event => event === "automatic").length, 1);
      assert.ok(fixture.events.indexOf("automatic") < fixture.events.indexOf("provider"));
      if (template === templates[0]) assert.ok(fixture.events.indexOf("daily") < fixture.events.indexOf("provider"));
      if (template === templates[1] || template === templates[2]) assert.ok(fixture.events.indexOf("weekly") < fixture.events.indexOf("provider"));
      assert.deepEqual(fixture.rows[0], before);
    }, [mailRow(template)]);
  }
});

test("automatic validation denial, missing guard and unsupported legacy template dead-letter before transport", async () => {
  for (const guard of [undefined, async () => { throw new Error("time_control_automatic_mail_disabled"); }]) {
    await withProcessorFixture(async fixture => {
      await withPatches([[dispatch, "validateAutomatic", guard]], async () => {
        const result = await processor.processDueEmails({ tenantId: uuid(1),
          sendEmailFn: async () => { assert.fail("provider must not run"); } });
        assert.equal(result.dead_letter, 1);
        assert.match(fixture.dead[0].errorCode, /^time_control_/);
        assert.equal(fixture.retried.length, 0);
      });
    });
  }
  await withProcessorFixture(async fixture => {
    await withPatches([[dispatch, "validateAutomatic", async (_client, { row }) => {
      assert.equal(row.template_key, "time_control.friday_manager_summary");
      throw new Error("time_control_automatic_template_unsupported");
    }]], async () => {
      const result = await processor.processDueEmails({ tenantId: uuid(1),
        sendEmailFn: async () => { assert.fail("legacy summary must not send"); } });
      assert.equal(result.dead_letter, 1);
      assert.equal(fixture.dead[0].errorCode, "time_control_automatic_template_unsupported");
    });
  }, [mailRow("time_control.friday_manager_summary")]);
});

test("the synchronous sending gate catches revocation after transaction validation", async () => {
  await withProcessorFixture(async fixture => {
    let enabled = true;
    await withPatches([
      [dispatch, "validateAutomatic", async () => { enabled = false; }],
      [automation, "requireSendingEnabled", () => { if (!enabled) throw new Error("time_control_automatic_mail_disabled"); }],
    ], async () => {
      const result = await processor.processDueEmails({ tenantId: uuid(1),
        sendEmailFn: async () => { assert.fail("revoked mail must not send"); } });
      assert.equal(result.sent, 0);
      assert.equal(result.retry, 0);
      assert.equal(fixture.dead[0].errorCode, "time_control_automatic_mail_disabled");
    });
  });
});

test("Timekontrol rejects cross-tenant claimed rows and missing provider idempotency before transport", async () => {
  for (const mutate of [row => { row.tenant_id = uuid(2); }, row => { row.idempotency_key = null; }]) {
    const row = mailRow();
    mutate(row);
    await withProcessorFixture(async fixture => {
      const result = await processor.processDueEmails({ tenantId: uuid(1),
        sendEmailFn: async () => { assert.fail("invalid claimed row must not send"); } });
      assert.equal(result.sent, 0);
      assert.equal(result.retry, 0);
      assert.match(fixture.dead[0].errorCode, /^time_control_/);
    }, [row]);
  }
});

test("network errors and missing or unsupported provider receipts are terminal uncertain without retry", async () => {
  const transports = [
    async () => { throw new Error("network_timeout"); },
    async () => { throw new Error("time_control_error_after_network_started"); },
    async () => undefined,
    async () => ({}),
    async () => ({ provider: "resend", providerMessageId: null }),
    async () => ({ provider: "resend", providerMessageId: " " }),
    async () => ({ provider: "postmark", providerMessageId: "mock-id" }),
  ];
  for (const sendEmailFn of transports) {
    await withProcessorFixture(async fixture => {
      const result = await processor.processDueEmails({ tenantId: uuid(1), sendEmailFn });
      assert.equal(result.sent, 0);
      assert.equal(result.retry, 0);
      assert.equal(result.dead_letter, 1);
      assert.deepEqual(result.failures, [{ id: uuid(10), code: "provider_acceptance_unclear", delivery_state: "unclear" }]);
      assert.equal(fixture.dead[0].errorCode, "provider_acceptance_unclear");
      assert.equal(fixture.retried.length, 0);
      assert.equal(fixture.sent.length, 0);
    });
  }
});

test("provider acceptance followed by persistence failure or lost markSent ownership never retries", async () => {
  for (const markSent of [async () => { throw new Error("database_failed"); }, async () => null]) {
    await withProcessorFixture(async fixture => {
      await withPatches([[repository, "markSent", markSent]], async () => {
        const result = await processor.processDueEmails({ tenantId: uuid(1),
          sendEmailFn: async () => ({ provider: "resend", providerMessageId: "mock-accepted" }) });
        assert.equal(result.retry, 0);
        assert.equal(result.sent, 0);
        assert.equal(fixture.dead[0].errorCode, "provider_acceptance_unclear");
        assert.equal(fixture.retried.length, 0);
      });
    });
  }
});

test("commit failures after the provider call stay terminal even when validation or sent persistence cannot commit", async () => {
  for (const failedCommit of [2, 3]) {
    await withProcessorFixture(async fixture => {
      let commits = 0;
      const query = fixture.client.query;
      fixture.client.query = async sql => {
        if (sql === "COMMIT" && ++commits === failedCommit) throw new Error("commit_outcome_unknown");
        return query(sql);
      };
      const result = await processor.processDueEmails({ tenantId: uuid(1),
        sendEmailFn: async () => ({ provider: "resend", providerMessageId: "mock-accepted" }) });
      assert.equal(result.retry, 0);
      assert.equal(result.sent, 0);
      assert.equal(fixture.dead[0].errorCode, "provider_acceptance_unclear");
      assert.equal(fixture.retried.length, 0);
    });
  }
});

test("unconfirmed processing attempts remain visible as unclear status diagnostics", async () => {
  const calls = [];
  const expected = [{ id: uuid(10), delivery_state: "unclear", attempt_count: 1 }];
  const client = { async query(sql, params) { calls.push({ sql, params }); return { rows: expected }; } };
  assert.deepEqual(await repository.listTimeControlUncertain(client, { tenantId: uuid(1) }), expected);
  assert.deepEqual(calls[0].params, [uuid(1)]);
  assert.match(calls[0].sql, /tenant_id = \$1 AND attempt_count > 0/);
  assert.match(calls[0].sql, /status = 'processing' OR \(status = 'dead_letter' AND last_error_code = 'provider_acceptance_unclear'\)/);
  assert.match(calls[0].sql, /source_type = 'time_control' OR template_key ~ '\^time_control\[\.\]'/);
  await withPatches([
    [pool, "connect", async () => ({ query: async () => ({ rows: [] }), release() {} })],
    [repository, "getQueueStats", async () => []],
    [repository, "listTimeControlUncertain", async () => expected],
  ], async () => {
    assert.deepEqual((await processor.statusOnly({ tenantId: uuid(1) })).unclear_time_control, expected);
  });
});

test("non-Timekontrol provider arguments and retry behavior stay unchanged", async () => {
  const row = { ...mailRow(), source_type: "absence_request", template_key: "absence_request.submitted.employee" };
  await withProcessorFixture(async fixture => {
    const result = await processor.processDueEmails({ tenantId: uuid(1), sendEmailFn: async (...args) => {
      assert.equal(args.length, 1);
      assert.equal(Object.hasOwn(args[0], "replyTo"), false);
      throw new Error("transient_network_error");
    } });
    assert.equal(result.retry, 1);
    assert.equal(fixture.retried.length, 1);
    assert.equal(fixture.dead.length, 0);
    assert.equal(fixture.events.includes("automatic"), false);
    assert.equal(fixture.events.includes("enabled"), false);
  }, [row]);
});
