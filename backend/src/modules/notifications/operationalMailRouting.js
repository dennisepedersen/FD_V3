"use strict";

const pool = require("../../db/pool");
const { withTransaction } = require("../../db/tx");
const audit = require("../../services/auditService");
const { createHttpError } = require("../../middleware/errorHandler");
const policy = require("./operationalMailRouting.policy");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function tenant(tenantId) {
  if (!UUID.test(tenantId || "")) throw createHttpError(403, "tenant_context_mismatch");
}
async function authorize(client, { tenantId, actorId }) {
  tenant(tenantId);
  if (!UUID.test(actorId || "")) throw createHttpError(403, "tenant_admin_access_denied");
  const { rows } = await client.query(`SELECT u.id FROM tenant_user u JOIN tenant t ON t.id=u.tenant_id
    WHERE u.tenant_id=$1 AND u.id=$2 AND u.role='tenant_admin' AND u.status='active'
    AND u.login_status='active' AND t.status='active' FOR SHARE OF u,t`, [tenantId, actorId]);
  if (rows.length !== 1) throw createHttpError(403, "tenant_admin_access_denied");
}
function shape(row, mailType) {
  if (!row) return policy.defaults(mailType);
  return { mail_type: mailType, title: policy.TITLES[mailType], revision: row.revision,
    extra_cc_enabled: row.extra_cc_enabled, extra_cc_emails: row.extra_cc_emails,
    extra_bcc_enabled: row.extra_bcc_enabled, extra_bcc_emails: row.extra_bcc_emails,
    updated_at: row.updated_at };
}
async function read(client, { tenantId, mailType }) {
  tenant(tenantId); policy.type(mailType);
  const { rows } = await client.query("SELECT * FROM tenant_operational_mail_routing WHERE tenant_id=$1 AND mail_type=$2", [tenantId, mailType]);
  return shape(rows[0], mailType);
}
async function lock(client, tenantId, mailType, shared = false) {
  tenant(tenantId); policy.type(mailType);
  await client.query("SET LOCAL lock_timeout = '3s'");
  await client.query(`SELECT pg_advisory_xact_lock${shared ? "_shared" : ""}(6124, hashtext($1))`, [tenantId + ":" + mailType]);
}
async function list(context) {
  return withTransaction(async client => {
    await authorize(client, context);
    const { rows } = await client.query("SELECT * FROM tenant_operational_mail_routing WHERE tenant_id=$1 ORDER BY mail_type", [context.tenantId]);
    return Object.keys(policy.TITLES).map(mailType => shape(rows.find(row => row.mail_type === mailType), mailType));
  });
}
async function save(context, mailType, input) {
  policy.type(mailType);
  const desired = policy.input(input);
  return withTransaction(async client => {
    await authorize(client, context);
    await lock(client, context.tenantId, mailType);
    const before = await read(client, { tenantId: context.tenantId, mailType });
    if (desired.revision !== before.revision) throw createHttpError(409, "operational_mail_routing_conflict");
    const fields = ["extra_cc_enabled", "extra_cc_emails", "extra_bcc_enabled", "extra_bcc_emails"];
    if (fields.every(key => JSON.stringify(before[key]) === JSON.stringify(desired[key]))) return before;
    const { rows } = await client.query(`INSERT INTO tenant_operational_mail_routing
      (tenant_id,mail_type,extra_cc_enabled,extra_cc_emails,extra_bcc_enabled,extra_bcc_emails,revision,updated_by_user_id)
      VALUES($1,$2,$3,$4::text[],$5,$6::text[],$7,$8)
      ON CONFLICT(tenant_id,mail_type) DO UPDATE SET extra_cc_enabled=EXCLUDED.extra_cc_enabled,
        extra_cc_emails=EXCLUDED.extra_cc_emails,extra_bcc_enabled=EXCLUDED.extra_bcc_enabled,
        extra_bcc_emails=EXCLUDED.extra_bcc_emails,revision=EXCLUDED.revision,
        updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=clock_timestamp() RETURNING *`,
    [context.tenantId, mailType, desired.extra_cc_enabled, desired.extra_cc_emails, desired.extra_bcc_enabled, desired.extra_bcc_emails, before.revision + 1, context.actorId]);
    const after = shape(rows[0], mailType);
    await audit.logAuditEvent({ client, tenantId: context.tenantId, actorId: context.actorId, actorScope: "tenant",
      moduleKey: "notifications", eventType: "tenant_config_changed", resourceType: "tenant_operational_mail_routing", resourceId: mailType,
      outcome: "success", metadata: { mail_type: mailType, before, after } });
    return after;
  });
}
async function compose(client, { tenantId, mailType, to, cc }) {
  return policy.recipients(await read(client, { tenantId, mailType }), { to, cc });
}
async function composeWithPool(input) {
  const client = await pool.connect();
  try { return await compose(client, input); }
  finally { client.release(); }
}
function payload(route) {
  return { cc_emails: route.cc, ...(route.bcc.length ? { bcc_emails: route.bcc } : {}), mail_routing: route.snapshot };
}
async function validateQueued(client, { tenantId, mailType, to, cc, queuedTo, queuedCc, queuedBcc, snapshot }) {
  await lock(client, tenantId, mailType, true);
  const route = await compose(client, { tenantId, mailType, to, cc });
  const current = route.snapshot;
  // Legacy mail is never retrofitted; new settings cannot silently alter a queued message.
  if (snapshot ? snapshot.mail_type !== mailType || snapshot.revision !== current.revision
    : route.cc.length !== (cc || []).length || route.bcc.length) throw createHttpError(409, "operational_mail_routing_changed");
  const actual = { to: policy.addresses([queuedTo])[0], cc: policy.addresses(queuedCc || [], Infinity), bcc: policy.addresses(queuedBcc || []) };
  policy.distinct([actual.to], actual.cc, actual.bcc);
  if (actual.to !== route.to || ["cc", "bcc"].some(key =>
    JSON.stringify(actual[key].slice().sort()) !== JSON.stringify(route[key].slice().sort()))) throw createHttpError(409, "operational_mail_routing_changed");
  return route;
}
async function withMessageLock({ tenantId, message, route, baseCc = [] }, send) {
  return withTransaction(async client => {
    await validateQueued(client, { tenantId, mailType: route.snapshot.mail_type, to: message.to, cc: baseCc,
      queuedTo: message.to, queuedCc: message.cc, queuedBcc: message.bcc, snapshot: route.snapshot });
    return send();
  });
}
module.exports = { list, save, read, compose, composeWithPool, payload, validateQueued, withMessageLock, policy };
