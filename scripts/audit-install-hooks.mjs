#!/usr/bin/env node
/**
 * Enumerate every package in node_modules that declares a non-trivial
 * preinstall / install / postinstall script, and diff the list against
 * a checked-in allowlist at .supply-chain/install-hooks.allowlist.
 *
 * New names in the tree but not in the allowlist = fail. Names in the
 * allowlist but not in the tree = fail (drift — allowlist is stale).
 *
 * Use `--update` to regenerate the allowlist from the current tree.
 * Run after any dependency change:
 *   yarn install
 *   yarn audit:install-hooks:update
 *   git add .supply-chain/install-hooks.allowlist
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Paths are anchored to the current working directory, not a CLI argument.
// yarn scripts always run from the workspace root, which is what we want.
// Taking a root path from argv would let it flow into readFileSync /
// writeFileSync as an unvalidated path (a path-traversal sink flagged by
// static analysis). The only CLI option the script accepts is `--update`,
// matched as a literal string below — it is never used as a file path.
const ROOT = resolve('.');
const ALLOWLIST_PATH = resolve(ROOT, '.supply-chain/install-hooks.allowlist');
const NODE_MODULES = resolve(ROOT, 'node_modules');
const UPDATE = process.argv.includes('--update');

const HOOK_KEYS = ['preinstall', 'install', 'postinstall'];

// Defence-in-depth: bound recursion into nested node_modules in case
// a pathological tree (symlink loop, malicious self-containment) exists.
// Real hoisted trees never exceed single-digit depth.
const MAX_DEPTH = 20;

// Hook commands we treat as trivial (no-op / log only). Everything else
// counts as "carries an install hook".
//
// The echo pattern uses a negative lookahead to reject any shell metachar
// that could chain a real command (e.g. `echo "ok" && node install.js`,
// `echo $(curl …)`). Without this, an attacker prefixing `echo ` would slip
// past the trivial filter. \n and \r are included because package.json
// `scripts` strings can contain literal newlines after JSON decoding, and
// `echo ok\nrm -rf /` would otherwise be classified as trivial.
const TRIVIAL = [
  /^(?!.*[&|;`$()<>\n\r])echo(\s|$)/,
  /^true$/,
  /^:$/,
  /^exit\s+0$/,
];

function isTrivial(cmd) {
  if (!cmd || typeof cmd !== 'string') return true;
  const t = cmd.trim();
  if (!t) return true;
  return TRIVIAL.some((r) => r.test(t));
}

/**
 * Recursively walk node_modules, yielding every package.json path.
 * Symlinked entries are skipped (Dirent.isDirectory() is false on a symlink) —
 * Yarn 1.x's hoisted node_modules layout doesn't normally use symlinks for
 * resolution, so this is fine for the registry-published-malicious-package
 * threat model. If a workflow change ever introduces symlinked deps (e.g.
 * yarn workspaces, monorepo tooling), this needs to follow symlinks via
 * realpathSync with cycle detection.
 */
function* walkPackageJsons(dir, depth = 0) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = join(dir, entry.name);
    // Scoped packages: recurse into @scope/ to find @scope/pkg/package.json
    if (entry.name.startsWith('@')) {
      yield* walkPackageJsons(full, depth + 1);
      continue;
    }
    const pkgJson = join(full, 'package.json');
    if (existsSync(pkgJson)) {
      try {
        if (statSync(pkgJson).isFile()) yield pkgJson;
      } catch {
        // stat may race with a parallel mutation of node_modules; skip.
      }
    }
    // Recurse into nested node_modules (hoisting-related)
    const nested = join(full, 'node_modules');
    if (existsSync(nested)) yield* walkPackageJsons(nested, depth + 1);
  }
}

