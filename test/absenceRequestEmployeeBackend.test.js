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
const absenceNotificationService = require("../backend/src/modules/notifications/absenceNotification.service");
const approvedAbsenceService = require("../backend/src/modules/calendar/approvedAbsence.service");
const absenceValidation = require("../backend/src/modules/absence/absence.validation");
const absenceTypeRepository = require("../backend/src/modules/absence/absenceType.repository");
const absenceRequestRepository = require("../backend/src/modules/absence/absenceRequest.repository");
const absenceSpecialWindowRepository = require("../backend/src/modules/absence/absenceSpecialWindow.repository");
const employeeManagerRelationRepository = require("../backend/src/modules/absence/employeeManagerRelation.repository");
const absenceRequestService = require("../backend/src/modules/absence/absenceRequest.service");

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

function createTxClient() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      return { rows: [] };
    },
    release() {
      calls.push({ sql: "RELEASE", params: [] });
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

function notificationContextRow(overrides = {}) {
  return {
    ...detailRow({
      status: "submitted",
      assigned_manager_tenant_user_id: uuid(5),
      absence_type_name: "Ferie",
    }),
    tenant_slug: "hoyrup-clemmensen",
    tenant_domain: "app.example.test",
    employee_name: "Medarbejder",
    employee_email: "medarbejder@example.test",
    employee_status: "active",
    employee_login_status: "active",
    assigned_manager_name: "Leder",
    manager_email: "leder@example.test",
    manager_status: "active",
    manager_login_status: "active",
    special_window_name: null,
    ...overrides,
  };
}
function detailRow(overrides = {}) {
  return {
    id: uuid(10),
    absence_type_id: uuid(1),
    absence_type_key: "vacation",
    absence_type_name: "Ferie",
    absence_type_workflow_mode: "request",
    absence_type_comment_policy: "optional",
    absence_type_visibility_policy: "private",
    absence_type_allowed_duration_types: ["full_days", "time_range"],
    absence_type_special_window_eligible: false,
    absence_type_is_active: true,
    duration_type: "full_days",
    start_date: "2026-08-10",
    end_date: "2026-08-11",
    start_time: null,
    end_time: null,
    timezone: "Europe/Copenhagen",
    employee_comment: null,
    status: "draft",
    assigned_manager_tenant_user_id: null,
    special_window_id: null,
    submitted_at: null,
    cancelled_at: null,
    version: 1,
    created_at: "2026-08-06T00:00:00.000Z",
    updated_at: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

function assertHttpError(fn, statusCode, message) {
  assert.throws(fn, (error) => error.statusCode === statusCode && error.message === message);
}

function requestType(overrides = {}) {
  return {
    id: uuid(9),
    is_active: true,
    workflow_mode: "request",
    comment_policy: "optional",
    allowed_duration_types: ["full_days", "time_range"],
    special_window_eligible: false,
    ...overrides,
  };
}

test("employee request validation supports full days and time ranges only for PR3", () => {
  assert.deepEqual(absenceValidation.normalizeCreatePayload({
    absence_type_id: uuid(1),
    duration_type: "full_days",
    start_date: "2026-08-10",
    end_date: "2026-08-12",
    timezone: "Europe/Copenhagen",
  }), {
    absenceTypeId: uuid(1),
    durationType: "full_days",
    dayPart: null,
    startDate: "2026-08-10",
    endDate: "2026-08-12",
    startTime: null,
    endTime: null,
    timezone: "Europe/Copenhagen",
    employeeComment: null,
  });

  assert.equal(absenceValidation.normalizeCreatePayload({
    absence_type_id: uuid(1),
    duration_type: "time_range",
    start_date: "2026-08-10",
    start_time: "08:00",
    end_time: "12:30:00",
  }).endDate, null);

  assertHttpError(() => absenceValidation.normalizeCreatePayload({
    absence_type_id: uuid(1),
    duration_type: "partial_day",
    start_date: "2026-08-10",
    end_date: "2026-08-10",
  }), 400, "partial_day is not supported yet");
});

test("employee request validation rejects client-controlled identity and status fields", () => {
  for (const field of ["tenant_id", "employee_tenant_user_id", "assigned_manager_tenant_user_id", "status", "special_window_id"]) {
    assertHttpError(() => absenceValidation.normalizeCreatePayload({
      absence_type_id: uuid(1),
      duration_type: "full_days",
      start_date: "2026-08-10",
      end_date: "2026-08-10",
      [field]: uuid(2),
    }), 400, "absence_request_server_managed_field");
  }

  assertHttpError(() => absenceValidation.normalizeActionVersion({
    version: 1,
    status: "submitted",
  }), 400, "absence_request_server_managed_field");
});

test("employee request validation enforces version, comments and absence type policy", () => {
  assertHttpError(() => absenceValidation.normalizeUpdatePayload({ employee_comment: "x" }, {
    absence_type_id: uuid(1),
    duration_type: "full_days",
    start_date: "2026-08-10",
    end_date: "2026-08-11",
    timezone: "Europe/Copenhagen",
  }), 400, "version_required");

  assertHttpError(() => absenceValidation.normalizeCreatePayload({
    absence_type_id: uuid(1),
    duration_type: "full_days",
    start_date: "2026-08-10",
    end_date: "2026-08-11",
    employee_comment: "x".repeat(251),
  }), 400, "absence_employee_comment_too_long");

  assertHttpError(() => absenceRequestService._test.validatePayloadAgainstType(requestType({ is_active: false }), {
    durationType: "full_days",
    employeeComment: null,
  }), 400, "absence_type_inactive");

  assertHttpError(() => absenceRequestService._test.validatePayloadAgainstType(requestType({ comment_policy: "disabled" }), {
    durationType: "full_days",
    employeeComment: "private",
  }), 400, "absence_employee_comment_disabled");
});

test("employee request repositories use tenant, employee and optimistic locking predicates", async () => {
  const client = createClient([{ id: uuid(3), version: 2 }]);
  await absenceRequestRepository.findByIdForEmployee(client, {
    tenantId: uuid(1),
    employeeTenantUserId: uuid(2),
    absenceRequestId: uuid(3),
    forUpdate: true,
  });
  await absenceRequestRepository.updateDraftForEmployee(client, {
    tenantId: uuid(1),
    employeeTenantUserId: uuid(2),
    absenceRequestId: uuid(3),
    expectedVersion: 1,
    absenceTypeId: uuid(4),
    durationType: "full_days",
    startDate: "2026-08-10",
    endDate: "2026-08-11",
    timezone: "Europe/Copenhagen",
  });
  await absenceRequestRepository.submitDraftForEmployee(client, {
    tenantId: uuid(1),
    employeeTenantUserId: uuid(2),
    absenceRequestId: uuid(3),
    expectedVersion: 2,
    managerTenantUserId: uuid(5),
    specialWindowId: null,
  });
  await absenceRequestRepository.cancelForEmployee(client, {
    tenantId: uuid(1),
    employeeTenantUserId: uuid(2),
    absenceRequestId: uuid(3),
    expectedVersion: 3,
    allowedStatuses: ["draft", "submitted"],
  });

  assert.match(client.calls[0].sql, /ar\.tenant_id = \$1/);
  assert.match(client.calls[0].sql, /ar\.employee_tenant_user_id = \$2/);
  assert.match(client.calls[0].sql, /FOR UPDATE OF ar/);
  assert.match(client.calls[1].sql, /employee_tenant_user_id = \$2/);
  assert.match(client.calls[1].sql, /version = \$4/);
  assert.match(client.calls[1].sql, /status = 'draft'/);
  assert.match(client.calls[2].sql, /submitted_at = now\(\)/);
  assert.match(client.calls[2].sql, /status = 'draft'/);
  assert.match(client.calls[3].sql, /status = ANY\(\$5::text\[\]\)/);
});

test("employee request idempotency is backed by transaction-scoped advisory locks and event metadata", async () => {
  const client = createClient([]);
  await absenceRequestRepository.acquireIdempotencyLock(client, { lockKey: "absence:create:tenant:user:key" });
  await absenceRequestRepository.findCreatedByIdempotencyKey(client, {
    tenantId: uuid(1),
    employeeTenantUserId: uuid(2),
    idempotencyKey: "client-key",
  });

  assert.match(client.calls[0].sql, /pg_advisory_xact_lock/);
  assert.match(client.calls[1].sql, /metadata_json->>'idempotency_key' = \$3/);
  assert.deepEqual(client.calls[1].params, [uuid(1), uuid(2), "client-key"]);
});

test("manager auto assignment only considers one active primary Fielddesk manager", async () => {
  const client = createClient([]);
  await employeeManagerRelationRepository.findActivePrimaryManagersForEmployee(client, {
    tenantId: uuid(1),
    employeeTenantUserId: uuid(2),
    asOfDate: "2026-08-06",
  });

  assert.match(client.calls[0].sql, /emr\.relation_type = 'primary'/);
  assert.match(client.calls[0].sql, /manager\.status = 'active'/);
  assert.match(client.calls[0].sql, /manager\.login_status = 'active'/);
  assert.match(client.calls[0].sql, /emr\.tenant_id = \$1/);
  assert.match(client.calls[0].sql, /emr\.employee_tenant_user_id = \$2/);
});

test("special-window matching accepts tenant-scoped resource-group matches and rejects partial overlaps", async () => {
  const original = absenceSpecialWindowRepository.listOverlappingActiveScopedForEmployee;
  const type = requestType({ special_window_eligible: true });
  try {
    absenceSpecialWindowRepository.listOverlappingActiveScopedForEmployee = async () => ([{
      id: uuid(30),
      scope_type: "resource_group",
      fully_contains_request: true,
    }]);
    const groupMatch = await absenceRequestService._test.resolveSpecialWindow({
      query: async () => ({ rows: [] }),
    }, {
      tenantId: uuid(1),
      employeeTenantUserId: uuid(2),
      absenceType: type,
      absenceTypeId: uuid(3),
      startDate: "2026-08-10",
      endDate: "2026-08-12",
    });
    assert.equal(groupMatch.id, uuid(30));

    absenceSpecialWindowRepository.listOverlappingActiveScopedForEmployee = async () => ([{
      id: uuid(31),
      scope_type: "tenant",
      fully_contains_request: false,
    }]);
    await assert.rejects(
      absenceRequestService._test.resolveSpecialWindow({
        query: async () => ({ rows: [] }),
      }, {
        tenantId: uuid(1),
        employeeTenantUserId: uuid(2),
        absenceType: type,
        absenceTypeId: uuid(3),
        startDate: "2026-08-10",
        endDate: "2026-08-12",
      }),
      (error) => error.statusCode === 409 && error.message === "absence_special_window_partial_overlap"
    );
  } finally {
    absenceSpecialWindowRepository.listOverlappingActiveScopedForEmployee = original;
  }
});

test("employee absence request routes are tenant-authenticated, permission-gated and mounted", () => {
  const routes = read("backend/src/modules/absence/absence.routes.js");
  const tenantSurfaceRoutes = read("backend/src/routes/tenantSurfaceRoutes.js");

  for (const action of ["read_own", "create_own", "update_own_draft", "submit_own", "cancel_own", "read_own_history"]) {
    assert.match(routes, new RegExp(`"${action}"`));
  }
  assert.match(routes, /requireTenantHost/);
  assert.match(routes, /requireAuth\("access"\)/);
  assert.match(routes, /tenant_context_mismatch/);
  assert.match(routes, /Idempotency-Key/);
  assert.match(routes, /\/api\/calendar\/absence-requests\/mine/);
  assert.match(routes, /\/api\/calendar\/absence-requests\/:id\/submit/);
  assert.match(routes, /\/api\/calendar\/absence-requests\/:id\/cancel/);
  assert.match(tenantSurfaceRoutes, /absenceRoutes/);
  assert.match(tenantSurfaceRoutes, /router\.use\(absenceRoutes\)/);
});

test("employee request service keeps mutations transactional and avoids private comments in audit metadata", () => {
  const source = read("backend/src/modules/absence/absenceRequest.service.js");
  assert.match(source, /withTransaction\(async \(client\) =>/);
  assert.match(source, /absence_request\.created/);
  assert.match(source, /absence_request\.updated/);
  assert.match(source, /absence_request\.submitted/);
  assert.match(source, /absence_request\.late_submitted/);
  assert.match(source, /absence_request\.cancelled/);
  assert.match(source, /private_comment_changed/);
  assert.doesNotMatch(source, /employee_comment:\s*payload\.employeeComment/);
});
test("create draft reuses persisted idempotency event metadata on sequential retry", async () => {
  const clients = [createTxClient(), createTxClient()];
  let clientIndex = 0;
  let createdRequestId = null;
  let insertCount = 0;
  let eventCount = 0;
  let auditCount = 0;
  const locks = [];

  await withPatches([
    [pool, "connect", async () => clients[clientIndex++]],
    [absenceTypeRepository, "findById", async () => requestType()],
    [absenceRequestRepository, "acquireIdempotencyLock", async (_client, { lockKey }) => locks.push(lockKey)],
    [absenceRequestRepository, "findCreatedByIdempotencyKey", async () => (createdRequestId ? { id: createdRequestId } : null)],
    [absenceRequestRepository, "insertRequest", async () => {
      insertCount += 1;
      createdRequestId = uuid(10);
      return { id: createdRequestId };
    }],
    [absenceRequestRepository, "insertEvent", async (_client, event) => {
      eventCount += 1;
      assert.equal(event.metadata.idempotency_key, "abc");
      return { id: uuid(20) };
    }],
    [absenceRequestRepository, "findByIdForEmployee", async () => detailRow({ id: createdRequestId || uuid(10) })],
    [auditService, "logAuditEvent", async () => {
      auditCount += 1;
    }],
  ], async () => {
    const payload = {
      absence_type_id: uuid(1),
      duration_type: "full_days",
      start_date: "2026-08-10",
      end_date: "2026-08-11",
    };
    const first = await absenceRequestService.createDraft({ tenantId: uuid(1), userId: uuid(2), body: payload, idempotencyKey: "abc" });
    const second = await absenceRequestService.createDraft({ tenantId: uuid(1), userId: uuid(2), body: payload, idempotencyKey: "abc" });

    assert.equal(first.idempotent, false);
    assert.equal(second.idempotent, true);
    assert.equal(first.request.id, second.request.id);
  });

  assert.equal(insertCount, 1);
  assert.equal(eventCount, 1);
  assert.equal(auditCount, 1);
  assert.equal(locks.length, 2);
  assert.equal(new Set(locks).size, 1);
  assert.equal(clients.flatMap((client) => client.calls.map((call) => call.sql)).filter((sql) => sql === "COMMIT").length, 2);
  assert.equal(clients.flatMap((client) => client.calls.map((call) => call.sql)).includes("ROLLBACK"), false);
});

test("create draft rolls back when request event insert fails", async () => {
  const client = createTxClient();
  let auditCount = 0;

  await withPatches([
    [pool, "connect", async () => client],
    [absenceTypeRepository, "findById", async () => requestType()],
    [absenceRequestRepository, "insertRequest", async () => ({ id: uuid(10) })],
    [absenceRequestRepository, "insertEvent", async () => {
      throw new Error("event_insert_failed");
    }],
    [auditService, "logAuditEvent", async () => {
      auditCount += 1;
    }],
  ], async () => {
    await assert.rejects(
      absenceRequestService.createDraft({
        tenantId: uuid(1),
        userId: uuid(2),
        body: {
          absence_type_id: uuid(1),
          duration_type: "full_days",
          start_date: "2026-08-10",
          end_date: "2026-08-11",
        },
      }),
      /event_insert_failed/
    );
  });

  assert.deepEqual(client.calls.map((call) => call.sql).filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)), ["BEGIN", "ROLLBACK"]);
  assert.equal(auditCount, 0);
});

test("update draft rolls back when audit insert fails after request event", async () => {
  const client = createTxClient();
  let updateCount = 0;
  let eventCount = 0;

  await withPatches([
    [pool, "connect", async () => client],
    [absenceTypeRepository, "findById", async () => requestType()],
    [absenceRequestRepository, "findByIdForEmployee", async () => detailRow()],
    [absenceRequestRepository, "updateDraftForEmployee", async () => {
      updateCount += 1;
      return detailRow({ version: 2, employee_comment: "Ny note" });
    }],
    [absenceRequestRepository, "insertEvent", async () => {
      eventCount += 1;
      return { id: uuid(20) };
    }],
    [auditService, "logAuditEvent", async () => {
      throw new Error("audit_insert_failed");
    }],
  ], async () => {
    await assert.rejects(
      absenceRequestService.updateDraft({
        tenantId: uuid(1),
        userId: uuid(2),
        absenceRequestId: uuid(10),
        body: { version: 1, employee_comment: "Ny note" },
      }),
      /audit_insert_failed/
    );
  });

  assert.equal(updateCount, 1);
  assert.equal(eventCount, 1);
  assert.deepEqual(client.calls.map((call) => call.sql).filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)), ["BEGIN", "ROLLBACK"]);
});

