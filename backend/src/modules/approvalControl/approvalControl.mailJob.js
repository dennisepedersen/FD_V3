"use strict";

const pool = require("../../db/pool");
const ENV = require("../../config/env");
const scope = require("./approvalControl.scope");
const source = require("./approvalControl.source");
const logic = require("./approvalControl.logic");
const admission = require("./approvalControl.admission");
const refresh = require("../../services/fitterhoursRefreshService");
const repository = require("./approvalControl.mailRepository");
const activation = require("./approvalControl.activation");
const policy = require("./approvalControl.mailPolicy");
const email = require("./approvalControl.mail");
const mailService = require("../../services/mailService");
const mailRouting = require("../notifications/operationalMailRouting");
const control = require("./approvalControl.control");
const { createHttpError } = require("../../middleware/errorHandler");

const sameScope = selected => JSON.stringify({ projects: selected.projects.map(p => p.project_id).sort(),
  bindings: selected.bindings.map(b => [b.project_id, b.ek_project_id]).sort(), email: selected.user.email });
const emptyCounts = () => ({ open_rows: 0, projects: 0, hours: 0, oldest_date: null });

async function selected(context, withConfig = false) {
  const client = await pool.connect();
  try {
    const lifecycle = await client.query(`SELECT t.id FROM tenant t
      JOIN tenant_domain d ON d.tenant_id=t.id AND d.active=true AND d.verified=true
      WHERE t.id=$1 AND t.slug=$2 AND t.status='active' AND lower(d.domain)=$3`,
    [context.tenantId, context.tenantSlug, `${context.tenantSlug}.${ENV.ROOT_DOMAIN}`]);
    if (lifecycle.rows.length !== 1) throw createHttpError(403, "approval_control_tenant_inactive");
    const result = await scope.loadMine(client, context);
    // Scheduled delivery is additionally restricted to DEP's existing POC mailbox.
    if (String(result.user.email).toLowerCase() !== "dep@hoyrup-clemmensen.dk") throw createHttpError(403, "approval_control_mail_recipient_invalid");
    return { ...result, config: withConfig && result.projects.length ? await refresh.resolveTenantConfig(client, { tenant: context.tenantId }) : null };
  } finally { client.release(); }
}

function summarize(context, current, captured, fromDate, today) {
  const future = captured.rows.filter(row => typeof row.date === "string" && logic.validDay(row.date.slice(0, 10)) && row.date.slice(0, 10) > today);
  const futureIds = new Set(future.map(row => row.id));
  const rows = captured.rows.filter(row => !futureIds.has(row.id) &&
    !(typeof row.date === "string" && logic.validDay(row.date.slice(0, 10)) && row.date.slice(0, 10) < fromDate));
  const result = logic.summarize({ ...context, ...current, rows, fromDate, toDate: today });
  const mine = new Set(current.projects.map(project => project.project_id));
  const bindings = new Map(current.bindings.filter(b => mine.has(b.project_id)).map(b => [b.ek_project_id, b.project_id]));
  const futureRows = future.filter(row => bindings.has(String(row.projectID))).map(row => ({ id: String(row.id), project_id: bindings.get(String(row.projectID)), date: row.date.slice(0, 10) }));
  return { ...result, fromDate, toDate: today, to: current.user.email, future_excluded: futureRows.length, future_excluded_rows: futureRows,
    observed_at: captured.observed_at, finished_at: captured.completed_at,
    source: { endpoint: captured.endpoint, requests: captured.requests, passes: captured.passes } };
}

function failure(error) {
  if (error.message === "approval_control_control_changed") return "Godkendelseskontrol blev sat på pause eller genaktiveret under kørslen. Ingen mail sendt.";
  if (error.message === "approval_control_scope_changed") return "Dine sager eller modtageroplysninger ændrede sig under kontrollen. Ingen mail sendt.";
  if (error.message === "approval_control_protected_window") return "Kontrollen er blokeret af det eksisterende beskyttelsesvindue for Timekontrol.";
  if (error.message === "approval_control_preview_running" || error.message === "approval_control_preview_cooldown") return "En anden Godkendelseskontrol optager læsevinduet. Ingen mail sendt.";
  if (/^approval_control_source_/.test(error.message)) return "EK-læsningen var fejlbehæftet, ustabil, ufuldstændig eller overskred læsebudgettet. Ingen delvis mail sendt.";
  return "Kontrollen kunne ikke gennemføres sikkert. Ingen automatisk genafsendelse.";
}

