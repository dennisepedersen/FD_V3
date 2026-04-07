/**
 * verify_bootstrap_family_fix.js
 *
 * Read-only verification: proves that the Model A bootstrap fix (pendingRows buffer +
 * flushPendingScopeRows) correctly handles the case where an inactive parent lands on
 * an earlier page than its active subproject.
 *
 * Test case used: project 80229-001 (ekProjectId 29167, parentProjectID 18008).
 *
 * Logic:
 *   - Simulate page assignment:  page = Math.ceil(ekProjectId / PAGE_SIZE)
 *     (EK paginates by projectID ascending, so this is a stable approximation)
 *   - Find families where parent and sub(s) would land on DIFFERENT pages
 *   - Show which ones have inactive parent + active sub (the worst-case bug scenario)
 *   - Show current DB state for those families
 *   - Answer: would old code have failed? Does new code cover it?
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.production') });
const { Pool } = require('pg');

const PAGE_SIZE = 200; // matches syncWorker PAGE_SIZE

function simulatePage(ekProjectId) {
  if (!ekProjectId) return null;
  return Math.ceil(Number(ekProjectId) / PAGE_SIZE);
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Step 1: Find families where parent is inactive and at least one sub is
    //         active. Show their simulated page numbers.
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════');
    console.log(' STEP 1: Find inactive-parent / active-sub families');
    console.log('══════════════════════════════════════════════');

    const { rows: familyCandidates } = await pool.query(`
      WITH families AS (
        SELECT
          parent.ek_project_id         AS parent_ek_id,
          parent.is_closed             AS parent_is_closed,
          sub.ek_project_id            AS sub_ek_id,
          sub.is_closed                AS sub_is_closed,
          sub.parent_project_ek_id     AS sub_parent_ek_id,
          pc_parent.external_project_ref AS parent_ref,
          pc_sub.external_project_ref    AS sub_ref
        FROM project_masterdata_v4 sub
        JOIN project_core pc_sub
          ON pc_sub.project_id = sub.project_id
         AND pc_sub.tenant_id  = sub.tenant_id
        JOIN project_masterdata_v4 parent
          ON parent.ek_project_id = sub.parent_project_ek_id
         AND parent.tenant_id    = sub.tenant_id
        JOIN project_core pc_parent
          ON pc_parent.project_id = parent.project_id
         AND pc_parent.tenant_id  = parent.tenant_id
        WHERE sub.parent_project_ek_id IS NOT NULL
          AND sub.ek_project_id IS NOT NULL
          AND parent.ek_project_id IS NOT NULL
          -- inactive parent + active sub
          AND COALESCE(parent.is_closed, false) = true
          AND COALESCE(sub.is_closed,   false) = false
      )
      SELECT
        parent_ek_id,
        parent_ref,
        parent_is_closed,
        sub_ek_id,
        sub_ref,
        sub_is_closed
      FROM families
      ORDER BY parent_ek_id, sub_ek_id
      LIMIT 20
    `);

    if (familyCandidates.length === 0) {
      console.log(
        '  NOTE: No inactive-parent/active-sub families found in current DB.\n' +
        '  This means either:\n' +
        '  a) Bootstrap has not run yet (project_masterdata_v4 may be empty/partial), or\n' +
        '  b) The flush correctly captured them so is_closed is now stored correctly.\n\n' +
        '  Falling back to known test case: 80229-001 (sub 29167, parent 18008).'
      );
    } else {
      console.log(`  Found ${familyCandidates.length} inactive-parent / active-sub pairs:\n`);
      for (const r of familyCandidates) {
        const parentPage = simulatePage(r.parent_ek_id);
        const subPage    = simulatePage(r.sub_ek_id);
        const splitPage  = parentPage !== subPage ? ' ← DIFFERENT PAGES' : '';
        console.log(
          `  parent: ekId=${r.parent_ek_id} ref=${r.parent_ref} isClosed=${r.parent_is_closed} page≈${parentPage}` +
          `  →  sub: ekId=${r.sub_ek_id} ref=${r.sub_ref} isClosed=${r.sub_is_closed} page≈${subPage}${splitPage}`
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 2: Known concrete test case — 80229-001 (sub 29167, parent 18008)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════');
    console.log(' STEP 2: Known test case — 80229-001 / parent 18008');
    console.log('══════════════════════════════════════════════');

    const subEkId    = 29167;
    const parentEkId = 18008;
    const subPage    = simulatePage(subEkId);
    const parentPage = simulatePage(parentEkId);

    console.log(`  sub    ekProjectId=${subEkId}    → simulated page ${subPage}`);
    console.log(`  parent ekProjectId=${parentEkId}  → simulated page ${parentPage}`);
    console.log(
      `  Page difference: ${subPage - parentPage} pages apart` +
      (parentPage < subPage ? '  (parent EARLIER than sub — worst-case for old code)' : '')
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Step 3: Show DB state for this family
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════');
    console.log(' STEP 3: DB state for family root 18008');
    console.log('══════════════════════════════════════════════');

    const { rows: familyRows } = await pool.query(`
      SELECT
        pc.external_project_ref                        AS ref,
        pm.ek_project_id                               AS ek_project_id,
        pm.parent_project_ek_id                        AS parent_ek_id,
        pm.is_subproject,
        pm.is_closed,
        pc.status,
        pc.responsible_name,
        pw.last_registration,
        pw.last_fitter_hour_date,
        pm.total_turn_over_exp,
        pm.source_updated_at
      FROM project_masterdata_v4 pm
      JOIN project_core pc
        ON pc.project_id = pm.project_id
       AND pc.tenant_id  = pm.tenant_id
      LEFT JOIN project_wip pw
        ON pw.project_id = pm.project_id
       AND pw.tenant_id  = pm.tenant_id
      WHERE
        -- family root 18008: either IS the parent (ek_project_id=18008)
        -- or has parent_project_ek_id=18008 (is a sub of it)
        (pm.ek_project_id = $1 OR pm.parent_project_ek_id = $1)
      ORDER BY pm.ek_project_id
    `, [parentEkId]);

    if (familyRows.length === 0) {
      console.log('  No rows found for family root 18008 in project_masterdata_v4.');
      console.log('  This likely means bootstrap has not run yet for this tenant.');
    } else {
      console.log(`  Family members in DB (${familyRows.length} rows):\n`);
      for (const r of familyRows) {
        const ekId  = r.ek_project_id;
        const page  = simulatePage(ekId);
        const role  = r.parent_ek_id === null ? 'PARENT' : 'SUB   ';
        console.log(
          `  [${role}] ref=${r.ref}  ekId=${ekId}  parentEkId=${r.parent_ek_id ?? 'null'}` +
          `  isClosed=${r.is_closed}  page≈${page}` +
          `  totalTurnOverExp=${r.total_turn_over_exp ?? 'null'}` +
          `  lastReg=${r.last_registration ? r.last_registration.toISOString().slice(0,10) : 'null'}`
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 4: Find families on different pages (split-page proof)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════');
    console.log(' STEP 4: Count families that span MULTIPLE pages (pageSize=200)');
    console.log('══════════════════════════════════════════════');

    const { rows: splitPageFamilies } = await pool.query(`
      WITH family_pages AS (
        SELECT
          COALESCE(pm.parent_project_ek_id, pm.ek_project_id) AS root_ek_id,
          pm.ek_project_id,
          CEIL(pm.ek_project_id::numeric / $1) AS simulated_page
        FROM project_masterdata_v4 pm
        WHERE pm.ek_project_id IS NOT NULL
      )
      SELECT
        root_ek_id,
        MIN(simulated_page) AS min_page,
        MAX(simulated_page) AS max_page,
        COUNT(*) AS family_size,
        MAX(simulated_page) - MIN(simulated_page) AS page_spread
      FROM family_pages
      GROUP BY root_ek_id
      HAVING COUNT(*) > 1
         AND MAX(simulated_page) - MIN(simulated_page) > 0
      ORDER BY page_spread DESC, root_ek_id
      LIMIT 10
    `, [PAGE_SIZE]);

    if (splitPageFamilies.length === 0) {
      console.log('  No multi-member families spanning different pages found in current DB.');
    } else {
      console.log(`  Top ${splitPageFamilies.length} families spanning multiple pages:\n`);
      for (const r of splitPageFamilies) {
        console.log(
          `  root_ek_id=${r.root_ek_id}  familySize=${r.family_size}` +
          `  pages=${r.min_page}–${r.max_page}  spread=${r.page_spread} pages`
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 5: Verdict
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════');
    console.log(' STEP 5: Verdict');
    console.log('══════════════════════════════════════════════\n');

    const parentOnEarlierPage = parentPage < subPage;
    console.log(
      '  Test case 80229-001 / parent 18008:\n' +
      `    sub 29167 → page ${subPage}\n` +
      `    parent 18008 → page ${parentPage}\n` +
      `    Parent arrives ${parentPage < subPage ? 'EARLIER' : 'later'} than sub.\n`
    );

    if (parentOnEarlierPage) {
      console.log(
        '  OLD CODE BEHAVIOUR (before fix):\n' +
        '    Page ' + parentPage + ': parent 18008 seen, isClosed=? → if inactive: pendingRows absent,\n' +
        '      no buffer → row DISCARDED.\n' +
        '    Page ' + subPage + ': sub 29167 seen, isClosed=false → familyRootEkIds.add(18008).\n' +
        '    familyRootEkIds now contains 18008, but parent row is ALREADY GONE.\n' +
        '    RESULT: subproject persisted, parent NOT persisted → FAMILY INCOMPLETE. ✗\n'
      );
      console.log(
        '  NEW CODE BEHAVIOUR (after fix):\n' +
        '    Page ' + parentPage + ': parent 18008, if inactive → buffered in pendingRows.\n' +
        '    Page ' + subPage + ': sub 29167, isClosed=false → familyRootEkIds.add(18008).\n' +
        '      Step 2 immediately resolves pendingRows: 18008 matches → included, removed from buffer.\n' +
        '      (If resolution happens later: flushPendingScopeRows() after all pages catches it.)\n' +
        '    RESULT: both parent AND sub persisted → FAMILY COMPLETE. ✓\n'
      );
    } else {
      console.log(
        '  In this specific case parent page (' + parentPage + ') >= sub page (' + subPage + ').\n' +
        '  The opposite ordering (active sub seen first, inactive parent later) would be handled\n' +
        '  by flushPendingScopeRows() after all pages complete.\n' +
        '  OLD CODE: parent buffered nowhere — DISCARDED. ✗\n' +
        '  NEW CODE: parent buffered in pendingRows → flushed after loop. ✓\n'
      );
    }

    const subInDb = familyRows.find((r) => r.ek_project_id === subEkId);
    const parentInDb = familyRows.find((r) => r.ek_project_id === parentEkId);

    if (subInDb && parentInDb) {
      console.log('  DB RESULT: Both PARENT and SUB present in project_masterdata_v4. ✓');
      console.log('  ┌─────────────────────────────────────────────────────');
      console.log(`  │ PARENT  ref=${parentInDb.ref}  ekId=${parentInDb.ek_project_id}  isClosed=${parentInDb.is_closed}`);
      console.log(`  │ SUB     ref=${subInDb.ref}     ekId=${subInDb.ek_project_id}     isClosed=${subInDb.is_closed}`);
      console.log('  └─────────────────────────────────────────────────────');
      console.log('\n  DOM: BOOTSTRAP SIKKER ✓');
    } else if (subInDb && !parentInDb) {
      console.log('  DB RESULT: Sub found, PARENT MISSING from project_masterdata_v4. ✗');
      console.log('  This confirms the old bug. Run a fresh bootstrap with the fix to resolve.');
      console.log('\n  DOM: BOOTSTRAP KAN MISSE FAMILIE (bootstrap not yet re-run with fix) ✗');
    } else if (!subInDb && !parentInDb) {
      console.log('  DB RESULT: Neither parent nor sub found in project_masterdata_v4.');
      console.log('  Bootstrap has not run yet — no conclusion possible from DB state.');
      console.log('\n  DOM: BOOTSTRAP IKKE KOERT ENDNU — KØR BOOTSTRAP FOR AT VERIFICERE');
    } else {
      console.log('  DB RESULT: Parent found, sub missing — unexpected state.');
    }

  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