test("repeated submit returns submitted state without new mutation, event or audit", async () => {
  const client = createTxClient();
  let managerLookupCount = 0;
  let submitCount = 0;
  let eventCount = 0;
  let auditCount = 0;

  await withPatches([
    [pool, "connect", async () => client],
    [absenceRequestRepository, "findByIdForEmployee", async () => detailRow({ status: "submitted", version: 2, assigned_manager_tenant_user_id: uuid(5) })],
    [employeeManagerRelationRepository, "findActivePrimaryManagersForEmployee", async () => {
      managerLookupCount += 1;
      return [];
    }],
    [absenceRequestRepository, "submitDraftForEmployee", async () => {
      submitCount += 1;
      return null;
    }],
    [absenceRequestRepository, "insertEvent", async () => {
      eventCount += 1;
    }],
    [auditService, "logAuditEvent", async () => {
      auditCount += 1;
    }],
  ], async () => {
    const result = await absenceRequestService.submitDraft({
      tenantId: uuid(1),
      userId: uuid(2),
      absenceRequestId: uuid(10),
      body: { version: 1 },
      idempotencyKey: "submit-1",
    });
    assert.equal(result.idempotent, true);
    assert.equal(result.request.status, "submitted");
  });

  assert.equal(managerLookupCount, 0);
  assert.equal(submitCount, 0);
  assert.equal(eventCount, 0);
  assert.equal(auditCount, 0);
  assert.deepEqual(client.calls.map((call) => call.sql).filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)), ["BEGIN", "COMMIT"]);
});

