#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const { repoRoot } = require('./lib/file-utils');

function run(label, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    console.error(`Whitespace: FAIL (${label})`);
    process.stderr.write(result.stdout || result.stderr || 'git diff --check failed\n');
    process.exit(result.status || 1);
  }
}

run('working tree', ['diff', '--check']);
run('staged', ['diff', '--cached', '--check']);
console.log('Whitespace: pass');