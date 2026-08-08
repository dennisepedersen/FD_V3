"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://example.invalid/fielddesk_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || "fielddesk.test";

const specialWindowService = require("../backend/src/modules/absence/specialWindow.service");
const specialWindowStatus = require("../backend/src/modules/absence/specialWindow.status");
const specialWindowValidation = require("../backend/src/modules/absence/specialWindow.validation");
const moduleAccessService = require("../backend/src/services/moduleAccessService");

const repoRoot = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function auth(role, tenantId = uuid(1), sub = uuid(2), permissions = []) {
  return { role, tenant_id: tenantId, sub, permissions };
}

function requireAccess(role, moduleKey, action, permissions = []) {
  return moduleAccessService.requireModuleAccess({
    tenant: { id: uuid(1) },
    auth: auth(role, uuid(1), uuid(2), permissions),
    moduleKey,
    action,
  });
}

function assertDenied(fn) {
  assert.throws(fn, (error) => error.statusCode === 403);
}

test("PR7 migration and schema are additive for special vacation windows", () => {
  const migration = read("migrations/0045_special_window_admin_review.sql");
  const schema = read("schema.sql");

  assert.match(migration, /ALTER TABLE absence_special_window[\s\S]+ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1/);
  assert.match(migration, /ck_absence_special_window_version/);
  assert.match(migration, /absence_request\.late_submitted/);
  assert.match(migration, /absence_special_window\.scope_changed/);
  assert.match(migration, /absence_request\.submitted_special_window\.employee/);
  assert.match(migration, /ikke godkendt endnu/);
  assert.match(migration, /ikke foerst til moelle/);
  assert.match(migration, /afventer faelles behandling/);
  assert.doesNotMatch(migration, /CREATE TABLE absence_special_window_scope/);

  assert.match(schema, /version integer NOT NULL DEFAULT 1/);
  assert.match(schema, /absence_request\.late_submitted/);
  assert.match(schema, /absence_special_window\.scope_changed/);
  assert.match(schema, /absence_request\.submitted_special_window\.manager/);
  assert.match(schema, /ikke godkendt endnu/);
  assert.match(schema, /afventer faelles behandling/);
});

test("special-window admin routes are tenant-authenticated and permission gated", () => {
  const routes = read("backend/src/modules/absence/specialWindow.routes.js");
  const mounted = read("backend/src/routes/tenantSurfaceRoutes.js");

  for (const route of [
    "/api/calendar/special-windows",
    "/api/calendar/special-windows/:id",
    "/api/calendar/special-windows/:id/archive",
    "/api/calendar/special-windows/:id/review-overview",
  ]) {
    assert.match(routes, new RegExp(route.replace(/[/:]/g, "\\$&")));
  }
  assert.match(routes, /requireTenantHost/);
  assert.match(routes, /requireAuth\("access"\)/);
  assert.match(routes, /tenant_context_mismatch/);
  assert.match(routes, /absence_special_window/);
  assert.match(routes, /"manage"/);
  assert.match(routes, /"review"/);
  assert.match(routes, /read_private_comment/);
  assert.match(mounted, /specialWindowRoutes/);
});

test("special-window review permission is explicit and tenant-scoped", () => {
  assert.equal(requireAccess("tenant_admin", "absence_special_window", "manage").permission, "absence_special_window:manage");
  assertDenied(() => requireAccess("tenant_admin", "absence_special_window", "review"));
  assert.equal(
    requireAccess("project_leader", "absence_special_window", "review", ["absence_special_window:review"]).permission,
    "absence_special_window:review"
  );
  assertDenied(() => moduleAccessService.requireModuleAccess({
    tenant: { id: uuid(1) },
    auth: auth("project_leader", uuid(9), uuid(2), ["absence_special_window:review"]),
    moduleKey: "absence_special_window",
    action: "review",
  }));
});

