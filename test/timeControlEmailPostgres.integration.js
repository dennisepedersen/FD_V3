"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

test("Timekontrol email migration corrects system text while preserving overrides, queues and reports", {
  skip: process.env.FIELD_DESK_LOCAL_PG_TEST !== "1", timeout: 120000,
}, async t => {
  const url = new URL(process.env.FIELDDESK_TIME_CONTROL_TEST_DATABASE_URL || "postgres://example.invalid/blocked");
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55432");
  assert.equal(url.username, "tc_validation");
  assert.equal(url.password, "");
  assert.match(url.pathname, /^\/fielddesk_tc_validation_upgrade_[a-f0-9]{24}$/);
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  const { Client } = require("../backend/node_modules/pg");
  const admin = new Client({ connectionString: url.toString(), ssl: false });
  await admin.connect();
  const database = "fielddesk_tc_validation_upgrade_" + randomUUID().replaceAll("-", "").slice(0, 24);
  try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.end(); }
  url.pathname = "/" + database;
  const client = new Client({ connectionString: url.toString(), ssl: false });
  await client.connect();
  t.after(() => client.end());
  const previous = { DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET, ROOT_DOMAIN: process.env.ROOT_DOMAIN };
  const ephemeralSigningKey = randomUUID();
  const connectionString = url.toString();
  Object.assign(process.env, { DATABASE_URL: connectionString, NODE_ENV: "test", JWT_SECRET: ephemeralSigningKey, ROOT_DOMAIN: "example.test" });
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  t.mock.method(global, "fetch", async () => { assert.fail("No external calls permitted"); });
  const runner = require("../backend/scripts/db_migrate");
  const files = runner.getMigrationFiles();
  await runner.ensureMigrationTable(client);
  await runner.runPendingMigrations(client, files.filter(f => f.filename < "0061_"), new Map());
  const tenantId = randomUUID();
  await client.query("INSERT INTO tenant(id,slug,name,status) VALUES($1,'mail-fixture','Mail fixture','active')", [tenantId]);
  await client.query(`INSERT INTO email_template(tenant_id,template_key,locale,version,subject_template,html_template,text_template,allowed_variables_json)
    SELECT $1,template_key,locale,version,subject_template,html_template,text_template,allowed_variables_json
    FROM email_template WHERE tenant_id IS NULL AND template_key='time_control.missing_hours.employee' AND is_active`, [tenantId]);
  await client.query(`INSERT INTO email_outbox(tenant_id,template_id,template_key,recipient_email,subject,html_body,text_body,status,sent_at,idempotency_key,source_type,source_id)
    SELECT $1,id,template_key,'fixture@example.test','Historic','<p>Bemaerk</p>','Bemaerk','sent',now(),'historic-mail','time_control',$1
    FROM email_template WHERE tenant_id IS NULL AND template_key='time_control.missing_hours.employee' AND is_active`, [tenantId]);
  await client.query(`INSERT INTO time_control_status_report(tenant_id,report_date,message_json,idempotency_key,expires_at)
    VALUES($1,'2026-10-14','{"text":"Historic"}','historic-report',now()+interval '1 day')`, [tenantId]);
  const preserved = async () => ({
    overrides: (await client.query("SELECT * FROM email_template WHERE tenant_id=$1 ORDER BY id", [tenantId])).rows,
    others: (await client.query("SELECT * FROM email_template WHERE template_key NOT LIKE 'time_control.%' ORDER BY id")).rows,
    outbox: (await client.query("SELECT * FROM email_outbox WHERE tenant_id=$1 ORDER BY id", [tenantId])).rows,
    reports: (await client.query("SELECT * FROM time_control_status_report WHERE tenant_id=$1 ORDER BY id", [tenantId])).rows,
  });
  const before = await preserved();
  const sql = fs.readFileSync("migrations/0061_time_control_email_danish.sql", "utf8");
  await client.query(sql);
  assert.deepEqual(await preserved(), before);
  const templates = (await client.query("SELECT * FROM email_template WHERE tenant_id IS NULL AND template_key LIKE 'time_control.%' AND is_active ORDER BY template_key")).rows;
  const daily = templates.find(x => x.template_key === "time_control.missing_hours.employee");
  assert.equal(daily.version, 2);
  for (const value of [daily.html_template, daily.text_template]) {
    assert.match(value, /Bemærk, at tillæg ikke tæller/);
    assert.match(value, /sygdomslønarter/);
    assert.match(value, /være/);
    assert.doesNotMatch(value, /Bemaerk|tillaeg|taeller|sygdomsloenarter/);
  }
  assert.ok(daily.text_template.includes("\n\n"));
  assert.ok(!daily.text_template.includes("\\n"));
  const diagnostic = templates.find(x => x.template_key === "time_control.internal_error");
  assert.match(diagnostic.text_template, /Årsag/);
  assert.match(diagnostic.html_template, /Årsag/);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM email_template WHERE tenant_id IS NULL AND version=1 AND NOT is_active AND template_key LIKE 'time_control.%'")).rows[0].n, 3);
  await client.query(sql);
  assert.deepEqual((await client.query("SELECT * FROM email_template WHERE tenant_id IS NULL AND template_key LIKE 'time_control.%' AND is_active ORDER BY template_key")).rows, templates);
  assert.deepEqual(await preserved(), before);
  const rendered = require("../backend/src/modules/notifications/templateRenderer").renderTemplate(daily, {
    subject: "Påmindelse", first_name: "Blåbær Søren", intro: "Påmindelse", required_hours: "7,5", valid_hours: "0,0", missing_hours: "7,5", missing_phrase: "dem",
  });
  const branded = await require("../backend/src/modules/timeControl/timeControl.email").brandTimeControlEmail(client, { tenantId, rendered, rootDomain: "example.test" });
  for (const value of [branded.html, branded.text]) for (const char of ["æ", "ø", "å"]) assert.ok(value.includes(char));
  assert.match(branded.html, /https:\/\/mail-fixture\.example\.test\/tenant\/assets\/FD_logo.png/);
  const output = process.env.FIELDDESK_TC_MAIL_PREVIEW_DIR;
  if (output) {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(output + "/daily.html", branded.html, "utf8");
    fs.writeFileSync(output + "/daily.txt", branded.text, "utf8");
  }
});