function collectHooks() {
  if (!existsSync(NODE_MODULES)) {
    console.error(`node_modules not found at ${NODE_MODULES} — run \`yarn install\` first.`);
    process.exit(2);
  }
  const found = new Map(); // name -> Set of "hook:cmd"
  for (const path of walkPackageJsons(NODE_MODULES)) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    if (!pkg.name || !pkg.scripts) continue;
    for (const hook of HOOK_KEYS) {
      const cmd = pkg.scripts[hook];
      if (!cmd || isTrivial(cmd)) continue;
      if (!found.has(pkg.name)) found.set(pkg.name, new Set());
      found.get(pkg.name).add(`${hook}: ${cmd.replace(/\s+/g, ' ').trim()}`);
    }
  }
  return found;
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return new Map();
  const raw = readFileSync(ALLOWLIST_PATH, 'utf8');
  const entries = new Map(); // name -> Set of "hook: cmd"
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Format is "name  # hook: cmd | hook: cmd". The hook portion is
    // load-bearing — it's what we compare against to detect a script
    // mutation in an already-allowlisted package. A name without a hook
    // suffix is treated as "no hooks recorded" (would only match a
    // package that has lost all its install scripts, which itself is
    // drift worth flagging via `--update`).
    const m = trimmed.match(/^(\S+)\s*(?:#\s*(.*))?$/);
    if (!m) continue;
    const name = m[1];
    const hooksRaw = (m[2] || '').trim();
    // Split on ` | ` only when the next chunk begins with a known hook
    // keyword. A bare ` | ` regex would mis-split commands containing
    // `||` (shell OR) — sharp's install script is the canonical case.
    const HOOK_SPLIT = /\s*\|\s+(?=(?:preinstall|install|postinstall):\s)/;
    const hooks = new Set(
      hooksRaw ? hooksRaw.split(HOOK_SPLIT).filter(Boolean) : [],
    );
    entries.set(name, hooks);
  }
  return entries;
}

function writeAllowlist(hooks) {
  const names = [...hooks.keys()].sort();
  const lines = [
    '# .supply-chain/install-hooks.allowlist',
    '#',
    '# Every package in node_modules that declares a non-trivial',
    '# preinstall / install / postinstall script. Regenerate with',
    '# `yarn audit:install-hooks:update` after any dependency change.',
    '# CI runs the same script without --update',
    '# and fails if this file drifts from the tree.',
    '#',
    '# Both the package name AND its recorded hook commands are gated:',
    '# changing a script in an already-listed package fails CI until',
    '# the allowlist is regenerated and the diff reviewed.',
    '',
  ];
  for (const name of names) {
    const hookLines = [...hooks.get(name)].sort();
    lines.push(`${name}  # ${hookLines.join(' | ')}`);
  }
  writeFileSync(ALLOWLIST_PATH, lines.join('\n') + '\n');
}

const found = collectHooks();

if (UPDATE) {
  writeAllowlist(found);
  console.log(`Wrote ${found.size} entries to ${ALLOWLIST_PATH}.`);
  process.exit(0);
}

const allowed = loadAllowlist();           // Map<name, Set<"hook: cmd">>
const foundNames = new Set(found.keys());
const allowedNames = new Set(allowed.keys());
const unexpected = [...foundNames].filter((n) => !allowedNames.has(n)).sort();
const missing = [...allowedNames].filter((n) => !foundNames.has(n)).sort();

// For names in both, verify the hook commands themselves haven't mutated.
// An already-allowlisted package whose `postinstall` flips from a benign
// prebuilt-binary download to `curl … | sh` is the precise attack this
// gate is meant to catch.
const changed = [];
function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
for (const name of foundNames) {
  if (!allowedNames.has(name)) continue;
  const allowedHooks = allowed.get(name);
  const foundHooks = found.get(name);
  if (!setsEqual(allowedHooks, foundHooks)) {
    changed.push({ name, was: [...allowedHooks].sort(), now: [...foundHooks].sort() });
  }
}

if (unexpected.length === 0 && missing.length === 0 && changed.length === 0) {
  console.log(`install-hooks: OK (${foundNames.size} allowlisted).`);
  process.exit(0);
}

if (unexpected.length > 0) {
  console.error('::error::install-hook audit found NEW packages with install hooks not in the allowlist:');
  for (const name of unexpected) {
    console.error(`  + ${name}`);
    for (const hook of found.get(name)) console.error(`      ${hook}`);
  }
  console.error('');
  console.error('Review the hook. If it is legitimate, add the package to');
  console.error('.supply-chain/install-hooks.allowlist (run: yarn audit:install-hooks:update).');
}

if (missing.length > 0) {
  console.error('::error::install-hook allowlist has entries no longer in the tree (drift):');
  for (const name of missing) console.error(`  - ${name}`);
  console.error('');
  console.error('Remove the stale entries (run: yarn audit:install-hooks:update).');
}

if (changed.length > 0) {
  console.error('::error::install-hook script CHANGED for an already-allowlisted package:');
  for (const { name, was, now } of changed) {
    console.error(`  ~ ${name}`);
    console.error('      was:');
    for (const h of was) console.error(`        ${h}`);
    console.error('      now:');
    for (const h of now) console.error(`        ${h}`);
  }
  console.error('');
  console.error('A package update has changed an install script. Inspect the new');
  console.error('command(s) carefully — this is the typical shape of a supply-chain');
  console.error('compromise. If the change is legitimate, refresh the allowlist:');
  console.error('  yarn audit:install-hooks:update');
}

process.exit(1);
