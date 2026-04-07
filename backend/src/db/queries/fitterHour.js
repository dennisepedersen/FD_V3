async function listFitterHoursForUser(client, {
  tenantId,
  userId,
  scope = "mine",
  role = null,
  projectId = null,
  projectRef = null,
  dateFrom = null,
  dateTo = null,
  limit = 50,
  offset = 0,
}) {
  const normalizedScope = String(scope || "mine").trim().toLowerCase();
  const normalizedProjectId = projectId == null ? null : String(projectId).trim() || null;
  const normalizedProjectRef = projectRef == null ? null : String(projectRef).trim() || null;

  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.floor(parsedLimit), 1), 200)
    : 50;

  const parsedOffset = Number(offset);
  const safeOffset = Number.isFinite(parsedOffset)
    ? Math.max(Math.floor(parsedOffset), 0)
    : 0;

  const fromValue = dateFrom == null || String(dateFrom).trim() === ""
    ? null
    : new Date(String(dateFrom));
  const toValue = dateTo == null || String(dateTo).trim() === ""
    ? null
    : new Date(String(dateTo));

  const safeDateFrom = fromValue && !Number.isNaN(fromValue.getTime())
    ? fromValue.toISOString()
    : null;
  const safeDateTo = toValue && !Number.isNaN(toValue.getTime())
    ? toValue.toISOString()
    : null;

  const sql = `
    WITH current_actor AS (
      SELECT lower(nullif(btrim(username), '')) AS username_ci
      FROM tenant_user
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    ),
    scoped_projects AS (
      SELECT DISTINCT
        pc.project_id,
        pc.external_project_ref,
        pc.name AS project_name,
        pm.ek_project_id::text AS ek_project_id_text
      FROM project_core pc
      CROSS JOIN current_actor cu
      LEFT JOIN project_assignment pa
        ON pa.tenant_id = pc.tenant_id
       AND pa.project_id = pc.project_id
      LEFT JOIN project_masterdata_v4 pm
        ON pm.project_id = pc.project_id
       AND pm.tenant_id = pc.tenant_id
      WHERE pc.tenant_id = $1
        AND pc.status = 'open'
        AND COALESCE(pc.is_closed, false) = false
        AND (
          ($9::text = 'all' AND $10::text = 'tenant_admin')
          OR
          (cu.username_ci IS NOT NULL AND lower(btrim(coalesce(pc.responsible_code, ''))) = cu.username_ci)
          OR
          (cu.username_ci IS NOT NULL AND lower(btrim(coalesce(pc.team_leader_code, ''))) = cu.username_ci)
          OR
          pc.owner_user_id = $2
          OR pa.tenant_user_id = $2
        )
        AND ($3::text IS NULL OR pc.project_id::text = $3)
        AND ($4::text IS NULL OR lower(btrim(coalesce(pc.external_project_ref, ''))) = lower(btrim($4)))
    )
    SELECT
      fh.fitter_hour_id,
      fh.work_date,
      fh.registration_date,
      fh.hours,
      fh.quantity,
      fh.unit,
      fh.note,
      fh.description,
      sp.project_id,
      fh.external_project_ref,
      sp.project_name,
      fh.fitter_id,
      COALESCE(f.name, fh.raw_payload_json ->> 'FitterName') AS fitter_name,
      fh.fitter_username,
      fh.fitter_salary_id,
      fh.fitter_category_id,
      fh.fitter_category_reference,
      COALESCE(fc.description, fh.raw_payload_json ->> 'CategoryName') AS fitter_category_description,
      (COALESCE(fh.work_date, fh.registration_date) > now()) AS is_future_dated,
      fh.source_key
    FROM fitter_hour fh
    INNER JOIN scoped_projects sp
      ON (
        lower(btrim(coalesce(fh.external_project_ref, ''))) = lower(btrim(coalesce(sp.external_project_ref, '')))
        OR lower(btrim(coalesce(fh.external_project_ref, ''))) = lower(btrim(coalesce(sp.ek_project_id_text, '')))
        OR lower(btrim(coalesce(fh.project_id, ''))) = lower(btrim(coalesce(sp.external_project_ref, '')))
        OR lower(btrim(coalesce(fh.project_id, ''))) = lower(btrim(coalesce(sp.ek_project_id_text, '')))
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
    WHERE fh.tenant_id = $1
      AND ($5::text IS NULL OR COALESCE(fh.work_date, fh.registration_date) >= $5::timestamptz)
      AND ($6::text IS NULL OR COALESCE(fh.work_date, fh.registration_date) <= $6::timestamptz)
    ORDER BY
      fh.work_date DESC NULLS LAST,
      fh.registration_date DESC NULLS LAST,
      fh.updated_at DESC
    LIMIT $7
    OFFSET $8
  `;

  const { rows } = await client.query(sql, [
    tenantId,
    userId,
    normalizedProjectId,
    normalizedProjectRef,
    safeDateFrom,
    safeDateTo,
    safeLimit,
    safeOffset,
    normalizedScope,
    role == null ? null : String(role),
  ]);

  return {
    scope: normalizedScope,
    limit: safeLimit,
    offset: safeOffset,
    rows,
  };
}

module.exports = {
  listFitterHoursForUser,
};
