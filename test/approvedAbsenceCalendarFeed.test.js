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
const moduleAccessService = require("../backend/src/services/moduleAccessService");
const auditService = require("../backend/src/services/auditService");
const approvedAbsenceRepository = require("../backend/src/modules/calendar/approvedAbsence.repository");
const approvedAbsenceService = require("../backend/src/modules/calendar/approvedAbsence.service");
const calendarFeedRepository = require("../backend/src/modules/calendar/calendarFeed.repository");
const calendarFeedService = require("../backend/src/modules/calendar/calendarFeed.service");
const { mapApprovedAbsenceEvent } = require("../backend/src/modules/calendar/calendarEvent.mapper");

const repoRoot = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function auth(role, tenantId = uuid(1), userId = uuid(2), permissions = []) {
  return { tenant_id: tenantId, sub: userId, role, permissions };
}

function requireAccess(role, action, permissions = []) {
  return moduleAccessService.requireModuleAccess({
    tenant: { id: uuid(1) },
    auth: auth(role, uuid(1), uuid(2), permissions),
    moduleKey: "calendar_event",
    action,
  });
}

function assertDenied(fn) {
  assert.throws(fn, (error) => error.statusCode === 403 && error.message === "module_access_denied");
}

function createClient(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      return { rows };
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

function approvedAbsenceRow(overrides = {}) {
  return {
    id: uuid(50),
    tenant_id: uuid(1),
    employee_tenant_user_id: uuid(2),
    employee_name: "Anne Medarbejder",
    employee_fitter_id: "FIT-2",
    source_type: "absence_request",
    source_id: uuid(10),
    absence_request_id: uuid(10),
    absence_type_id: uuid(3),
    absence_type_name: "Ferie",
    absence_type_key: "vacation",
    duration_type: "full_days",
    start_date: "2026-08-10",
    end_date: "2026-08-12",
    start_time: null,
    end_time: null,
    timezone: "Europe/Copenhagen",
    status: "active",
    visibility_policy: "private",
    approved_by_tenant_user_id: uuid(5),
    approved_at: "2026-08-06T01:00:00.000Z",
    ...overrides,
  };
}

function approvedRequestRow(overrides = {}) {
  return {
    id: uuid(10),
    tenant_id: uuid(1),
    employee_tenant_user_id: uuid(2),
    employee_fitter_id: "FIT-2",
    absence_type_id: uuid(3),
    absence_type_visibility_policy: "private",
    duration_type: "full_days",
    start_date: "2026-08-10",
    end_date: "2026-08-12",
    start_time: null,
    end_time: null,
    timezone: "Europe/Copenhagen",
    status: "approved",
    reviewed_at: "2026-08-06T01:00:00.000Z",
    ...overrides,
  };
}

test("0044 migration and schema create approved_absence without modifying resource_absences", () => {
  const migrationFiles = fs.readdirSync(path.join(repoRoot, "migrations")).filter((name) => name.endsWith(".sql")).sort();
  const migration = read("migrations/0044_approved_absence_calendar_foundation.sql");
  const schema = read("schema.sql");

  assert.equal(migrationFiles.includes("0044_approved_absence_calendar_foundation.sql"), true);
  assert.equal(migrationFiles.filter((name) => name.startsWith("0044_")).length, 1);
  for (const source of [migration, schema]) {
    assert.match(source, /CREATE TABLE approved_absence/);
    assert.match(source, /FOREIGN KEY \(employee_tenant_user_id, tenant_id\) REFERENCES tenant_user\(id, tenant_id\)/);
    assert.match(source, /FOREIGN KEY \(absence_request_id, tenant_id\) REFERENCES absence_request\(id, tenant_id\)/);
    assert.match(source, /FOREIGN KEY \(absence_type_id, tenant_id\) REFERENCES absence_type\(id, tenant_id\)/);
    assert.match(source, /uq_approved_absence_source UNIQUE \(tenant_id, source_type, source_id\)/);
    assert.match(source, /uq_approved_absence_active_request/);
    assert.match(source, /ck_approved_absence_duration_type CHECK \(duration_type IN \('full_days', 'time_range'\)\)/);
    assert.match(source, /approved_absence\.created/);
  }
  assert.match(migration, /INSERT INTO approved_absence/);
  assert.match(migration, /ar\.status = 'approved'/);
  assert.doesNotMatch(migration, /ALTER TABLE resource_absences/);
});

test("calendar event permissions grant own feed by role but never managed feed by role alone", () => {
  for (const role of ["tenant_admin", "project_leader", "technician"]) {
    assert.equal(requireAccess(role, "read_own").permission, "calendar_event:read_own");
    assertDenied(() => requireAccess(role, "read_managed"));
  }

  assert.equal(
    requireAccess("project_leader", "read_managed", ["calendar_event:read_managed"]).permission,
    "calendar_event:read_managed"
  );
});

test("approved absence materialization is tenant-scoped, idempotent and rejects unsupported request shapes", async () => {
  const client = createClient([approvedAbsenceRow()]);
  const result = await approvedAbsenceService.materializeFromApprovedRequest(client, {
    tenantId: uuid(1),
    absenceRequest: approvedRequestRow(),
    approvedByTenantUserId: uuid(5),
  });

  assert.equal(result.created, true);
  assert.match(client.calls[0].sql, /INSERT INTO approved_absence/);
  assert.match(client.calls[0].sql, /ON CONFLICT \(tenant_id, source_type, source_id\) DO NOTHING/);
  assert.deepEqual(client.calls[0].params.slice(0, 5), [uuid(1), uuid(2), "FIT-2", uuid(10), uuid(3)]);

  assert.throws(
    () => approvedAbsenceService._test.assertRequestShape(approvedRequestRow({ status: "rejected" })),
    /approved_absence_request_not_approved/
  );
  assert.throws(
    () => approvedAbsenceService._test.assertRequestShape(approvedRequestRow({ duration_type: "partial_day" })),
    /approved_absence_duration_not_supported/
  );
});

test("calendar feed repositories scope own and team feeds by tenant and active manager relation", async () => {
  const client = createClient([]);
  await calendarFeedRepository.listOwnApprovedAbsenceEvents(client, {
    tenantId: uuid(1),
    employeeTenantUserId: uuid(2),
    from: "2026-08-01",
    to: "2026-08-31",
    limit: 50,
    offset: 0,
  });
  await calendarFeedRepository.hasActiveManagedTeamScope(client, {
    tenantId: uuid(1),
    managerTenantUserId: uuid(5),
  });
  await calendarFeedRepository.listManagedApprovedAbsenceEvents(client, {
    tenantId: uuid(1),
    managerTenantUserId: uuid(5),
    from: "2026-08-01",
    to: "2026-08-31",
    limit: 50,
    offset: 0,
  });

  assert.match(client.calls[0].sql, /aa\.tenant_id = \$1/);
  assert.match(client.calls[0].sql, /aa\.employee_tenant_user_id = \$2/);
  assert.match(client.calls[0].sql, /aa\.status = 'active'/);
  assert.match(client.calls[0].sql, /COALESCE\(aa\.end_date, aa\.start_date\) >= \$3::date/);
  assert.match(client.calls[1].sql, /FROM employee_manager_relation emr/);
  assert.match(client.calls[1].sql, /emr\.tenant_id = \$1/);
  assert.match(client.calls[1].sql, /emr\.manager_tenant_user_id = \$2/);
  assert.match(client.calls[1].sql, /emr\.relation_type = 'primary'/);
  assert.match(client.calls[1].sql, /emr\.is_active = true/);
  assert.match(client.calls[1].sql, /employee\.status = 'active'/);
  assert.match(client.calls[1].sql, /employee\.login_status = 'active'/);
  assert.match(client.calls[2].sql, /JOIN employee_manager_relation emr/);
  assert.match(client.calls[2].sql, /emr\.tenant_id = aa\.tenant_id/);
  assert.match(client.calls[2].sql, /emr\.manager_tenant_user_id = \$2/);
  assert.match(client.calls[2].sql, /emr\.relation_type = 'primary'/);
  assert.match(client.calls[2].sql, /emr\.is_active = true/);
  assert.match(client.calls[2].sql, /employee\.status = 'active'/);
  assert.match(client.calls[2].sql, /employee\.login_status = 'active'/);
  assert.doesNotMatch(client.calls[2].sql, /resource_group/);
  assert.doesNotMatch(client.calls[2].sql, /calendar_absence/);
});

function overlapsDateRange({ startDate, endDate }, { from, to }) {
  return String(endDate || startDate) >= from && String(startDate) <= to;
}

test("calendar date overlap contract covers boundary, year and leap-day cases", () => {
  const query = { from: "2026-08-10", to: "2026-08-12" };
  assert.equal(overlapsDateRange({ startDate: "2026-08-10", endDate: "2026-08-10" }, query), true);
  assert.equal(overlapsDateRange({ startDate: "2026-08-08", endDate: "2026-08-10" }, query), true);
  assert.equal(overlapsDateRange({ startDate: "2026-08-12", endDate: "2026-08-14" }, query), true);
  assert.equal(overlapsDateRange({ startDate: "2026-08-01", endDate: "2026-08-31" }, query), true);
  assert.equal(overlapsDateRange({ startDate: "2026-08-09", endDate: "2026-08-09" }, query), false);
  assert.equal(overlapsDateRange({ startDate: "2026-08-13", endDate: "2026-08-13" }, query), false);
  assert.equal(overlapsDateRange({ startDate: "2026-12-31", endDate: "2027-01-02" }, { from: "2027-01-01", to: "2027-01-31" }), true);
  assert.equal(overlapsDateRange({ startDate: "2028-02-29", endDate: null }, { from: "2028-02-29", to: "2028-03-01" }), true);
  assert.equal(overlapsDateRange({ startDate: "2026-08-10", endDate: null }, query), true);
  assert.equal(overlapsDateRange({ startDate: "2026-08-12", endDate: null }, query), true);
  assert.equal(calendarFeedRepository._test.overlapPredicate("aa"), "COALESCE(aa.end_date, aa.start_date) >= $3::date AND aa.start_date <= $4::date");
});
test("calendar feed mapping redacts manager titles based on visibility and omits private fields", () => {
  const own = mapApprovedAbsenceEvent(approvedAbsenceRow({ visibility_policy: "private" }), { scope: "mine" });
  const teamPrivate = mapApprovedAbsenceEvent(approvedAbsenceRow({ visibility_policy: "private" }), { scope: "team" });
  const teamVisible = mapApprovedAbsenceEvent(approvedAbsenceRow({ visibility_policy: "manager_visible" }), { scope: "team" });

  assert.equal(own.title, "Ferie");
  assert.equal(own.visibility.reason_visible, true);
  assert.equal(teamPrivate.title, "Ikke til stede");
  assert.equal(teamPrivate.visibility.reason_visible, false);
  assert.equal(teamVisible.title, "Ferie");
  assert.equal(teamVisible.visibility.reason_visible, true);

  for (const event of [own, teamPrivate, teamVisible]) {
    assert.deepEqual(Object.keys(event).sort(), [
      "all_day",
      "employee",
      "end_date",
      "end_time",
      "event_type",
      "id",
      "metadata",
      "source_id",
      "source_type",
      "start_date",
      "start_time",
      "status",
      "timezone",
      "title",
      "visibility",
    ]);
    assert.equal(Object.prototype.hasOwnProperty.call(event, "employee_comment"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(event, "reason"), false);
  }
});

test("calendar feed service requires bounded date filters and maps repository rows", async () => {
  assert.throws(
    () => calendarFeedService._test.normalizeFilters({ from: "2026-08-01" }),
    (error) => error.statusCode === 400 && error.message === "calendar_event_to_required"
  );
  assert.throws(
    () => calendarFeedService._test.normalizeFilters({ from: "2026-08-31", to: "2026-08-01" }),
    (error) => error.statusCode === 400 && error.message === "calendar_event_date_range_invalid"
  );
  assert.throws(
    () => calendarFeedService._test.normalizeFilters({ from: "2026-01-01", to: "2027-02-01" }),
    (error) => error.statusCode === 400 && error.message === "calendar_event_date_range_too_large"
  );

  const client = createClient([approvedAbsenceRow()]);
  await withPatches([
    [pool, "connect", async () => client],
  ], async () => {
    const result = await calendarFeedService.listMine({
      tenantId: uuid(1),
      userId: uuid(2),
      filters: { from: "2026-08-01", to: "2026-08-31", limit: "25", offset: "5" },
    });
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].source_type, "absence_request");
    assert.equal(result.limit, 25);
    assert.equal(result.offset, 5);
  });

  await withPatches([
    [pool, "connect", async () => createClient([approvedAbsenceRow()])],
    [calendarFeedRepository, "hasActiveManagedTeamScope", async (_client, args) => {
      assert.equal(args.tenantId, uuid(1));
      assert.equal(args.managerTenantUserId, uuid(5));
      return true;
    }],
  ], async () => {
    const result = await calendarFeedService.listTeam({
      tenantId: uuid(1),
      userId: uuid(5),
      filters: { from: "2026-08-01", to: "2026-08-31" },
    });
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].title, "Ikke til stede");
  });

  await withPatches([
    [pool, "connect", async () => createClient([])],
    [calendarFeedRepository, "hasActiveManagedTeamScope", async () => false],
  ], async () => {
    await assert.rejects(
      calendarFeedService.listTeam({ tenantId: uuid(1), userId: uuid(6), filters: { from: "2026-08-01", to: "2026-08-31" } }),
      (error) => error.statusCode === 403 && error.message === "calendar_event_access_denied"
    );
  });
});

test("calendar feed routes expose PR6 endpoints and do not reuse legacy resource_absences feed", () => {
  const routes = read("backend/src/modules/calendar/calendar.routes.js");
  assert.match(routes, /\/api\/calendar\/events\/mine/);
  assert.match(routes, /\/api\/calendar\/events\/team/);
  const repository = read("backend/src/modules/calendar/calendarFeed.repository.js");
  const service = read("backend/src/modules/calendar/calendarFeed.service.js");
  assert.match(routes, /moduleKey: \"calendar_event\"/);
  assert.match(routes, /\"read_own\"/);
  assert.doesNotMatch(routes, /events\/team[\s\S]{0,500}requireCalendarEventAccess\(req, "read_managed"\)/);
  assert.match(repository, /function hasActiveManagedTeamScope/);
  assert.match(service, /hasActiveManagedTeamScope/);
  assert.match(service, /calendar_event_access_denied/);
  assert.doesNotMatch(routes, /resourceAbsenceService\.listAbsencesForTenantRange[\s\S]+events\/mine/);
  assert.equal(auditService.ALLOWED_EVENT_TYPES.includes("approved_absence.created"), true);
});