test("repeated cancel returns cancelled state without duplicate event or audit", async () => {
  const client = createTxClient();
  let cancelCount = 0;
  let eventCount = 0;
  let auditCount = 0;

  await withPatches([
    [pool, "connect", async () => client],
    [absenceRequestRepository, "findByIdForEmployee", async () => detailRow({ status: "cancelled", version: 2, cancelled_at: "2026-08-06T00:00:00.000Z" })],
    [absenceRequestRepository, "cancelForEmployee", async () => {
      cancelCount += 1;
      return null;
    }],
    [absenceRequestRepository, "insertEvent", async () => {
      eventCount += 1;
    }],
    [auditService, "logAuditEvent", async () => {
      auditCount += 1;
    }],
  ], async () => {
    const result = await absenceRequestService.cancelOwn({
      tenantId: uuid(1),
      userId: uuid(2),
      absenceRequestId: uuid(10),
      body: { version: 1 },
    });
    assert.equal(result.idempotent, true);
    assert.equal(result.request.status, "cancelled");
  });

  assert.equal(cancelCount, 0);
  assert.equal(eventCount, 0);
  assert.equal(auditCount, 0);
});
test("submit requires exactly one active primary manager and snapshots manager on success", async () => {
  async function runCase(managers) {
    const client = createTxClient();
    let submitArgs = null;
    let currentRow = detailRow();
    let eventCount = 0;
    let auditCount = 0;
    let notificationCount = 0;

    await withPatches([
      [pool, "connect", async () => client],
      [absenceRequestRepository, "findByIdForEmployee", async () => currentRow],
      [employeeManagerRelationRepository, "findActivePrimaryManagersForEmployee", async () => managers],
      [absenceSpecialWindowRepository, "listOverlappingActiveScopedForEmployee", async () => []],
      [absenceRequestRepository, "submitDraftForEmployee", async (_client, args) => {
        submitArgs = args;
        currentRow = detailRow({ status: "submitted", version: 2, assigned_manager_tenant_user_id: args.managerTenantUserId });
        return currentRow;
      }],
      [absenceRequestRepository, "insertEvent", async () => {
        eventCount += 1;
        return { id: uuid(20) };
      }],
      [auditService, "logAuditEvent", async () => {
        auditCount += 1;
      }],
      [absenceRequestRepository, "findNotificationContextById", async () => notificationContextRow({ assigned_manager_tenant_user_id: uuid(5) })],
      [absenceNotificationService, "enqueueAbsenceSubmitted", async () => {
        notificationCount += 1;
      }],
    ], async () => {
      const result = await absenceRequestService.submitDraft({
        tenantId: uuid(1),
        userId: uuid(2),
        absenceRequestId: uuid(10),
        body: { version: 1 },
      });
      assert.equal(result.request.status, "submitted");
    });

    assert.equal(submitArgs.managerTenantUserId, uuid(5));
    assert.equal(eventCount, 1);
    assert.equal(auditCount, 1);
    assert.equal(notificationCount, 1);
    assert.deepEqual(client.calls.map((call) => call.sql).filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)), ["BEGIN", "COMMIT"]);
  }

  await runCase([{
    id: uuid(30),
    manager_tenant_user_id: uuid(5),
    manager_status: "active",
    manager_login_status: "active",
  }]);
});

