#!/usr/bin/env node
'use strict';

const { parseArgs, resolveInputFiles, relativePath, readUtf8, lineAndColumnAt } = require('./lib/file-utils');

const args = parseArgs(process.argv.slice(2));
const files = resolveInputFiles({ paths: args.paths, all: true, filterText: true });
const badCodepoints = new Map([
  [0xfffd, 'replacement character'],
  [0x00c3, 'mojibake marker U+00C3'],
  [0x00c2, 'mojibake marker U+00C2'],
  [0x00e2, 'mojibake marker U+00E2'],
  [0x00ef, 'mojibake marker U+00EF'],
]);
const findings = [];

for (const file of files) {
  const text = readUtf8(file);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.codePointAt(i);
    if (badCodepoints.has(code)) {
      const pos = lineAndColumnAt(text, i);
      findings.push(`${relativePath(file)}:${pos.line}:${pos.column} ${badCodepoints.get(code)}`);
      break;
    }
  }
}

if (findings.length) {
  console.error('Encoding: FAIL');
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}
console.log(`Encoding: pass (${files.length} files)`);