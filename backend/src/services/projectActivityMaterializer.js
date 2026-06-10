function uniqueProjectIds(projectIds) {
  if (!Array.isArray(projectIds)) {
    return null;
  }

  const seen = new Set();
  for (const projectId of projectIds) {
    if (!projectId) continue;
    const value = String(projectId).trim();
    if (value) {
      seen.add(value);
    }
  }
  return [...seen];
}

async function materializeProjectActivityFromFitterHours(client, { tenantId, projectIds = null }) {
  if (!tenantId) {
    throw new Error("tenantId is required");
  }

  const scopedProjectIds = uniqueProjectIds(projectIds);
  if (Array.isArray(scopedProjectIds) && scopedProjectIds.length === 0) {
    return {
      scopedProjectCount: 0,
      materializedCount: 0,
    };
  }

  const params = [tenantId];
  const projectFilter = Array.isArray(scopedProjectIds)
    ? "AND fh.fd_project_id = ANY($2::uuid[])"
    : "";

  if (Array.isArray(scopedProjectIds)) {
    params.push(scopedProjectIds);
  }

  const result = await client.query(
    `
      WITH source_activity AS (
        SELECT
          fh.tenant_id,
          fh.fd_project_id AS project_id,
          MAX(fh.work_date) AS last_fitter_hour_date,
          MAX(fh.registration_date) AS last_registration
        FROM fitter_hour fh
        INNER JOIN project_core pc
          ON pc.tenant_id = fh.tenant_id
         AND pc.project_id = fh.fd_project_id
        WHERE fh.tenant_id = $1
          AND fh.fd_project_id IS NOT NULL
          ${projectFilter}
        GROUP BY fh.tenant_id, fh.fd_project_id
      ),
      upserted_activity AS (
        INSERT INTO project_wip (
          project_id,
          tenant_id,
          last_registration,
          last_fitter_hour_date,
          calculated_days_since_last_registration
        )
        SELECT
          project_id,
          tenant_id,
          last_registration,
          last_fitter_hour_date,
          CASE
            WHEN last_registration IS NULL THEN NULL
            ELSE GREATEST(0, CURRENT_DATE - last_registration::date)::integer
          END AS calculated_days_since_last_registration
        FROM source_activity
        ON CONFLICT (project_id)
        DO UPDATE SET
          last_registration = EXCLUDED.last_registration,
          last_fitter_hour_date = EXCLUDED.last_fitter_hour_date,
          calculated_days_since_last_registration = EXCLUDED.calculated_days_since_last_registration,
          updated_at = now()
        WHERE project_wip.tenant_id = EXCLUDED.tenant_id
          AND (
            project_wip.last_registration IS DISTINCT FROM EXCLUDED.last_registration
            OR project_wip.last_fitter_hour_date IS DISTINCT FROM EXCLUDED.last_fitter_hour_date
            OR project_wip.calculated_days_since_last_registration IS DISTINCT FROM EXCLUDED.calculated_days_since_last_registration
          )
        RETURNING 1
      )
      SELECT
        (SELECT COUNT(*)::int FROM source_activity) AS scoped_project_count,
        (SELECT COUNT(*)::int FROM upserted_activity) AS materialized_count
    `,
    params
  );

  return {
    scopedProjectCount: Number(result.rows[0]?.scoped_project_count || 0),
    materializedCount: Number(result.rows[0]?.materialized_count || 0),
  };
}

module.exports = {
  materializeProjectActivityFromFitterHours,
};
