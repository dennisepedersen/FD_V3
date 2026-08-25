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
const absenceTypeService = require("../backend/src/modules/absence/absenceType.service");
const absenceRequestRepository = require("../backend/src/modules/absence/absenceRequest.repository");
const absenceSpecialWindowRepository = require("../backend/src/modules/absence/absenceSpecialWindow.repository");
const employeeManagerRelationRepository = require("../backend/src/modules/absence/employeeManagerRelation.repository");
const absenceRequestService = require("../backend/src/modules/absence/absenceRequest.service");
const moduleAccessService = require("../backend/src/services/moduleAccessService");

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

function requestEventRow(overrides = {}) {
  return {
    id: uuid(20),
    tenant_id: uuid(1),
    absence_request_id: uuid(10),
    event_type: "approved",
    actor_tenant_user_id: uuid(5),
    actor_name: "Mads Leder",
    old_status: "submitted",
    new_status: "approved",
    reason: "Husk overdragelse inden ferien",
    metadata_json: {},
    created_at: "2026-08-06T01:00:00.000Z",
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

test("vacation-day special-window policy uses configurable quota before normal window blocking", async () => {
  const originalList = absenceSpecialWindowRepository.listOverlappingActiveScopedForEmployee;
  const originalUsage = absenceSpecialWindowRepository.listVacationDayQuotaUsageDates;
  let lookups = 0;
  try {
    absenceSpecialWindowRepository.listOverlappingActiveScopedForEmployee = async () => {
      lookups += 1;
      return [{
        id: uuid(32),
        name: "Sommerferie 2027",
        scope_type: "tenant",
        fully_contains_request: true,
        absence_start_date: "2027-07-01",
        absence_end_date: "2027-07-31",
        submission_open_date: "2027-01-01",
        submission_deadline: "2027-03-01",
        review_start_date: "2027-03-02",
        late_submission_policy: "blocked",
        vacation_day_exemption_quota: 1,
      }];
    };
    absenceSpecialWindowRepository.listVacationDayQuotaUsageDates = async () => [];

    const vacationMatch = await absenceRequestService._test.resolveSpecialWindow({ query: async () => ({ rows: [] }) }, {
      tenantId: uuid(1),
      employeeTenantUserId: uuid(2),
      absenceType: requestType({ key: "vacation", name: "Ferie", special_window_eligible: true }),
      absenceTypeId: uuid(3),
      startDate: "2027-07-10",
      endDate: "2027-07-10",
    });
    assert.equal(vacationMatch.id, uuid(32));
    assert.equal(lookups, 1);

    lookups = 0;
    const vacationDaySingle = await absenceRequestService._test.resolveSpecialWindow({ query: async () => ({ rows: [] }) }, {
      tenantId: uuid(1),
      employeeTenantUserId: uuid(2),
      absenceType: requestType({ key: "vacation_day", name: "Feriefridag", special_window_eligible: true }),
      absenceTypeId: uuid(3),
      startDate: "2027-07-10",
      endDate: "2027-07-10",
    });
    assert.equal(vacationDaySingle, null);
    assert.equal(lookups, 1);

    absenceSpecialWindowRepository.listVacationDayQuotaUsageDates = async () => ["2027-07-09"];
    const vacationDayAfterQuota = await absenceRequestService._test.resolveSpecialWindow({ query: async () => ({ rows: [] }) }, {
      tenantId: uuid(1),
      employeeTenantUserId: uuid(2),
      absenceType: requestType({ key: "vacation_day", name: "Feriefridag", special_window_eligible: true }),
      absenceTypeId: uuid(3),
      startDate: "2027-07-10",
      endDate: "2027-07-10",
    });
    assert.equal(vacationDayAfterQuota.id, uuid(32));

    absenceSpecialWindowRepository.listVacationDayQuotaUsageDates = async () => [];
    await assert.rejects(
      absenceRequestService._test.resolveSpecialWindow({ query: async () => ({ rows: [] }) }, {
        tenantId: uuid(1),
        employeeTenantUserId: uuid(2),
        absenceType: requestType({ key: "vacation_day", name: "Feriefridag", special_window_eligible: true }),
        absenceTypeId: uuid(3),
        startDate: "2027-06-30",
        endDate: "2027-07-02",
      }),
      (error) => error.statusCode === 409
        && error.message === "absence_vacation_day_quota_split_required"
        && error.details.vacation_day_quota.exempt_dates.includes("2027-07-01")
        && error.details.vacation_day_quota.normal_window_dates.includes("2027-07-02")
    );
  } finally {
    absenceSpecialWindowRepository.listOverlappingActiveScopedForEmployee = originalList;
    absenceSpecialWindowRepository.listVacationDayQuotaUsageDates = originalUsage;
  }
});
test("vacation-day quota preflight reports deterministic quota usage and split states", () => {
  const baseWindow = {
    id: uuid(33),
    key: "sommerferie-2027",
    name: "Sommerferie 2027",
    absence_start_date: "2027-07-01",
    absence_end_date: "2027-07-31",
    submission_open_date: "2027-01-01",
    submission_deadline: "2027-03-01",
    review_start_date: "2027-03-02",
    late_submission_policy: "blocked",
    collective_processing: true,
  };
  const details = (quota) => ({
    requested_period: { start_date: "2027-07-10", end_date: "2027-07-10" },
    special_window: baseWindow,
    special_windows: [baseWindow],
    split_suggestion: [
      { start_date: "2027-07-10", end_date: "2027-07-10", special_window: null, vacation_day_quota_exempt: true },
    ],
    vacation_day_quota: {
      quota: 2,
      used_count: quota.used_count,
      remaining_before_request: quota.remaining_before_request,
      request_uses_count: quota.request_uses_count,
      used_after_request: quota.used_after_request,
      remaining_after_request: quota.remaining_after_request,
      used_dates: quota.used_dates || [],
      exempt_dates: quota.exempt_dates || [],
      normal_window_dates: quota.normal_window_dates || [],
      active_collective_count: quota.active_collective_count || 0,
      active_collective_dates: quota.active_collective_dates || [],
    },
  });

  const zeroOfTwo = absenceRequestService._test.buildVacationDayQuotaPreflightResult(details({
    used_count: 0,
    remaining_before_request: 2,
    request_uses_count: 1,
    used_after_request: 1,
    remaining_after_request: 1,
    exempt_dates: ["2027-07-10"],
  }), { asOfDate: "2027-02-01" });
  assert.equal(zeroOfTwo.state, "vacation_day_quota_exempt");
  assert.equal(zeroOfTwo.can_submit, true);
  assert.equal(zeroOfTwo.vacation_day_quota.used_after_request, 1);

  const oneOfTwo = absenceRequestService._test.buildVacationDayQuotaPreflightResult(details({
    used_count: 1,
    remaining_before_request: 1,
    request_uses_count: 1,
    used_after_request: 2,
    remaining_after_request: 0,
    used_dates: ["2027-07-09"],
    exempt_dates: ["2027-07-10"],
  }), { asOfDate: "2027-02-01" });
  assert.equal(oneOfTwo.state, "vacation_day_quota_exempt");
  assert.equal(oneOfTwo.vacation_day_quota.remaining_after_request, 0);

  const exhaustedBeforeDeadline = absenceRequestService._test.buildVacationDayQuotaPreflightResult(details({
    used_count: 2,
    remaining_before_request: 0,
    request_uses_count: 0,
    used_after_request: 2,
    remaining_after_request: 0,
    used_dates: ["2027-07-08", "2027-07-09"],
    normal_window_dates: ["2027-07-10"],
    active_collective_count: 1,
    active_collective_dates: ["2027-07-10"],
  }), { asOfDate: "2027-02-01" });
  assert.equal(exhaustedBeforeDeadline.state, "vacation_day_quota_collective");
  assert.equal(exhaustedBeforeDeadline.vacation_day_quota.active_collective_count, 1);
  assert.equal(exhaustedBeforeDeadline.can_submit, true);

  const thirdAfterDeadline = absenceRequestService._test.buildVacationDayQuotaPreflightResult(details({
    used_count: 2,
    remaining_before_request: 0,
    request_uses_count: 0,
    used_after_request: 2,
    remaining_after_request: 0,
    used_dates: ["2027-07-08", "2027-07-09"],
    normal_window_dates: ["2027-07-10"],
  }), { asOfDate: "2027-03-10" });
  assert.equal(thirdAfterDeadline.state, "after_deadline_blocked");
  assert.equal(thirdAfterDeadline.can_submit, false);

  const partialQuota = absenceRequestService._test.buildVacationDayQuotaPreflightResult({
    ...details({
      used_count: 1,
      remaining_before_request: 1,
      request_uses_count: 1,
      used_after_request: 2,
      remaining_after_request: 0,
      used_dates: ["2027-07-08"],
      exempt_dates: ["2027-07-10"],
      normal_window_dates: ["2027-07-11"],
    }),
    requested_period: { start_date: "2027-07-10", end_date: "2027-07-11" },
    split_suggestion: [
      { start_date: "2027-07-10", end_date: "2027-07-10", special_window: null, vacation_day_quota_exempt: true },
      { start_date: "2027-07-11", end_date: "2027-07-11", special_window: baseWindow, vacation_day_quota_exempt: false },
    ],
  }, { asOfDate: "2027-02-01" });
  assert.equal(partialQuota.state, "vacation_day_quota_split_required");
  assert.equal(partialQuota.can_submit, false);
  assert.deepEqual(partialQuota.split_suggestion.map((segment) => [segment.start_date, segment.end_date, Boolean(segment.vacation_day_quota_exempt)]), [
    ["2027-07-10", "2027-07-10", true],
    ["2027-07-11", "2027-07-11", false],
  ]);
});

test("vacation-day quota usage counts only quota-exempt rows and allocation order is deterministic", () => {
  const repository = read("backend/src/modules/absence/absenceSpecialWindow.repository.js");
  assert.match(repository, /ar\.status NOT IN \('draft', 'rejected', 'cancelled'\)/);
  assert.match(repository, /ar\.employee_tenant_user_id = \$2/);
  assert.match(repository, /ar\.tenant_id = \$1/);
  assert.match(repository, /sw\.id = \$3/);
  assert.match(repository, /AND ar\.special_window_id IS NULL/);
  assert.match(repository, /COALESCE\(ar\.submitted_at, ar\.created_at\) ASC/);
  assert.match(repository, /ar\.id ASC/);
  assert.match(repository, /days\.day::date ASC/);
  assert.match(repository, /FOR UPDATE OF ar/);
});

function quotaWindow(overrides = {}) {
  return {
    id: uuid(40),
    tenant_id: uuid(1),
    name: "Efterårsferie 2026",
    review_start_date: "2099-01-01",
    absence_start_date: "2026-10-01",
    absence_end_date: "2026-10-31",
    vacation_day_exemption_quota: 2,
    scope_type: "tenant",
    scope_ref_id: null,
    ...overrides,
  };
}

function quotaAllocationRow(overrides = {}) {
  return {
    ...detailRow({
      id: uuid(20),
      tenant_id: uuid(1),
      employee_tenant_user_id: uuid(2),
      absence_type_key: "vacation_day",
      absence_type_name: "Feriefridag",
      absence_type_special_window_eligible: true,
      status: "submitted",
      start_date: "2026-10-07",
      end_date: "2026-10-07",
      special_window_id: uuid(40),
      submitted_at: "2026-08-01T08:00:00.000Z",
      created_at: "2026-08-01T07:00:00.000Z",
    }),
    absence_date: "2026-10-07",
    ...overrides,
  };
}

test("vacation-day quota reclassification promotes freed slots deterministically and writes safe history", async () => {
  const client = createTxClient();
  const locks = [];
  const updates = [];
  const inserts = [];
  const events = [];
  const audits = [];
  const sources = new Map([
    [uuid(20), quotaAllocationRow({ id: uuid(20), start_date: "2026-10-07", end_date: "2026-10-07", absence_date: "2026-10-07", employee_comment: "Privat B" })],
    [uuid(21), quotaAllocationRow({ id: uuid(21), start_date: "2026-10-11", end_date: "2026-10-11", absence_date: "2026-10-11", submitted_at: "2026-08-02T08:00:00.000Z", employee_comment: "Privat C" })],
  ]);

  await withPatches([
    [absenceSpecialWindowRepository, "listOverlappingActiveScopedForEmployee", async () => [quotaWindow()]],
    [absenceRequestRepository, "acquireIdempotencyLock", async (_client, args) => locks.push(args.lockKey)],
    [absenceSpecialWindowRepository, "listVacationDayQuotaAllocationRows", async (_client, args) => {
      assert.equal(args.forUpdate, true);
      return Array.from(sources.values());
    }],
    [absenceRequestRepository, "findById", async (_client, args) => sources.get(args.absenceRequestId)],
    [absenceRequestRepository, "updateQuotaReclassificationSegment", async (_client, args) => {
      updates.push(args);
      const source = sources.get(args.absenceRequestId);
      return { ...source, start_date: args.startDate, end_date: args.endDate, special_window_id: args.specialWindowId, version: source.version + 1 };
    }],
    [absenceRequestRepository, "insertQuotaReclassificationSegment", async () => {
      inserts.push(true);
      return null;
    }],
    [absenceRequestRepository, "insertEvent", async (_client, args) => {
      events.push(args);
      return { id: uuid(80 + events.length) };
    }],
    [auditService, "logAuditEvent", async (args) => audits.push(args)],
  ], async () => {
    const changes = await absenceRequestService._test.reclassifyVacationDayQuotaAfterTerminalTransition(client, {
      tenantId: uuid(1),
      employeeTenantUserId: uuid(2),
      actorId: uuid(2),
      transitionedRequest: detailRow({
        id: uuid(10),
        tenant_id: uuid(1),
        employee_tenant_user_id: uuid(2),
        absence_type_id: uuid(1),
        absence_type_key: "vacation_day",
        absence_type_name: "Feriefridag",
        status: "submitted",
        start_date: "2026-10-05",
        end_date: "2026-10-06",
        special_window_id: null,
      }),
      triggerEvent: { id: uuid(90) },
      triggerAction: "cancelled",
    });

    assert.deepEqual(changes.map((change) => change.request_id), [uuid(20), uuid(21)]);
  });

  assert.deepEqual(locks, [`absence:vacation-day-quota:${uuid(1)}:${uuid(2)}:${uuid(40)}`]);
  assert.deepEqual(updates.map((args) => [args.absenceRequestId, args.startDate, args.endDate, args.specialWindowId]), [
    [uuid(20), "2026-10-07", "2026-10-07", null],
    [uuid(21), "2026-10-11", "2026-10-11", null],
  ]);
  assert.equal(inserts.length, 0);
  assert.equal(events.length, 2);
  assert.equal(events[0].eventType, "administrative_override");
  assert.match(events[0].reason, /annulleret/);
  assert.equal(events[0].metadata.system_reclassification, true);
  assert.equal(events[0].metadata.triggered_by_request_id, uuid(10));
  assert.equal(events[0].metadata.triggered_by_event_id, uuid(90));
  assert.equal(audits.length, 2);
  const combinedMetadata = JSON.stringify({ events, audits });
  assert.equal(combinedMetadata.includes("Privat"), false);
});

test("vacation-day quota reclassification splits partial multi-day collective requests without leaking notes", async () => {
  const client = createTxClient();
  const updates = [];
  const inserts = [];
  const events = [];
  const audits = [];
  const source = quotaAllocationRow({
    id: uuid(30),
    start_date: "2026-10-07",
    end_date: "2026-10-09",
    submitted_at: "2026-08-02T08:00:00.000Z",
    employee_comment: "Privat splittest",
    version: 3,
  });
  const allocationRows = [
    quotaAllocationRow({ id: uuid(22), special_window_id: null, absence_date: "2026-10-05", start_date: "2026-10-05", end_date: "2026-10-05" }),
    { ...source, absence_date: "2026-10-07" },
    { ...source, absence_date: "2026-10-08" },
    { ...source, absence_date: "2026-10-09" },
  ];

  await withPatches([
    [absenceSpecialWindowRepository, "listOverlappingActiveScopedForEmployee", async () => [quotaWindow({ vacation_day_exemption_quota: 2 })]],
    [absenceRequestRepository, "acquireIdempotencyLock", async () => {}],
    [absenceSpecialWindowRepository, "listVacationDayQuotaAllocationRows", async () => allocationRows],
    [absenceRequestRepository, "findById", async () => source],
    [absenceRequestRepository, "updateQuotaReclassificationSegment", async (_client, args) => {
      updates.push(args);
      return { ...source, start_date: args.startDate, end_date: args.endDate, special_window_id: args.specialWindowId, version: 4 };
    }],
    [absenceRequestRepository, "insertQuotaReclassificationSegment", async (_client, args) => {
      inserts.push(args);
      return { ...source, id: uuid(31), start_date: args.startDate, end_date: args.endDate, special_window_id: args.specialWindowId, version: 1 };
    }],
    [absenceRequestRepository, "insertEvent", async (_client, args) => {
      events.push(args);
      return { id: uuid(80 + events.length) };
    }],
    [auditService, "logAuditEvent", async (args) => audits.push(args)],
  ], async () => {
    const changes = await absenceRequestService._test.reclassifyVacationDayQuotaAfterTerminalTransition(client, {
      tenantId: uuid(1),
      employeeTenantUserId: uuid(2),
      actorId: uuid(5),
      transitionedRequest: detailRow({
        id: uuid(10),
        tenant_id: uuid(1),
        employee_tenant_user_id: uuid(2),
        absence_type_id: uuid(1),
        absence_type_key: "vacation_day",
        absence_type_name: "Feriefridag",
        status: "submitted",
        start_date: "2026-10-05",
        end_date: "2026-10-05",
        special_window_id: null,
      }),
      triggerEvent: { id: uuid(91) },
      triggerAction: "cancelled",
    });

    assert.deepEqual(changes, [{ request_id: uuid(30), promoted_dates: ["2026-10-07"], split_created_request_id: uuid(31) }]);
  });

  assert.deepEqual(updates.map((args) => [args.absenceRequestId, args.startDate, args.endDate, args.specialWindowId]), [
    [uuid(30), "2026-10-07", "2026-10-07", null],
  ]);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].sourceRow.employee_comment, "Privat splittest");
  assert.deepEqual([inserts[0].startDate, inserts[0].endDate, inserts[0].specialWindowId], ["2026-10-08", "2026-10-09", uuid(40)]);
  assert.deepEqual(events.map((event) => event.eventType), ["created", "administrative_override"]);
  assert.equal(events[0].absenceRequestId, uuid(31));
  assert.equal(events[1].metadata.split_created_request_id, uuid(31));
  assert.deepEqual(events[1].metadata.split_remainder_dates, ["2026-10-08", "2026-10-09"]);
  assert.equal(audits.length, 2);
  assert.equal(JSON.stringify({ events, audits }).includes("Privat splittest"), false);
});