test("special-window validation normalizes tenant-wide scopes and protects windows with requests", () => {
  const payload = specialWindowValidation.normalizeCreatePayload({
    key: "summer-2027",
    name: "Sommerferie 2027",
    absence_start_date: "2027-07-01",
    absence_end_date: "2027-07-31",
    submission_open_date: "2027-01-01",
    submission_deadline: "2027-03-01",
    review_start_date: "2027-03-15",
    absence_type_ids: [uuid(7), uuid(7)],
  });

  assert.equal(payload.scopes.length, 1);
  assert.equal(payload.scopes[0].scopeType, "tenant");
  assert.equal(payload.scopes[0].absenceTypeId, uuid(7));

  assert.throws(
    () => specialWindowValidation.normalizeCreatePayload({
      key: "bad-window",
      name: "Bad",
      absence_start_date: "2027-07-01",
      absence_end_date: "2027-07-31",
      submission_open_date: "2027-08-01",
      submission_deadline: "2027-08-02",
      review_start_date: "2027-08-03",
    }),
    (error) => error.statusCode === 400 && error.message === "special_window_open_after_absence_start"
  );

  assert.throws(
    () => specialWindowValidation.assertEditableWithRequests(["submission_deadline"], 1),
    (error) => error.statusCode === 409 && error.message === "special_window_has_requests_protected_fields"
  );
});

test("derived special-window status follows open, deadline, review and archived states", () => {
  const window = {
    is_active: true,
    submission_open_date: "2027-01-01",
    submission_deadline: "2027-03-01",
    review_start_date: "2027-03-15",
    absence_end_date: "2027-07-31",
  };

  assert.equal(specialWindowStatus.deriveSpecialWindowStatus(window, { asOfDate: "2026-12-31" }), "scheduled");
  assert.equal(specialWindowStatus.deriveSpecialWindowStatus(window, { asOfDate: "2027-02-01" }), "open");
  assert.equal(specialWindowStatus.deriveSpecialWindowStatus(window, { asOfDate: "2027-03-10" }), "closed_waiting_review");
  assert.equal(specialWindowStatus.deriveSpecialWindowStatus(window, { asOfDate: "2027-04-01" }), "review_open");
  assert.equal(specialWindowStatus.deriveSpecialWindowStatus({ ...window, is_active: false }, { asOfDate: "2027-04-01" }), "archived");
});

test("review overview redacts private comments and reports simple overlap signals", () => {
  const rows = [
    { id: uuid(10), start_date: "2027-07-01", end_date: "2027-07-10", duration_type: "full_days", status: "submitted" },
    { id: uuid(11), start_date: "2027-07-05", end_date: "2027-07-12", duration_type: "full_days", status: "submitted" },
  ];
  const signals = specialWindowService._test.buildOverlapSignals(rows);
  const mapped = specialWindowService._test.mapReviewRequest({
    ...rows[0],
    tenant_id: uuid(1),
    employee_tenant_user_id: uuid(2),
    employee_name: "Anne",
    absence_type_id: uuid(3),
    absence_type_key: "vacation",
    absence_type_name: "Ferie",
    timezone: "Europe/Copenhagen",
    employee_comment: "Privat note",
    submitted_after_deadline: true,
    submitted_metadata: { late_submission_policy: "manual_review" },
    resource_groups: [{ id: uuid(4), name: "Service" }],
    version: 2,
  }, { includePrivateComment: false, overlapSignals: signals });

  assert.equal(mapped.has_private_comment, true);
  assert.equal(Object.prototype.hasOwnProperty.call(mapped, "employee_comment"), false);
  assert.equal(mapped.late_submission, true);
  assert.equal(mapped.overlap_signals.length, 1);
  assert.equal(mapped.resource_groups[0].name, "Service");
});

test("special-window repository resolves resource groups through tenant-scoped fitter membership", () => {
  const source = read("backend/src/modules/absence/absenceSpecialWindow.repository.js");
  assert.match(source, /JOIN resource_group_members rgm[\s\S]+rgm\.tenant_id = sws\.tenant_id/);
  assert.match(source, /JOIN fitter f[\s\S]+f\.tenant_id = rgm\.tenant_id[\s\S]+f\.tenant_user_id = \$2/);
  assert.match(source, /rg\.status = 'active'/);
  assert.doesNotMatch(source, /absence_special_window_scope_unclear/);
});
