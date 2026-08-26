const auditService = require("./auditService");

const LINKED_STATUSES = new Set(["auto_linked", "manually_linked"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeEmailForIdentity(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function normalizeUuid(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function hasApprovedLink(fitter) {
  return Boolean(fitter?.tenant_user_id) && LINKED_STATUSES.has(fitter.identity_link_status || "manually_linked");
}

async function loadFitterForIdentity(client, { tenantId, fitterId }) {
  const { rows } = await client.query(
    `
      SELECT
        f.id,
        f.tenant_id,
        f.fitter_id,
        f.name,
        f.email,
        f.ek_user_id,
        f.tenant_user_id,
        f.identity_link_status,
        f.identity_link_method,
        f.identity_link_conflict_reason,
        f.is_active_derived,
        tu.id AS linked_tenant_user_id,
        tu.email AS linked_tenant_user_email,
        tu.ek_user_id AS linked_tenant_user_ek_user_id,
        tu.status AS linked_tenant_user_status,
        tu.login_status AS linked_tenant_user_login_status
      FROM fitter f
      LEFT JOIN tenant_user tu
        ON tu.tenant_id = f.tenant_id
       AND tu.id = f.tenant_user_id
      WHERE f.tenant_id = $1
        AND f.fitter_id = $2
      LIMIT 1
      FOR UPDATE OF f
    `,
    [tenantId, fitterId]
  );
  return rows[0] || null;
}

async function findActiveTenantUsersByEmail(client, { tenantId, email }) {
  const { rows } = await client.query(
    `
      SELECT id, tenant_id, email, ek_user_id, status, login_status
      FROM tenant_user
      WHERE tenant_id = $1
        AND lower(btrim(email)) = $2
        AND status = 'active'
        AND login_status = 'active'
      ORDER BY id
      LIMIT 2
    `,
    [tenantId, email]
  );
  return rows;
}

async function findActiveFittersByIdentity(client, { tenantId, email, ekUserId }) {
  const { rows } = await client.query(
    `
      SELECT fitter_id, tenant_user_id, ek_user_id, identity_link_status
      FROM fitter
      WHERE tenant_id = $1
        AND is_active_derived IS DISTINCT FROM false
        AND (
          lower(btrim(email)) = $2
          OR ek_user_id = $3::uuid
        )
      ORDER BY fitter_id
      LIMIT 2
    `,
    [tenantId, email, ekUserId]
  );
  return rows;
}

async function findOtherLinkedFitter(client, { tenantId, tenantUserId, fitterId }) {
  const { rows } = await client.query(
    `
      SELECT fitter_id
      FROM fitter
      WHERE tenant_id = $1
        AND tenant_user_id = $2
        AND fitter_id <> $3
        AND identity_link_status IN ('auto_linked', 'manually_linked')
        AND is_active_derived IS DISTINCT FROM false
      LIMIT 1
    `,
    [tenantId, tenantUserId, fitterId]
  );
  return rows[0] || null;
}

async function findTenantUserEkCollision(client, { tenantId, tenantUserId, ekUserId }) {
  const { rows } = await client.query(
    `
      SELECT id
      FROM tenant_user
      WHERE tenant_id = $1
        AND ek_user_id = $2::uuid
        AND id <> $3
      LIMIT 1
    `,
    [tenantId, ekUserId, tenantUserId]
  );
  return rows[0] || null;
}

async function markUnresolved(client, { tenantId, fitterId, reason }) {
  await client.query(
    `
      UPDATE fitter
      SET identity_link_status = 'unresolved',
          identity_link_method = NULL,
          identity_link_conflict_reason = $3,
          identity_link_checked_at = now(),
          updated_at = now()
      WHERE tenant_id = $1
        AND fitter_id = $2
        AND tenant_user_id IS NULL
    `,
    [tenantId, fitterId, reason]
  );
}

async function markConflict(client, { tenantId, fitterId, reason }) {
  await client.query(
    `
      UPDATE fitter
      SET identity_link_status = 'conflict',
          identity_link_method = 'conflict',
          identity_link_conflict_reason = $3,
          identity_link_checked_at = now(),
          updated_at = now()
      WHERE tenant_id = $1
        AND fitter_id = $2
    `,
    [tenantId, fitterId, reason]
  );
}

async function touchPreserved(client, { tenantId, fitterId }) {
  await client.query(
    `
      UPDATE fitter
      SET identity_link_checked_at = now(),
          updated_at = now()
      WHERE tenant_id = $1
        AND fitter_id = $2
    `,
    [tenantId, fitterId]
  );
}

async function attachEkUserToTenantUser(client, { tenantId, tenantUserId, ekUserId, source }) {
  const { rows } = await client.query(
    `
      UPDATE tenant_user
      SET ek_user_id = $3::uuid,
          ek_user_linked_at = COALESCE(ek_user_linked_at, now()),
          ek_user_link_source = COALESCE(ek_user_link_source, $4),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
        AND (ek_user_id IS NULL OR ek_user_id = $3::uuid)
      RETURNING id, ek_user_id
    `,
    [tenantId, tenantUserId, ekUserId, source]
  );
  return rows[0] || null;
}

async function autoLinkFitter(client, { tenantId, fitterId, tenantUserId }) {
  await client.query(
    `
      UPDATE fitter
      SET tenant_user_id = $3,
          identity_link_status = 'auto_linked',
          identity_link_method = 'auto_email',
          identity_linked_at = COALESCE(identity_linked_at, now()),
          identity_link_conflict_reason = NULL,
          identity_link_checked_at = now(),
          updated_at = now()
      WHERE tenant_id = $1
        AND fitter_id = $2
        AND tenant_user_id IS NULL
    `,
    [tenantId, fitterId, tenantUserId]
  );
}

async function logAutoLinkAudit(client, { tenantId, tenantUserId, fitterId, ekUserId, actorId }) {
  await auditService.logAuditEvent({
    client,
    tenantId,
    actorId: actorId || "system:ek_fitters_sync",
    actorType: "system",
    actorScope: "system",
    eventType: "tenant_user_identity_linked",
    resourceType: "fitter_identity_link",
    resourceId: `${tenantId}:${fitterId}`,
    outcome: "success",
    reason: "ek_fitter_auto_email",
    metadata: {
      tenant_user_id: tenantUserId,
      fitter_id: fitterId,
      ek_user_id: ekUserId,
      method: "auto_email",
    },
  });
}

async function resolveFitterIdentityForRow(client, { tenantId, row, auditActorId }) {
  if (!tenantId || !row?.fitterId) {
    return "skipped";
  }

  const fitter = await loadFitterForIdentity(client, { tenantId, fitterId: row.fitterId });
  if (!fitter) {
    return "skipped";
  }

  const ekUserId = normalizeUuid(row.ekUserId || fitter.ek_user_id);
  const rawEkUserId = row.ekUserId || fitter.ek_user_id;
  const email = normalizeEmailForIdentity(fitter.email || row.email);

  if (rawEkUserId && !ekUserId) {
    await markConflict(client, { tenantId, fitterId: row.fitterId, reason: "invalid_ek_user_id" });
    return "conflict";
  }

  if (hasApprovedLink(fitter)) {
    const linkedEkUserId = normalizeUuid(fitter.linked_tenant_user_ek_user_id);
    if (ekUserId && linkedEkUserId && linkedEkUserId !== ekUserId) {
      await markConflict(client, { tenantId, fitterId: row.fitterId, reason: "linked_tenant_user_ek_user_mismatch" });
      return "conflict";
    }

    if (ekUserId && !linkedEkUserId) {
      const collision = await findTenantUserEkCollision(client, {
        tenantId,
        tenantUserId: fitter.tenant_user_id,
        ekUserId,
      });
      if (collision) {
        await markConflict(client, { tenantId, fitterId: row.fitterId, reason: "ek_user_id_collision" });
        return "conflict";
      }

      const attached = await attachEkUserToTenantUser(client, {
        tenantId,
        tenantUserId: fitter.tenant_user_id,
        ekUserId,
        source: "preexisting",
      });
      if (!attached) {
        await markConflict(client, { tenantId, fitterId: row.fitterId, reason: "tenant_user_ek_user_attach_failed" });
        return "conflict";
      }
    }

    await touchPreserved(client, { tenantId, fitterId: row.fitterId });
    return "preserved";
  }

  if (fitter.is_active_derived === false) {
    await markUnresolved(client, { tenantId, fitterId: row.fitterId, reason: "inactive_fitter" });
    return "unresolved";
  }

  if (!ekUserId) {
    await markUnresolved(client, { tenantId, fitterId: row.fitterId, reason: "missing_ek_user_id" });
    return "unresolved";
  }

  if (!email) {
    await markUnresolved(client, { tenantId, fitterId: row.fitterId, reason: "missing_email" });
    return "unresolved";
  }

  const tenantUsers = await findActiveTenantUsersByEmail(client, { tenantId, email });
  if (tenantUsers.length === 0) {
    await markUnresolved(client, { tenantId, fitterId: row.fitterId, reason: "no_active_tenant_user_email_match" });
    return "unresolved";
  }
  if (tenantUsers.length > 1) {
    await markConflict(client, { tenantId, fitterId: row.fitterId, reason: "ambiguous_tenant_user_email_match" });
    return "conflict";
  }

  const identityFitters = await findActiveFittersByIdentity(client, { tenantId, email, ekUserId });
  if (identityFitters.length !== 1 || String(identityFitters[0].fitter_id) !== String(row.fitterId)) {
    await markConflict(client, { tenantId, fitterId: row.fitterId, reason: "ambiguous_fitter_identity_match" });
    return "conflict";
  }

  const tenantUser = tenantUsers[0];
  const tenantUserEkUserId = normalizeUuid(tenantUser.ek_user_id);
  if (tenantUserEkUserId && tenantUserEkUserId !== ekUserId) {
    await markConflict(client, { tenantId, fitterId: row.fitterId, reason: "tenant_user_ek_user_mismatch" });
    return "conflict";
  }

  const otherLinkedFitter = await findOtherLinkedFitter(client, {
    tenantId,
    tenantUserId: tenantUser.id,
    fitterId: row.fitterId,
  });
  if (otherLinkedFitter) {
    await markConflict(client, { tenantId, fitterId: row.fitterId, reason: "tenant_user_already_linked" });
    return "conflict";
  }

  const ekCollision = await findTenantUserEkCollision(client, {
    tenantId,
    tenantUserId: tenantUser.id,
    ekUserId,
  });
  if (ekCollision) {
    await markConflict(client, { tenantId, fitterId: row.fitterId, reason: "ek_user_id_collision" });
    return "conflict";
  }

  const attached = await attachEkUserToTenantUser(client, {
    tenantId,
    tenantUserId: tenantUser.id,
    ekUserId,
    source: "ek_fitter_auto_email",
  });
  if (!attached) {
    await markConflict(client, { tenantId, fitterId: row.fitterId, reason: "tenant_user_ek_user_attach_failed" });
    return "conflict";
  }

  await autoLinkFitter(client, { tenantId, fitterId: row.fitterId, tenantUserId: tenantUser.id });
  await logAutoLinkAudit(client, {
    tenantId,
    tenantUserId: tenantUser.id,
    fitterId: row.fitterId,
    ekUserId,
    actorId: auditActorId,
  });
  return "auto_linked";
}

async function resolveFitterIdentityLinksForBatch(client, { tenantId, mappedRows, auditActorId }) {
  const result = {
    checked: 0,
    autoLinked: 0,
    unresolved: 0,
    conflicts: 0,
    preserved: 0,
    skipped: 0,
  };

  const rows = Array.isArray(mappedRows) ? mappedRows.filter(Boolean) : [];
  for (const row of rows) {
    const outcome = await resolveFitterIdentityForRow(client, { tenantId, row, auditActorId });
    result.checked += 1;
    if (outcome === "auto_linked") result.autoLinked += 1;
    else if (outcome === "unresolved") result.unresolved += 1;
    else if (outcome === "conflict") result.conflicts += 1;
    else if (outcome === "preserved") result.preserved += 1;
    else result.skipped += 1;
  }

  return result;
}

async function resolveCurrentFitter(client, { tenantId, tenantUserId }) {
  const { rows } = await client.query(
    `
      SELECT
        f.fitter_id,
        f.name,
        f.email,
        f.username,
        f.identity_link_status,
        f.identity_link_method,
        f.identity_linked_at
      FROM fitter f
      JOIN tenant_user tu
        ON tu.tenant_id = f.tenant_id
       AND tu.id = f.tenant_user_id
      WHERE f.tenant_id = $1
        AND f.tenant_user_id = $2
        AND f.identity_link_status IN ('auto_linked', 'manually_linked')
        AND f.is_active_derived IS DISTINCT FROM false
        AND tu.status = 'active'
        AND tu.login_status = 'active'
      ORDER BY f.updated_at DESC, f.fitter_id
      LIMIT 2
    `,
    [tenantId, tenantUserId]
  );

  if (rows.length !== 1) {
    return null;
  }

  const row = rows[0];
  return {
    fitter_id: row.fitter_id,
    ek_fitter_id: row.fitter_id,
    name: row.name,
    email: row.email,
    username: row.username,
    identity_link_status: row.identity_link_status,
    identity_link_method: row.identity_link_method,
    identity_linked_at: row.identity_linked_at,
  };
}

module.exports = {
  normalizeEmailForIdentity,
  normalizeUuid,
  resolveCurrentFitter,
  resolveFitterIdentityForRow,
  resolveFitterIdentityLinksForBatch,
};
