"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://example.invalid/fielddesk_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || "fielddesk.test";

const { captureDay, _constants } = require("../backend/src/modules/timeControl/timeControl.capture");
const coverage = require("../backend/src/modules/timeControl/timeControl.coverage");

test("replays the retained actual EK full-terminal source capture through the production adapter", {
  skip: !process.env.FIELDDESK_TC_TERMINAL_EVIDENCE_PATH,
}, async () => {
  const source = JSON.parse(require("node:fs").readFileSync(process.env.FIELDDESK_TC_TERMINAL_EVIDENCE_PATH, "utf8"));
  const captured = source.captures.find(c => c.day === "2026-09-26");
  assert.equal(captured.rows.length, 30);
  assert.equal(captured.stable, true);
  let calls = 0;
  const fetchImpl = async url => {
    const query = new URL(url).searchParams;
    assert.equal(query.get("fromDate"), captured.day);
    assert.equal(query.get("toDate"), captured.day);
    const pass = captured.passes[Math.floor(calls / 3)];
    const page = pass.pages[Number(query.get("page")) - 1];
    calls++;
    const actual = source.requests[page.requestNumber - 1];
    assert.equal(actual.hasErrors, false);
    return response(payload(actual.rows.map(r => ({
      id: Number(r.id), date:r.date, hours:r.hours, fitterID:r.fitterId,
      categoryID:r.categoryId, categoryReference:r.categoryReference,
      projectID:r.projectId, projectReference:r.projectReference,
    })), { total:page.total, currentPage:page.currentPage, nextPage:page.nextPage }));
  };
  const result = await captureDay({ tenantId, controlledDate:captured.day,
    testDependencies:dependencies(fetchImpl) });
  assert.equal(calls, 6);
  assert.equal(result.proof.row_count, 30);
  assert.equal(result.proof.contract, "ek_v4_all_projects_single_day_two_pass_v3");
});

const tenantId = "00000000-0000-4000-8000-000000000001";
const day = "2026-10-08";

function row(id, patch = {}) {
  return {
    id,
    date: `${day}T00:00:00`,
    hours: 7.5,
    fitterID: 24,
    categoryID: 291,
    categoryReference: "1236",
    projectID: 23050,
    projectReference: "12325-026",
    fitterName: "Must not be retained",
    note: "Must not be retained",
    ...patch,
  };
}

function payload(rows, {
  total = rows.length, currentPage = 1, nextPage = null, hasErrors = false,
  errorCount = 0, patch = {},
} = {}) {
  return {
    hasErrors,
    errorMessage: null,
    validationErrors: [],
    modelStateErrors: {},
    errorCount,
    data: {
      data: rows,
      total,
      currentPage,
      nextPage,
      hasErrors: null,
    },
    ...patch,
  };
}

function response(json, { status = 200, headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    text: async () => JSON.stringify(json),
  };
}

function dependencies(fetchImpl, options = {}) {
  let milliseconds = options.startMs ?? Date.UTC(2026, 9, 12, 0, 0);
  return {
    client: {},
    resolveTenantConfig: async (_client, input) => {
      assert.equal(input.tenant, tenantId);
      return {
        tenantId,
        ekBaseUrl: "https://ek.example.test/",
        ekApiKey: "injected-api-key",
        siteName: "injected-site",
      };
    },
    fetchImpl,
    now: () => milliseconds,
    sleep: async (delay) => {
      if (options.sleeps) options.sleeps.push(delay);
      milliseconds += delay;
    },
  };
}

function paginated(rows, { onRequest } = {}) {
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    const parsedUrl = new URL(url);
    const page = Number(parsedUrl.searchParams.get("page"));
    const fromDate = parsedUrl.searchParams.get("fromDate");
    const toDate = parsedUrl.searchParams.get("toDate");
    assert.equal(parsedUrl.pathname, "/api/v4/paginatedfitterhours");
    assert.deepEqual([...parsedUrl.searchParams.keys()].sort(), ["fromDate", "page", "pageSize", "toDate"]);
    assert.equal(fromDate, day);
    assert.equal(toDate, day);
    assert.equal(parsedUrl.searchParams.get("pageSize"), "10");
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.apikey, "injected-api-key");
    assert.equal(init.headers.siteName, "injected-site");
    assert.equal(init.headers.Accept, "application/json");
    const result = onRequest
      ? onRequest({ call: calls, page, fromDate, toDate, init })
      : (() => {
        const pages = Math.ceil(rows.length / 10);
        const pageRows = rows.slice((page - 1) * 10, page * 10);
        return payload(pageRows, {
          total: rows.length,
          currentPage: page,
          nextPage: page < pages ? page + 1 : null,
        });
      })();
    return result && result.status
      ? result
      : response(result);
  };
  fetchImpl.callCount = () => calls;
  return fetchImpl;
}

