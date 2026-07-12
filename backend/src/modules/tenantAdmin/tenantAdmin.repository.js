async function listUsers(client, { tenantId, search }) {
  const normalizedSearch = search ? `%${String(search).trim().toLowerCase()}%` : null;
  const { rows } = await client.query(
    `
      WITH fitter_groups AS (
        SELECT
          rgm.tenant_id,
          rgm.fitter_id,
          jsonb_agg(
            jsonb_build_object(
              'id', rg.id,
              'name', rg.name,
              'external_id', rg.external_id,
              'short_code', rg.short_code
            )
            ORDER BY rg.name ASC
          ) AS groups
        FROM resource_group_members rgm
        JOIN resource_groups rg
          ON rg.tenant_id = rgm.tenant_id
         AND rg.id = rgm.group_id
        WHERE rgm.tenant_id = $1
        GROUP BY rgm.tenant_id, rgm.fitter_id
      ),
      latest_invitations AS (
        SELECT DISTINCT ON (tenant_id, tenant_user_id)
          tenant_id,
          tenant_user_id,
          status,
          expires_at,
          sent_at,
          send_error,
          created_at
        FROM tenant_user_invitation_token
        WHERE tenant_id = $1
          AND purpose = 'account_setup'
        ORDER BY tenant_id, tenant_user_id, created_at DESC
      ),
      people AS (
        SELECT
          COALESCE(f.tenant_user_id::text, f.id::text) AS id,
          f.tenant_user_id,
          f.id AS fitter_row_id,
          f.fitter_id,
          COALESCE(NULLIF(btrim(f.name), ''), tu.name) AS name,
          COALESCE(NULLIF(btrim(f.email), ''), tu.email) AS email,
          COALESCE(NULLIF(btrim(f.username), ''), UPPER(NULLIF(btrim(split_part(f.email, '@', 1)), ''))) AS short_code,
          COALESCE(f.source, 'ekomplet') AS source,
          f.external_source,
          f.external_id,
          CASE
            WHEN tu.status IS NOT NULL THEN tu.status
            WHEN f.is_active_derived IS TRUE THEN 'active'
            WHEN f.end_date IS NOT NULL AND f.end_date::date < CURRENT_DATE THEN 'inactive'
            WHEN f.is_active_derived IS FALSE THEN 'inactive'
            ELSE 'active'
          END AS status,
          CASE
            WHEN tu.id IS NULL THEN 'imported_no_login'
            ELSE COALESCE(tu.login_status, CASE WHEN tu.status = 'active' THEN 'active' ELSE 'imported_no_login' END)
          END AS login_status,
          tu.last_invited_at,
          tu.invite_accepted_at,
          tu.session_version,
          tu.deactivated_reason,
          tu.deactivated_by_user_id,
          du.name AS deactivated_by_name,
          tu.deactivated_at,
          tu.reactivation_requested_at,
          li.status AS invitation_status,
          li.expires_at AS invitation_expires_at,
          li.sent_at AS invitation_sent_at,
          li.send_error AS invitation_send_error,
          tu.role,
          f.is_active_derived,
          f.is_plannable,
          f.end_date,
          COALESCE(fg.groups, '[]'::jsonb) AS resource_groups,
          f.created_at,
          f.updated_at,
          (
            COALESCE(f.name, '') || ' ' ||
            COALESCE(f.email, '') || ' ' ||
            COALESCE(f.username, '') || ' ' ||
            COALESCE(f.fitter_id, '') || ' ' ||
            COALESCE(f.external_id, '') || ' ' ||
            COALESCE(fg.groups::text, '')
          ) AS search_text
        FROM fitter f
        LEFT JOIN tenant_user tu
          ON tu.tenant_id = f.tenant_id
         AND tu.id = f.tenant_user_id
        LEFT JOIN fitter_groups fg
          ON fg.tenant_id = f.tenant_id
         AND fg.fitter_id = f.fitter_id
        LEFT JOIN tenant_user du
          ON du.tenant_id = f.tenant_id
         AND du.id = tu.deactivated_by_user_id
        LEFT JOIN latest_invitations li
          ON li.tenant_id = f.tenant_id
         AND li.tenant_user_id = tu.id
        WHERE f.tenant_id = $1

        UNION ALL

        SELECT
          tu.id::text AS id,
          tu.id AS tenant_user_id,
          NULL::uuid AS fitter_row_id,
          NULL::text AS fitter_id,
          tu.name,
          tu.email,
          COALESCE(NULLIF(btrim(tu.username), ''), UPPER(NULLIF(btrim(split_part(tu.email, '@', 1)), ''))) AS short_code,
          'manual' AS source,
          NULL::text AS external_source,
          NULL::text AS external_id,
          tu.status,
          COALESCE(tu.login_status, CASE WHEN tu.status = 'active' THEN 'active' ELSE 'imported_no_login' END) AS login_status,
          tu.last_invited_at,
          tu.invite_accepted_at,
          tu.session_version,
          tu.deactivated_reason,
          tu.deactivated_by_user_id,
          du.name AS deactivated_by_name,
          tu.deactivated_at,
          tu.reactivation_requested_at,
          li.status AS invitation_status,
          li.expires_at AS invitation_expires_at,
          li.sent_at AS invitation_sent_at,
          li.send_error AS invitation_send_error,
          tu.role,
          NULL::boolean AS is_active_derived,
          NULL::boolean AS is_plannable,
          NULL::timestamptz AS end_date,
          '[]'::jsonb AS resource_groups,
          tu.created_at,
          tu.updated_at,
          (
            COALESCE(tu.name, '') || ' ' ||
            COALESCE(tu.email, '') || ' ' ||
            COALESCE(tu.username, '') || ' ' ||
            COALESCE(tu.role, '')
          ) AS search_text
        FROM tenant_user tu
        LEFT JOIN tenant_user du
          ON du.tenant_id = tu.tenant_id
         AND du.id = tu.deactivated_by_user_id
        LEFT JOIN latest_invitations li
          ON li.tenant_id = tu.tenant_id
         AND li.tenant_user_id = tu.id
        WHERE tu.tenant_id = $1
          AND NOT EXISTS (
            SELECT 1
            FROM fitter f
            WHERE f.tenant_id = tu.tenant_id
              AND f.tenant_user_id = tu.id
          )
      )
      SELECT *
      FROM people
      WHERE $2::text IS NULL OR lower(search_text) LIKE $2
      ORDER BY
        CASE WHEN status = 'active' THEN 0 ELSE 1 END,
        name ASC NULLS LAST,
        email ASC NULLS LAST
    `,
    [tenantId, normalizedSearch]
  );

  return rows;
}

