"use strict";

const pool = require("../../db/pool");
const audit = require("../../services/auditService");
const { createHttpError } = require("../../middleware/errorHandler");

function protectedWindow(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return ["Tue", "Wed", "Thu", "Fri"].includes(parts.weekday) && minutes >= 8 * 60 + 59 && minutes < 9 * 60 + 30 ||
    parts.weekday === "Fri" && minutes >= 11 * 60 + 59 && minutes < 14 * 60 + 31;
}

async function read(context, fn, now = () => new Date(), { mailRunId = null } = {}) {
  if (mailRunId !== null && !/^[0-9a-f-]{36}$/i.test(mailRunId)) throw createHttpError(400, "approval_control_run_invalid");
  const clock = typeof now === "function" ? now : () => now;
  const tenantId = context.tenantId;
  if (protectedWindow(clock())) throw createHttpError(409, "approval_control_protected_window");
  const client = await pool.connect();
  let locked = false, discard = false;
  try {
    const { rows } = await client.query("SELECT pg_try_advisory_lock(6121, hashtext($1)) AS locked", [tenantId]);
    locked = rows[0]?.locked === true;
    if (!locked) throw createHttpError(409, "approval_control_preview_running");
    const recent = await client.query(`
      SELECT 1 FROM audit_event WHERE tenant_id=$1
        AND event_type IN ('approval_control.previewed','approval_control.preview_failed','approval_control.capture_admitted')
        AND occurred_at > clock_timestamp() - interval '60 seconds' LIMIT 1
    `, [tenantId]);
    if (recent.rows.length) throw createHttpError(429, "approval_control_preview_cooldown");
    if (protectedWindow(clock())) throw createHttpError(409, "approval_control_protected_window");
    try {
      await audit.logAuditEvent({ client, tenantId, actorId: context.userId, actorScope: "tenant",
        moduleKey: "approval_control", eventType: "approval_control.capture_admitted",
        resourceType: mailRunId ? "approval_control_mail_run" : "approval_control_preview", resourceId: mailRunId, outcome: "success",
        metadata: { started_at: clock().toISOString(), mail_attempted: false, provider_id: null,
          ...(mailRunId ? { mail_run_id: mailRunId } : {}) },
      });
    } catch (_) { throw createHttpError(503, "approval_control_audit_unavailable"); }
    // Pool/advisory/audit waits must not shift a capture into the blackout.
    if (protectedWindow(clock())) throw createHttpError(409, "approval_control_protected_window");
    return await fn();
  } finally {
    if (locked) {
      try { await client.query("SELECT pg_advisory_unlock(6121, hashtext($1))", [tenantId]); }
      catch (_) { discard = true; }
    }
    client.release(discard);
  }
}

module.exports = { read, protectedWindow };
