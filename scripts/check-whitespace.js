#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const { repoRoot } = require('./lib/file-utils');

function runGit(label, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    console.error(`Whitespace: FAIL (${label})`);
    process.stderr.write(result.stdout || result.stderr || `git ${args.join(' ')} failed\n`);
    process.exit(result.status || 1);
  }
  if (result.stdout) process.stdout.write(result.stdout);
}

function gitRefExists(ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    cwd: repoRoot,
    stdio: 'ignore',
    windowsHide: true,
  });
  return result.status === 0;
}

function resolveMode(env) {
  const explicitBase = env.CHECK_BASE_SHA || env.GITHUB_BASE_SHA || '';
  const explicitHead = env.CHECK_HEAD_SHA || env.GITHUB_HEAD_SHA || '';
  if (explicitBase && explicitHead) {
    return { mode: 'ci-pr-diff', base: explicitBase, head: explicitHead };
  }

  if (env.GITHUB_EVENT_NAME === 'pull_request' && env.GITHUB_BASE_REF && env.GITHUB_SHA) {
    const baseRef = `origin/${env.GITHUB_BASE_REF}`;
    if (gitRefExists(baseRef)) {
      return { mode: 'ci-pr-diff', base: baseRef, head: env.GITHUB_SHA };
    }
    console.warn(`Whitespace: clean fallback (base ref ${baseRef} unavailable)`);
    return { mode: 'clean-fallback' };
  }

  return { mode: 'local-working-tree' };
}

const mode = resolveMode(process.env);

if (mode.mode === 'ci-pr-diff') {
  console.log(`Whitespace: mode=CI PR diff base=${mode.base} head=${mode.head}`);
  runGit('PR diff', ['diff', '--check', `${mode.base}...${mode.head}`]);
  console.log('Whitespace: pass');
} else if (mode.mode === 'local-working-tree') {
  console.log('Whitespace: mode=local working tree');
  runGit('working tree', ['diff', '--check']);
  runGit('staged', ['diff', '--cached', '--check']);
  console.log('Whitespace: pass');
} else {
  console.log('Whitespace: mode=clean fallback');
  runGit('working tree', ['diff', '--check']);
  runGit('staged', ['diff', '--cached', '--check']);
  console.log('Whitespace: pass');
}
