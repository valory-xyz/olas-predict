#!/usr/bin/env node
// Wraps `yarn audit --groups dependencies --json` to:
//   1. Apply a high/critical gate explicitly (Yarn 1.x's --level only filters
//      printed output; the exit code is a severity bitmask, not a threshold).
//   2. Consult .supply-chain/audit-allowlist.json so advisories that are not
//      exploitable in this app's actual code paths can be suppressed with a
//      stated reason and a review date.
//
// Exit codes:
//   0 — no unallowlisted high/critical advisories
//   1 — at least one unallowlisted high/critical advisory; fail the build
//
// IMPORTANT: this script must remain dependency-free (Node built-ins only).
// The CI `audit` job in .github/workflows/main.yml does NOT run
// `yarn install` before invoking it — `yarn audit` reads package.json +
// yarn.lock directly without needing node_modules, and skipping the install
// keeps the audit gate fast (~30s saved per PR). If you need to import a
// non-builtin package here, also add a `yarn install --frozen-lockfile`
// step to the `audit` job, otherwise the gate will pass locally and fail
// in CI.
//
// See SUPPLY-CHAIN-SECURITY.md §5.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const allowlistPath = resolve(repoRoot, '.supply-chain/audit-allowlist.json');

const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const log = (msg) => process.stdout.write(msg + '\n');
// Both warn and err route to stderr so CI log readers see them in the same
// stream, and so a caller redirecting stdout doesn't lose diagnostics.
const warn = (msg) => process.stderr.write((isCI ? '::warning::' : 'WARNING: ') + msg + '\n');
const err = (msg) => process.stderr.write((isCI ? '::error::' : 'ERROR: ') + msg + '\n');

let allowlist = { allowlist: [] };
try {
  allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));
} catch (e) {
  warn(`Could not read allowlist at ${allowlistPath}: ${e.message}. Continuing with empty allowlist.`);
}
const allowedIds = new Map();
let allowlistInvalid = false;
for (const entry of allowlist.allowlist || []) {
  // Coerce to Number so an entry written as "id": "1234" still matches the
  // numeric IDs from yarn audit. A silent miss here would mean the
  // allowlist suppression doesn't apply and the advisory fails the gate
  // for the wrong reason — surface the problem loudly instead.
  if (entry == null || entry.id == null) {
    err(`Allowlist entry is missing an "id" field: ${JSON.stringify(entry)}`);
    allowlistInvalid = true;
    continue;
  }
  const id = Number(entry.id);
  if (!Number.isInteger(id) || id <= 0) {
    err(`Allowlist entry has a non-integer "id": ${JSON.stringify(entry.id)} (must be a positive integer)`);
    allowlistInvalid = true;
    continue;
  }
  allowedIds.set(id, { ...entry, id });
}
if (allowlistInvalid) {
  process.exit(1);
}

const result = spawnSync('yarn', ['audit', '--groups', 'dependencies', '--json'], {
  cwd: repoRoot,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 64 * 1024 * 1024,
});

if (result.error) {
  err(`Failed to spawn yarn audit: ${result.error.message}`);
  process.exit(1);
}

const lines = (result.stdout || '').split(/\r?\n/).filter(Boolean);
const advisories = new Map();
let summarySeen = false;
for (const line of lines) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    continue;
  }
  if (parsed.type === 'auditAdvisory' && parsed.data && parsed.data.advisory) {
    const a = parsed.data.advisory;
    if (!advisories.has(a.id)) advisories.set(a.id, a);
  } else if (parsed.type === 'auditSummary') {
    summarySeen = true;
  }
}

// Fail closed on suspected truncation / network error / malformed yarn
// output. A clean audit emits an `auditSummary` event even when the tree
// is empty; an audit with findings emits one or more `auditAdvisory`
// events. Seeing neither means something went wrong upstream (registry
// 5xx, malformed manifest, killed process) and we must not pass the
// gate on a silent zero.
if (!summarySeen && advisories.size === 0) {
  err(
    `yarn audit produced no parseable advisory or summary events ` +
      `(stdout had ${lines.length} non-empty line(s); exit code ${result.status}). ` +
      `Refusing to pass the gate on empty output — likely a registry / network failure.`,
  );
  if (result.stderr && result.stderr.trim()) {
    err(`yarn audit stderr (truncated to 1k): ${result.stderr.trim().slice(0, 1024)}`);
  }
  process.exit(1);
}

const highOrCritical = [...advisories.values()].filter(
  (a) => a.severity === 'high' || a.severity === 'critical',
);

const unallowlisted = [];
const allowlistedSeen = new Set();
const today = new Date().toISOString().slice(0, 10);

for (const a of highOrCritical) {
  // Same normalization as on the allowlist side — defensive in case yarn
  // ever serializes advisory IDs as strings.
  const aid = Number(a.id);
  const entry = allowedIds.get(aid);
  if (entry) {
    allowlistedSeen.add(aid);
    if (entry.review && entry.review < today) {
      warn(
        `Allowlisted advisory #${a.id} (${a.module_name}) is past its review date ${entry.review}. ` +
          `Re-evaluate: ${entry.reason || '(no reason recorded)'}`,
      );
    }
  } else {
    unallowlisted.push(a);
  }
}

// Surface allowlist entries that no longer match anything in the audit (drift).
for (const [id, entry] of allowedIds) {
  if (!allowlistedSeen.has(id)) {
    warn(
      `Allowlist entry #${id} (${entry.module || '?'}) did not match any current advisory. ` +
        `Likely the advisory was cleared by a dependency bump — remove the entry from .supply-chain/audit-allowlist.json.`,
    );
  }
}

log('');
log(`yarn audit summary: ${highOrCritical.length} high/critical advisory(ies) found.`);
log(`Allowlisted: ${allowlistedSeen.size}`);
log(`Unallowlisted: ${unallowlisted.length}`);

if (unallowlisted.length > 0) {
  log('');
  log('Unallowlisted high/critical advisories:');
  for (const a of unallowlisted) {
    log(`  #${a.id} [${a.severity}] ${a.module_name} — ${a.title}`);
    log(`    vulnerable: ${a.vulnerable_versions}    patched: ${a.patched_versions}`);
    log(`    https://www.npmjs.com/advisories/${a.id}`);
  }
  err(
    `${unallowlisted.length} unallowlisted high/critical advisory(ies) in the production tree. ` +
      `Bump the affected dependency or add an exact-pinned Yarn resolution per SUPPLY-CHAIN-SECURITY.md §1, ` +
      `or — only if the advisory is not exploitable in this app's code paths — add an entry to ` +
      `.supply-chain/audit-allowlist.json with a stated reason and a review date.`,
  );
  process.exit(1);
}

log('');
log('No unallowlisted high/critical advisories. Audit gate passes.');
process.exit(0);
