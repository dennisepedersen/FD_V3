"use strict";

const pool = require("../src/db/pool");
const sender = require("../src/modules/timeControl/timeControl.mailTestSender");

async function main() {
  const [action, id, confirm, ...extra] = process.argv.slice(2);
  if (extra.length || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || "") ||
      !["prepare", "send"].includes(action) ||
      confirm !== (action === "prepare" ? `PREPARE:timekontrol-poc-mhj:${id}` : `SEND:timekontrol-poc-mhj:${id}`)) {
    throw new Error("usage: node scripts/time_control_poc_mhj.js prepare <batch-id> PREPARE:timekontrol-poc-mhj:<batch-id> | send <test-id> SEND:timekontrol-poc-mhj:<test-id>");
  }
  const tenantId = "f1f51c07-2d88-4ee4-a766-78eac833a9d0";
  const actor = (await pool.query(
    "SELECT id FROM tenant_user WHERE tenant_id=$1 AND id=$2 AND role='tenant_admin' AND status='active'",
    [tenantId, process.env.TIME_CONTROL_POC_APPROVED_ACTOR_ID]
  )).rows[0];
  if (!actor) throw new Error("time_control_poc_authorized_admin_required");
  if (action === "prepare") {
    const { test } = await sender.prepareMhj({ tenantId, actorId: actor.id, batchId: id });
    console.log(JSON.stringify({ test_id: test.id, status: test.status, test_key: test.test_key,
      content_hash: test.content_hash, message: test.message_json, mail_sent: false }));
  } else {
    const result = await sender.sendPreparedMhj({ tenantId, actorId: actor.id, testId: id, confirm });
    console.log(JSON.stringify({ test_id: result.id, provider_acceptance: result.delivery_state,
      provider_message_id: result.provider_message_id, inbox_receipt_verified: false, retry_allowed: false }));
  }
}

main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; }).finally(() => pool.end());
