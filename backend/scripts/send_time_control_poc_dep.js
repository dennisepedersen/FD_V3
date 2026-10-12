"use strict";

const pool = require("../src/db/pool");
const sender = require("../src/modules/timeControl/timeControl.mailTestSender");

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || !/^[0-9a-f-]{36}$/i.test(args[0]) || args[1] !== `SEND:timekontrol-poc-dep:${args[0]}`) {
    throw new Error("usage: node scripts/send_time_control_poc_dep.js <test-id> SEND:timekontrol-poc-dep:<test-id>");
  }
  const tenantId = "f1f51c07-2d88-4ee4-a766-78eac833a9d0";
  const actorId = process.env.TIME_CONTROL_POC_APPROVED_ACTOR_ID;
  const actor = (await pool.query(
    "SELECT id FROM tenant_user WHERE tenant_id=$1 AND id=$2 AND role='tenant_admin' AND status='active'",
    [tenantId, actorId]
  )).rows[0];
  if (!actor) throw new Error("time_control_poc_authorized_admin_required");
  const result = await sender.sendPreparedDep({ tenantId, actorId: actor.id, testId: args[0], confirm: args[1] });
  console.log(JSON.stringify({ test_id: result.id, provider_acceptance: result.delivery_state, provider_message_id: result.provider_message_id, inbox_receipt_verified: false, retry_allowed: false }));
}

main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; }).finally(() => pool.end());
