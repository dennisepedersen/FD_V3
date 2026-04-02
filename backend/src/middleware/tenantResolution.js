const env = require("../config/env");
const pool = require("../db/pool");
const tenantQueries = require("../db/queries/tenant");
const auditQueries = require("../db/queries/audit");
const { createHttpError } = require("./errorHandler");

function normalizeHost(value) {
  return String(value || "")
    .toLowerCase()
    .split(":")[0]
    .trim();
}

function classifyHost(host) {
  if (host === env.ROOT_DOMAIN) {
    return { domainScope: "root", slug: null };
  }

  if (host === env.PORTAL_DOMAIN) {
    return { domainScope: "portal", slug: null };
  }

  const suffix = `.${env.ROOT_DOMAIN}`;
  if (host.endsWith(suffix)) {
    const slug = host.slice(0, -suffix.length);
    if (slug && !slug.includes(".")) {
      return { domainScope: "tenant", slug };
    }
  }

  return { domainScope: "unknown", slug: null };
}

async function writeResolutionDenyAudit(client, { host, slug, reason }) {
  try {
    await auditQueries.insertAuditEvent(client, {
      actorId: "system:tenant_resolution",
      actorScope: "system",
      tenantId: null,
      eventType: "support_access_denied",
      targetType: "tenant_resolution",
      targetId: slug || host,
      outcome: "deny",
      reason: "tenant_resolution_denied",
      metadata: {
        host,
        slug,
        detail: reason,
      },
    });
  } catch (auditError) {
    // Deny result must not depend on audit write availability.
  }
}

async function tenantResolution(req, res, next) {
  const host = normalizeHost(req.headers.host);
  if (!host) {
    return next(createHttpError(400, "Missing host header"));
  }

  const classification = classifyHost(host);
  req.context = {
    domainScope: classification.domainScope,
    host,
  };

  if (classification.domainScope === "root") {
    return next();
  }

  if (classification.domainScope === "portal") {
    return next();
  }

  if (classification.domainScope !== "tenant") {
    return next(createHttpError(404, "not_found"));
  }

  const client = await pool.connect();
  try {
    const tenantRow = await tenantQueries.resolveActiveTenantBySlugAndHost(client, {
      slug: classification.slug,
      host,
    });

    if (!tenantRow) {
      await writeResolutionDenyAudit(client, {
        host,
        slug: classification.slug,
        reason: "tenant_not_found_or_domain_inactive",
      });
      return next(createHttpError(404, "not_found"));
    }

    if (tenantRow.status === "suspended") {
      await writeResolutionDenyAudit(client, {
        host,
        slug: classification.slug,
        reason: "tenant_suspended",
      });
      return next(createHttpError(410, "gone_suspended"));
    }

    if (tenantRow.status === "deleted") {
      await writeResolutionDenyAudit(client, {
        host,
        slug: classification.slug,
        reason: "tenant_deleted",
      });
      return next(createHttpError(410, "gone_deleted"));
    }

    if (tenantRow.status !== "active" || !tenantRow.verified || !tenantRow.active) {
      await writeResolutionDenyAudit(client, {
        host,
        slug: classification.slug,
        reason: "tenant_not_active_lifecycle",
      });
      return next(createHttpError(403, "deny_lifecycle"));
    }

    req.context.tenant = {
      id: tenantRow.id,
      slug: tenantRow.slug,
      name: tenantRow.name,
      status: tenantRow.status,
      domain: tenantRow.domain,
    };

    return next();
  } catch (error) {
    return next(error);
  } finally {
    client.release();
  }
}

module.exports = tenantResolution;