async function createManualTenantUser(client, {
  tenantId,
  email,
  name,
  role,
  status,
  username,
  passwordHash,
  loginStatus,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO tenant_user (tenant_id, email, name, role, status, login_status, username, password_hash)
      VALUES ($1, lower($2), $3, $4, $5, $6, $7, $8)
      RETURNING id, tenant_id, email, name, role, status, login_status, username, created_at, updated_at
    `,
    [tenantId, email, name, role, status, loginStatus, username, passwordHash]
  );

  return rows[0];
}

async function createManualFitterForTenantUser(client, {
  tenantId,
  tenantUserId,
  fitterId,
  name,
  email,
  username,
  note,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO fitter (
        tenant_id,
        fitter_id,
        name,
        username,
        email,
        source,
        external_source,
        external_id,
        tenant_user_id,
        manual_note,
        is_active_derived,
        raw_payload_json,
        synced_at
      )
      VALUES ($1, $2, $3, $4, lower($5), 'manual', 'manual', $2, $6, $7, true, '{}'::jsonb, now())
      RETURNING *
    `,
    [tenantId, fitterId, name, username, email, tenantUserId, note || null]
  );

  return rows[0];
}

async function updateManualTenantUser(client, { tenantId, userId, name, role, status, username, hasUsername }) {
  const { rows } = await client.query(
    `
      UPDATE tenant_user
      SET
        name = COALESCE($3, name),
        role = COALESCE($4, role),
        status = COALESCE($5, status),
        login_status = CASE
          WHEN $5::text IN ('suspended','deleted') THEN 'disabled'
          WHEN $5::text = 'active' THEN 'active'
          ELSE login_status
        END,
        disabled_at = CASE WHEN $5::text IN ('suspended','deleted') THEN now() ELSE disabled_at END,
        username = CASE WHEN $6::boolean THEN $7 ELSE username END,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING id, tenant_id, email, name, role, status, login_status, username, created_at, updated_at
    `,
    [tenantId, userId, name, role, status, hasUsername === true, username]
  );

  return rows[0] || null;
}

