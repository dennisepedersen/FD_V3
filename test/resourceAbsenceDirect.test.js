"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://example.invalid/fielddesk_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || "fielddesk.test";

const pool = require("../backend/src/db/pool");
const resourceAbsenceRepository = require("../backend/src/modules/calendar/resourceAbsence.repository");
const resourceAbsenceService = require("../backend/src/modules/calendar/resourceAbsence.service");

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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

test("direct sickness registration requires note server-side", async () => {
  await assert.rejects(
    resourceAbsenceService.preflightAbsenceForTenant({
      tenantId: uuid(1),
      fitterId: "FIT-1",
      absenceType: "sickness",
      startDate: "2027-07-01",
      endDate: "2027-07-01",
      visibilityScope: "tenant_admin_only",
      createdByUserId: uuid(2),
    }),
    (error) => error.statusCode === 400 && error.message === "direct_sickness_note_required"
  );
});

test("direct absence idempotency rejects payload mismatch before insert", async () => {
  const client = createTxClient();
  let inserts = 0;
  await withPatches([
    [pool, "connect", async () => client],
    [resourceAbsenceRepository, "listByDirectIdempotencyKey", async () => ([{
      id: uuid(10),
      idempotency_payload_hash: "0".repeat(64),
    }])],
    [resourceAbsenceRepository, "createAbsenceForTenant", async () => { inserts += 1; }],
  ], async () => {
    await assert.rejects(
      resourceAbsenceService.createAbsenceForTenant({
        tenantId: uuid(1),
        fitterId: "FIT-1",
        absenceType: "sickness",
        startDate: "2027-07-01",
        endDate: "2027-07-01",
        note: "Ringet ind kl. 07:12",
        visibilityScope: "tenant_admin_only",
        createdByUserId: uuid(2),
        updatedByUserId: uuid(2),
        idempotencyKey: "abc",
      }),
      (error) => error.statusCode === 409 && error.message === "direct_absence_idempotency_payload_mismatch"
    );
  });

  assert.equal(inserts, 0);
  assert.deepEqual(client.calls.map((call) => call.sql).filter((sql) => ["BEGIN", "ROLLBACK"].includes(sql)), ["BEGIN", "ROLLBACK"]);
});

test("direct absence overlap preflight creates only missing same-type segments without exposing notes", async () => {
  const client = createTxClient();
  const inserts = [];
  await withPatches([
    [pool, "connect", async () => client],
    [resourceAbsenceRepository, "listByDirectIdempotencyKey", async () => []],
    [resourceAbsenceRepository, "listAbsencesForFitterRange", async () => ([{
      id: uuid(20),
      absence_type: "sickness",
      status: "approved",
      start_date: "2027-07-02",
      end_date: "2027-07-03",
      note: "Privat note må ikke ud",
      visibility_scope: "tenant_admin_only",
    }])],
    [resourceAbsenceRepository, "createAbsenceForTenant", async (_client, args) => {
      inserts.push(args);
      return { id: uuid(30 + inserts.length), ...args };
    }],
  ], async () => {
    const result = await resourceAbsenceService.createAbsenceForTenant({
      tenantId: uuid(1),
      fitterId: "FIT-1",
      absenceType: "sickness",
      startDate: "2027-07-01",
      endDate: "2027-07-04",
      note: "Ringet ind kl. 07:12",
      visibilityScope: "tenant_admin_only",
      createdByUserId: uuid(2),
      updatedByUserId: uuid(2),
      idempotencyKey: "abc",
    });

    assert.equal(result.absences.length, 2);
    assert.deepEqual(inserts.map((item) => [item.startDate, item.endDate, item.idempotencySegmentIndex]), [
      ["2027-07-01", "2027-07-01", 1],
      ["2027-07-04", "2027-07-04", 2],
    ]);
    assert.equal(result.preflight.requires_confirmation, true);
    assert.equal(JSON.stringify(result.preflight).includes("Privat note"), false);
  });
});