test("vacation-day quota reclassification respects rejection wording and review-start cutoff", async () => {
  let allocationLookups = 0;
  const events = [];
  await withPatches([
    [absenceSpecialWindowRepository, "listOverlappingActiveScopedForEmployee", async () => [quotaWindow({ review_start_date: "2099-01-01" })]],
    [absenceRequestRepository, "acquireIdempotencyLock", async () => {}],
    [absenceSpecialWindowRepository, "listVacationDayQuotaAllocationRows", async () => {
      allocationLookups += 1;
      return [quotaAllocationRow({ id: uuid(20), absence_date: "2026-10-07" })];
    }],
    [absenceRequestRepository, "findById", async () => quotaAllocationRow({ id: uuid(20), start_date: "2026-10-07", end_date: "2026-10-07" })],
    [absenceRequestRepository, "updateQuotaReclassificationSegment", async (_client, args) => quotaAllocationRow({ id: args.absenceRequestId, start_date: args.startDate, end_date: args.endDate, special_window_id: args.specialWindowId, version: 2 })],
    [absenceRequestRepository, "insertEvent", async (_client, args) => {
      events.push(args);
      return { id: uuid(81) };
    }],
    [auditService, "logAuditEvent", async () => {}],
  ], async () => {
    await absenceRequestService._test.reclassifyVacationDayQuotaAfterTerminalTransition(createTxClient(), {
      tenantId: uuid(1),
      employeeTenantUserId: uuid(2),
      actorId: uuid(5),
      transitionedRequest: detailRow({
        id: uuid(10),
        tenant_id: uuid(1),
        employee_tenant_user_id: uuid(2),
        absence_type_id: uuid(1),
        absence_type_key: "vacation_day",
        absence_type_name: "Feriefridag",
        status: "ready_for_review",
        start_date: "2026-10-05",
        end_date: "2026-10-05",
      }),
      triggerEvent: { id: uuid(92) },
      triggerAction: "rejected",
    });
  });
  assert.equal(allocationLookups, 1);
  assert.match(events[0].reason, /afvist/);

  await withPatches([
    [absenceSpecialWindowRepository, "listOverlappingActiveScopedForEmployee", async () => [quotaWindow({ review_start_date: "2020-01-01" })]],
    [absenceSpecialWindowRepository, "listVacationDayQuotaAllocationRows", async () => {
      throw new Error("allocation must not run after review start");
    }],
  ], async () => {
    const changes = await absenceRequestService._test.reclassifyVacationDayQuotaAfterTerminalTransition(createTxClient(), {
      tenantId: uuid(1),
      employeeTenantUserId: uuid(2),
      actorId: uuid(5),
      transitionedRequest: detailRow({
        id: uuid(10),
        tenant_id: uuid(1),
        employee_tenant_user_id: uuid(2),
        absence_type_id: uuid(1),
        absence_type_key: "vacation_day",
        absence_type_name: "Feriefridag",
        status: "submitted",
        start_date: "2026-10-05",
        end_date: "2026-10-05",
      }),
      triggerAction: "cancelled",
    });
    assert.deepEqual(changes, []);
  });
});