async function updateManualFitterForTenantUser(client, { tenantId, userId, name, username, status, note, hasUsername, hasNote }) {
  const { rows } = await client.query(
    `
      UPDATE fitter
      SET
        name = COALESCE($3, name),
        username = CASE WHEN $4::boolean THEN $5 ELSE username END,
        is_active_derived = CASE
          WHEN $6::text IS NULL THEN is_active_derived
          WHEN $6::text = 'active' THEN true
          ELSE false
        END,
        manual_note = CASE WHEN $7::boolean THEN $8 ELSE manual_note END,
        updated_at = now()
      WHERE tenant_id = $1
        AND tenant_user_id = $2
        AND source = 'manual'
      RETURNING *
    `,
    [
      tenantId,
      userId,
      name,
      hasUsername === true,
      username,
      status || null,
      hasNote === true,
      note,
    ]
  );

  return rows[0] || null;
}

async function findTenantUser(client, { tenantId, userId }) {
  const { rows } = await client.query(
    `
      SELECT id, tenant_id, email, name, role, status, login_status, username
      FROM tenant_user
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1
    `,
    [tenantId, userId]
  );
  return rows[0] || null;
}

async function listResourceGroups(client, { tenantId, includeArchived, search }) {
  const normalizedSearch = search ? `%${String(search).trim().toLowerCase()}%` : null;
  const { rows } = await client.query(
    `
      SELECT
        rg.id,
        rg.tenant_id,
        rg.name,
        rg.description,
        rg.status,
        rg.source,
        rg.external_source,
        rg.external_id,
        rg.short_code,
        rg.area,
        rg.discipline,
        rg.category,
        rg.external_metadata,
        COUNT(rgm.id)::int AS member_count,
        rg.created_at,
        rg.updated_at
      FROM resource_groups rg
      LEFT JOIN resource_group_members rgm
        ON rgm.tenant_id = rg.tenant_id
       AND rgm.group_id = rg.id
      WHERE rg.tenant_id = $1
        AND ($2::boolean = true OR rg.status = 'active')
        AND (
          $3::text IS NULL
          OR lower(
            COALESCE(rg.name, '') || ' ' ||
            COALESCE(rg.external_id, '') || ' ' ||
            COALESCE(rg.short_code, '') || ' ' ||
            COALESCE(rg.area, '') || ' ' ||
            COALESCE(rg.discipline, '') || ' ' ||
            COALESCE(rg.category, '')
          ) LIKE $3
        )
      GROUP BY rg.id
      ORDER BY
        CASE WHEN rg.status = 'active' THEN 0 ELSE 1 END,
        rg.name ASC
    `,
    [tenantId, includeArchived === true, normalizedSearch]
  );

  return rows;
}

async function hasEkompletIntegration(client, { tenantId }) {
  const { rows } = await client.query(
    `
      SELECT 1
      FROM tenant_config
      WHERE tenant_id = $1
        AND status = 'active'
        AND ek_base_url IS NOT NULL
        AND ek_api_key_encrypted IS NOT NULL
      LIMIT 1
    `,
    [tenantId]
  );
  return rows.length > 0;
}