test("captures a complete v4 all-project day with only approved projected fields and real server observation", async () => {
  const startMs = Date.UTC(2026, 9, 12, 1, 0);
  const fetchImpl = paginated([row(42), row(43, { hours: 2 })]);
  const dataset = await captureDay({
    tenantId,
    controlledDate: day,
    testDependencies: dependencies(fetchImpl, { startMs }),
  });

  assert.equal(dataset.proof.status, "complete");
  assert.equal(dataset.proof.contract, "ek_v4_all_projects_single_day_two_pass_v3");
  assert.equal(dataset.proof.row_count, 2);
  assert.equal(coverage.getCaptureObservation(dataset), new Date(startMs).toISOString());
  assert.equal(fetchImpl.callCount(), 2);

  const evidence = coverage.getDatasetEvidence(dataset, { tenantId, controlledDate: day });
  assert.equal(evidence.evidence.endpointContract.scope, "tenant_all_projects");
  assert.deepEqual(evidence.evidence.endpointContract.requestParameters, {
    fromDate: day, toDate: day, pageSize: 10,
  });
  assert.equal(evidence.evidence.capture.logicalPageCalls, 2);
  assert.equal(evidence.passes.length, 2);
  assert.ok(evidence.passes.every((pass) => pass.startedAt && pass.completedAt));
  assert.ok(evidence.passes[0].pageEvidence[0].attempts[0].outcome === "success");
  assert.deepEqual(Object.keys(evidence.rows[0]).sort(), [
    "categoryId", "categoryReference", "date", "fitterId", "hours", "id", "projectId", "projectReference",
  ]);
  assert.equal(JSON.stringify(evidence).includes("injected-api-key"), false);
  assert.equal(JSON.stringify(evidence).includes("fitterName"), false);
  assert.equal(JSON.stringify(evidence).includes("Must not be retained"), false);
});

test("accepts the strict v4 envelope only and fails closed on API and malformed responses", async () => {
  for (const badPayload of [
    { rows: [row(1)] },
    payload([row(1)], { hasErrors: true }),
    payload([row(1)], { errorCount: 1 }),
    payload([row(1)], { patch: { validationErrors: [{ error: "invalid" }] } }),
    payload([row(1)], { patch: { data: { data: null } } }),
  ]) {
    const fetchImpl = paginated([], { onRequest: () => response(badPayload) });
    await assert.rejects(
      captureDay({ tenantId, controlledDate: day, testDependencies: dependencies(fetchImpl) }),
      /time_control_capture_invalid:/,
    );
  }
});

test("honors Retry-After within the day deadline and records sanitized retry evidence", async () => {
  const sleeps = [];
  let first = true;
  const fetchImpl = paginated([row(1)], {
    onRequest: () => {
      if (first) {
        first = false;
        return response(null, { status: 429, headers: { "retry-after": "2" } });
      }
      return response(payload([row(1)]));
    },
  });
  const dataset = await captureDay({
    tenantId, controlledDate: day,
    testDependencies: dependencies(fetchImpl, { sleeps }),
  });
  const evidence = coverage.getDatasetEvidence(dataset, { tenantId, controlledDate: day });
  assert.deepEqual(sleeps, [2000]);
  assert.equal(evidence.passes[0].pageEvidence[0].attempts.length, 2);
  assert.equal(evidence.passes[0].pageEvidence[0].attempts[0].retryAfterMs, 2000);
  assert.equal(evidence.passes[0].pageEvidence[0].attempts[1].outcome, "success");
  assert.equal(fetchImpl.callCount(), 3);
});

