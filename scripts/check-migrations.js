#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { repoRoot } = require('./lib/file-utils');

const explicitPathIndex = process.argv.indexOf('--path');
const isExplicitPath = explicitPathIndex >= 0;
const dir = isExplicitPath
  ? path.resolve(repoRoot, process.argv[explicitPathIndex + 1] || '')
  : path.join(repoRoot, 'migrations');
const legacyDuplicateAllowlist = new Map([
  ['0002', new Set(['0002_onboarding_v1.sql', '0002_username_login.sql'])],
]);
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort() : [];
const numberToFiles = new Map();
const findings = [];

function gitBlobBytes(relPath) {
  const exists = spawnSync('git', ['cat-file', '-e', `:${relPath}`], { cwd: repoRoot, windowsHide: true });
  if (exists.status !== 0) return null;
  const show = spawnSync('git', ['show', `:${relPath}`], { cwd: repoRoot, encoding: 'buffer', windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  if (show.status !== 0) return null;
  return show.stdout;
}

for (const name of files) {
  const match = name.match(/^(\d{4})_[a-z0-9][a-z0-9_]*\.sql$/);
  if (!match) findings.push(`${name}: filename must match 0000_lower_snake_case.sql`);
  const number = match ? match[1] : name.slice(0, 4);
  if (!numberToFiles.has(number)) numberToFiles.set(number, []);
  numberToFiles.get(number).push(name);

  const full = path.join(dir, name);
  const rel = path.relative(repoRoot, full).replace(/\\/g, '/');
  const bytes = !isExplicitPath && rel.startsWith('migrations/') ? (gitBlobBytes(rel) || fs.readFileSync(full)) : fs.readFileSync(full);
  if (bytes.includes(0x00)) findings.push(`${name}: contains NUL byte`);
  const text = bytes.toString('utf8');
  if (text.includes('\r\n')) findings.push(`${name}: CRLF line endings; migrations must be LF in git`);
  if (text.charCodeAt(0) === 0xfeff) findings.push(`${name}: UTF-8 BOM is not allowed`);
}

for (const [number, names] of numberToFiles.entries()) {
  if (names.length <= 1) continue;
  const allowed = legacyDuplicateAllowlist.get(number);
  const isAllowedLegacy = allowed && names.length === allowed.size && names.every((name) => allowed.has(name));
  if (!isAllowedLegacy) findings.push(`${number}: duplicate migration number (${names.join(', ')})`);
}

if (findings.length) {
  console.error('Migrations: FAIL');
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}
console.log(`Migrations: pass (${files.length} files, legacy duplicate 0002 accepted)`);