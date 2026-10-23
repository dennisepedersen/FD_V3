"use strict";

const crypto = require("node:crypto");
const audit = require("../../services/auditService");

async function record(client, context, result, errorCode = null) {
  const event = errorCode ? "approval_control.preview_failed" : "approval_control.previewed";
  const fingerprint = errorCode ? crypto.createHash("sha256").update(JSON.stringify([context.tenantId, context.userId, result.fromDate, result.toDate, errorCode])).digest("hex") : result.fingerprint;
  await client.query("BEGIN");
  try {
    // Two-key advisory namespace is separate from Timekontrol's claims/locks.
    await client.query("SELECT pg_advisory_xact_lock(6120, hashtext($1))", [context.tenantId + ":" + context.userId]);
    const params = [context.tenantId, context.userId];
    const find = () => client.query(`
      SELECT id, occurred_at AS created_at, event_type, metadata FROM audit_event
      WHERE tenant_id=$1 AND actor_id=$2
        AND event_type IN ('approval_control.previewed','approval_control.preview_failed')
      ORDER BY occurred_at DESC LIMIT 1
    `, params);
    let found = (await find()).rows[0];
    const duplicate = found?.event_type === event && found?.metadata?.fingerprint === fingerprint &&
      found?.metadata?.observed_at === result.observed_at;
    if (!duplicate) {
      await audit.logAuditEvent({ client, tenantId: context.tenantId, actorId: context.userId,
        actorScope: "tenant", moduleKey: "approval_control", eventType: event,
        resourceType: "approval_control_preview", outcome: errorCode ? "fail" : "success",
        metadata: errorCode ? { fingerprint, observed_at: result.observed_at, from_date: result.fromDate, to_date: result.toDate, error_code: errorCode, mail_attempted: false, provider_id: null }
          : { fingerprint, observed_at: result.observed_at, finished_at: result.finished_at,
            from_date: result.fromDate, to_date: result.toDate, to: result.mail.to, cc: [],
            counts: result.counts, pending: result.pending, unknown: result.unknown,
            approved_count: result.approved_count, source: result.source,
            mail_attempted: false, provider_id: null, result: "preview_only" },
      });
      found = (await find()).rows[0];
      if (!found) throw new Error("approval_control_audit_not_saved");
    }
    await client.query("COMMIT");
    return { id: found.id, created_at: found.created_at, fingerprint, duplicate: Boolean(duplicate), mail_attempted: false, provider_id: null };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function latest(client, context) {
  const { rows } = await client.query(`
    SELECT id, occurred_at AS created_at, event_type, metadata FROM audit_event
    WHERE tenant_id=$1 AND actor_id=$2
      AND event_type IN ('approval_control.previewed','approval_control.preview_failed','approval_control.capture_admitted')
      AND NOT (event_type='approval_control.capture_admitted' AND metadata ? 'mail_run_id')
    ORDER BY occurred_at DESC LIMIT 1
  `, [context.tenantId, context.userId]);
  return rows[0] || null;
}

module.exports = { record, latest };