test("direct vacation overlap creates the canonical missing tail and leaves source records unchanged", async () => {
  const client = createTxClient();
  const existing = [{
    id: uuid(40),
    absence_type: "vacation",
    status: "approved",
    start_date: "2026-08-24",
    end_date: "2026-08-30",
    note: "Privat note maa ikke ud",
    visibility_scope: "tenant_admin_only",
  }];
  const snapshot = JSON.stringify(existing);
  const inserts = [];
  await withPatches([
    [pool, "connect", async () => client],
    [resourceAbsenceRepository, "listByDirectIdempotencyKey", async () => []],
    [resourceAbsenceRepository, "listAbsencesForFitterRange", async () => existing],
    [resourceAbsenceRepository, "createAbsenceForTenant", async (_client, args) => {
      inserts.push(args);
      return { id: uuid(50 + inserts.length), ...args };
    }],
  ], async () => {
    const result = await resourceAbsenceService.createAbsenceForTenant({
      tenantId: uuid(1),
      fitterId: "TBT",
      absenceType: "vacation",
      startDate: "2026-08-25",
      endDate: "2026-10-29",
      note: "",
      visibilityScope: "tenant_admin_only",
      createdByUserId: uuid(2),
      updatedByUserId: uuid(2),
      idempotencyKey: "vacation-tail",
    });

    assert.equal(JSON.stringify(existing), snapshot, "underlying source record is not mutated");
    assert.equal(result.preflight.requires_confirmation, true);
    assert.equal(result.preflight.reason, "same_type_partial_overlap");
    assert.deepEqual(result.preflight.missing_segments, [{ start_date: "2026-08-31", end_date: "2026-10-29" }]);
    assert.equal(JSON.stringify(result.preflight).includes("Privat note"), false);
    assert.deepEqual(inserts.map((item) => [item.startDate, item.endDate]), [["2026-08-31", "2026-10-29"]]);
  });
});

test("direct absence preflight blocks fully covered and different-type overlap without mutation", async () => {
  const client = createTxClient();
  let inserts = 0;
  await withPatches([
    [pool, "connect", async () => client],
    [resourceAbsenceRepository, "listAbsencesForFitterRange", async () => [{
      id: uuid(60),
      absence_type: "vacation",
      status: "approved",
      start_date: "2026-08-24",
      end_date: "2026-10-29",
      note: "Privat note",
      visibility_scope: "tenant_admin_only",
    }]],
    [resourceAbsenceRepository, "createAbsenceForTenant", async () => { inserts += 1; }],
  ], async () => {
    const result = await resourceAbsenceService.preflightAbsenceForTenant({
      tenantId: uuid(1),
      fitterId: "TBT",
      absenceType: "vacation",
      startDate: "2026-08-25",
      endDate: "2026-10-29",
      note: "",
      visibilityScope: "tenant_admin_only",
      createdByUserId: uuid(2),
    });
    assert.equal(result.preflight.already_covered, true);
    assert.equal(result.preflight.can_apply, false);
    assert.equal(JSON.stringify(result.preflight).includes("Privat note"), false);
  });

  await withPatches([
    [pool, "connect", async () => client],
    [resourceAbsenceRepository, "listByDirectIdempotencyKey", async () => []],
    [resourceAbsenceRepository, "listAbsencesForFitterRange", async () => [{
      id: uuid(61),
      absence_type: "sickness",
      status: "approved",
      start_date: "2026-08-24",
      end_date: "2026-08-30",
      note: "Privat sygenote",
      visibility_scope: "tenant_admin_only",
    }]],
    [resourceAbsenceRepository, "createAbsenceForTenant", async () => { inserts += 1; }],
  ], async () => {
    await assert.rejects(
      resourceAbsenceService.createAbsenceForTenant({
        tenantId: uuid(1),
        fitterId: "TBT",
        absenceType: "vacation",
        startDate: "2026-08-25",
        endDate: "2026-10-29",
        note: "",
        visibilityScope: "tenant_admin_only",
        createdByUserId: uuid(2),
        updatedByUserId: uuid(2),
        idempotencyKey: "blocked-different-type",
      }),
      (error) => error.statusCode === 409
        && error.message === "direct_absence_overlap_conflict"
        && error.details.preflight.reason === "different_type_overlap"
        && JSON.stringify(error.details.preflight).includes("Privat sygenote") === false
    );
  });

  assert.equal(inserts, 0);
});