test("vacation-day quota reclassification ignores approved, tenant, employee and window mismatches", async () => {
  const updates = [];
  const allocationRows = [
    quotaAllocationRow({ id: uuid(20), status: "approved", absence_date: "2026-10-07" }),
    quotaAllocationRow({ id: uuid(21), tenant_id: uuid(99), absence_date: "2026-10-08" }),
    quotaAllocationRow({ id: uuid(22), employee_tenant_user_id: uuid(99), absence_date: "2026-10-09" }),
    quotaAllocationRow({ id: uuid(23), special_window_id: uuid(99), absence_date: "2026-10-10" }),
  ];

  await withPatches([
    [absenceSpecialWindowRepository, "listOverlappingActiveScopedForEmployee", async () => [quotaWindow({ vacation_day_exemption_quota: 4 })]],
    [absenceRequestRepository, "acquireIdempotencyLock", async () => {}],
    [absenceSpecialWindowRepository, "listVacationDayQuotaAllocationRows", async () => allocationRows],
    [absenceRequestRepository, "findById", async () => {
      throw new Error("mismatched candidates must be skipped before lookup");
    }],
    [absenceRequestRepository, "updateQuotaReclassificationSegment", async (_client, args) => updates.push(args)],
  ], async () => {
    const changes = await absenceRequestService._test.reclassifyVacationDayQuotaAfterTerminalTransition(createTxClient(), {
      tenantId: uuid(1),
      employeeTenantUserId: uuid(2),
      actorId: uuid(5),
      transitionedRequest: detailRow({
        id: uuid(10),
        tenant_id: uuid(1),
        employee_tenant_user_id: uuid(2),
        absence_type_id: uuid(1),
        absence_type_key: "vacation_day",
        absence_type_name: "Feriefridag",
        status: "submitted",
        start_date: "2026-10-05",
        end_date: "2026-10-05",
      }),
      triggerAction: "cancelled",
    });
    assert.deepEqual(changes, []);
  });

  assert.deepEqual(updates, []);
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
  assert.match(routes, /\/api\/calendar\/absence-types\/request-options/);
  assert.match(routes, /absenceTypeService\.listRequestOptions/);
  assert.match(routes, /\/api\/calendar\/absence-requests\/mine/);
  assert.match(routes, /\/api\/calendar\/absence-requests\/:id\/submit/);
  assert.match(routes, /\/api\/calendar\/absence-requests\/:id\/cancel/);
  assert.ok(routes.indexOf("/api/calendar/absence-types/request-options") < routes.indexOf("/api/calendar/absence-requests/:id"));
  assert.match(tenantSurfaceRoutes, /absenceRoutes/);
  assert.match(tenantSurfaceRoutes, /router\.use\(absenceRoutes\)/);
});

