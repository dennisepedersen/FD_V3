#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const { repoRoot } = require('./lib/file-utils');

const steps = [
  ['Syntax', ['node', ['scripts/check-syntax.js']]],
  ['Whitespace', ['node', ['scripts/check-whitespace.js']]],
  ['Encoding', ['node', ['scripts/check-encoding.js']]],
  ['Secrets', ['node', ['scripts/check-secrets.js', '--all']]],
  ['Migrations', ['node', ['scripts/check-migrations.js']]],
  ['Tests', ['npm', ['test']]],
  ['Static assertions', ['node', ['scripts/check-static.js']]],
];

for (const [label, [command, args]] of steps) {
  console.log(`${label}: start`);
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true });
  if (result.status !== 0) {
    console.error(`${label}: FAIL`);
    process.exit(result.status || 1);
  }
  console.log(`${label}: pass`);
}

console.log('Check: pass');