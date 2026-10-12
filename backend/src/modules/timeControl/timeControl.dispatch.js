"use strict";

const operation = require("./timeControl.operation");
const repository = require("./timeControl.repository");
const storage = require("./timeControl.dataset");
const coverage = require("./timeControl.coverage");
const logic = require("./timeControl.logic");
const { isDeepStrictEqual } = require("node:util");
const { emailFailureFor, emailListFailureFor } = require("../../services/emailRecipients");

function resultBinding(result) {
  return JSON.parse(JSON.stringify({
    result_id: result.id, employee_config_id: result.employee_config_id, fitter_id: result.fitter_id,
    hours_dataset_id: result.hours_dataset_id, weekly_snapshot_id: result.weekly_snapshot_id,
    identity_snapshot: result.identity_snapshot, employee_name: result.employee_name,
    employee_email: result.employee_email, internal_ref: result.internal_ref,
    status: result.status, coverage_status: result.coverage_status,
    required_hours: Number(result.required_hours), valid_hours: Number(result.valid_hours),
    missing_hours: result.missing_hours == null ? null : Number(result.missing_hours),
    counted_pay_codes: result.counted_pay_codes, excluded_pay_codes: result.excluded_pay_codes,
  }));
}

function matchesResultBinding(result, binding) {
  return Boolean(binding?.identity_snapshot && isDeepStrictEqual(resultBinding(result), binding));
}

function matchesIdentity(identity, snapshot) {
  const { hours_dataset: _dataset, ...approvedIdentity } = snapshot || {};
  return isDeepStrictEqual(JSON.parse(JSON.stringify(identity)), JSON.parse(JSON.stringify(approvedIdentity)));
}

function validateRouting(row, { to, cc }, prefix) {
  const queuedTo = emailFailureFor(row.recipient_email);
  const expectedTo = emailFailureFor(to);
  const queuedCc = emailListFailureFor(row.payload_json?.cc_emails);
  const expectedCc = emailListFailureFor(cc);
  if (queuedTo.errorCode || expectedTo.errorCode || queuedCc.errorCode || expectedCc.errorCode ||
      queuedTo.email !== expectedTo.email ||
      !isDeepStrictEqual(queuedCc.emails.sort(), expectedCc.emails.sort())) {
    throw new Error(`${prefix}_dispatch_routing_changed`);
  }
}

async function validateDaily(client, { tenantId, row }) {
  const payload = row.payload_json || {};
  const day = payload.controlled_date;
  if (!operation.dispatchWindow("daily_09", day)) throw new Error("time_control_daily_dispatch_window_expired");
  const result = (await client.query(
    `SELECT tr.* FROM time_control_result tr JOIN time_control_run r ON r.id=tr.run_id AND r.tenant_id=tr.tenant_id
     WHERE tr.tenant_id=$1 AND tr.id=$2 AND r.id=$3 AND r.control_type='daily_09'
     AND r.controlled_date=$4::date AND r.mode='live' AND r.triggered_by='scheduler' AND r.status='completed'
     AND tr.status='missing_hours' FOR SHARE OF r,tr`,
    [tenantId, payload.result_id, payload.run_id, day])).rows[0];
  if (!result?.hours_dataset_id || !matchesResultBinding(result, payload.result_binding) ||
      payload.result_binding.result_id !== payload.result_id) throw new Error("time_control_daily_dispatch_binding_invalid");
  const settings = (await client.query(
    `SELECT s.* FROM time_control_settings s JOIN tenant t ON t.id=s.tenant_id
     WHERE s.tenant_id=$1 AND t.status='active' FOR SHARE OF s,t`, [tenantId])).rows[0];
  if (settings?.is_enabled !== true || settings.mode !== "live") throw new Error("time_control_daily_dispatch_settings_invalid");
  validateRouting(row, { to: result.employee_email, cc: settings.employee_cc_emails }, "time_control_daily");
  const current = await storage.loadHoursDataset(client, {
    tenantId, controlledDate: day, datasetId: result.hours_dataset_id, freshnessMinutes: settings.sync_freshness_minutes,
  });
  if (!current.proof.server_captured) throw new Error("time_control_daily_server_observation_required");
  if (!isDeepStrictEqual(JSON.parse(JSON.stringify(current.proof)), payload.result_binding.identity_snapshot.hours_dataset)) {
    throw new Error("time_control_daily_dispatch_binding_invalid");
  }
  const config = await repository.lockEmployeeConfig(client, { tenantId, configId: result.employee_config_id });
  const resolution = config && require("./timeControl.service")._test.classifyResolvedEmployee(config,
    await repository.resolveEmployeeConfig(client, { tenantId, config }));
  if (!resolution?.ok || !matchesIdentity(resolution.employee.identitySnapshot, payload.result_binding.identity_snapshot) ||
      emailFailureFor(resolution.employee.email).email !== emailFailureFor(row.recipient_email).email) throw new Error("time_control_daily_dispatch_identity_changed");
  const rules = logic.normalizePayCodeRules(await repository.listPayCodeRules(client, { tenantId }));
  const evaluated = coverage.evaluateFitterDay(current.dataset, { tenantId, controlledDate: day,
    fitterId: result.fitter_id, payCodeRules: rules, requiredHours: Number(result.required_hours) });
  if (evaluated.evaluation.status !== "missing_hours" ||
      evaluated.evaluation.validHours !== Number(result.valid_hours)) throw new Error("time_control_daily_dispatch_evaluation_changed");
  if (!operation.dispatchWindow("daily_09", day)) throw new Error("time_control_daily_dispatch_window_expired");
}

module.exports = { validateDaily, resultBinding, matchesResultBinding, matchesIdentity, validateRouting };