test("absence request type options are request-only, ordered and safe for UI", async () => {
  const rows = [
    {
      id: uuid(3),
      tenant_id: uuid(99),
      key: "vacation",
      name: "Ferie",
      workflow_mode: "request",
      comment_policy: "optional",
      visibility_policy: "private",
      allowed_duration_types: ["full_days"],
      special_window_eligible: true,
      sort_order: 10,
      created_by_tenant_user_id: uuid(7),
      updated_by_tenant_user_id: uuid(8),
    },
  ];
  let listArgs = null;

  await withPatches([
    [absenceTypeRepository, "listActive", async (_client, args) => {
      listArgs = args;
      return rows;
    }],
  ], async () => {
    const result = await absenceTypeService.listRequestOptions({ tenantId: uuid(1) });

    assert.deepEqual(listArgs, { tenantId: uuid(1), workflowMode: "request" });
    assert.deepEqual(result, {
      items: [{
        id: uuid(3),
        key: "vacation",
        name: "Ferie",
        comment_policy: "optional",
        allowed_duration_types: ["full_days"],
        special_window_eligible: true,
        sort_order: 10,
      }],
    });
    assert.equal(Object.hasOwn(result.items[0], "tenant_id"), false);
    assert.equal(Object.hasOwn(result.items[0], "visibility_policy"), false);
    assert.equal(Object.hasOwn(result.items[0], "created_by_tenant_user_id"), false);
    assert.equal(Object.hasOwn(result.items[0], "updated_by_tenant_user_id"), false);
  });
});

