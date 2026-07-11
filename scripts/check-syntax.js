#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, resolveInputFiles, relativePath, repoRoot } = require('./lib/file-utils');

const args = parseArgs(process.argv.slice(2));
const files = resolveInputFiles({ paths: args.paths, all: true })
  .filter((file) => ['.js', '.mjs', '.cjs'].includes(path.extname(file).toLowerCase()))
  .filter((file) => !/\.min\.js$/i.test(file));

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    failed = true;
    console.error(`Syntax: FAIL ${relativePath(file)}`);
    process.stderr.write(result.stderr || result.stdout || 'node --check failed\n');
  }
}

if (failed) process.exit(1);
console.log(`Syntax: pass (${files.length} files)`);