test("submit rejects missing, ambiguous, self or inactive primary manager without event or audit", async () => {
  const cases = [
    { managers: [], message: "absence_manager_not_found" },
    { managers: [
      { id: uuid(30), manager_tenant_user_id: uuid(5), manager_status: "active", manager_login_status: "active" },
      { id: uuid(31), manager_tenant_user_id: uuid(6), manager_status: "active", manager_login_status: "active" },
    ], message: "absence_manager_ambiguous" },
    { managers: [{ id: uuid(30), manager_tenant_user_id: uuid(2), manager_status: "active", manager_login_status: "active" }], message: "absence_manager_ambiguous" },
    { managers: [{ id: uuid(30), manager_tenant_user_id: uuid(5), manager_status: "inactive", manager_login_status: "active" }], message: "absence_manager_not_found" },
    { managers: [{ id: uuid(30), manager_tenant_user_id: uuid(5), manager_status: "active", manager_login_status: "pending" }], message: "absence_manager_not_found" },
  ];

  for (const testCase of cases) {
    const client = createTxClient();
    let submitCount = 0;
    let eventCount = 0;
    let auditCount = 0;

    await withPatches([
      [pool, "connect", async () => client],
      [absenceRequestRepository, "findByIdForEmployee", async () => detailRow()],
      [employeeManagerRelationRepository, "findActivePrimaryManagersForEmployee", async () => testCase.managers],
      [absenceRequestRepository, "submitDraftForEmployee", async () => {
        submitCount += 1;
      }],
      [absenceRequestRepository, "insertEvent", async () => {
        eventCount += 1;
      }],
      [auditService, "logAuditEvent", async () => {
        auditCount += 1;
      }],
    ], async () => {
      await assert.rejects(
        absenceRequestService.submitDraft({
          tenantId: uuid(1),
          userId: uuid(2),
          absenceRequestId: uuid(10),
          body: { version: 1 },
        }),
        (error) => error.statusCode === 409 && error.message === testCase.message
      );
    });

    assert.equal(submitCount, 0);
    assert.equal(eventCount, 0);
    assert.equal(auditCount, 0);
    assert.deepEqual(client.calls.map((call) => call.sql).filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)), ["BEGIN", "ROLLBACK"]);
  }
});

test("submit revalidates current absence type before manager lookup or events", async () => {
  const rows = [
    detailRow({ absence_type_is_active: false }),
    detailRow({ absence_type_workflow_mode: "direct" }),
    detailRow({ absence_type_allowed_duration_types: ["time_range"] }),
    detailRow({ absence_type_comment_policy: "required", employee_comment: null }),
    detailRow({ absence_type_comment_policy: "disabled", employee_comment: "note" }),
  ];

  for (const row of rows) {
    const client = createTxClient();
    let managerLookupCount = 0;
    let eventCount = 0;
    let auditCount = 0;

    await withPatches([
      [pool, "connect", async () => client],
      [absenceRequestRepository, "findByIdForEmployee", async () => row],
      [employeeManagerRelationRepository, "findActivePrimaryManagersForEmployee", async () => {
        managerLookupCount += 1;
        return [];
      }],
      [absenceRequestRepository, "insertEvent", async () => {
        eventCount += 1;
      }],
      [auditService, "logAuditEvent", async () => {
        auditCount += 1;
      }],
    ], async () => {
      await assert.rejects(
        absenceRequestService.submitDraft({
          tenantId: uuid(1),
          userId: uuid(2),
          absenceRequestId: uuid(10),
          body: { version: 1 },
        }),
        (error) => error.statusCode === 400
      );
    });

    assert.equal(managerLookupCount, 0);
    assert.equal(eventCount, 0);
    assert.equal(auditCount, 0);
  }
});

test("patch rejects every server-owned field and unknown fields", () => {
  const existing = detailRow();
  for (const field of [
    "tenant_id",
    "employee_tenant_user_id",
    "employee_fitter_id",
    "assigned_manager_tenant_user_id",
    "special_window_id",
    "status",
    "submitted_at",
    "cancelled_at",
    "created_at",
    "updated_at",
  ]) {
    assertHttpError(() => absenceValidation.normalizeUpdatePayload({ version: 1, [field]: "x" }, existing), 400, "absence_request_server_managed_field");
  }
  assertHttpError(() => absenceValidation.normalizeUpdatePayload({ version: 1, unexpected: "x" }, existing), 400, "absence_request_unknown_field");
});