test("absence request type options return a valid empty list", async () => {
  await withPatches([
    [absenceTypeRepository, "listActive", async () => []],
  ], async () => {
    assert.deepEqual(await absenceTypeService.listRequestOptions({ tenantId: uuid(1) }), { items: [] });
  });
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
test("submit revalidation uses vacation-day special-window policy without mutating blocked drafts", async () => {
  const baseWindow = {
    id: uuid(51),
    name: "Sommerferie 2027",
    submission_open_date: "2027-01-01",
    submission_deadline: "2027-03-01",
    late_submission_policy: "blocked",
    absence_start_date: "2027-07-01",
    absence_end_date: "2027-07-31",
    vacation_day_exemption_quota: 1,
    scope_type: "tenant",
    fully_contains_request: true,
  };

  for (const row of [
    detailRow({ absence_type_key: "vacation_day", absence_type_name: "Feriefridag", absence_type_special_window_eligible: true, start_date: "2027-07-10", end_date: "2027-07-10" }),
    detailRow({ absence_type_key: "vacation_day", absence_type_name: "Feriefridag", absence_type_special_window_eligible: true, start_date: "2027-07-10", end_date: "2027-07-11" }),
  ]) {
    const client = createTxClient();
    let lookupCount = 0;
    let submitArgs = null;
    let eventCount = 0;
    await withPatches([
      [pool, "connect", async () => client],
      [absenceRequestRepository, "findByIdForEmployee", async () => row],
      [employeeManagerRelationRepository, "findActivePrimaryManagersForEmployee", async () => [{ id: uuid(30), manager_tenant_user_id: uuid(5), manager_status: "active", manager_login_status: "active" }]],
      [absenceSpecialWindowRepository, "listOverlappingActiveScopedForEmployee", async () => { lookupCount += 1; return [baseWindow]; }],
      [absenceSpecialWindowRepository, "listVacationDayQuotaUsageDates", async () => []],
      [absenceRequestRepository, "submitDraftForEmployee", async (_client, args) => {
        submitArgs = args;
        return detailRow({ status: "submitted", version: 2, assigned_manager_tenant_user_id: uuid(5) });
      }],
      [absenceRequestRepository, "insertEvent", async () => { eventCount += 1; return { id: uuid(20) }; }],
      [auditService, "logAuditEvent", async () => {}],
      [absenceRequestRepository, "findNotificationContextById", async () => notificationContextRow({ assigned_manager_tenant_user_id: uuid(5) })],
      [absenceNotificationService, "enqueueAbsenceSubmitted", async () => {}],
    ], async () => {
      const action = absenceRequestService.submitDraft({ tenantId: uuid(1), userId: uuid(2), absenceRequestId: uuid(10), body: { version: 1 } });
      if (row.start_date === row.end_date) {
        await action;
        assert.equal(lookupCount, 1);
        assert.equal(submitArgs.specialWindowId, null);
        assert.equal(eventCount, 1);
      } else {
        await assert.rejects(action, (error) => error.statusCode === 409 && error.message === "absence_vacation_day_quota_split_required");
        assert.equal(lookupCount, 1);
        assert.equal(submitArgs, null);
        assert.equal(eventCount, 0);
        assert.deepEqual(client.calls.map((call) => call.sql).filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)), ["BEGIN", "ROLLBACK"]);
      }
    });
  }
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
  assert.deepEqual(absenceValidation.normalizeApprovePayload({ version: 3, reason: "   " }), { version: 3, reason: null });
  assert.deepEqual(absenceValidation.normalizeApprovePayload({ version: 3, reason: "  Tidlig godkendelse  " }), { version: 3, reason: "Tidlig godkendelse" });
  assert.deepEqual(absenceValidation.normalizeRejectPayload({ version: 3, reason: " Ikke muligt " }), { version: 3, reason: "Ikke muligt" });

  assertHttpError(() => absenceValidation.normalizeRejectPayload({ version: 3 }), 400, "absence_reject_reason_required");
  assertHttpError(() => absenceValidation.normalizeApprovePayload({ version: 3, reason: "x".repeat(501) }), 400, "absence_manager_reason_too_long");
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

test("request history joins actor tenant-safely and maps decision message for employee and assigned manager", async () => {
  const client = createClient([requestEventRow()]);
  await absenceRequestRepository.listEvents(client, {
    tenantId: uuid(1),
    absenceRequestId: uuid(10),
  });
  assert.match(client.calls[0].sql, /LEFT JOIN tenant_user actor/);
  assert.match(client.calls[0].sql, /actor.tenant_id = are.tenant_id/);
  assert.match(client.calls[0].sql, /actor.id = are.actor_tenant_user_id/);

  await withPatches([
    [pool, "connect", async () => createTxClient()],
    [absenceRequestRepository, "findByIdForEmployee", async () => detailRow({ status: "approved" })],
    [absenceRequestRepository, "findByIdForManager", async () => managerRow({ status: "approved", employee_comment: "Privat kontekst" })],
    [absenceRequestRepository, "listEvents", async () => [requestEventRow()]],
  ], async () => {
    const mine = await absenceRequestService.getMineDetail({
      tenantId: uuid(1),
      userId: uuid(2),
      absenceRequestId: uuid(10),
      includeHistory: true,
    });
    assert.equal(mine.events[0].reason, "Husk overdragelse inden ferien");
    assert.equal(mine.events[0].actor.display_name, "Mads Leder");

    const managed = await absenceRequestService.getManagedDetail({
      tenantId: uuid(1),
      userId: uuid(5),
      absenceRequestId: uuid(10),
      includePrivateComment: false,
    });
    assert.equal(managed.request.employee_comment, "Privat kontekst");
    assert.equal(managed.events[0].reason, "Husk overdragelse inden ferien");
    assert.equal(managed.events[0].actor.id, uuid(5));
  });
});

test("manager routes expose object-scoped PR5 endpoints without role blanket access", () => {
  const routes = read("backend/src/modules/absence/absence.routes.js");
  const repository = read("backend/src/modules/absence/absenceRequest.repository.js");
  assert.match(routes, /\/api\/calendar\/absence-requests\/manager\/pending/);
  assert.match(routes, /\/api\/calendar\/absence-requests\/manager\/:id/);
  assert.match(routes, /\/api\/calendar\/absence-requests\/:id\/approve/);
  assert.match(routes, /\/api\/calendar\/absence-requests\/:id\/reject/);
  assert.ok(routes.indexOf("/api/calendar/absence-requests/manager/pending") < routes.indexOf("/api/calendar/absence-requests/:id"));
  assert.ok(routes.indexOf("/api/calendar/absence-requests/manager/:id") < routes.indexOf("/api/calendar/absence-requests/:id"));
  assert.doesNotMatch(routes, /manager\/pending[\s\S]{0,500}requireAbsenceRequestAccess\(req, "read_managed"\)/);
  assert.doesNotMatch(routes, /manager\/:id[\s\S]{0,500}requireAbsenceRequestAccess\(req, "read_managed"\)/);
  assert.doesNotMatch(routes, /:id\/approve[\s\S]{0,500}requireAbsenceRequestAccess\(req, "approve_managed"\)/);
  assert.doesNotMatch(routes, /:id\/reject[\s\S]{0,500}requireAbsenceRequestAccess\(req, "reject_managed"\)/);
  for (const action of ["read_private_comment", "approve_before_review_date"]) {
    assert.match(routes, new RegExp(`"${action}"`));
  }
  assert.match(repository, /ar\.assigned_manager_tenant_user_id = \$2/);
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


test("tenant admin does not get before-review decision override by role default", () => {
  const tenant = { id: uuid(1) };
  const baseAuth = { sub: uuid(5), tenant_id: uuid(1), role: "tenant_admin", permissions: [] };
  assert.throws(
    () => moduleAccessService.requireModuleAccess({ tenant, auth: baseAuth, moduleKey: "absence_request", action: "approve_before_review_date" }),
    (error) => error.statusCode === 403 && error.message === "module_access_denied"
  );
  const explicitAuth = { ...baseAuth, permissions: ["absence_request:approve_before_review_date"] };
  const result = moduleAccessService.requireModuleAccess({ tenant, auth: explicitAuth, moduleKey: "absence_request", action: "approve_before_review_date" });
  assert.equal(result.permission, "absence_request:approve_before_review_date");
});
test("manager object-scope is independent of system role and never grants blanket access", async () => {
  for (const role of ["technician", "project_leader", "tenant_admin"]) {
    const client = createTxClient();
    let listArgs = null;
    let detailArgs = null;
    let decisionArgs = null;
    let currentRow = managerRow({ assigned_manager_tenant_user_id: uuid(5), employee_comment: "Privat kontekst" });
    await withPatches([
      [pool, "connect", async () => client],
      [absenceRequestRepository, "listForManager", async (_client, args) => {
        listArgs = args;
        return [currentRow];
      }],
      [absenceRequestRepository, "findByIdForManager", async (_client, args) => {
        detailArgs = args;
        currentRow = { ...currentRow, assigned_manager_tenant_user_id: args.managerTenantUserId };
        return currentRow;
      }],
      [absenceRequestRepository, "updateManagedDecision", async (_client, args) => {
        decisionArgs = args;
        currentRow = { ...currentRow, status: "approved", version: 5, assigned_manager_tenant_user_id: args.managerTenantUserId };
        return currentRow;
      }],
      [approvedAbsenceService, "materializeFromApprovedRequest", async () => ({ approvedAbsence: { id: uuid(70), source_type: "absence_request", source_id: uuid(10) }, created: true })],
      [absenceRequestRepository, "insertEvent", async () => ({ id: uuid(20) })],
      [auditService, "logAuditEvent", async () => {}],
      [absenceRequestRepository, "findNotificationContextById", async () => notificationContextRow({ status: "approved" })],
      [absenceNotificationService, "enqueueAbsenceApproved", async () => {}],
    ], async () => {
      const pending = await absenceRequestService.listManagedPending({ tenantId: uuid(1), userId: uuid(5), filters: {} });
      assert.equal(pending.requests.length, 1, role);
      assert.equal(pending.requests[0].has_private_comment, true, role);
      assert.equal(Object.prototype.hasOwnProperty.call(pending.requests[0], "employee_comment"), false, role);
      const detail = await absenceRequestService.getManagedDetail({ tenantId: uuid(1), userId: uuid(5), absenceRequestId: uuid(10), includePrivateComment: false });
      assert.equal(detail.request.assigned_manager.id, uuid(5), role);
      assert.equal(detail.request.employee_comment, "Privat kontekst", role);
      const decision = await absenceRequestService.approveManaged({ tenantId: uuid(1), userId: uuid(5), absenceRequestId: uuid(10), body: { version: 4 } });
      assert.equal(decision.request.status, "approved", role);
    });
    assert.equal(listArgs.managerTenantUserId, uuid(5));
    assert.equal(detailArgs.managerTenantUserId, uuid(5));
    assert.equal(decisionArgs.managerTenantUserId, uuid(5));
  }

  await withPatches([
    [pool, "connect", async () => createTxClient()],
    [absenceRequestRepository, "findByIdForManager", async () => null],
  ], async () => {
    await assert.rejects(
      absenceRequestService.getManagedDetail({ tenantId: uuid(1), userId: uuid(6), absenceRequestId: uuid(10), includePrivateComment: false }),
      (error) => error.statusCode === 404 && error.message === "absence_request_not_found"
    );
  });
});
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
      body: { version: 4, reason: "Husk overdragelse inden ferien" },
      idempotencyKey: "approve-1",
    });
    assert.equal(result.request.status, "approved");
  });

  assert.deepEqual(updateArgs.fromStatuses, ["submitted", "ready_for_review"]);
  assert.equal(updateArgs.toStatus, "approved");
  assert.equal(eventArgs.eventType, "approved");
  assert.equal(eventArgs.oldStatus, "submitted");
  assert.equal(eventArgs.newStatus, "approved");
  assert.equal(eventArgs.reason, "Husk overdragelse inden ferien");
  assert.equal(eventArgs.metadata.approved_absence_id, uuid(70));
  assert.equal(materializeArgs.absenceRequest.status, "approved");
  assert.equal(materializeArgs.absenceRequest.absence_type_visibility_policy, "private");
  assert.equal(auditEvents[0].eventType, "absence_request.approved");
  assert.equal(auditEvents[0].metadata.special_window_override, false);
  assert.equal(Object.values(auditEvents[0].metadata).includes("Husk overdragelse inden ferien"), false);
  assert.equal(auditEvents[1].eventType, "approved_absence.created");
  assert.equal(auditEvents[1].resourceType, "approved_absence");
  assert.equal(notificationCount, 1);
  assert.deepEqual(client.calls.map((call) => call.sql).filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)), ["BEGIN", "COMMIT"]);
});

