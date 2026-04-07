require("dotenv").config({ path: require("path").resolve(__dirname, "../.env.production") });
const { Client } = require("pg");
const fitterBusinessQueries = require("../src/db/queries/fitterBusiness");

function isSortedAsc(values) {
  const normalized = [...values];
  const sorted = [...values].sort((a, b) => String(a).localeCompare(String(b), "da"));
  return JSON.stringify(normalized) === JSON.stringify(sorted);
}

function isSortedDescByHours(rows) {
  for (let i = 1; i < rows.length; i += 1) {
    const prev = Number(rows[i - 1].total_hours || 0);
    const curr = Number(rows[i].total_hours || 0);
    if (curr > prev) {
      return false;
    }
  }
  return true;
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const tenantRes = await client.query(
      "SELECT id, slug FROM tenant WHERE slug = 'hoyrup-clemmensen' LIMIT 1"
    );
    if (!tenantRes.rows.length) {
      throw new Error("tenant_not_found");
    }
    const tenantId = tenantRes.rows[0].id;

    const candidateRes = await client.query(
      `
      WITH candidate_projects AS (
        SELECT
          pc.project_id,
          pc.external_project_ref,
          pc.name,
          COUNT(*) AS raw_rows
        FROM project_core pc
        LEFT JOIN project_masterdata_v4 pm
          ON pm.project_id = pc.project_id
         AND pm.tenant_id = pc.tenant_id
        JOIN fitter_hour fh
          ON fh.tenant_id = pc.tenant_id
         AND (
           lower(btrim(coalesce(fh.external_project_ref, ''))) = lower(btrim(coalesce(pc.external_project_ref, '')))
           OR lower(btrim(coalesce(fh.project_id, ''))) = lower(btrim(coalesce(pc.external_project_ref, '')))
           OR lower(btrim(coalesce(fh.external_project_ref, ''))) = lower(btrim(coalesce(pm.ek_project_id::text, '')))
           OR lower(btrim(coalesce(fh.project_id, ''))) = lower(btrim(coalesce(pm.ek_project_id::text, '')))
         )
        WHERE pc.tenant_id = $1
        GROUP BY pc.project_id, pc.external_project_ref, pc.name
      )
      SELECT project_id, external_project_ref, name, raw_rows
      FROM candidate_projects
      ORDER BY raw_rows DESC, name ASC
      LIMIT 1
      `,
      [tenantId]
    );

    if (!candidateRes.rows.length) {
      throw new Error("no_project_with_fitterhours_found");
    }

    const project = candidateRes.rows[0];

    const [summary, detail] = await Promise.all([
      fitterBusinessQueries.getProjectDrawerOutput(client, {
        tenantId,
        projectId: project.project_id,
      }),
      fitterBusinessQueries.getProjectDetailHoursOutput(client, {
        tenantId,
        projectId: project.project_id,
      }),
    ]);

    const rawTotalsRes = await client.query(
      `
      WITH target AS (
        SELECT pc.project_id, pc.external_project_ref, pm.ek_project_id::text AS ek_project_id_text
        FROM project_core pc
        LEFT JOIN project_masterdata_v4 pm
          ON pm.project_id = pc.project_id
         AND pm.tenant_id = pc.tenant_id
        WHERE pc.tenant_id = $1
          AND pc.project_id = $2::uuid
        LIMIT 1
      )
      SELECT
        COALESCE(SUM(COALESCE(fh.hours, fh.quantity, 0)), 0)::numeric(14,2) AS raw_total_hours,
        COUNT(*)::int AS raw_rows
      FROM fitter_hour fh
      JOIN target t ON (
        lower(btrim(coalesce(fh.external_project_ref, ''))) = lower(btrim(coalesce(t.external_project_ref, '')))
        OR lower(btrim(coalesce(fh.project_id, ''))) = lower(btrim(coalesce(t.external_project_ref, '')))
        OR lower(btrim(coalesce(fh.external_project_ref, ''))) = lower(btrim(coalesce(t.ek_project_id_text, '')))
        OR lower(btrim(coalesce(fh.project_id, ''))) = lower(btrim(coalesce(t.ek_project_id_text, '')))
      )
      WHERE fh.tenant_id = $1
      `,
      [tenantId, project.project_id]
    );

    const exclusionRes = await client.query(
      `
      WITH target AS (
        SELECT pc.project_id, pc.external_project_ref, pm.ek_project_id::text AS ek_project_id_text
        FROM project_core pc
        LEFT JOIN project_masterdata_v4 pm
          ON pm.project_id = pc.project_id
         AND pm.tenant_id = pc.tenant_id
        WHERE pc.tenant_id = $1
          AND pc.project_id = $2::uuid
        LIMIT 1
      ),
      joined AS (
        SELECT
          COALESCE(fh.hours, fh.quantity, 0)::numeric AS hour_value,
          COALESCE(fc.is_only_for_internal_projects, false) AS is_internal_only,
          COALESCE(fc.is_on_invoice, false) AS is_invoice_relevant,
          lower(trim(concat_ws(' ', fc.reference, fc.description, fh.raw_payload_json ->> 'CategoryName', fh.description, fh.note))) AS text_blob
        FROM fitter_hour fh
        JOIN target t ON (
          lower(btrim(coalesce(fh.external_project_ref, ''))) = lower(btrim(coalesce(t.external_project_ref, '')))
          OR lower(btrim(coalesce(fh.project_id, ''))) = lower(btrim(coalesce(t.external_project_ref, '')))
          OR lower(btrim(coalesce(fh.external_project_ref, ''))) = lower(btrim(coalesce(t.ek_project_id_text, '')))
          OR lower(btrim(coalesce(fh.project_id, ''))) = lower(btrim(coalesce(t.ek_project_id_text, '')))
        )
        LEFT JOIN fitter_category fc
          ON fc.tenant_id = fh.tenant_id
         AND (
           (fh.fitter_category_id IS NOT NULL AND fc.fitter_category_id = fh.fitter_category_id)
           OR
           (fh.fitter_category_reference IS NOT NULL AND fc.reference = fh.fitter_category_reference)
         )
        WHERE fh.tenant_id = $1
      )
      SELECT
        COUNT(*) FILTER (WHERE is_internal_only) AS excluded_internal_only,
        COUNT(*) FILTER (WHERE text_blob ~* '(ferie|syg|sygedag|sygdom|barsel|orlov|omsorg|hospital|barns|fri uden lon|fri u/lon|fritvalg|absence|leave)') AS excluded_absence_leave,
        COUNT(*) FILTER (WHERE text_blob ~* '(kursus|moede|mode|vaerksted|verksted|fri|intern)') AS excluded_non_project_activity,
        COUNT(*) FILTER (WHERE is_invoice_relevant = false) AS excluded_non_invoice,
        COUNT(*) FILTER (
          WHERE is_internal_only = false
            AND (text_blob ~* '(ferie|syg|sygedag|sygdom|barsel|orlov|omsorg|hospital|barns|fri uden lon|fri u/lon|fritvalg|absence|leave)') = false
            AND (text_blob ~* '(kursus|moede|mode|vaerksted|verksted|fri|intern)') = false
            AND is_invoice_relevant = true
        ) AS included_project_hour_candidates
      FROM joined
      `,
      [tenantId, project.project_id]
    );

    const rawTotals = rawTotalsRes.rows[0] || { raw_total_hours: "0.00", raw_rows: 0 };
    const exclusions = exclusionRes.rows[0] || {};

    const result = {
      tenant: tenantRes.rows[0],
      project,
      drawer_summary: summary,
      detail_breakdown: {
        total_project_relevant_hours: detail.total_project_relevant_hours,
        fitters: detail.fitters,
      },
      verification: {
        fitter_names_alphabetic: isSortedAsc(summary.fitter_names || []),
        breakdown_sorted_desc_hours: isSortedDescByHours(detail.fitters || []),
        business_total_vs_raw_total: {
          business_total_hours: summary.total_project_relevant_hours,
          raw_total_hours: rawTotals.raw_total_hours,
          raw_rows: Number(rawTotals.raw_rows || 0),
        },
        exclusion_buckets: exclusions,
      },
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