test("cancel allows draft and submitted only and rejects approved without event", async () => {
  for (const status of ["draft", "submitted"]) {
    const client = createTxClient();
    let cancelArgs = null;
    let currentRow = detailRow({ status });
    let eventCount = 0;
    let auditCount = 0;
    let notificationCount = 0;
    await withPatches([
      [pool, "connect", async () => client],
      [absenceRequestRepository, "findByIdForEmployee", async () => currentRow],
      [absenceRequestRepository, "cancelForEmployee", async (_client, args) => {
        cancelArgs = args;
        currentRow = detailRow({ status: "cancelled", version: 2 });
        return currentRow;
      }],
      [absenceRequestRepository, "insertEvent", async () => {
        eventCount += 1;
        return { id: uuid(20) };
      }],
      [auditService, "logAuditEvent", async () => {
        auditCount += 1;
      }],
      [absenceRequestRepository, "findNotificationContextById", async () => notificationContextRow({ status: "cancelled" })],
      [absenceNotificationService, "enqueueAbsenceCancelled", async () => {
        notificationCount += 1;
      }],
    ], async () => {
      const result = await absenceRequestService.cancelOwn({ tenantId: uuid(1), userId: uuid(2), absenceRequestId: uuid(10), body: { version: 1 } });
      assert.equal(result.request.status, "cancelled");
    });
    assert.deepEqual(cancelArgs.allowedStatuses, ["draft", "submitted"]);
    assert.equal(eventCount, 1);
    assert.equal(auditCount, 1);
    assert.equal(notificationCount, 1);
  }

  const client = createTxClient();
  let eventCount = 0;
  await withPatches([
    [pool, "connect", async () => client],
    [absenceRequestRepository, "findByIdForEmployee", async () => detailRow({ status: "approved" })],
    [absenceRequestRepository, "insertEvent", async () => {
      eventCount += 1;
    }],
  ], async () => {
    await assert.rejects(
      absenceRequestService.cancelOwn({ tenantId: uuid(1), userId: uuid(2), absenceRequestId: uuid(10), body: { version: 1 } }),
      (error) => error.statusCode === 409 && error.message === "absence_request_not_cancellable"
    );
  });
  assert.equal(eventCount, 0);
});

test("special-window submit timing enforces open date and late policy", () => {
  const base = {
    id: uuid(50),
    name: "Sommerferie",
    submission_open_date: "2026-01-10",
    submission_deadline: "2026-01-20",
  };

  assert.throws(
    () => absenceRequestService._test.validateSpecialWindowSubmissionTiming(base, { asOfDate: "2026-01-09" }),
    (error) => error.statusCode === 409 && error.message === "absence_special_window_not_open"
  );
  assert.throws(
    () => absenceRequestService._test.validateSpecialWindowSubmissionTiming({ ...base, late_submission_policy: "blocked" }, { asOfDate: "2026-01-21" }),
    (error) => error.statusCode === 409 && error.message === "absence_special_window_deadline_passed"
  );

  const manual = absenceRequestService._test.validateSpecialWindowSubmissionTiming({ ...base, late_submission_policy: "manual_review" }, { asOfDate: "2026-01-21" });
  assert.equal(manual.submittedAfterDeadline, true);
  assert.equal(manual.metadata.late_submission_requires_manual_review, true);

  const allowed = absenceRequestService._test.validateSpecialWindowSubmissionTiming({ ...base, late_submission_policy: "allowed" }, { asOfDate: "2026-01-21" });
  assert.equal(allowed.submittedAfterDeadline, true);
  assert.equal(allowed.metadata.late_submission_requires_manual_review, false);
});
test("special-window matching accepts one exact tenant or user match and rejects multiple matches", async () => {
  const original = absenceSpecialWindowRepository.listOverlappingActiveScopedForEmployee;
  const type = requestType({ special_window_eligible: true });
  try {
    absenceSpecialWindowRepository.listOverlappingActiveScopedForEmployee = async () => ([{
      id: uuid(40),
      scope_type: "tenant_user",
      fully_contains_request: true,
    }]);
    const match = await absenceRequestService._test.resolveSpecialWindow({ query: async () => ({ rows: [] }) }, {
      tenantId: uuid(1),
      employeeTenantUserId: uuid(2),
      absenceType: type,
      absenceTypeId: uuid(3),
      startDate: "2026-08-10",
      endDate: "2026-08-12",
    });
    assert.equal(match.id, uuid(40));

    absenceSpecialWindowRepository.listOverlappingActiveScopedForEmployee = async () => ([
      { id: uuid(40), scope_type: "tenant", fully_contains_request: true },
      { id: uuid(41), scope_type: "tenant_user", fully_contains_request: true },
    ]);
    await assert.rejects(
      absenceRequestService._test.resolveSpecialWindow({ query: async () => ({ rows: [] }) }, {
        tenantId: uuid(1),
        employeeTenantUserId: uuid(2),
        absenceType: type,
        absenceTypeId: uuid(3),
        startDate: "2026-08-10",
        endDate: "2026-08-12",
      }),
      (error) => error.statusCode === 409 && error.message === "absence_special_window_conflict"
    );
  } finally {
    absenceSpecialWindowRepository.listOverlappingActiveScopedForEmployee = original;
  }
});
test("submit rolls back when notification or outbox enqueue fails", async () => {
  const client = createTxClient();
  let currentRow = detailRow();
  let eventCount = 0;
  let auditCount = 0;

  await withPatches([
    [pool, "connect", async () => client],
    [absenceRequestRepository, "findByIdForEmployee", async () => currentRow],
    [employeeManagerRelationRepository, "findActivePrimaryManagersForEmployee", async () => ([{
      id: uuid(30),
      manager_tenant_user_id: uuid(5),
      manager_status: "active",
      manager_login_status: "active",
    }])],
    [absenceSpecialWindowRepository, "listOverlappingActiveScopedForEmployee", async () => []],
    [absenceRequestRepository, "submitDraftForEmployee", async () => {
      currentRow = detailRow({ status: "submitted", version: 2, assigned_manager_tenant_user_id: uuid(5) });
      return currentRow;
    }],
    [absenceRequestRepository, "insertEvent", async () => {
      eventCount += 1;
      return { id: uuid(20) };
    }],
    [auditService, "logAuditEvent", async () => {
      auditCount += 1;
    }],
    [absenceRequestRepository, "findNotificationContextById", async () => notificationContextRow({ assigned_manager_tenant_user_id: uuid(5) })],
    [absenceNotificationService, "enqueueAbsenceSubmitted", async () => {
      throw new Error("notification_enqueue_failed");
    }],
  ], async () => {
    await assert.rejects(
      absenceRequestService.submitDraft({
        tenantId: uuid(1),
        userId: uuid(2),
        absenceRequestId: uuid(10),
        body: { version: 1 },
      }),
      /notification_enqueue_failed/
    );
  });

  assert.equal(eventCount, 1);
  assert.equal(auditCount, 1);
  assert.deepEqual(client.calls.map((call) => call.sql).filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)), ["BEGIN", "ROLLBACK"]);
});

