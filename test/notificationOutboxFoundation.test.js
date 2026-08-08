"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://example.invalid/fielddesk_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || "fielddesk.test";

const pool = require("../backend/src/db/pool");
const auditService = require("../backend/src/services/auditService");
const templateRepository = require("../backend/src/modules/notifications/emailTemplate.repository");
const outboxRepository = require("../backend/src/modules/notifications/emailOutbox.repository");
const emailOutboxService = require("../backend/src/modules/notifications/emailOutbox.service");
const emailOutboxProcessor = require("../backend/src/modules/notifications/emailOutbox.processor");
const absenceNotificationService = require("../backend/src/modules/notifications/absenceNotification.service");
const internalNotificationService = require("../backend/src/modules/notifications/internalNotification.service");
const { renderTemplate } = require("../backend/src/modules/notifications/templateRenderer");

const repoRoot = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function createClient(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      return { rows };
    },
  };
}

async function withPatches(patches, fn) {
  const restores = patches.map(([target, key, value]) => {
    const previous = target[key];
    target[key] = value;
    return () => {
      target[key] = previous;
    };
  });
  try {
    return await fn();
  } finally {
    for (const restore of restores.reverse()) restore();
  }
}

test("migration 0042 creates notification, template and outbox tables with safe constraints", () => {
  const migration = read("migrations/0042_notifications_email_outbox.sql");
  const schema = read("schema.sql");

  for (const source of [migration, schema]) {
    assert.match(source, /CREATE TABLE internal_notification/);
    assert.match(source, /CREATE TABLE email_template/);
    assert.match(source, /CREATE TABLE email_outbox/);
    assert.match(source, /FOREIGN KEY \(recipient_tenant_user_id, tenant_id\) REFERENCES tenant_user\(id, tenant_id\)/);
    assert.match(source, /uq_email_outbox_tenant_idempotency_key/);
    assert.match(source, /ck_email_outbox_status CHECK \(status IN \('queued', 'processing', 'sent', 'retry', 'dead_letter'\)\)/);
    assert.match(source, /ck_email_template_allowed_variables_array/);
    assert.match(source, /internal_notification\.created/);
    assert.match(source, /email_outbox\.retry_scheduled/);
  }
  assert.match(migration, /INSERT INTO email_template/);
  assert.match(migration, /ON CONFLICT DO NOTHING/);
  assert.match(migration, /absence_request\.submitted\.manager/);
  assert.match(migration, /absence_request\.cancelled\.employee/);
});

test("template renderer allows only declared variables and escapes html values", () => {
  const template = {
    subject_template: "Hej {{name}}",
    html_template: "<p>{{name}}</p><a href=\"{{action_url}}\">Aabn</a>",
    text_template: "Hej {{name}} {{action_url}}",
    allowed_variables_json: ["name", "action_url"],
  };
  const rendered = renderTemplate(template, {
    name: "<script>",
    action_url: "https://tenant.example/app?x=1&y=2",
  });

  assert.equal(rendered.subject, "Hej <script>");
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.match(rendered.html, /x=1&amp;y=2/);
  assert.match(rendered.text, /x=1&y=2/);

  assert.throws(
    () => renderTemplate({ ...template, html_template: "{{unknown}}" }, { name: "A", action_url: "B", unknown: "C" }),
    /email_template_variable_not_allowed:unknown/
  );
  assert.throws(
    () => renderTemplate(template, { name: "A" }),
    /email_template_variable_missing:action_url/
  );
});