async function runDue(context, { mode = "simulation", clock = () => new Date(), readPolicy = (first, state) => policy.read(process.env, clock(), first, state), sendEmailFn = mailService.sendEmail } = {}) {
  if (!["simulation", "live"].includes(mode)) throw new Error("approval_control_mail_mode_invalid");
  if (mode === "live" && ENV.NODE_ENV !== "production") return { state: "disabled", reason: "Rigtig maildrift er kun mulig i produktionsmiljøet." };
  let settings = readPolicy(null);
  const started = clock(), planned = policy.slot(started, settings);
  if (!planned) return { state: "not_due", reason: "Ikke et planlagt hverdags-slot. Ingen indhentning af gamle kørsler." };
  if (!settings.configuration_valid || !settings.schedule_valid) return { state: "blocked", reason: "Konfigurationen stemmer ikke med Godkendelseskontrols aktiveringsregler eller planlagte tidspunkt." };
  const initial = await selected(context);
  const first = await activation.get(context);
  if (!first) return { state: "not_activated", reason: "Ingen aktiv kontrolperiode. Tenantens scheduler er ikke produktionsaktiveret." };
  const state = await control.get(context);
  settings = readPolicy(first, state);
  if (!state.enabled || mode === "live" && (!settings.scheduler_enabled || !settings.mail_enabled)) return { state: "disabled", reason: "Godkendelseskontrol er sat på pause eller stoppet af et sikkerhedsflag." };
  if (!control.validForSlot(state, planned, first)) return { state: "not_due", reason: "Første ordinære kørsel er næste planlagte tidspunkt efter aktivering eller genaktivering." };
  if (first.tenant_id !== context.tenantId || !settings.configuration_valid || !settings.activation_valid || settings.activation_id !== first.id || settings.coverage_from !== first.coverage_from) throw createHttpError(409, "approval_control_activation_invalid");
  const claim = await control.withSendLock(context, state, planned, first, () => repository.claim(context, {
    ...planned, started_at: started.toISOString(), coverage_from: settings.coverage_from,
    activation_id: first.id, activated_at: first.activated_at, scheduler_revision: state.revision, mode }));
  if (!claim.claimed) return { state: "duplicate", reason: "Dagens slot er allerede optaget. Ingen ny afsendelse.", run_id: claim.run.id };
  const runId = claim.run.id;
  const finish = result => repository.finish(context, runId, { ...result, completed_at: clock().toISOString() });
  let prepared, providerResult = null, transportStarted = false;
  try {
    // Keep the existing tenant-wide admission, blackout and rate budget unchanged.
    await admission.read(context, async () => {
      const beforeCapture = await control.get(context);
      if (beforeCapture.revision !== state.revision || !control.validForSlot(beforeCapture, planned, first)) throw new Error("approval_control_control_changed");
      if (policy.slot(clock(), settings)?.scheduled_at !== planned.scheduled_at) throw new Error("approval_control_slot_elapsed");
      if (initial.projects.some(project => !initial.bindings.some(b => b.project_id === project.project_id))) throw new Error("approval_control_project_binding_missing");
      const configured = initial.projects.length ? await selected(context, true) : initial;
      if (sameScope(configured) !== sameScope(initial)) throw new Error("approval_control_scope_changed");
      if (configured.config && configured.config.tenantId !== context.tenantId) throw createHttpError(403, "tenant_context_mismatch");
      const captured = initial.projects.length ? await source.capture({ config: configured.config, fromDate: settings.coverage_from, toDate: planned.local_date })
        : { rows: [], observed_at: clock().toISOString(), completed_at: clock().toISOString(), requests: 0, passes: 0, endpoint: null };
      const current = await selected(context);
      if (sameScope(current) !== sameScope(initial)) throw new Error("approval_control_scope_changed");
      const afterCapture = await control.get(context);
      if (afterCapture.revision !== state.revision || !control.validForSlot(afterCapture, planned, first)) throw new Error("approval_control_control_changed");
      prepared = summarize(context, current, captured, settings.coverage_from, planned.local_date);
      prepared.activation_id = first.id;
      prepared.activated_at = first.activated_at;
      prepared.scheduler_revision = state.revision;
      if (clock().getTime() - started.getTime() > 120000 || policy.local(clock()).date !== planned.local_date) throw new Error("approval_control_snapshot_expired");
      if (!prepared.pending.length) {
        await finish({ ...prepared, state: "no_open", reason: prepared.unknown.length ? "Kun dataklaringsrækker; de udløser ikke mail." : "Ingen mailberettigede åbne registreringer.", mail_attempted: false, provider_id: null });
        return;
      }
      const message = email.build({ context, result: prepared, runId, rootDomain: ENV.ROOT_DOMAIN, sender: ENV.MAIL_FROM, replyTo: ENV.MAIL_REPLY_TO });
      const route = await mailRouting.composeWithPool({ tenantId: context.tenantId, mailType: "approval_control_summary", to: message.to, cc: message.cc });
      message.cc = route.cc;
      if (route.bcc.length) message.bcc = route.bcc;
      prepared.mail_routing = route.snapshot;
      const idempotencyKey = `approval_control:${context.tenantId}:${context.userId}:${planned.local_date}`;
      if (mode === "simulation") {
        await finish({ ...prepared, state: "simulated", reason: "Mail simuleret; ingen provider kontaktet.", message, idempotency_key: idempotencyKey, mail_attempted: false, provider_id: null });
        return;
      }
      const latestPolicy = readPolicy(first, state);
      if (!latestPolicy.mail_enabled || !latestPolicy.scheduler_enabled || !latestPolicy.configuration_valid || !latestPolicy.activation_valid || !latestPolicy.schedule_valid || latestPolicy.coverage_from !== settings.coverage_from ||
          ENV.MAIL_PROVIDER !== "resend" || !ENV.MAIL_FROM || !ENV.MAIL_REPLY_TO) throw new Error("approval_control_mail_disabled_or_unconfigured");
      // A durable attempt is committed before provider access. It is never reclaimed.
      if (!await repository.attempt(context, runId, { ...prepared, message, idempotency_key: idempotencyKey, attempted_at: clock().toISOString(), mail_attempted: true, provider_id: null })) throw new Error("approval_control_attempt_already_claimed");
      let receipt, rejected = false;
      let preflight;
      try { preflight = await selected(context); }
      catch (_) {
        await finish({ ...prepared, state: "blocked", reason: "Tenant, bruger eller modtager kunne ikke længere autoriseres. Ingen provider kontaktet.", mail_attempted: false, provider_id: null });
        return;
      }
      if (sameScope(preflight) !== sameScope(initial)) {
        await finish({ ...prepared, state: "blocked", reason: failure(new Error("approval_control_scope_changed")), mail_attempted: false, provider_id: null });
        return;
      }
      const finalPolicy = readPolicy(first, state);
      if (!finalPolicy.mail_enabled || !finalPolicy.scheduler_enabled || !finalPolicy.configuration_valid || !finalPolicy.activation_valid || !finalPolicy.schedule_valid || finalPolicy.coverage_from !== settings.coverage_from ||
          admission.protectedWindow(clock()) || clock().getTime() - started.getTime() > 120000 || policy.local(clock()).date !== planned.local_date) {
        await finish({ ...prepared, state: "blocked", reason: "Afsendelsen blev stoppet ved den sidste sikkerhedskontrol.", mail_attempted: false, provider_id: null });
        return;
      }
      try {
        receipt = await control.withSendLock(context, state, planned, first, () => mailRouting.withMessageLock({ tenantId: context.tenantId, message, route }, async () => {
          const beforeProvider = await selected(context);
          if (sameScope(beforeProvider) !== sameScope(initial)) throw new Error("approval_control_scope_changed");
          const beforeSend = readPolicy(first, state);
          if (!beforeSend.mail_enabled || !beforeSend.scheduler_enabled || !beforeSend.configuration_valid ||
              !beforeSend.activation_valid || !beforeSend.schedule_valid || beforeSend.coverage_from !== settings.coverage_from ||
              admission.protectedWindow(clock()) || clock().getTime() - started.getTime() > 120000 || policy.local(clock()).date !== planned.local_date) {
            throw new Error("approval_control_mail_disabled_or_unconfigured");
          }
          transportStarted = true;
          return sendEmailFn(message, { idempotencyKey, timeoutMs: 15000 });
        }));
      } catch (error) {
        if (!transportStarted) throw error;
        const status = error?.details?.status;
        rejected = Number.isInteger(status) && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
      }
      const accepted = receipt?.provider === "resend" && receipt?.sent === true && typeof receipt.providerMessageId === "string" && receipt.providerMessageId.length > 0;
      providerResult = { ...prepared, state: accepted ? "provider_accepted" : rejected ? "provider_rejected" : "provider_unclear",
        reason: accepted ? "Mailudbyderen accepterede mailen. Levering og indbakkemodtagelse er ikke bevist." : rejected ? "Mailudbyderen afviste mailen. Ingen automatisk genafsendelse." : "Mailudbyderens accept er uafklaret. Må ikke genafsendes automatisk.",
        mail_attempted: true, provider_id: accepted ? receipt.providerMessageId : null, idempotency_key: idempotencyKey };
      await finish(providerResult);
    }, clock, { mailRunId: runId });
  } catch (error) {
    // An existing durable attempt may have reached the provider even if persistence failed.
    const existing = await repository.get(context, runId);
    if (!existing?.result) await finish(providerResult || { ...(prepared || {}), state: transportStarted ? "provider_unclear" : existing?.attempt || error.message === "approval_control_control_changed" ? "blocked" : "failed", reason: transportStarted ? "Et afsendelseskrav findes uden sikkert afslutningsresultat. Ingen automatisk genafsendelse." : failure(error), mail_attempted: transportStarted, provider_id: null });
  }
  return repository.get(context, runId);
}