test("cancel rolls back when notification or outbox enqueue fails", async () => {
  const client = createTxClient();
  let currentRow = detailRow({ status: "submitted" });
  let eventCount = 0;
  let auditCount = 0;

  await withPatches([
    [pool, "connect", async () => client],
    [absenceRequestRepository, "findByIdForEmployee", async () => currentRow],
    [absenceRequestRepository, "cancelForEmployee", async () => {
      currentRow = detailRow({ status: "cancelled", version: 2, assigned_manager_tenant_user_id: uuid(5) });
      return currentRow;
    }],
    [absenceRequestRepository, "insertEvent", async () => {
      eventCount += 1;
      return { id: uuid(20) };
    }],
    [auditService, "logAuditEvent", async () => {
      auditCount += 1;
    }],
    [absenceRequestRepository, "findNotificationContextById", async () => notificationContextRow({ status: "cancelled", assigned_manager_tenant_user_id: uuid(5) })],
    [absenceNotificationService, "enqueueAbsenceCancelled", async () => {
      throw new Error("outbox_enqueue_failed");
    }],
  ], async () => {
    await assert.rejects(
      absenceRequestService.cancelOwn({
        tenantId: uuid(1),
        userId: uuid(2),
        absenceRequestId: uuid(10),
        body: { version: 1 },
      }),
      /outbox_enqueue_failed/
    );
  });

  assert.equal(eventCount, 1);
  assert.equal(auditCount, 1);
  assert.deepEqual(client.calls.map((call) => call.sql).filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)), ["BEGIN", "ROLLBACK"]);
});

test("manager request validation accepts only version and bounded reason", () => {
  assert.deepEqual(absenceValidation.normalizeApprovePayload({ version: 3 }), { version: 3, reason: null });
  assert.deepEqual(absenceValidation.normalizeApprovePayload({ version: 3, reason: "  Tidlig godkendelse  " }), { version: 3, reason: "Tidlig godkendelse" });
  assert.deepEqual(absenceValidation.normalizeRejectPayload({ version: 3, reason: " Ikke muligt " }), { version: 3, reason: "Ikke muligt" });

  assertHttpError(() => absenceValidation.normalizeRejectPayload({ version: 3 }), 400, "absence_reject_reason_required");
  assertHttpError(() => absenceValidation.normalizeRejectPayload({ version: 3, reason: "x".repeat(501) }), 400, "absence_manager_reason_too_long");
  assertHttpError(() => absenceValidation.normalizeApprovePayload({ version: 3, employee_tenant_user_id: uuid(2) }), 400, "absence_request_server_managed_field");
  assertHttpError(() => absenceValidation.normalizeRejectPayload({ version: 3, reason: "nej", status: "approved" }), 400, "absence_request_server_managed_field");
});

test("manager repositories scope list, detail and decision updates by tenant and assigned manager", async () => {
  const client = createClient([{ id: uuid(10), version: 2 }]);
  await absenceRequestRepository.listForManager(client, {
    tenantId: uuid(1),
    managerTenantUserId: uuid(5),
    statuses: ["submitted", "ready_for_review"],
    limit: 25,
    offset: 0,
  });
  await absenceRequestRepository.findByIdForManager(client, {
    tenantId: uuid(1),
    managerTenantUserId: uuid(5),
    absenceRequestId: uuid(10),
    forUpdate: true,
  });
  await absenceRequestRepository.updateManagedDecision(client, {
    tenantId: uuid(1),
    managerTenantUserId: uuid(5),
    absenceRequestId: uuid(10),
    expectedVersion: 2,
    fromStatuses: ["submitted", "ready_for_review"],
    toStatus: "approved",
  });

  assert.match(client.calls[0].sql, /ar\.tenant_id = \$1/);
  assert.match(client.calls[0].sql, /ar\.assigned_manager_tenant_user_id = \$2/);
  assert.match(client.calls[0].sql, /ar\.status = ANY\(\$3::text\[\]\)/);
  assert.match(client.calls[1].sql, /ar\.tenant_id = \$1/);
  assert.match(client.calls[1].sql, /ar\.assigned_manager_tenant_user_id = \$2/);
  assert.match(client.calls[1].sql, /FOR UPDATE OF ar/);
  assert.match(client.calls[2].sql, /assigned_manager_tenant_user_id = \$2/);
  assert.match(client.calls[2].sql, /version = \$4/);
  assert.match(client.calls[2].sql, /status = ANY\(\$5::text\[\]\)/);
});

test("manager routes are permission-gated and expose PR5 endpoints", () => {
  const routes = read("backend/src/modules/absence/absence.routes.js");
  assert.match(routes, /\/api\/calendar\/absence-requests\/manager\/pending/);
  assert.match(routes, /\/api\/calendar\/absence-requests\/manager\/:id/);
  assert.match(routes, /\/api\/calendar\/absence-requests\/:id\/approve/);
  assert.match(routes, /\/api\/calendar\/absence-requests\/:id\/reject/);
  assert.ok(routes.indexOf("/api/calendar/absence-requests/manager/pending") < routes.indexOf("/api/calendar/absence-requests/:id"));
  assert.ok(routes.indexOf("/api/calendar/absence-requests/manager/:id") < routes.indexOf("/api/calendar/absence-requests/:id"));
  for (const action of ["read_managed", "approve_managed", "reject_managed", "read_private_comment", "approve_before_review_date"]) {
    assert.match(routes, new RegExp(`"${action}"`));
  }
});

function managerRow(overrides = {}) {
  return detailRow({
    employee_tenant_user_id: uuid(2),
    employee_name: "Anne Medarbejder",
    employee_status: "active",
    employee_login_status: "active",
    status: "submitted",
    assigned_manager_tenant_user_id: uuid(5),
    assigned_manager_name: "Mads Leder",
    submitted_at: "2026-08-06T00:00:00.000Z",
    version: 4,
    ...overrides,
  });
}

