"use strict";

const pool = require("../../db/pool");
const ENV = require("../../config/env");
const audit = require("../../services/auditService");
const { withTransaction } = require("../../db/tx");
const { createHttpError } = require("../../middleware/errorHandler");
const activation = require("./approvalControl.activation");
const policy = require("./approvalControl.mailPolicy");
const routing = require("../notifications/operationalMailRouting");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const error = (status, code) => createHttpError(status, "approval_control_" + code);

function context(input) {
  if (!input || !UUID.test(input.tenantId || "") || !UUID.test(input.userId || "") || input.tenantSlug !== "hoyrup-clemmensen") throw error(403, "control_access_denied");
}
async function authorize(client, actor) {
  context(actor);
  const { rows } = await client.query(`SELECT u.id FROM tenant_user u JOIN tenant t ON t.id=u.tenant_id
    WHERE u.tenant_id=$1 AND u.id=$2 AND t.slug=$3 AND t.status='active'
      AND u.role='tenant_admin' AND u.status='active' AND u.login_status='active' FOR SHARE OF u,t`,
  [actor.tenantId, actor.userId, actor.tenantSlug]);
  if (rows.length !== 1) throw error(403, "control_access_denied");
}
async function recipient(client, actor) {
  context(actor);
  const { rows } = await client.query(`SELECT u.id,u.tenant_id,u.email FROM tenant_user u JOIN tenant t ON t.id=u.tenant_id
    WHERE u.tenant_id=$1 AND t.slug=$2 AND t.status='active' AND lower(u.username)='dep'
      AND lower(u.email)='dep@hoyrup-clemmensen.dk' AND u.status='active' AND u.login_status='active'`,
  [actor.tenantId, actor.tenantSlug]);
  if (rows.length !== 1) throw error(409, "mail_recipient_invalid");
  return { tenantId: actor.tenantId, tenantSlug: actor.tenantSlug, userId: rows[0].id, email: rows[0].email };
}
async function lock(client, actor, shared = false) {
  context(actor);
  await client.query("SET LOCAL lock_timeout = '3s'");
  await client.query(`SELECT pg_advisory_xact_lock${shared ? "_shared" : ""}(6125, hashtext($1::uuid::text))`, [actor.tenantId]);
}
async function limits(client) {
  await client.query("SET LOCAL lock_timeout = '3s'");
  await client.query("SET LOCAL statement_timeout = '15s'");
}
async function read(client, actor) {
  context(actor);
  const { rows } = await client.query(`SELECT metadata FROM audit_event WHERE tenant_id=$1
    AND event_type='tenant_config_changed' AND target_type='approval_control_settings' AND target_id=$1::text
    AND metadata->>'module_key'='approval_control'
    ORDER BY (metadata->>'revision')::bigint DESC,occurred_at DESC,id DESC LIMIT 1`, [actor.tenantId]);
  if (!rows.length) return { enabled: false, revision: 0, changed_at: null, enabled_at: null, activation_id: null, coverage_from: null };
  const state = rows[0].metadata.after;
  if (!state || !Number.isSafeInteger(state.revision) || state.revision < 1 || state.revision !== rows[0].metadata.revision ||
      typeof state.enabled !== "boolean" || !Number.isFinite(Date.parse(state.changed_at)) ||
      !Number.isFinite(Date.parse(state.enabled_at)) || !UUID.test(state.activation_id || "") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(state.coverage_from || "")) throw error(503, "control_state_invalid");
  return state;
}
async function get(actor) {
  const client = await pool.connect();
  try { return await read(client, actor); }
  finally { client.release(); }
}
async function databaseClock(client) {
  const { rows } = await client.query(`WITH source AS MATERIALIZED (SELECT clock_timestamp() AS at)
    SELECT to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,
      to_char(at AT TIME ZONE 'Europe/Copenhagen','YYYY-MM-DD') AS today FROM source`);
  return rows[0];
}
function validForSlot(state, planned, first) {
  return state?.enabled === true && state.revision > 0 && first?.id === state.activation_id && first.coverage_from === state.coverage_from &&
    Number.isFinite(Date.parse(state.enabled_at)) && Date.parse(planned.scheduled_at) > Date.parse(state.enabled_at);
}
async function view(client, actor) {
  const state = await read(client, actor), first = await activation.read(client, actor), clock = await databaseClock(client);
  const settings = policy.read(process.env, new Date(clock.at), first, state);
  const extra = await routing.read(client, { tenantId: actor.tenantId, mailType: "approval_control_summary" });
  const blockers = [...settings.configuration_blockers];
  let target = null;
  try { target = await recipient(client, actor); }
  catch (err) { if (err.message !== "approval_control_mail_recipient_invalid") throw err; blockers.push("Den eksisterende DEP-modtager er ikke aktiv og entydig."); }
  if (target) {
    try { routing.policy.recipients(extra, { to: target.email, cc: [] }); }
    catch (_) { blockers.push("De ekstra modtagere konflikter med mailens normale modtager. Ret modtagerindstillingerne før aktivering."); }
  }
  if (ENV.NODE_ENV !== "production") blockers.push("Aktivering er kun mulig i produktionsmiljøet.");
  if (!policy.runtimeAllowed()) blockers.push("Godkendelseskontrol er stoppet af et overordnet sikkerhedsflag.");
  if (ENV.MAIL_PROVIDER !== "resend" || !ENV.MAIL_FROM || !ENV.MAIL_REPLY_TO || !ENV.MAIL_API_KEY) blockers.push("Den eksisterende mailtransport og afsender er ikke fuldt konfigureret.");
  if (state.revision && (!settings.activation_valid || state.activation_id !== first?.id || state.coverage_from !== first?.coverage_from)) throw error(503, "control_state_invalid");
  const prospective = { ...settings, activation_valid: true };
  return { status: !state.revision && !first ? "inactive" : state.enabled ? "active" : "paused", revision: state.revision,
    today: clock.today, coverage_from: settings.coverage_from, activated_at: settings.activated_at,
    activation_id: settings.activation_id, effective_active: state.enabled && settings.activation_valid && !blockers.length,
    next_scheduled_at: state.enabled && !blockers.length ? policy.next(new Date(clock.at), settings) : null,
    activation_next_scheduled_at: blockers.length ? null : policy.next(new Date(clock.at), prospective), time_zone: policy.TIME_ZONE,
    scheduled_local_time: settings.scheduled_local_time, friday_local_time: settings.friday_local_time,
    mail_routing_revision: extra.revision, recipients: { to: target ? [target.email] : [],
      extra_cc: extra.extra_cc_enabled ? extra.extra_cc_emails : [], extra_bcc: extra.extra_bcc_enabled ? extra.extra_bcc_emails : [] },
    configuration_blockers: blockers };
}
async function status(actor) {
  return withTransaction(async client => { await limits(client); await authorize(client, actor); return view(client, actor); });
}
function input(value) {
  const keys = ["action", "revision", "expected_local_date", "mail_routing_revision", "confirm"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      Object.keys(value).some(key => !keys.includes(key)) || !["activate", "pause"].includes(value.action) ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isSafeInteger(value.mail_routing_revision) || value.mail_routing_revision < 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.expected_local_date || "") ||
      value.confirm !== (value.action === "activate" ? "ACTIVATE:approval_control" : "PAUSE:approval_control")) throw error(400, "control_input_invalid");
  return value;
}
async function change(actor, body) {
  const desired = input(body);
  try {
    return await withTransaction(async client => {
      await limits(client);
      await authorize(client, actor);
      await lock(client, actor);
      const before = await read(client, actor);
      if (before.revision !== desired.revision) throw error(409, "control_conflict");
      await client.query("SELECT pg_advisory_xact_lock_shared(6124,hashtext($1))", [actor.tenantId + ":approval_control_summary"]);
      const current = await view(client, actor);
      if (current.today !== desired.expected_local_date || current.mail_routing_revision !== desired.mail_routing_revision) throw error(409, "control_confirmation_changed");
      const enabling = desired.action === "activate";
      if (enabling && current.configuration_blockers.length) throw error(409, "control_configuration_blocked");
      if (before.enabled === enabling) return current;
      const first = enabling ? await activation.recordFirstInTransaction(client, actor) : await activation.read(client, actor);
      if (!first) throw error(409, "activation_invalid");
      const clock = await databaseClock(client);
      if (clock.today !== desired.expected_local_date || !current.activation_id && first.coverage_from !== clock.today) throw error(409, "control_confirmation_changed");
      const after = { enabled: enabling, revision: before.revision + 1, changed_at: clock.at,
        enabled_at: enabling ? clock.at : before.enabled_at, activation_id: first.id, coverage_from: first.coverage_from };
      await audit.logAuditEvent({ client, tenantId: actor.tenantId, actorId: actor.userId, actorScope: "tenant",
        moduleKey: "approval_control", eventType: "tenant_config_changed", resourceType: "approval_control_settings", resourceId: actor.tenantId,
        outcome: "success", metadata: { revision: after.revision, action: desired.action, before, after } });
      return view(client, actor);
    });
  } catch (err) { if (err.code === "55P03") throw error(409, "control_busy"); throw err; }
}
async function withSendLock(actor, expected, planned, first, send) {
  return withTransaction(async client => {
    await lock(client, actor, true);
    const state = await read(client, actor);
    if (state.revision !== expected.revision || !validForSlot(state, planned, first) || !policy.runtimeAllowed()) throw error(409, "control_changed");
    return send();
  });
}
module.exports = { get, read, status, change, input, recipient, validForSlot, withSendLock };
