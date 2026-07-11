'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const textExtensions = new Set([
  '.cjs', '.css', '.env', '.example', '.gitattributes', '.gitignore', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.sh', '.sql', '.txt', '.yml', '.yaml',
]);
const binaryExtensions = new Set([
  '.avif', '.bin', '.bmp', '.db', '.gif', '.ico', '.jpeg', '.jpg', '.pdf', '.png', '.pfx', '.p12', '.sqlite', '.webp', '.zip', '.gz', '.tgz',
]);
const ignoredPathParts = new Set(['.git', 'node_modules', '.tmp', '__pycache__']);
const ignoredPathFragments = [
  `${path.sep}audit (read only)${path.sep}`,
  `${path.sep}backend${path.sep}src${path.sep}public${path.sep}tenant${path.sep}vendor${path.sep}`,
];

function toPosix(value) {
  return String(value).replace(/\\/g, '/');
}

function relativePath(file) {
  return toPosix(path.relative(repoRoot, file));
}

function isIgnoredPath(file) {
  const resolved = path.resolve(file);
  const parts = resolved.split(path.sep);
  if (parts.some((part) => ignoredPathParts.has(part))) return true;
  return ignoredPathFragments.some((fragment) => resolved.includes(fragment));
}

function isLikelyTextFile(file) {
  if (isIgnoredPath(file)) return false;
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file).toLowerCase();
  if (binaryExtensions.has(ext)) return false;
  if (base === '_poll_output.txt') return false;
  if (textExtensions.has(ext)) return true;
  if (base === 'dockerfile' || base === 'procfile' || base === 'license') return true;
  return false;
}

function parseArgs(argv) {
  const args = { paths: [], all: false, staged: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--all') args.all = true;
    else if (token === '--staged') args.staged = true;
    else if (token === '--path' || token === '--paths') {
      const value = argv[i + 1];
      if (!value) throw new Error(`Missing value for ${token}`);
      i += 1;
      args.paths.push(...value.split(',').filter(Boolean));
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || '').trim() || `git ${args.join(' ')} failed`;
    throw new Error(message);
  }
  return result.stdout || '';
}

function listGitFiles({ staged = false } = {}) {
  const output = staged
    ? runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    : runGit(['ls-files']);
  return output.split(/\r?\n/)
    .filter(Boolean)
    .map((file) => path.resolve(repoRoot, file))
    .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile());
}

function resolveInputFiles({ paths = [], staged = false, all = true, filterText = false } = {}) {
  let files = [];
  if (paths.length) {
    for (const input of paths) {
      const full = path.resolve(repoRoot, input);
      if (!fs.existsSync(full)) continue;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        files.push(...walk(full));
      } else if (stat.isFile()) {
        files.push(full);
      }
    }
  } else {
    files = listGitFiles({ staged: staged && !all });
  }

  const unique = Array.from(new Set(files.map((file) => path.resolve(file))));
  return filterText ? unique.filter(isLikelyTextFile) : unique.filter((file) => !isIgnoredPath(file));
}

function walk(dir) {
  const out = [];
  if (isIgnoredPath(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (isIgnoredPath(full)) continue;
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function readUtf8(file) {
  return fs.readFileSync(file, 'utf8');
}

function lineAndColumnAt(text, index) {
  const before = text.slice(0, index);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

module.exports = {
  repoRoot,
  relativePath,
  parseArgs,
  runGit,
  resolveInputFiles,
  readUtf8,
  lineAndColumnAt,
  isLikelyTextFile,
};