test("notification repositories use tenant-scoped lookups and locked outbox claiming", async () => {
  const client = createClient([]);
  await templateRepository.findActiveTemplate(client, {
    tenantId: uuid(1),
    templateKey: "absence_request.submitted.employee",
  });
  await outboxRepository.claimDueBatch(client, {
    tenantId: uuid(1),
    limit: 10,
    processingTimeoutMinutes: 15,
  });

  assert.match(client.calls[0].sql, /LEFT JOIN email_template system_template/);
  assert.match(client.calls[0].sql, /system_template.tenant_id IS NULL/);
  assert.match(client.calls[0].sql, /AND \(candidate.tenant_id = \$1 OR candidate.tenant_id IS NULL\)/);
  assert.match(client.calls[0].sql, /CASE WHEN candidate.tenant_id = \$1 THEN 0 ELSE 1 END/);
  assert.match(client.calls[1].sql, /WHERE tenant_id = \$1/);
  assert.match(client.calls[1].sql, /attempt_count < max_attempts/);
  assert.match(client.calls[1].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(client.calls[1].sql, /status IN \('queued', 'retry'\)/);
});

test("absence notification context omits comments and derives tenant action urls server-side", () => {
  const context = absenceNotificationService._test.buildContext({
    id: uuid(10),
    tenant_slug: "hoyrup-clemmensen",
    tenant_domain: "app.example.test",
    employee_tenant_user_id: uuid(2),
    employee_name: "Anne",
    employee_email: "anne@example.test",
    employee_status: "active",
    employee_login_status: "active",
    assigned_manager_tenant_user_id: uuid(3),
    assigned_manager_name: "Leder",
    manager_email: "leder@example.test",
    manager_status: "active",
    manager_login_status: "active",
    absence_type_name: "Ferie",
    duration_type: "full_days",
    start_date: "2026-08-10",
    end_date: "2026-08-11",
  });

  assert.equal(context.actionUrl, `https://app.example.test/login#absence-request-${uuid(10)}`);
  assert.equal(context.employee.email, "anne@example.test");
  assert.deepEqual(absenceNotificationService._test.safePayload(context), {
    absence_request_id: uuid(10),
    absence_type_name: "Ferie",
    absence_period: "10.08.2026 - 11.08.2026",
    start_date: "2026-08-10",
    end_date: "2026-08-11",
    duration_type: "full_days",
    special_window_name: null,
    special_window_submission_deadline: null,
    special_window_review_start_date: null,
  });
});

test("special-window submitted notifications use collective-review templates and safe variables", () => {
  const context = absenceNotificationService._test.buildContext({
    id: uuid(10),
    tenant_slug: "hoyrup-clemmensen",
    employee_tenant_user_id: uuid(2),
    employee_name: "Anne",
    employee_email: "anne@example.test",
    employee_status: "active",
    employee_login_status: "active",
    assigned_manager_tenant_user_id: uuid(3),
    assigned_manager_name: "Leder",
    manager_email: "leder@example.test",
    manager_status: "active",
    manager_login_status: "active",
    absence_type_name: "Ferie",
    duration_type: "full_days",
    start_date: "2026-07-01",
    end_date: "2026-07-07",
    special_window_name: "Sommerferie",
    special_window_submission_deadline: "2026-03-01",
    special_window_review_start_date: "2026-03-15",
    special_window_receipt_text: "Vi samler onskerne efter fristen.",
  });

  const variables = absenceNotificationService._test.submittedVariables(context);
  assert.equal(variables.special_window_name, "Sommerferie");
  assert.equal(variables.submission_deadline, "01.03.2026");
  assert.equal(variables.review_start_date, "15.03.2026");
  assert.equal(variables.receipt_text, "Vi samler onskerne efter fristen.");
  assert.deepEqual(absenceNotificationService._test.safePayload(context).special_window_name, "Sommerferie");
});
test("email enqueue renders template, writes dead-letter for missing recipient email and audits queue result", async () => {
  const calls = [];
  await withPatches([
    [templateRepository, "findActiveTemplate", async () => ({
      id: uuid(50),
      locale: "da-DK",
      subject_template: "Hej {{name}}",
      html_template: "<p>{{name}}</p>",
      text_template: "Hej {{name}}",
      allowed_variables_json: ["name"],
    })],
    [outboxRepository, "upsertEmail", async (_client, args) => {
      calls.push(args);
      return { id: uuid(60), status: args.status };
    }],
    [auditService, "logAuditEvent", async (event) => {
      calls.push({ audit: event });
    }],
  ], async () => {
    const row = await emailOutboxService.enqueueEmail(createClient(), {
      tenantId: uuid(1),
      actorId: uuid(2),
      templateKey: "absence_request.submitted.employee",
      recipientTenantUserId: uuid(2),
      recipientEmail: null,
      recipientName: "Anne",
      variables: { name: "Anne" },
      payload: { absence_request_id: uuid(10) },
      sourceId: uuid(10),
      idempotencyKey: "key",
    });
    assert.equal(row.status, "dead_letter");
  });

  assert.equal(calls[0].status, "dead_letter");
  assert.equal(calls[0].lastErrorCode, "recipient_email_missing");
  assert.equal(calls[0].subject, "Hej Anne");
  assert.equal(calls[1].audit.eventType, "email_outbox.queued");
  assert.equal(calls[1].audit.outcome, "fail");
});

test("processor classifies transient provider errors for retry and permanent 4xx for dead-letter", () => {
  assert.equal(emailOutboxProcessor._test.classifySendError({
    code: "mail_provider_disabled",
    statusCode: 503,
  }, { attempt_count: 1, max_attempts: 5 }).retry, true);

  assert.equal(emailOutboxProcessor._test.classifySendError({
    code: "mail_provider_rejected_message",
    details: { status: 400 },
  }, { attempt_count: 1, max_attempts: 5 }).retry, false);

  assert.equal(emailOutboxProcessor._test.classifySendError({
    code: "mail_provider_rejected_message",
    details: { status: 502 },
  }, { attempt_count: 5, max_attempts: 5 }).retry, false);
});

test("tenant template override cannot extend system allowlist", () => {
  assert.throws(
    () => templateRepository._test.assertTenantOverrideAllowed({
      id: uuid(70),
      tenant_id: uuid(1),
      template_key: "absence_request.submitted.employee",
      locale: "da-DK",
      allowed_variables_json: ["employee_name", "action_url", "secret_value"],
      system_allowed_variables_json: ["employee_name", "action_url"],
    }),
    /email_template_override_variable_not_allowed:secret_value/
  );

  assert.doesNotThrow(() => templateRepository._test.assertTenantOverrideAllowed({
    id: uuid(71),
    tenant_id: uuid(1),
    template_key: "absence_request.submitted.employee",
    locale: "da-DK",
    allowed_variables_json: ["employee_name"],
    system_allowed_variables_json: ["employee_name", "action_url"],
  }));
});

test("email enqueue dead-letters invalid recipient email without blocking request flow", async () => {
  const calls = [];
  await withPatches([
    [templateRepository, "findActiveTemplate", async () => ({
      id: uuid(50),
      locale: "da-DK",
      subject_template: "Hej {{name}}",
      html_template: "<p>{{name}}</p>",
      text_template: "Hej {{name}}",
      allowed_variables_json: ["name"],
    })],
    [outboxRepository, "upsertEmail", async (_client, args) => {
      calls.push(args);
      return { id: uuid(60), status: args.status };
    }],
    [auditService, "logAuditEvent", async (event) => {
      calls.push({ audit: event });
    }],
  ], async () => {
    const row = await emailOutboxService.enqueueEmail(createClient(), {
      tenantId: uuid(1),
      actorId: uuid(2),
      templateKey: "absence_request.submitted.employee",
      recipientTenantUserId: uuid(2),
      recipientEmail: "not-an-email",
      recipientName: "Anne",
      variables: { name: "Anne" },
      payload: { absence_request_id: uuid(10) },
      sourceId: uuid(10),
      idempotencyKey: "invalid-key",
    });
    assert.equal(row.status, "dead_letter");
  });

  assert.equal(calls[0].recipientEmail, "not-an-email");
  assert.equal(calls[0].lastErrorCode, "recipient_email_invalid");
  assert.equal(calls[1].audit.outcome, "fail");
});

test("inactive recipients are not materialized to internal notifications or outbox", async () => {
  let notificationCount = 0;
  let outboxCount = 0;
  await withPatches([
    [internalNotificationService, "createInternalNotification", async () => {
      notificationCount += 1;
      return { id: uuid(80) };
    }],
    [emailOutboxService, "enqueueEmail", async () => {
      outboxCount += 1;
      return { id: uuid(81), status: "queued" };
    }],
  ], async () => {
    const result = await absenceNotificationService.enqueueAbsenceSubmitted(createClient(), {
      tenantId: uuid(1),
      actorId: uuid(2),
      requestContext: {
        id: uuid(10),
        tenant_slug: "hoyrup-clemmensen",
        tenant_domain: "app.example.test",
        employee_tenant_user_id: uuid(2),
        employee_name: "Anne",
        employee_email: "anne@example.test",
        employee_status: "active",
        employee_login_status: "disabled",
        assigned_manager_tenant_user_id: uuid(3),
        assigned_manager_name: "Leder",
        manager_email: "leder@example.test",
        manager_status: "active",
        manager_login_status: "disabled",
        absence_type_name: "Ferie",
        duration_type: "full_days",
        start_date: "2026-08-10",
        end_date: "2026-08-11",
      },
    });
    assert.deepEqual(result, []);
  });

  assert.equal(notificationCount, 0);
  assert.equal(outboxCount, 0);
});

test("processor status-only and dry-run are read-only repository calls", async () => {
  const client = {
    calls: [],
    async query(sql) {
      this.calls.push(String(sql));
      return { rows: [] };
    },
    release() {},
  };
  let statsCount = 0;
  let previewCount = 0;

  await withPatches([
    [pool, "connect", async () => client],
    [outboxRepository, "getQueueStats", async () => {
      statsCount += 1;
      return [];
    }],
    [outboxRepository, "listDuePreview", async () => {
      previewCount += 1;
      return [];
    }],
    [outboxRepository, "claimDueBatch", async () => {
      throw new Error("claim_should_not_run");
    }],
  ], async () => {
    await emailOutboxProcessor.statusOnly({ tenantId: uuid(1) });
    await emailOutboxProcessor.dryRun({ tenantId: uuid(1), limit: 10 });
  });

  assert.equal(statsCount, 1);
  assert.equal(previewCount, 1);
  assert.equal(client.calls.filter((sql) => sql === "COMMIT").length, 2);
});
test("migration 0043 seeds manager decision employee templates with constrained variables", () => {
  const migration = read("migrations/0043_absence_manager_decision_email_templates.sql");
  const schema = read("schema.sql");

  for (const source of [migration, schema]) {
    assert.match(source, /absence_request\.approved\.employee/);
    assert.match(source, /absence_request\.rejected\.employee/);
    assert.match(source, /"employee_name"/);
    assert.match(source, /"manager_name"/);
    assert.match(source, /"absence_type"/);
    assert.match(source, /"start_date"/);
    assert.match(source, /"end_date"/);
    assert.match(source, /"action_url"/);
    assert.match(source, /"tenant_name"/);
    assert.match(source, /ON CONFLICT DO NOTHING/);
  }
  assert.match(migration, /absence_request\.approved\.employee[\s\S]+"start_time","end_time","action_url","tenant_name"/);
  assert.doesNotMatch(migration, /absence_request\.approved\.employee[\s\S]+"decision_reason"[\s\S]+absence_request\.rejected\.employee/);
  assert.match(migration, /absence_request\.rejected\.employee[\s\S]+"decision_reason"/);
});

test("approved and rejected employee notifications use neutral bodies and rejection reason only in email variables", async () => {
  const calls = [];
  await withPatches([
    [internalNotificationService, "createInternalNotification", async (_client, args) => {
      calls.push({ notification: args });
      return { id: uuid(80) };
    }],
    [emailOutboxService, "enqueueEmail", async (_client, args) => {
      calls.push({ email: args });
      return { id: uuid(81), status: "queued" };
    }],
  ], async () => {
    await absenceNotificationService.enqueueAbsenceApproved(createClient(), {
      tenantId: uuid(1),
      actorId: uuid(5),
      requestContext: {
        id: uuid(10),
        tenant_slug: "hoyrup-clemmensen",
        tenant_name: "Hoyrup Clemmensen",
        tenant_domain: "app.example.test",
        employee_tenant_user_id: uuid(2),
        employee_name: "Anne",
        employee_email: "anne@example.test",
        employee_status: "active",
        employee_login_status: "active",
        assigned_manager_tenant_user_id: uuid(5),
        assigned_manager_name: "Mads",
        manager_email: "mads@example.test",
        manager_status: "active",
        manager_login_status: "active",
        absence_type_name: "Ferie",
        duration_type: "full_days",
        start_date: "2026-08-10",
        end_date: "2026-08-11",
      },
    });
    await absenceNotificationService.enqueueAbsenceRejected(createClient(), {
      tenantId: uuid(1),
      actorId: uuid(5),
      decisionReason: "Ikke muligt i perioden",
      requestContext: {
        id: uuid(10),
        tenant_slug: "hoyrup-clemmensen",
        tenant_name: "Hoyrup Clemmensen",
        tenant_domain: "app.example.test",
        employee_tenant_user_id: uuid(2),
        employee_name: "Anne",
        employee_email: "anne@example.test",
        employee_status: "active",
        employee_login_status: "active",
        assigned_manager_tenant_user_id: uuid(5),
        assigned_manager_name: "Mads",
        manager_email: "mads@example.test",
        manager_status: "active",
        manager_login_status: "active",
        absence_type_name: "Ferie",
        duration_type: "full_days",
        start_date: "2026-08-10",
        end_date: "2026-08-11",
      },
    });
  });

  const approvedNotification = calls.find((call) => call.notification?.eventKey === "absence_request.approved.employee").notification;
  const rejectedNotification = calls.find((call) => call.notification?.eventKey === "absence_request.rejected.employee").notification;
  const rejectedEmail = calls.find((call) => call.email?.templateKey === "absence_request.rejected.employee").email;

  assert.equal(approvedNotification.title, "Fravaersanmodning godkendt");
  assert.equal(rejectedNotification.title, "Fravaersanmodning afvist");
  assert.doesNotMatch(rejectedNotification.body, /Ikke muligt/);
  assert.equal(rejectedEmail.variables.decision_reason, "Ikke muligt i perioden");
  assert.equal(rejectedEmail.payload.decision_reason, undefined);
  assert.equal(rejectedEmail.idempotencyKey, `${rejectedEmail.templateKey}:${uuid(10)}:${uuid(2)}`);
});