test("fails a Retry-After that would exhaust the bounded day deadline", async () => {
  let calls = 0;
  const sleeps = [];
  const fetchImpl = paginated([], {
    onRequest: () => {
      calls += 1;
      return response(null, { status: 429, headers: { "retry-after": "121" } });
    },
  });
  await assert.rejects(
    captureDay({
      tenantId, controlledDate: day,
      testDependencies: dependencies(fetchImpl, { sleeps }),
    }),
    /deadline_exceeded_retry_after/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test("bounds EK config resolution and destroys its acquired client when the resolver hangs", async () => {
  let releasedWith;
  let resolverStarted = false;
  const client = {
    release(error) {
      releasedWith = error;
    },
  };
  const pool = {
    connect: async () => client,
  };
  const fetchImpl = async () => {
    throw new Error("EK request must not start before tenant config resolves");
  };
  const pendingConfigResolver = () => {
    resolverStarted = true;
    return new Promise(() => {});
  };

  await assert.rejects(
    captureDay({
      tenantId,
      controlledDate: day,
      testDependencies: {
        pool,
        resolveTenantConfig: pendingConfigResolver,
        fetchImpl,
        deadlineMs: 25,
      },
    }),
    /time_control_capture_invalid:deadline_exceeded/,
  );
  assert.equal(resolverStarted, true);
  assert.ok(releasedWith instanceof Error);
  assert.equal(releasedWith.captureDeadline, true);
});

test("requires stable two-pass pagination and distinct in-day rows even with a full terminal page", async () => {
  const elevenRows = Array.from({ length: 11 }, (_, index) => row(index + 20));
  const completePagination = paginated(elevenRows);
  const complete = await captureDay({
    tenantId, controlledDate: day,
    testDependencies: dependencies(completePagination),
  });
  const completeEvidence = coverage.getDatasetEvidence(complete, { tenantId, controlledDate: day });
  assert.equal(complete.proof.row_count, 11);
  assert.equal(completeEvidence.passes[0].pageEvidence.length, 2);
  assert.equal(completeEvidence.passes[1].pageEvidence[1].currentPage, 2);
  assert.equal(completePagination.callCount(), 4);

  const partial = paginated([], {
    onRequest: ({ page }) => {
      const pageRows = page === 1
        ? Array.from({ length: 10 }, (_, index) => row(index + 50))
        : [row(60)];
      return response(payload(pageRows, {
        total: 12,
        currentPage: page,
        nextPage: page === 1 ? 2 : null,
      }));
    },
  });
  await assert.rejects(
    captureDay({ tenantId, controlledDate: day, testDependencies: dependencies(partial) }),
    /total_changed/,
  );

  let pass = 0;
  const unstable = paginated([], {
    onRequest: () => {
      pass += 1;
      return response(payload([row(1, { hours: pass === 1 ? 7 : 8 })]));
    },
  });
  await assert.rejects(
    captureDay({ tenantId, controlledDate: day, testDependencies: dependencies(unstable) }),
    /dataset_changed/,
  );

  for (const rows of [
    [row(2), row(2)],
    [row(3, { date: "2026-10-09T00:00:00" })],
  ]) {
    const fetchImpl = paginated(rows);
    await assert.rejects(
      captureDay({ tenantId, controlledDate: day, testDependencies: dependencies(fetchImpl) }),
      /time_control_capture_invalid:/,
    );
  }

  const fullPage = paginated(Array.from({ length: 30 }, (_, index) => row(index + 10)));
  const full = await captureDay({
    tenantId, controlledDate: day, testDependencies: dependencies(fullPage),
  });
  assert.equal(full.proof.row_count, 30);
  const fullEvidence = coverage.getDatasetEvidence(full, { tenantId, controlledDate: day });
  assert.deepEqual(fullEvidence.passes[0].pageEvidence.map(p => [p.currentPage, p.nextPage, p.rowCount]),
    [[1, 2, 10], [2, 3, 10], [3, null, 10]]);
  assert.equal(fullPage.callCount(), 6);
  const legacyEvidence = structuredClone(fullEvidence);
  legacyEvidence.evidence.endpointContract.version = "ek_v4_all_projects_single_day_two_pass_v2";
  assert.throws(() => coverage.createHoursDataset(legacyEvidence), /page_terminal/);
  const prematureTerminal = paginated([], { onRequest: () =>
    payload(Array.from({ length: 10 }, (_, index) => row(index + 10)), { total: 20 }) });
  await assert.rejects(
    captureDay({
      tenantId, controlledDate: day,
      testDependencies: dependencies(prematureTerminal),
    }),
    /total_changed/,
  );
});

test("zero-row EK responses never become verified coverage", async () => {
  const fetchImpl = paginated([], {
    onRequest: () => response(payload([], { total: 0, currentPage: 0, nextPage: null })),
  });
  await assert.rejects(
    captureDay({ tenantId, controlledDate: day, testDependencies: dependencies(fetchImpl) }),
    /unverified_zero_day_contract/,
  );
  assert.equal(fetchImpl.callCount(), 1);
});

test("caps request retries and page count without exceeding the published budgets", async () => {
  assert.deepEqual(_constants, {
    ENDPOINT: "/api/v4/paginatedfitterhours",
    PAGE_SIZE: 10,
    MAX_PAGES_PER_PASS: 1000,
    MAX_PAGE_CALLS_PER_DAY: 2000,
    MAX_ATTEMPTS_PER_REQUEST: 3,
    CAPTURE_DEADLINE_MS: 120000,
    MAX_REQUEST_TIMEOUT_MS: 15000,
  });

  const failing = paginated([], {
    onRequest: () => response(null, { status: 503 }),
  });
  await assert.rejects(
    captureDay({ tenantId, controlledDate: day, testDependencies: dependencies(failing) }),
    /request_attempt_limit/,
  );
  assert.equal(failing.callCount(), 3);

  let pageRequests = 0;
  const tooManyPages = paginated([], {
    onRequest: ({ page }) => {
      pageRequests += 1;
      const rows = Array.from({ length: 10 }, (_, index) => row((page - 1) * 10 + index + 1));
      return response(payload(rows, {
        total: 20001,
        currentPage: page,
        nextPage: page + 1,
      }));
    },
  });
  await assert.rejects(
    captureDay({ tenantId, controlledDate: day, testDependencies: dependencies(tooManyPages) }),
    /page_progression/,
  );
  assert.equal(pageRequests, 1000);
});

test("dataset revision changes when captured rows are added, changed or deleted", async () => {
  async function revision(rows) {
    const dataset = await captureDay({
      tenantId, controlledDate: day,
      testDependencies: dependencies(paginated(rows)),
    });
    return dataset.proof.dataset_revision;
  }

  const original = [row(100), row(101)];
  const changed = [row(100, { hours: 6.5 }), row(101)];
  const deleted = [row(100)];
  const revisions = await Promise.all([
    revision(original), revision(changed), revision(deleted),
  ]);
  assert.equal(new Set(revisions).size, 3);
});