function visible(run, current, first) {
  if (!run || !first || run.activation_id !== first.id || run.coverage_from !== first.coverage_from) return null;
  const ids = new Set(current.projects.map(project => project.project_id));
  const result = run.result || run.attempt || {};
  const pending = (result.pending || []).filter(row => ids.has(row.project_id) && row.date >= first.coverage_from);
  const unknown = (result.unknown || []).filter(row => ids.has(row.project_id) && !(logic.validDay(row.date) && row.date < first.coverage_from));
  return { id: run.id, started_at: run.started_at, scheduled_at: run.scheduled_at, local_date: run.local_date, mode: run.mode,
    coverage_from: run.coverage_from, activation_id: first.id, activated_at: first.activated_at,
    state: run.result?.state || (run.attempt ? "provider_unclear" : "running"),
    reason: run.result?.reason || (run.attempt ? "Afsendelseskrav uden sikkert resultat. Må ikke genafsendes automatisk." : "Kontrollen er startet uden afsluttet resultat."),
    provider_id: result.provider_id || null, mail_attempted: run.result ? result.mail_attempted === true : run.attempt ? null : false,
    counts: { ...emptyCounts(), open_rows: pending.length, projects: new Set(pending.map(row => row.project_id)).size, hours: Math.round(pending.reduce((n, row) => n + row.hours, 0) * 100) / 100, oldest_date: pending.length ? pending.map(row => row.date).sort()[0] : null },
    pending, unknown, future_excluded: (result.future_excluded_rows || []).filter(row => ids.has(row.project_id)).length };
}