test("manager approve is transactional, versioned, audited and enqueues employee notification once", async () => {
  const client = createTxClient();
  let currentRow = managerRow();
  let updateArgs = null;
  let eventArgs = null;
  const auditEvents = [];
  let materializeArgs = null;
  let notificationCount = 0;

  await withPatches([
    [pool, "connect", async () => client],
    [absenceRequestRepository, "acquireIdempotencyLock", async () => {}],
    [absenceRequestRepository, "findByIdForManager", async () => currentRow],
    [absenceRequestRepository, "updateManagedDecision", async (_client, args) => {
      updateArgs = args;
      currentRow = managerRow({ status: "approved", version: 5, reviewed_at: "2026-08-06T01:00:00.000Z" });
      return currentRow;
    }],
    [approvedAbsenceService, "materializeFromApprovedRequest", async (_client, args) => {
      materializeArgs = args;
      return {
        approvedAbsence: {
          id: uuid(70),
          source_type: "absence_request",
          source_id: uuid(10),
        },
        created: true,
      };
    }],
    [absenceRequestRepository, "insertEvent", async (_client, args) => {
      eventArgs = args;
      return { id: uuid(20) };
    }],
    [auditService, "logAuditEvent", async (args) => {
      auditEvents.push(args);
    }],
    [absenceRequestRepository, "findNotificationContextById", async () => notificationContextRow({ status: "approved" })],
    [absenceNotificationService, "enqueueAbsenceApproved", async () => {
      notificationCount += 1;
    }],
  ], async () => {
    const result = await absenceRequestService.approveManaged({
      tenantId: uuid(1),
      userId: uuid(5),
      absenceRequestId: uuid(10),
      body: { version: 4 },
      idempotencyKey: "approve-1",
    });
    assert.equal(result.request.status, "approved");
  });

  assert.deepEqual(updateArgs.fromStatuses, ["submitted", "ready_for_review"]);
  assert.equal(updateArgs.toStatus, "approved");
  assert.equal(eventArgs.eventType, "approved");
  assert.equal(eventArgs.oldStatus, "submitted");
  assert.equal(eventArgs.newStatus, "approved");
  assert.equal(eventArgs.reason, null);
  assert.equal(eventArgs.metadata.approved_absence_id, uuid(70));
  assert.equal(materializeArgs.absenceRequest.status, "approved");
  assert.equal(materializeArgs.absenceRequest.absence_type_visibility_policy, "private");
  assert.equal(auditEvents[0].eventType, "absence_request.approved");
  assert.equal(auditEvents[0].metadata.special_window_override, false);
  assert.equal(auditEvents[1].eventType, "approved_absence.created");
  assert.equal(auditEvents[1].resourceType, "approved_absence");
  assert.equal(notificationCount, 1);
  assert.deepEqual(client.calls.map((call) => call.sql).filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)), ["BEGIN", "COMMIT"]);
});

test("manager reject stores reason in event but not audit metadata and enqueues employee outbox", async () => {
  const client = createTxClient();
  let currentRow = managerRow({ status: "ready_for_review" });
  let eventArgs = null;
  let auditArgs = null;
  let rejectedReason = null;

  await withPatches([
    [pool, "connect", async () => client],
    [absenceRequestRepository, "findByIdForManager", async () => currentRow],
    [absenceRequestRepository, "updateManagedDecision", async () => {
      currentRow = managerRow({ status: "rejected", version: 5, reviewed_at: "2026-08-06T01:00:00.000Z" });
      return currentRow;
    }],
    [absenceRequestRepository, "insertEvent", async (_client, args) => {
      eventArgs = args;
      return { id: uuid(21) };
    }],
    [auditService, "logAuditEvent", async (args) => {
      auditArgs = args;
    }],
    [absenceRequestRepository, "findNotificationContextById", async () => notificationContextRow({ status: "rejected" })],
    [absenceNotificationService, "enqueueAbsenceRejected", async (_client, args) => {
      rejectedReason = args.decisionReason;
    }],
  ], async () => {
    const result = await absenceRequestService.rejectManaged({
      tenantId: uuid(1),
      userId: uuid(5),
      absenceRequestId: uuid(10),
      body: { version: 4, reason: "Ikke muligt i perioden" },
    });
    assert.equal(result.request.status, "rejected");
  });

  assert.equal(eventArgs.eventType, "rejected");
  assert.equal(eventArgs.reason, "Ikke muligt i perioden");
  assert.equal(auditArgs.eventType, "absence_request.rejected");
  assert.equal(Object.values(auditArgs.metadata).includes("Ikke muligt i perioden"), false);
  assert.equal(rejectedReason, "Ikke muligt i perioden");
});

test("manager decision rejects wrong manager, stale version and repeated terminal states without duplicate side effects", async () => {
  const client = createTxClient();
  let updateCount = 0;
  let eventCount = 0;
  let auditCount = 0;

  await withPatches([
    [pool, "connect", async () => client],
    [absenceRequestRepository, "findByIdForManager", async () => null],
    [absenceRequestRepository, "updateManagedDecision", async () => { updateCount += 1; }],
    [absenceRequestRepository, "insertEvent", async () => { eventCount += 1; }],
    [auditService, "logAuditEvent", async () => { auditCount += 1; }],
  ], async () => {
    await assert.rejects(
      absenceRequestService.approveManaged({ tenantId: uuid(1), userId: uuid(6), absenceRequestId: uuid(10), body: { version: 4 } }),
      (error) => error.statusCode === 404 && error.message === "absence_request_not_found"
    );
  });
  assert.equal(updateCount, 0);
  assert.equal(eventCount, 0);
  assert.equal(auditCount, 0);

  await withPatches([
    [pool, "connect", async () => createTxClient()],
    [absenceRequestRepository, "findByIdForManager", async () => managerRow({ version: 5 })],
  ], async () => {
    await assert.rejects(
      absenceRequestService.approveManaged({ tenantId: uuid(1), userId: uuid(5), absenceRequestId: uuid(10), body: { version: 4 } }),
      (error) => error.statusCode === 409 && error.message === "absence_request_version_conflict"
    );
  });

  let duplicateEventCount = 0;
  await withPatches([
    [pool, "connect", async () => createTxClient()],
    [absenceRequestRepository, "findByIdForManager", async () => managerRow({ status: "approved", version: 5 })],
    [absenceRequestRepository, "insertEvent", async () => { duplicateEventCount += 1; }],
  ], async () => {
    const result = await absenceRequestService.approveManaged({ tenantId: uuid(1), userId: uuid(5), absenceRequestId: uuid(10), body: { version: 4 } });
    assert.equal(result.idempotent, true);
    assert.equal(result.request.status, "approved");
  });
  assert.equal(duplicateEventCount, 0);
});