test("manager approve accepts quota-promoted vacation-day request after reclassification clears special window", async () => {
  const client = createTxClient();
  let currentRow = managerRow({
    absence_type_key: "vacation_day",
    absence_type_name: "Feriefridag",
    absence_type_special_window_eligible: true,
    status: "submitted",
    version: 8,
    special_window_id: null,
    special_window_name: null,
    special_window_review_start_date: null,
  });
  let detailArgs = null;
  let updateArgs = null;
  let eventArgs = null;
  let materializeArgs = null;

  await withPatches([
    [pool, "connect", async () => client],
    [absenceRequestRepository, "findByIdForManager", async (_client, args) => {
      detailArgs = args;
      return currentRow;
    }],
    [absenceRequestRepository, "updateManagedDecision", async (_client, args) => {
      updateArgs = args;
      currentRow = { ...currentRow, status: "approved", version: 9, reviewed_at: "2026-08-06T01:00:00.000Z" };
      return currentRow;
    }],
    [approvedAbsenceService, "materializeFromApprovedRequest", async (_client, args) => {
      materializeArgs = args;
      return { approvedAbsence: { id: uuid(70), source_type: "absence_request", source_id: uuid(10) }, created: true };
    }],
    [absenceRequestRepository, "insertEvent", async (_client, args) => {
      eventArgs = args;
      return { id: uuid(20) };
    }],
    [auditService, "logAuditEvent", async () => {}],
    [absenceRequestRepository, "findNotificationContextById", async () => notificationContextRow({ status: "approved", absence_type_name: "Feriefridag" })],
    [absenceNotificationService, "enqueueAbsenceApproved", async () => {}],
  ], async () => {
    const result = await absenceRequestService.approveManaged({
      tenantId: uuid(1),
      userId: uuid(5),
      absenceRequestId: uuid(10),
      body: { version: 8 },
    });
    assert.equal(result.request.status, "approved");
  });

  assert.equal(detailArgs.tenantId, uuid(1));
  assert.equal(detailArgs.managerTenantUserId, uuid(5));
  assert.equal(detailArgs.absenceRequestId, uuid(10));
  assert.equal(updateArgs.expectedVersion, 8);
  assert.deepEqual(updateArgs.fromStatuses, ["submitted", "ready_for_review"]);
  assert.equal(updateArgs.toStatus, "approved");
  assert.equal(materializeArgs.absenceRequest.status, "approved");
  assert.equal(materializeArgs.absenceRequest.special_window_id, null);
  assert.equal(eventArgs.eventType, "approved");
  assert.equal(Object.prototype.hasOwnProperty.call(eventArgs.metadata, "special_window_id"), false);
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

test("absence request preflight returns special-window states without mutation side effects", async () => {
  const baseWindow = {
    id: uuid(70),
    key: "sommerferie-2027",
    name: "Sommerferie 2027",
    absence_start_date: "2027-07-01",
    absence_end_date: "2027-07-31",
    submission_open_date: "2027-01-01",
    submission_deadline: "2027-03-01",
    review_start_date: "2027-03-02",
    late_submission_policy: "blocked",
    collective_processing: true,
    scope_type: "tenant",
    fully_contains_request: true,
  };

  assert.deepEqual(absenceRequestService._test.buildSpecialWindowPreflightResult(null), {
    state: "no_match",
    can_submit: true,
    special_window: null,
  });
  assert.equal(absenceRequestService._test.buildSpecialWindowPreflightResult(baseWindow, { asOfDate: "2026-12-31" }).state, "before_open");
  assert.equal(absenceRequestService._test.buildSpecialWindowPreflightResult(baseWindow, { asOfDate: "2027-02-01" }).state, "open");
  assert.equal(absenceRequestService._test.buildSpecialWindowPreflightResult(baseWindow, { asOfDate: "2027-03-03" }).state, "after_deadline_blocked");
  assert.equal(absenceRequestService._test.buildSpecialWindowPreflightResult({ ...baseWindow, late_submission_policy: "manual_review" }, { asOfDate: "2027-03-03" }).state, "after_deadline_manual_review");
  assert.equal(absenceRequestService._test.buildSpecialWindowPreflightResult({ ...baseWindow, late_submission_policy: "allowed" }, { asOfDate: "2027-03-03" }).state, "after_deadline_allowed");

  const partial = absenceRequestService._test.preflightResultFromSpecialWindowError(Object.assign(new Error("absence_special_window_partial_overlap"), { statusCode: 409 }));
  assert.equal(partial.state, "partial_overlap");
  assert.equal(partial.can_submit, false);
  assert.deepEqual(partial.special_windows, []);
  assert.deepEqual(partial.split_suggestion, []);

  const overlapDetails = absenceRequestService._test.buildSpecialWindowOverlapDetails([{ ...baseWindow, absence_start_date: "2027-05-25", absence_end_date: "2027-08-29" }], {
    startDate: "2027-06-15",
    endDate: "2027-09-15",
  });
  assert.deepEqual(overlapDetails.requested_period, { start_date: "2027-06-15", end_date: "2027-09-15" });
  assert.deepEqual(overlapDetails.split_suggestion.map((segment) => [segment.start_date, segment.end_date, segment.special_window ? segment.special_window.name : null]), [
    ["2027-06-15", "2027-08-29", "Sommerferie 2027"],
    ["2027-08-30", "2027-09-15", null],
  ]);
  const detailedPartial = absenceRequestService._test.preflightResultFromSpecialWindowError(Object.assign(new Error("absence_special_window_partial_overlap"), { statusCode: 409, details: overlapDetails }));
  assert.equal(detailedPartial.special_window.name, "Sommerferie 2027");
  assert.equal(detailedPartial.split_suggestion.length, 2);

  const multiple = absenceRequestService._test.preflightResultFromSpecialWindowError(Object.assign(new Error("absence_special_window_conflict"), { statusCode: 409, details: overlapDetails }));
  assert.equal(multiple.state, "multiple_matches");
  assert.equal(multiple.special_windows.length, 1);

  const client = createTxClient();
  let eventCount = 0;
  let auditCount = 0;
  let notificationCount = 0;
  await withPatches([
    [pool, "connect", async () => client],
    [absenceTypeRepository, "findById", async () => requestType({ special_window_eligible: true })],
    [absenceSpecialWindowRepository, "listOverlappingActiveScopedForEmployee", async (_client, args) => {
      assert.equal(args.tenantId, uuid(1));
      assert.equal(args.employeeTenantUserId, uuid(2));
      return [baseWindow];
    }],
    [absenceRequestRepository, "insertEvent", async () => { eventCount += 1; }],
    [auditService, "logAuditEvent", async () => { auditCount += 1; }],
    [absenceNotificationService, "enqueueAbsenceSubmitted", async () => { notificationCount += 1; }],
  ], async () => {
    const result = await absenceRequestService.preflightEmployeeRequest({
      tenantId: uuid(1),
      userId: uuid(2),
      asOfDate: "2027-02-01",
      body: {
        absence_type_id: uuid(3),
        duration_type: "full_days",
        start_date: "2027-07-10",
        end_date: "2027-07-12",
      },
    });

    assert.equal(result.preflight.state, "open");
    assert.equal(result.preflight.can_submit, true);
    assert.equal(result.preflight.special_window.id, uuid(70));
  });

  assert.equal(eventCount, 0);
  assert.equal(auditCount, 0);
  assert.equal(notificationCount, 0);
});

test("absence request preflight route is before id routes and uses create-own permission", () => {
  const routes = read("backend/src/modules/absence/absence.routes.js");
  const preflightIndex = routes.indexOf("/api/calendar/absence-requests/preflight");
  assert.ok(preflightIndex > -1);
  assert.ok(preflightIndex < routes.indexOf("/api/calendar/absence-requests/:id"));
  assert.match(routes, /preflightEmployeeRequest/);
  assert.match(routes, /requireAbsenceRequestAccess\(req, "create_own"\)/);
  assert.match(routes, /preflight: result\.preflight/);
});

test("split submit validates all segments before creating drafts", async () => {
  const client = createTxClient();
  let insertCount = 0;
  let submitCount = 0;
  let eventCount = 0;
  const windowRow = {
    id: uuid(40),
    key: "summer-2099",
    name: "Sommerferie 2099",
    absence_start_date: "2099-07-01",
    absence_end_date: "2099-07-31",
    submission_open_date: "2099-06-01",
    submission_deadline: "2099-06-15",
    review_start_date: "2099-06-20",
    late_submission_policy: "blocked",
    collective_processing: true,
    scope_type: "tenant",
    fully_contains_request: true,
  };

  await withPatches([
    [pool, "connect", async () => client],
    [absenceRequestRepository, "acquireIdempotencyLock", async () => {}],
    [absenceRequestRepository, "findCreatedBySplitIdempotencyKey", async () => []],
    [employeeManagerRelationRepository, "findActivePrimaryManagersForEmployee", async () => [{ id: uuid(30), manager_tenant_user_id: uuid(5), manager_status: "active", manager_login_status: "active" }]],
    [absenceTypeRepository, "findById", async () => requestType({ special_window_eligible: true })],
    [absenceSpecialWindowRepository, "listOverlappingActiveScopedForEmployee", async (_client, args) => args.startDate === "2099-07-01" ? [windowRow] : []],
    [absenceRequestRepository, "insertRequest", async () => { insertCount += 1; return { id: uuid(10), version: 1 }; }],
    [absenceRequestRepository, "submitDraftForEmployee", async () => { submitCount += 1; return detailRow({ status: "submitted", version: 2 }); }],
    [absenceRequestRepository, "insertEvent", async () => { eventCount += 1; return { id: uuid(20) }; }],
    [auditService, "logAuditEvent", async () => {}],
    [absenceNotificationService, "enqueueAbsenceSubmitted", async () => {}],
  ], async () => {
    await assert.rejects(
      absenceRequestService.submitSplitSegments({
        tenantId: uuid(1),
        userId: uuid(2),
        idempotencyKey: "split-1",
        body: {
          segments: [
            { absence_type_id: uuid(1), duration_type: "full_days", start_date: "2099-03-01", end_date: "2099-04-30" },
            { absence_type_id: uuid(1), duration_type: "full_days", start_date: "2099-07-01", end_date: "2099-07-20" },
          ],
        },
      }),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.message, "absence_split_segment_failed");
        assert.equal(error.details.segment_index, 2);
        assert.equal(error.details.cause_code, "absence_special_window_not_open");
        return true;
      }
    );
  });

  assert.equal(insertCount, 0);
  assert.equal(submitCount, 0);
  assert.equal(eventCount, 0);
  assert.deepEqual(client.calls.map((call) => call.sql).filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)), ["BEGIN", "ROLLBACK"]);
});

