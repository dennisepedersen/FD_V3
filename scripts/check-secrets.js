#!/usr/bin/env node
'use strict';

const { parseArgs, resolveInputFiles, relativePath, readUtf8 } = require('./lib/file-utils');
const { rules, shouldSkipFinding } = require('./lib/secret-rules');

const args = parseArgs(process.argv.slice(2));
const scanAll = args.all || !args.staged;
const files = resolveInputFiles({ paths: args.paths, all: scanAll, staged: args.staged, filterText: true });
const findings = [];

for (const file of files) {
  const rel = relativePath(file);
  const lines = readUtf8(file).split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of rules) {
      const match = line.match(rule.regex);
      if (!match) continue;
      if (shouldSkipFinding({ file: rel, line, rule, match })) continue;
      findings.push({ rule: rule.id, file: rel, line: index + 1 });
    }
  });
}

if (findings.length) {
  console.error('Secrets: FAIL potential secret patterns detected (content masked)');
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  findings.forEach((finding) => console.error(`- ${finding.rule} at ${finding.file}:${finding.line} [REDACTED]`));
  process.exit(1);
}
console.log(`Secrets: pass (${files.length} files)`);