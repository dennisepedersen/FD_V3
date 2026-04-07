function toSafeLimit(value, fallback = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(parsed), 1), 500);
}

function toSafeOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(Math.floor(parsed), 0);
}

function normalizeNullableText(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

function normalizeProjectSelector({ projectId = null, projectRef = null }) {
  const normalizedProjectId = normalizeNullableText(projectId);
  const normalizedProjectRef = normalizeNullableText(projectRef);

  if (!normalizedProjectId && !normalizedProjectRef) {
    throw new Error("project_selector_required");
  }

  return {
    normalizedProjectId,
    normalizedProjectRef,
  };
}

async function listFitterCategoryBusinessRows(client, {
  tenantId,
  limit = 200,
  offset = 0,
}) {
  const safeLimit = toSafeLimit(limit, 200);
  const safeOffset = toSafeOffset(offset);

  const sql = `
    WITH categories AS (
      SELECT
        fc.id,
        fc.tenant_id,
        fc.fitter_category_id,
        fc.reference,
        fc.description,
        fc.display,
        fc.show_in_app,
        fc.is_only_for_internal_projects,
        fc.is_on_invoice,
        lower(translate(trim(concat_ws(' ', fc.reference, fc.description, fc.display)), 'ÆØÅæøå', 'EOAeoa')) AS text_blob
      FROM fitter_category fc
      WHERE fc.tenant_id = $1
    )
    SELECT
      id,
      tenant_id,
      fitter_category_id,
      reference,
      description,
      display,
      COALESCE(show_in_app, false) AS is_visible_in_app,
      COALESCE(is_only_for_internal_projects, false) AS is_internal_only,
      COALESCE(is_on_invoice, false) AS is_invoice_relevant,
      (
        text_blob ~* '(ferie|syg|sygedag|sygdom|barsel|orlov|omsorg|hospital|barns|fri uden lon|fri u/lon|fritvalg|absence|leave)'
      ) AS is_absence_or_leave,
      (
        text_blob ~* '(kursus|moede|mode|vaerksted|verksted|fri|intern)'
      ) AS is_non_project_activity,
      (
        text_blob ~* '(tilleg|tillaeg|formandstilleg|formandstillaeg|stedtilleg|stedtillaeg)'
      ) AS is_allowance,
      (
        COALESCE(is_only_for_internal_projects, false) = false
        AND (text_blob ~* '(ferie|syg|sygedag|sygdom|barsel|orlov|omsorg|hospital|barns|fri uden lon|fri u/lon|fritvalg|absence|leave)') = false
        AND (text_blob ~* '(kursus|moede|mode|vaerksted|verksted|fri|intern)') = false
        AND (text_blob ~* '(tilleg|tillaeg|formandstilleg|formandstillaeg|stedtilleg|stedtillaeg)') = false
        AND (
          COALESCE(is_on_invoice, false) = true
          OR is_on_invoice IS NULL
        )
      ) AS is_project_hour_candidate
    FROM categories
    ORDER BY description ASC NULLS LAST, fitter_category_id ASC
    LIMIT $2
    OFFSET $3
  `;

  const { rows } = await client.query(sql, [tenantId, safeLimit, safeOffset]);

  return {
    limit: safeLimit,
    offset: safeOffset,
    rows,
  };
}

function buildProjectRelevantHoursCte() {
  return `
    WITH project_target AS (
      SELECT
        pc.project_id,
        pc.external_project_ref,
        pc.name AS project_name,
        pm.ek_project_id::text AS ek_project_id_text
      FROM project_core pc
      LEFT JOIN project_masterdata_v4 pm
        ON pm.project_id = pc.project_id
       AND pm.tenant_id = pc.tenant_id
      WHERE pc.tenant_id = $1
        AND ($2::text IS NULL OR pc.project_id::text = $2)
        AND ($3::text IS NULL OR lower(btrim(coalesce(pc.external_project_ref, ''))) = lower(btrim($3)))
      ORDER BY pc.updated_at DESC
      LIMIT 1
    ),
    matched_hours AS (
      SELECT
        pt.project_id,
        pt.external_project_ref AS project_external_ref,
        pt.project_name,
        fh.source_key,
        fh.fitter_id,
        fh.fitter_username,
        COALESCE(f.name, fh.raw_payload_json ->> 'FitterName', fh.fitter_username, fh.fitter_id, 'Unknown fitter') AS fitter_name,
        COALESCE(fh.hours, fh.quantity, 0)::numeric AS hour_value,
        COALESCE(fc.is_only_for_internal_projects, false) AS is_internal_only,
        COALESCE(fc.is_on_invoice, false) AS is_invoice_relevant,
        lower(translate(trim(concat_ws(' ',
          fc.reference,
          fc.description,
          fh.raw_payload_json ->> 'CategoryName',
          fh.description,
          fh.note
        )), 'ÆØÅæøå', 'EOAeoa')) AS category_text_blob
      FROM project_target pt
      JOIN fitter_hour fh
        ON fh.tenant_id = $1
       AND (
         lower(btrim(coalesce(fh.external_project_ref, ''))) = lower(btrim(coalesce(pt.external_project_ref, '')))
         OR lower(btrim(coalesce(fh.external_project_ref, ''))) = lower(btrim(coalesce(pt.ek_project_id_text, '')))
         OR lower(btrim(coalesce(fh.project_id, ''))) = lower(btrim(coalesce(pt.external_project_ref, '')))
         OR lower(btrim(coalesce(fh.project_id, ''))) = lower(btrim(coalesce(pt.ek_project_id_text, '')))
       )
      LEFT JOIN fitter f
        ON f.tenant_id = $1
       AND f.fitter_id = fh.fitter_id
      LEFT JOIN fitter_category fc
        ON fc.tenant_id = $1
       AND (
         (fh.fitter_category_id IS NOT NULL AND fc.fitter_category_id = fh.fitter_category_id)
         OR
         (fh.fitter_category_reference IS NOT NULL AND fc.reference = fh.fitter_category_reference)
       )
    ),
    evaluated_hours AS (
      SELECT
        project_id,
        project_external_ref,
        project_name,
        source_key,
        fitter_id,
        fitter_username,
        fitter_name,
        hour_value,
        is_internal_only,
        is_invoice_relevant,
        (
          category_text_blob ~* '(ferie|syg|sygedag|sygdom|barsel|orlov|omsorg|hospital|barns|fri uden lon|fri u/lon|fritvalg|absence|leave)'
        ) AS is_absence_or_leave,
        (
          category_text_blob ~* '(kursus|moede|mode|vaerksted|verksted|fri|intern)'
        ) AS is_non_project_activity,
        (
          category_text_blob ~* '(tilleg|tillaeg|formandstilleg|formandstillaeg|stedtilleg|stedtillaeg)'
        ) AS is_allowance,
        (
          is_internal_only = false
          AND (category_text_blob ~* '(ferie|syg|sygedag|sygdom|barsel|orlov|omsorg|hospital|barns|fri uden lon|fri u/lon|fritvalg|absence|leave)') = false
          AND (category_text_blob ~* '(kursus|moede|mode|vaerksted|verksted|fri|intern)') = false
          AND (category_text_blob ~* '(tilleg|tillaeg|formandstilleg|formandstillaeg|stedtilleg|stedtillaeg)') = false
          AND is_invoice_relevant = true
        ) AS is_project_hour_candidate
      FROM matched_hours
    )
  `;
}

async function getProjectDrawerOutput(client, {
  tenantId,
  projectId = null,
  projectRef = null,
}) {
  const { normalizedProjectId, normalizedProjectRef } = normalizeProjectSelector({
    projectId,
    projectRef,
  });

  const sql = `
    ${buildProjectRelevantHoursCte()}
    SELECT
      COALESCE(MAX(project_id::text), $2::text) AS project_id,
      MAX(project_external_ref) AS project_ref,
      MAX(project_name) AS project_name,
      COALESCE(SUM(hour_value) FILTER (WHERE is_project_hour_candidate), 0)::numeric(14,2) AS total_project_relevant_hours,
      COUNT(DISTINCT COALESCE(fitter_id, fitter_username, fitter_name)) FILTER (WHERE is_project_hour_candidate) AS unique_fitters_count,
      COALESCE(
        ARRAY_AGG(DISTINCT fitter_name ORDER BY fitter_name) FILTER (WHERE is_project_hour_candidate),
        '{}'::text[]
      ) AS fitter_names
    FROM evaluated_hours
  `;

  const { rows } = await client.query(sql, [tenantId, normalizedProjectId, normalizedProjectRef]);

  return rows[0] || {
    project_id: normalizedProjectId,
    project_ref: normalizedProjectRef,
    project_name: null,
    total_project_relevant_hours: "0.00",
    unique_fitters_count: 0,
    fitter_names: [],
  };
}

async function getProjectDetailHoursOutput(client, {
  tenantId,
  projectId = null,
  projectRef = null,
}) {
  const { normalizedProjectId, normalizedProjectRef } = normalizeProjectSelector({
    projectId,
    projectRef,
  });

  const sql = `
    ${buildProjectRelevantHoursCte()}
    SELECT
      COALESCE(MAX(project_id::text), $2::text) AS project_id,
      MAX(project_external_ref) AS project_ref,
      MAX(project_name) AS project_name,
      COALESCE(SUM(hour_value) FILTER (WHERE is_project_hour_candidate), 0)::numeric(14,2) AS total_project_relevant_hours
    FROM evaluated_hours
  `;

  const breakdownSql = `
    ${buildProjectRelevantHoursCte()}
    SELECT
      COALESCE(fitter_id, fitter_username, lower(fitter_name)) AS fitter_key,
      fitter_id,
      fitter_username,
      fitter_name,
      COALESCE(SUM(hour_value), 0)::numeric(14,2) AS total_hours
    FROM evaluated_hours
    WHERE is_project_hour_candidate
    GROUP BY COALESCE(fitter_id, fitter_username, lower(fitter_name)), fitter_id, fitter_username, fitter_name
    ORDER BY total_hours DESC, fitter_name ASC
  `;

  const [summary, breakdown] = await Promise.all([
    client.query(sql, [tenantId, normalizedProjectId, normalizedProjectRef]),
    client.query(breakdownSql, [tenantId, normalizedProjectId, normalizedProjectRef]),
  ]);

  const summaryRow = summary.rows[0] || {
    project_id: normalizedProjectId,
    project_ref: normalizedProjectRef,
    project_name: null,
    total_project_relevant_hours: "0.00",
  };

  return {
    ...summaryRow,
    fitters: breakdown.rows,
  };
}

async function listFitterResourceGroupMembershipSnapshot(client, {
  tenantId,
}) {
  const sql = `
    WITH exploded AS (
      SELECT
        f.fitter_id,
        f.name AS fitter_name,
        f.ressource_group_string,
        item.value AS group_value
      FROM fitter f
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(f.resource_groups_json, '[]'::jsonb)) item(value)
        ON true
      WHERE f.tenant_id = $1
    )
    SELECT
      fitter_id,
      fitter_name,
      ressource_group_string,
      CASE
        WHEN group_value IS NULL THEN NULL
        WHEN jsonb_typeof(group_value) = 'string' THEN trim(both '"' from group_value::text)
        WHEN jsonb_typeof(group_value) = 'object' THEN COALESCE(
          group_value ->> 'name',
          group_value ->> 'Name',
          group_value ->> 'display',
          group_value ->> 'Display',
          group_value ->> 'code',
          group_value ->> 'Code'
        )
        ELSE group_value::text
      END AS resource_group_name,
      CASE
        WHEN group_value IS NULL THEN NULL
        WHEN jsonb_typeof(group_value) = 'object' THEN COALESCE(group_value ->> 'id', group_value ->> 'ID', group_value ->> 'code', group_value ->> 'Code')
        ELSE NULL
      END AS resource_group_key
    FROM exploded
    ORDER BY fitter_name ASC NULLS LAST, resource_group_name ASC NULLS LAST
  `;

  const { rows } = await client.query(sql, [tenantId]);
  return rows;
}

module.exports = {
  listFitterCategoryBusinessRows,
  getProjectDrawerOutput,
  getProjectDetailHoursOutput,
  listFitterResourceGroupMembershipSnapshot,
};