test("split submit creates and submits all segments atomically with idempotency metadata", async () => {
  const client = createTxClient();
  const insertedIds = [uuid(101), uuid(102)];
  let insertCount = 0;
  let submitCount = 0;
  const events = [];
  let auditCount = 0;
  let notificationCount = 0;

  await withPatches([
    [pool, "connect", async () => client],
    [absenceRequestRepository, "acquireIdempotencyLock", async () => {}],
    [absenceRequestRepository, "findCreatedBySplitIdempotencyKey", async () => []],
    [employeeManagerRelationRepository, "findActivePrimaryManagersForEmployee", async () => [{ id: uuid(30), manager_tenant_user_id: uuid(5), manager_status: "active", manager_login_status: "active" }]],
    [absenceTypeRepository, "findById", async () => requestType({ special_window_eligible: false })],
    [absenceSpecialWindowRepository, "listOverlappingActiveScopedForEmployee", async () => []],
    [absenceRequestRepository, "insertRequest", async (_client, args) => {
      const id = insertedIds[insertCount];
      insertCount += 1;
      return { ...detailRow({ id, start_date: args.startDate, end_date: args.endDate }), version: 1 };
    }],
    [absenceRequestRepository, "submitDraftForEmployee", async (_client, args) => {
      submitCount += 1;
      return detailRow({ id: args.absenceRequestId, status: "submitted", version: 2, assigned_manager_tenant_user_id: args.managerTenantUserId, submitted_at: "2026-08-06T01:00:00.000Z" });
    }],
    [absenceRequestRepository, "insertEvent", async (_client, event) => { events.push(event); return { id: uuid(20 + events.length) }; }],
    [auditService, "logAuditEvent", async () => { auditCount += 1; }],
    [absenceRequestRepository, "findNotificationContextById", async (_client, args) => notificationContextRow({ id: args.absenceRequestId, status: "submitted" })],
    [absenceNotificationService, "enqueueAbsenceSubmitted", async () => { notificationCount += 1; }],
    [absenceRequestRepository, "findByIdForEmployee", async (_client, args) => detailRow({ id: args.absenceRequestId, status: "submitted", version: 2, assigned_manager_tenant_user_id: uuid(5), submitted_at: "2026-08-06T01:00:00.000Z" })],
  ], async () => {
    const result = await absenceRequestService.submitSplitSegments({
      tenantId: uuid(1),
      userId: uuid(2),
      idempotencyKey: "split-2",
      body: {
        segments: [
          { absence_type_id: uuid(1), duration_type: "full_days", start_date: "2027-03-01", end_date: "2027-04-30" },
          { absence_type_id: uuid(1), duration_type: "full_days", start_date: "2027-05-01", end_date: "2027-07-20" },
        ],
      },
    });
    assert.equal(result.idempotent, false);
    assert.equal(result.requests.length, 2);
    assert.deepEqual(result.requests.map((item) => item.status), ["submitted", "submitted"]);
  });

  assert.equal(insertCount, 2);
  assert.equal(submitCount, 2);
  assert.equal(events.length, 4);
  assert.deepEqual(events.filter((event) => event.eventType === "created").map((event) => event.metadata.split_segment_index), [1, 2]);
  assert.deepEqual(events.filter((event) => event.eventType === "submitted").map((event) => event.metadata.split_idempotency_key), ["split-2", "split-2"]);
  assert.equal(auditCount, 4);
  assert.equal(notificationCount, 2);
  assert.deepEqual(client.calls.map((call) => call.sql).filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)), ["BEGIN", "COMMIT"]);
});

