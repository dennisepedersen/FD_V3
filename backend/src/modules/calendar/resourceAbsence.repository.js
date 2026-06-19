async function listAbsencesForTenantRange(client, { tenantId, from, to }) {
  const { rows } = await client.query(
    `
      SELECT
        ra.id,
        ra.tenant_id,
        ra.fitter_id,
        f.name AS fitter_name,
        f.username AS fitter_username,
        f.email AS fitter_email,
        ra.absence_type,
        ra.status,
        ra.start_date,
        ra.end_date,
        ra.note,
        ra.visibility_scope,
        ra.created_by_user_id,
        created_by.name AS created_by_name,
        ra.updated_by_user_id,
        updated_by.name AS updated_by_name,
        ra.created_at,
        ra.updated_at,
        ra.cancelled_at,
        ra.cancelled_by_user_id,
        cancelled_by.name AS cancelled_by_name
      FROM resource_absences ra
      JOIN fitter f
        ON f.tenant_id = ra.tenant_id
       AND f.fitter_id = ra.fitter_id
      LEFT JOIN tenant_user created_by
        ON created_by.tenant_id = ra.tenant_id
       AND created_by.id = ra.created_by_user_id
      LEFT JOIN tenant_user updated_by
        ON updated_by.tenant_id = ra.tenant_id
       AND updated_by.id = ra.updated_by_user_id
      LEFT JOIN tenant_user cancelled_by
        ON cancelled_by.tenant_id = ra.tenant_id
       AND cancelled_by.id = ra.cancelled_by_user_id
      WHERE ra.tenant_id = $1
        AND ra.start_date <= $3::date
        AND ra.end_date >= $2::date
      ORDER BY ra.start_date ASC, ra.end_date ASC, f.name ASC NULLS LAST, ra.created_at ASC
    `,
    [tenantId, from, to]
  );

  return rows;
}

async function listResourcesForTenant(client, { tenantId }) {
  const { rows } = await client.query(
    `
      SELECT
        fitter_id,
        name,
        username,
        UPPER(
          LEFT(
            REGEXP_REPLACE(
              COALESCE(NULLIF(btrim(name), ''), NULLIF(btrim(username), ''), fitter_id),
              '[^[:alnum:]]',
              '',
              'g'
            ),
            4
          )
        ) AS initials,
        COALESCE(NULLIF(btrim(name), ''), NULLIF(btrim(username), ''), fitter_id) AS label
      FROM fitter
      WHERE tenant_id = $1
      ORDER BY
        COALESCE(NULLIF(btrim(name), ''), NULLIF(btrim(username), ''), fitter_id) ASC,
        fitter_id ASC
    `,
    [tenantId]
  );

  return rows;
}

async function createAbsenceForTenant(client, {
  tenantId,
  fitterId,
  absenceType,
  status = "approved",
  startDate,
  endDate,
  note = null,
  visibilityScope = "tenant_admin_only",
  createdByUserId = null,
  updatedByUserId = null,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO resource_absences (
        tenant_id,
        fitter_id,
        absence_type,
        status,
        start_date,
        end_date,
        note,
        visibility_scope,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10)
      RETURNING
        id,
        tenant_id,
        fitter_id,
        absence_type,
        status,
        start_date,
        end_date,
        note,
        visibility_scope,
        created_by_user_id,
        updated_by_user_id,
        created_at,
        updated_at,
        cancelled_at,
        cancelled_by_user_id
    `,
    [
      tenantId,
      fitterId,
      absenceType,
      status,
      startDate,
      endDate,
      note,
      visibilityScope,
      createdByUserId,
      updatedByUserId,
    ]
  );

  return rows[0];
}

module.exports = {
  createAbsenceForTenant,
  listAbsencesForTenantRange,
  listResourcesForTenant,
};