async function status(context, now = new Date()) {
  const current = await selected(context), first = await activation.get(context), state = await control.get(context), settings = policy.read(process.env, now, first, state);
  try {
    const attached = require("./approvalControl.scheduler").isAttached();
    return { ...settings, control_status: !state.revision && !first ? "inactive" : state.enabled ? "active" : "paused",
      control_revision: state.revision, next_scheduled_at: settings.scheduler_enabled && settings.activation_valid ? policy.next(now, settings) : null,
      next_is_active: settings.scheduler_enabled && settings.mail_enabled && settings.activation_valid && attached,
      scheduler_attached: attached, latest: settings.activation_valid ? visible(await repository.latest(context), current, first) : null };
  } catch (error) {
    if (error.code !== "42703" && error.code !== "42P01") throw error;
    throw createHttpError(503, "approval_control_mail_audit_unavailable");
  }
}

async function getRun(context, runId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) throw createHttpError(400, "approval_control_run_invalid");
  const current = await selected(context), first = await activation.get(context), run = first ? await repository.get(context, runId) : null;
  const result = visible(run, current, first);
  if (!result) throw createHttpError(404, "approval_control_run_not_found");
  return result;
}

async function activateScheduler(context, input = {}) {
  return control.change(context, input);
}

module.exports = { runDue, summarize, status, getRun, visible, activateScheduler };