test("split submit idempotent retry returns existing submitted segments without duplicate writes", async () => {
  const client = createTxClient();
  let insertCount = 0;
  let submitCount = 0;

  await withPatches([
    [pool, "connect", async () => client],
    [absenceRequestRepository, "acquireIdempotencyLock", async () => {}],
    [absenceRequestRepository, "findCreatedBySplitIdempotencyKey", async () => [
      detailRow({ id: uuid(101), status: "submitted", version: 2, submitted_at: "2026-08-06T01:00:00.000Z" }),
      detailRow({ id: uuid(102), status: "submitted", version: 2, submitted_at: "2026-08-06T01:00:00.000Z" }),
    ]],
    [absenceRequestRepository, "insertRequest", async () => { insertCount += 1; return { id: uuid(10), version: 1 }; }],
    [absenceRequestRepository, "submitDraftForEmployee", async () => { submitCount += 1; return null; }],
  ], async () => {
    const result = await absenceRequestService.submitSplitSegments({
      tenantId: uuid(1),
      userId: uuid(2),
      idempotencyKey: "split-2",
      body: {
        segments: [
          { absence_type_id: uuid(1), duration_type: "full_days", start_date: "2027-03-01", end_date: "2027-04-30" },
          { absence_type_id: uuid(1), duration_type: "full_days", start_date: "2027-05-01", end_date: "2027-07-20" },
        ],
      },
    });
    assert.equal(result.idempotent, true);
    assert.equal(result.requests.length, 2);
  });

  assert.equal(insertCount, 0);
  assert.equal(submitCount, 0);
  assert.deepEqual(client.calls.map((call) => call.sql).filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)), ["BEGIN", "COMMIT"]);
});