test("manager decision rejects non-reviewable and opposite terminal statuses", async () => {
  for (const [action, status] of [
    ...["draft", "cancelled", "change_proposed", "under_review", "rejected"].map((status) => ["approve", status]),
    ...["draft", "cancelled", "change_proposed", "under_review", "approved"].map((status) => ["reject", status]),
  ]) {
    let updateCount = 0;
    await withPatches([
      [pool, "connect", async () => createTxClient()],
      [absenceRequestRepository, "findByIdForManager", async () => managerRow({ status })],
      [absenceRequestRepository, "updateManagedDecision", async () => {
        updateCount += 1;
      }],
    ], async () => {
      const call = action === "approve"
        ? absenceRequestService.approveManaged({ tenantId: uuid(1), userId: uuid(5), absenceRequestId: uuid(10), body: { version: 4 } })
        : absenceRequestService.rejectManaged({ tenantId: uuid(1), userId: uuid(5), absenceRequestId: uuid(10), body: { version: 4, reason: "Ikke muligt" } });
      await assert.rejects(
        call,
        (error) => error.statusCode === 409 && error.message === "absence_request_not_reviewable"
      );
    });
    assert.equal(updateCount, 0);
  }
});

test("special-window review date blocks approve and reject unless override permission with reason is present", async () => {
  const row = managerRow({
    special_window_id: uuid(40),
    special_window_name: "Sommerferie",
    special_window_is_active: true,
    special_window_review_start_date: "2099-01-01",
    special_window_approval_blocked_before_review: true,
    special_window_absence_start_date: "2026-08-01",
    special_window_absence_end_date: "2026-08-31",
  });

  assert.throws(
    () => absenceRequestService._test.validateSpecialWindowForDecision(row, { action: "approve", hasBeforeReviewOverride: false, reason: null }),
    (error) => error.statusCode === 409 && error.message === "absence_special_window_approve_blocked_before_review"
  );
  assert.throws(
    () => absenceRequestService._test.validateSpecialWindowForDecision(row, { action: "reject", hasBeforeReviewOverride: true, reason: null }),
    (error) => error.statusCode === 400 && error.message === "absence_special_window_override_reason_required"
  );
  const allowed = absenceRequestService._test.validateSpecialWindowForDecision(row, {
    action: "reject",
    hasBeforeReviewOverride: true,
    reason: "Samlet behandling",
  });
  assert.equal(allowed.override, true);
  assert.equal(allowed.metadata.special_window_id, uuid(40));

  const onReviewDate = absenceRequestService._test.validateSpecialWindowForDecision({
    ...row,
    special_window_review_start_date: "2000-01-01",
  }, { action: "approve", hasBeforeReviewOverride: false, reason: null });
  assert.equal(onReviewDate.override, false);
});

test("manager approve rolls back before event, audit and notification when approved absence materialization fails", async () => {
  const client = createTxClient();
  let currentRow = managerRow();
  let eventCount = 0;
  let auditCount = 0;
  let notificationCount = 0;

  await withPatches([
    [pool, "connect", async () => client],
    [absenceRequestRepository, "findByIdForManager", async () => currentRow],
    [absenceRequestRepository, "updateManagedDecision", async () => {
      currentRow = managerRow({ status: "approved", version: 5, reviewed_at: "2026-08-06T01:00:00.000Z" });
      return currentRow;
    }],
    [approvedAbsenceService, "materializeFromApprovedRequest", async () => {
      throw new Error("approved_absence_materialization_failed");
    }],
    [absenceRequestRepository, "insertEvent", async () => {
      eventCount += 1;
    }],
    [auditService, "logAuditEvent", async () => {
      auditCount += 1;
    }],
    [absenceNotificationService, "enqueueAbsenceApproved", async () => {
      notificationCount += 1;
    }],
  ], async () => {
    await assert.rejects(
      absenceRequestService.approveManaged({ tenantId: uuid(1), userId: uuid(5), absenceRequestId: uuid(10), body: { version: 4 } }),
      /approved_absence_materialization_failed/
    );
  });

  assert.equal(eventCount, 0);
  assert.equal(auditCount, 0);
  assert.equal(notificationCount, 0);
  assert.deepEqual(client.calls.map((call) => call.sql).filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)), ["BEGIN", "ROLLBACK"]);
});
test("manager decision rolls back when event, audit or notification enqueue fails", async () => {
  for (const action of ["approve", "reject"]) {
    for (const failure of ["event", "audit", "notification"]) {
      const client = createTxClient();
      let currentRow = managerRow();
      let eventCount = 0;
      let auditCount = 0;

      await withPatches([
        [pool, "connect", async () => client],
        [absenceRequestRepository, "findByIdForManager", async () => currentRow],
        [absenceRequestRepository, "updateManagedDecision", async () => {
          currentRow = managerRow({ status: action === "approve" ? "approved" : "rejected", version: 5, reviewed_at: "2026-08-06T01:00:00.000Z" });
          return currentRow;
        }],
        [approvedAbsenceService, "materializeFromApprovedRequest", async () => ({
          approvedAbsence: { id: uuid(70), source_type: "absence_request", source_id: uuid(10) },
          created: true,
        })],
        [absenceRequestRepository, "insertEvent", async () => {
          eventCount += 1;
          if (failure === "event") throw new Error(`${action}_event_failed`);
          return { id: uuid(20) };
        }],
        [auditService, "logAuditEvent", async () => {
          auditCount += 1;
          if (failure === "audit") throw new Error(`${action}_audit_failed`);
        }],
        [absenceRequestRepository, "findNotificationContextById", async () => notificationContextRow({ status: action === "approve" ? "approved" : "rejected" })],
        [absenceNotificationService, "enqueueAbsenceApproved", async () => {
          if (failure === "notification") throw new Error("approve_notification_failed");
        }],
        [absenceNotificationService, "enqueueAbsenceRejected", async () => {
          if (failure === "notification") throw new Error("reject_notification_failed");
        }],
      ], async () => {
        const call = action === "approve"
          ? absenceRequestService.approveManaged({ tenantId: uuid(1), userId: uuid(5), absenceRequestId: uuid(10), body: { version: 4 } })
          : absenceRequestService.rejectManaged({ tenantId: uuid(1), userId: uuid(5), absenceRequestId: uuid(10), body: { version: 4, reason: "Ikke muligt" } });
        await assert.rejects(call, new RegExp(`${action}_${failure}_failed`));
      });

      assert.equal(eventCount, 1);
      const expectedAuditCount = failure === "event" ? 0 : failure === "audit" ? 1 : action === "approve" ? 2 : 1;
      assert.equal(auditCount, expectedAuditCount);
      assert.deepEqual(client.calls.map((call) => call.sql).filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)), ["BEGIN", "ROLLBACK"]);
    }
  }
});