async function listSyncStatus(client, { tenantId, endpoints }) {
  const { rows } = await client.query(
    `
      SELECT
        ses.endpoint_key,
        ses.status,
        ses.current_mode,
        ses.sync_strategy,
        ses.current_job_id,
        ses.last_job_id,
        ses.last_attempt_at,
        ses.last_successful_sync_at,
        ses.rows_fetched,
        ses.rows_persisted,
        ses.pages_processed_last_job,
        ses.rows_fetched_last_job,
        ses.retry_count,
        ses.pending_backlog_count,
        ses.failed_page_count,
        ses.next_planned_at,
        ses.last_error,
        ses.updated_at,
        sj.rows_processed AS last_rows_processed,
        sj.pages_processed AS last_pages_processed,
        sj.status AS last_job_status,
        sj.created_at AS last_job_created_at,
        sj.started_at AS last_job_started_at,
        sj.finished_at AS last_job_finished_at
      FROM sync_endpoint_state ses
      LEFT JOIN sync_job sj ON sj.id = ses.last_job_id
      WHERE ses.tenant_id = $1
        AND ses.endpoint_key = ANY($2::text[])
      ORDER BY ses.endpoint_key ASC
    `,
    [tenantId, endpoints]
  );

  return rows;
}

async function findActiveEndpointJob(client, { tenantId, endpointKey }) {
  const { rows } = await client.query(
    `
      SELECT id, status, created_at
      FROM sync_job
      WHERE tenant_id = $1
        AND endpoint_key = $2
        AND status IN ('queued', 'running')
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [tenantId, endpointKey]
  );

  return rows[0] || null;
}

async function ensureEndpointSelected(client, { tenantId, endpointKey }) {
  const existing = await client.query(
    `
      SELECT id
      FROM tenant_endpoint_selection
      WHERE tenant_id = $1
        AND lower(endpoint_key) = lower($2)
      LIMIT 1
    `,
    [tenantId, endpointKey]
  );

  if (existing.rows[0]) {
    await client.query(
      `
        UPDATE tenant_endpoint_selection
        SET enabled = true, updated_at = now()
        WHERE id = $1
      `,
      [existing.rows[0].id]
    );
    return;
  }

  await client.query(
    `
      INSERT INTO tenant_endpoint_selection (tenant_id, endpoint_key, enabled)
      VALUES ($1, $2, true)
    `,
    [tenantId, endpointKey]
  );
}

async function createManualSyncJob(client, { tenantId, endpointKey, userId, metadata }) {
  const { rows } = await client.query(
    `
      INSERT INTO sync_job (
        tenant_id,
        type,
        status,
        rows_processed,
        pages_processed,
        endpoint_key,
        requested_by_user_id,
        metadata
      )
      VALUES ($1, 'manual_full_resync', 'queued', 0, 0, $2, $3, $4::jsonb)
      RETURNING id, tenant_id, type, status, rows_processed, pages_processed, endpoint_key, created_at, started_at, finished_at
    `,
    [tenantId, endpointKey, userId, JSON.stringify(metadata || {})]
  );

  return rows[0];
}

async function findTenantUserForUpdate(client, { tenantId, userId }) {
  const { rows } = await client.query(
    `
      SELECT id, tenant_id, email, name, role, status, login_status, username, session_version,
             deactivated_reason, deactivated_by_user_id, deactivated_at, reactivation_requested_at
      FROM tenant_user
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE
    `,
    [tenantId, userId]
  );
  return rows[0] || null;
}

async function findTenantUserByEmail(client, { tenantId, email }) {
  const { rows } = await client.query(
    `
      SELECT id, tenant_id, email, name, role, status, login_status
      FROM tenant_user
      WHERE tenant_id = $1 AND lower(email) = lower($2)
      LIMIT 1
    `,
    [tenantId, email]
  );
  return rows[0] || null;
}

async function countActiveTenantAdmins(client, { tenantId }) {
  const { rows } = await client.query(
    `
      SELECT COUNT(*)::int AS count
      FROM tenant_user
      WHERE tenant_id = $1
        AND role = 'tenant_admin'
        AND status = 'active'
        AND login_status = 'active'
    `,
    [tenantId]
  );
  return rows[0]?.count || 0;
}

async function revokeOpenTenantUserInvitations(client, { tenantId, userId }) {
  const { rows } = await client.query(
    `
      UPDATE tenant_user_invitation_token
      SET status = 'revoked',
          revoked_at = now()
      WHERE tenant_id = $1
        AND tenant_user_id = $2
        AND purpose = 'account_setup'
        AND status IN ('pending','sent','send_failed')
        AND used_at IS NULL
        AND revoked_at IS NULL
      RETURNING id
    `,
    [tenantId, userId]
  );
  return rows.length;
}

async function deactivateTenantUser(client, { tenantId, userId, actorId, reason, passwordHash }) {
  const { rows } = await client.query(
    `
      UPDATE tenant_user
      SET status = 'deactivated',
          login_status = 'disabled',
          password_hash = $5,
          session_version = session_version + 1,
          deactivated_reason = $4,
          deactivated_by_user_id = $3,
          deactivated_at = now(),
          reactivation_requested_at = NULL,
          reactivation_requested_by_user_id = NULL,
          disabled_at = now(),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
        AND status = 'active'
      RETURNING id, tenant_id, email, name, role, status, login_status, session_version,
                deactivated_reason, deactivated_by_user_id, deactivated_at, reactivation_requested_at,
                last_invited_at, invite_accepted_at, created_at, updated_at
    `,
    [tenantId, userId, actorId, reason, passwordHash]
  );
  return rows[0] || null;
}

async function requestTenantUserReactivation(client, { tenantId, userId, actorId, passwordHash }) {
  const { rows } = await client.query(
    `
      UPDATE tenant_user
      SET status = 'pending_reactivation',
          login_status = 'pending_reactivation',
          password_hash = $4,
          reactivation_requested_at = now(),
          reactivation_requested_by_user_id = $3,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
        AND status IN ('deactivated','pending_reactivation')
      RETURNING id, tenant_id, email, name, role, status, login_status, session_version,
                deactivated_reason, deactivated_by_user_id, deactivated_at, reactivation_requested_at,
                last_invited_at, invite_accepted_at, created_at, updated_at
    `,
    [tenantId, userId, actorId, passwordHash]
  );
  return rows[0] || null;
}

async function insertTenantUserLifecycleEvent(client, { tenantId, userId, eventType, reason, actorId, metadata }) {
  const { rows } = await client.query(
    `
      INSERT INTO tenant_user_lifecycle_event (
        tenant_id,
        tenant_user_id,
        event_type,
        reason,
        actor_user_id,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING id, tenant_id, tenant_user_id, event_type, reason, actor_user_id, occurred_at, metadata
    `,
    [tenantId, userId, eventType, reason || null, actorId || null, JSON.stringify(metadata || {})]
  );
  return rows[0];
}
module.exports = {
  createManualFitterForTenantUser,
  createManualSyncJob,
  createManualTenantUser,
  ensureEndpointSelected,
  findActiveEndpointJob,
  countActiveTenantAdmins,
  deactivateTenantUser,
  findTenantUser,
  findTenantUserByEmail,
  findTenantUserForUpdate,
  hasEkompletIntegration,
  listResourceGroups,
  listSyncStatus,
  listUsers,
  updateManualFitterForTenantUser,
  insertTenantUserLifecycleEvent,
  requestTenantUserReactivation,
  revokeOpenTenantUserInvitations,
  updateManualTenantUser,
};
