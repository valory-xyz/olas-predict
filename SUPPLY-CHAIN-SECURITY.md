# Supply Chain Security

This document describes how `olas-predict-app` protects itself against npm supply chain attacks — specifically, the scenario where a dependency (direct or transitive) is compromised and a malicious version is published.

It complements [`SECURITY.md`](./SECURITY.md), which covers reporting vulnerabilities in our own code.

## Threat model

The attacks we care about:

1. **Malicious publish** — a maintainer account is compromised (or a maintainer goes rogue) and a bad version of a legitimate package is published. Recent examples: `ua-parser-js` (2021), `node-ipc` protestware (2022), various `@ctrl/*` / `rspack`-related worms (2024–2025), the `shai-hulud` npm worm (2025).
2. **Typosquatting / dependency confusion** — a look-alike name is installed instead of the intended package.
3. **Postinstall script abuse** — a compromised package runs arbitrary code during `yarn install`, exfiltrating env vars or tokens from the build environment. Higher impact than on a static marketing site because this app reads `BLOB_READ_WRITE_TOKEN` from a server-side runtime path (see [§7](#7-secrets-hygiene-in-the-build-environment)).
4. **Transitive compromise** — a deep, rarely-audited dependency is the attack vector. The `wagmi` + `viem` + Next.js + AntD tree is large.

## Policies

### 1. Exact version pinning in `package.json`

All direct dependencies in [`package.json`](./package.json) are pinned to **exact versions** — no `^`, no `~`, no `>=`, no floating major.

**Why:** `^` allows minor and patch updates; `~` allows patch updates. If a compromised patch is published and someone runs `yarn add <other-pkg>` or `yarn install` without a lockfile, the bad version can enter the tree silently. Exact pins make every version change an explicit, reviewable `package.json` diff.

**How to update a dependency:** bump the exact version in `package.json`, run `yarn install`, review the `yarn.lock` diff, and commit both files in the same PR. Never run `yarn upgrade` without pinning the result.

**Note on initial pinning sweep.** When this policy was first introduced, every direct dependency's spec changed from a caret range (e.g. `"^6.0.7"`) to an exact pin. Several were pinned to the version that was already resolved in `yarn.lock` rather than to the floor of the prior caret range — so what *looks* in the diff like a minor bump (e.g. `styled-components` `^6.0.7` → `6.1.8`, `eslint` `^8.56.0` → `8.57.0`) is actually the same code that fresh-install consumers were already getting. No tarballs or integrity hashes shifted in the lockfile for those packages. Going forward, any pin change should be either an explicit, intentional bump or a no-op in the lockfile diff.

**Transitive overrides follow the same rule.** Entries under `"resolutions"` in [`package.json`](./package.json) are a transitive-pinning mechanism, not an escape hatch for ranges. Use `"1.2.3"`, not `"^1.2.3"` or `">=1.2.3"`, so a compromised patch cannot silently enter the tree through an override. When adding a resolution to clear a CVE, reference the advisory in the PR/commit message so future readers understand why the override exists. The current resolutions block exists because the audit sweep (see [§9](#current-gaps--todo)) pinned 13 transitive packages reached deep through the `wagmi → @walletconnect/*` and `wagmi → @metamask/sdk` chains where the upstream consumers haven't yet bumped to the patched lines.

### 2. Single lockfile, treated as source of truth

[`yarn.lock`](./yarn.lock) is the canonical lockfile. The `packageManager` field in [`package.json`](./package.json) pins Yarn `1.22.22`; CI activates that version explicitly via `corepack enable` + `corepack prepare yarn@1.22.22 --activate` at the start of every Node job ([.github/workflows/main.yml](./.github/workflows/main.yml)), so installs don't fall back to whatever Yarn the runner happens to ship with. `package-lock.json` / `pnpm-lock.yaml` are in [`.gitignore`](./.gitignore) so a stray `npm install` / `pnpm install` can't land a second lockfile that conflicts with `yarn.lock`. CI and Vercel ([`vercel.json`](./vercel.json)) both install with `yarn install --frozen-lockfile`, which fails if `package.json` and `yarn.lock` disagree — catching any silent resolution drift at build time.

**Known limitation: no integrity hash on the package-manager binary itself.** Modern Corepack supports `"packageManager": "yarn@1.22.22+sha512:<hash>"` syntax for tamper-detection on the Yarn binary that Corepack downloads. Yarn 1.x's classic distribution predates that scheme, so we pin only the version. The risk is bounded — Corepack downloads from the registry over HTTPS and the registry itself enforces immutability of published versions — but it is a notch below the rest of this doc's policy. A Yarn Berry migration would graduate this; until then it is a documented known limitation.

### 3. Lockfile review in PRs

Any PR that touches `yarn.lock` requires a reviewer to confirm:

- The diff is proportionate to the `package.json` change.
- No unexpected packages appear. Look for unfamiliar names, typos of known packages, or packages with very recent publish dates on high-traffic names.
- Resolved URLs point to the official registry (`registry.yarnpkg.com` / `registry.npmjs.org`), not a fork or mirror. This is also enforced automatically by the `lockfile-lint` job — see [§5](#5-audit-in-ci).

### 4. Cooldown window on updates

Prefer dependency versions that are **at least 7 days old**. Most malicious publishes are caught and unpublished within hours to days.

This is enforced by **manual discipline on every PR** — there is no Renovate or Dependabot bot on this repo. When a PR bumps a dependency, the reviewer checks `npm view <pkg> time` (or the npm page) and confirms the target version is at least 7 days old. If the bump is for a disclosed security advisory, the cooldown does not apply — note the advisory ID in the PR description so the override is auditable.

Vulnerability discovery does not depend on this rule. Already-disclosed CVEs are caught by the `yarn audit` job in [.github/workflows/main.yml](./.github/workflows/main.yml) on every PR (see [§5](#5-audit-in-ci)), and GitHub sends passive Dependabot alerts (Security tab / email) for advisories affecting our lockfile regardless of any repo configuration.

All GitHub Actions used in [.github/workflows/main.yml](./.github/workflows/main.yml) are SHA-pinned: `actions/checkout` and `actions/setup-node` on every Node-using job, plus `actions/checkout` on the gitleaks `scan` job. The gitleaks binary itself is downloaded by URL with `curl -fsSL` and verified against a known SHA-256 (`sha256sum -c`) before install, so a compromised release on the upstream `zricethezav/gitleaks` repo would not silently land in CI. Audit the pins periodically — at minimum once per major release of each action — until a bot with `pinDigests: true` is in place.

### 5. Audit in CI

The `audit` job in [.github/workflows/main.yml](./.github/workflows/main.yml) runs `yarn audit:prod` on every PR. That script ([`scripts/audit.mjs`](./scripts/audit.mjs)) wraps `yarn audit --groups dependencies --json`, applies the high/critical gate explicitly (Yarn 1.x's `--level` only filters the *printed* output — see the "Yarn 1.x audit quirk" note below), and consults [`.supply-chain/audit-allowlist.json`](./.supply-chain/audit-allowlist.json). An unallowlisted high/critical advisory against a production dependency blocks merge — the PR author must either (a) bump the dep, (b) add an exact-pinned Yarn `resolutions` entry per [§1](#1-exact-version-pinning-in-packagejson) with the advisory ID in the PR description, or (c) add the advisory to the allowlist with a stated reason and a review date. Allowlist entries past their `review` date generate a `::warning::` in CI output (surfaced in the Actions UI) but do not fail the job — the warning is how the team is kept honest about re-evaluating suppressions. Allowlist entries that no longer match a current advisory also surface a `::warning::` so cleared entries get pruned.

`--groups dependencies` restricts the audit to the production tree — `devDependencies` (ESLint / Babel / TypeScript / `@graphql-codegen/*` / types) generate substantial transitive-advisory noise and do not ship to users, so they are excluded by policy.

We also run [`lockfile-lint`](https://github.com/lirantal/lockfile-lint) on every PR to enforce that every `resolved` URL in `yarn.lock` points at `registry.yarnpkg.com` or `registry.npmjs.org`, uses HTTPS, and has an integrity hash — automating the registry-origin part of [§3](#3-lockfile-review-in-prs). The tool itself is pinned as a `devDependency` in [`package.json`](./package.json) (currently `5.0.0`) and invoked via the `yarn lint:lockfile` script, so the `lockfile-lint` binary used in CI is integrity-verified against `yarn.lock` rather than re-fetched on every run.

The CI step deliberately runs `yarn audit:prod`, not `yarn audit`. Yarn 1.x ships a built-in `yarn audit` subcommand that takes priority over a same-named entry in `package.json` `scripts`, so naming the wrapper `audit` would silently bypass [`scripts/audit.mjs`](./scripts/audit.mjs) and run the stock command instead — skipping the allowlist and the production-tree filter. The `audit:prod` name makes the collision impossible.

**Yarn 1.x audit quirk.** This repo uses Yarn `1.22.22`. Yarn 1.x `yarn audit` exits with a severity bitmask (`1`=info, `2`=low, `4`=moderate, `8`=high, `16`=critical) rather than a threshold comparison against `--level`, so `--level high` filters the *printed* output but does not affect the exit code. [`scripts/audit.mjs`](./scripts/audit.mjs) sidesteps the bitmask entirely by parsing the JSON output and applying the high/critical gate in JavaScript. Revisit on a future Yarn Berry migration, which ships `yarn npm audit` with proper severity gating.

The audit job is **blocking**: it is included in `all-checks-passed.needs` and runs without `continue-on-error`, so any unallowlisted high or critical advisory that lands in the production tree will fail PRs until it is addressed.

### 6. Avoid postinstall-heavy dependencies

When adding a new dependency, check:

- Does it have a `postinstall` / `preinstall` / `install` script? (`yarn why <pkg>` + inspect its `package.json`)
- If yes, is the script necessary, and is the package well-known?
- Prefer alternatives with no install scripts for new additions.

**Olas-predict-specific watches:**

- [`@vercel/blob`](https://www.npmjs.com/package/@vercel/blob) is what actually reads `BLOB_READ_WRITE_TOKEN` at runtime (see [§7](#7-secrets-hygiene-in-the-build-environment)). A compromised version could exfiltrate the token. Pin tightly and do not skip review on its transitive bumps.
- [`wagmi`](https://www.npmjs.com/package/wagmi), [`viem`](https://www.npmjs.com/package/viem), [`@wagmi/core`](https://www.npmjs.com/package/@wagmi/core) — EVM client libraries. This app uses them **read-only** (`readContract`, `usePublicClient`) — no wallet connectors, no signing — so the blast radius of a compromised version is narrower than in a dapp that signs transactions. It is still a large transitive surface; scrutinize bumps.
- [`graphql-request`](https://www.npmjs.com/package/graphql-request) is on the hot path for every page render (subgraph fetches). A compromised version could redirect requests off our subgraph endpoints.

### 7. Secrets hygiene in the build environment

#### What secrets this app actually uses

The runtime and build environments for `olas-predict-app` hold a deliberately small set of secrets. An auditor should be able to enumerate them exactly:

| Name | Purpose | Scope | Where read |
| --- | --- | --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob read access for cached achievement lookup files | Runtime (server-only, SSR) | Implicitly by `@vercel/blob` SDK — see [`utils/achievements.ts`](./utils/achievements.ts), invoked from `getServerSideProps` in [`pages/[agent]/achievement/index.tsx`](./pages/[agent]/achievement/index.tsx) |

Everything else read by the app is `NEXT_PUBLIC_*` configuration that Next.js inlines into the client bundle:

| Name | Where read |
| --- | --- |
| `NEXT_PUBLIC_SUBGRAPH_API_KEY` | [`constants/index.ts`](./constants/index.ts) — keys for The Graph queries |
| `NEXT_PUBLIC_GNOSIS_URL` | [`constants/wagmiConfig.ts`](./constants/wagmiConfig.ts) — Gnosis Chain RPC |
| `NEXT_PUBLIC_REGISTRY_GRAPH_URL` | [`utils/registry.ts`](./utils/registry.ts) — registry subgraph |
| `NEXT_PUBLIC_PREDICT_POLYMARKET_URL` | [`constants/index.ts`](./constants/index.ts) — Polymarket subgraph |
| `NEXT_PUBLIC_SKIP_LEGACY_ACHIEVEMENTS` | [`utils/achievements.ts`](./utils/achievements.ts) — feature flag |

`NEXT_PUBLIC_*` values are visible to anyone who loads the site. **`NEXT_PUBLIC_SUBGRAPH_API_KEY` and `NEXT_PUBLIC_GNOSIS_URL` are sensitive even though they are public**: the subgraph API key is bundled and can be extracted from the JS, and the RPC URL typically embeds an API key in the URL. Treat them as low-rotation public configuration, but rotate them when an install-time compromise is suspected because a postinstall could exfiltrate them at build time before they ever hit the bundle. The remaining `NEXT_PUBLIC_*` URLs above are non-sensitive endpoint configuration.

#### General hygiene

- No long-lived secrets in CI env vars that a postinstall script could exfiltrate. The GitHub Actions workflow in [.github/workflows/main.yml](./.github/workflows/main.yml) does not export any repo or org secrets to the install step.
- Vercel **build-time** env vars should be limited to what the build actually needs; anything only the running server needs must be marked runtime-only in the Vercel project settings so it is not present when `yarn install` runs. **Audit the current Vercel project to confirm `BLOB_READ_WRITE_TOKEN` is runtime-only, not build-time** — this is the highest-value remaining gap (see [§9](#current-gaps--todo)).
- Vercel deploy tokens, GitHub tokens, and cloud-provider credentials must never be available to the build environment.
- `.npmrc` / `.yarnrc` auth tokens: never committed. [`.gitignore`](./.gitignore) currently protects `.env`, `.env.local`, and `.vercel`.

### 8. Dependency review on every new addition

Before adding a new direct dependency:

- Weekly download count on npm — very low numbers on a "popular-sounding" name is a typosquat red flag.
- GitHub repo exists, is active, has reasonable star count and contributor history.
- Maintainer is the expected one (check publish history: `npm view <pkg> time`).
- No recently transferred ownership unless it's a known, announced transfer.
- For Web3 / wallet libraries (`wagmi`, `viem`, `@wagmi/core`, etc.), additionally confirm the audit status on the project's site and check Socket.dev / Snyk advisories.

## Response playbook: "a dependency we use was just disclosed as compromised"

1. **Identify exposure.** `yarn why <pkg>` — direct or transitive? Which version is in our lockfile? Did it land in any code path that runs server-side (i.e. could it have read `BLOB_READ_WRITE_TOKEN`)?
2. **Check the window.** When was the bad version published vs. when we last ran `yarn install` / deployed? If our lockfile predates the bad version, we are not shipping it in production — but any developer running `yarn install` fresh could pull it locally.
3. **Pin to a safe version.** Edit `package.json` to a known-good version (or add a Yarn `resolutions` entry for transitive deps, following the exact-pinning rule in [§1](#1-exact-version-pinning-in-packagejson)). Commit lockfile.
4. **Rotate every secret the build/runtime could have seen.** If the compromised version ran in any SSR invocation since it was published, rotate `BLOB_READ_WRITE_TOKEN`. If a postinstall script could have run on the build machine, also rotate `NEXT_PUBLIC_SUBGRAPH_API_KEY` and `NEXT_PUBLIC_GNOSIS_URL` (both embed keys), plus any Vercel deploy tokens and any npm/GitHub tokens attached to the build account. See [§7](#7-secrets-hygiene-in-the-build-environment) for the full enumeration.
5. **Redeploy.** Force a fresh build so production no longer serves any code influenced by the bad version.
6. **Post-mortem.** Record the incident: what package, which version, how we detected it, time-to-mitigate, what leaked (if anything).

## Current gaps / TODO

- [x] Pin all direct dependencies in [`package.json`](./package.json) to exact versions.
- [x] Add a `packageManager` field to [`package.json`](./package.json) pinning `yarn@1.22.22`.
- [x] Add `package-lock.json` and `pnpm-lock.yaml` to [`.gitignore`](./.gitignore) to prevent stray dual-lockfile creation.
- [x] Declare Vercel install command as `yarn install --frozen-lockfile` in [`vercel.json`](./vercel.json) (overrides any dashboard setting).
- [x] Update [.github/workflows/main.yml](./.github/workflows/main.yml) to install with `yarn install --frozen-lockfile`, add a blocking `audit` job (`yarn audit:prod`, wrapping `yarn audit --groups dependencies --json` via [`scripts/audit.mjs`](./scripts/audit.mjs) with allowlist support), add a `lockfile-lint` job, SHA-pin `actions/checkout` and `actions/setup-node`, and aggregate via an `all-checks-passed` job for branch-protection.
- [x] **Production-tree audit sweep.** Starting point was 30 unique high/critical advisories (`6 critical + 83 high` raw findings, mostly via `next@13.5.6` and the `wagmi → @walletconnect/*` chain). Cleared by bumping `next` `13.5.6` → `15.5.15` (clears CVE-2025-29927 critical authorization-bypass + 7 high advisories spanning SSRF in Server Actions, middleware authorization bypass, cache poisoning, and four Server-Components DoS variants), bumping direct `lodash` `4.17.21` → `4.18.1`, and adding Yarn `resolutions` for 13 transitive packages (`@coinbase/wallet-sdk`, `base-x`, `braces`, `cross-spawn`, `defu`, `elliptic`, `h3`, `lodash`, `node-forge`, `picomatch`, `secp256k1`, `sha.js`, `socket.io-parser`, `undici`). **After the sweep: 0 critical, 0 high.** No allowlist entries needed — [`.supply-chain/audit-allowlist.json`](./.supply-chain/audit-allowlist.json) is empty.
- [x] **Next.js 13 → 14 → 15 migration.** Landed in two stacked PRs after the security-hardening PR so each framework jump has its own smoke-test cycle and revert surface. Final state: `next@15.5.15`. Required adding `staticPageGenerationTimeout: 300` to [`next.config.js`](./next.config.js) — Next 14 introduced per-page module-data collection via worker subprocesses with a default 60s timeout, and on Windows the worker startup overhead plus the wagmi/walletconnect import tree pushed `_app` past that limit; the higher ceiling costs nothing on Linux CI. `react@18.2.0` and `react-dom@18.2.0` are intentionally retained — Next 15 supports React 18 as a peer, and bumping to React 19 would warrant its own compat sweep against AntD / styled-components / wagmi / recharts that is out of scope here.
- [ ] **Audit Vercel env-var scoping for `BLOB_READ_WRITE_TOKEN`** — must be marked **runtime-only** in the Vercel dashboard, not build-time. Build-time exposure is exactly what a compromised `postinstall` script exfiltrates.
- [x] SHA-pin the `gitleaks` job in [.github/workflows/main.yml](./.github/workflows/main.yml). Bumped `actions/checkout@v3` → `@v4.3.1` (SHA-pinned), removed the unused `actions/setup-go@v3` step (the job runs a precompiled gitleaks binary, never invokes `go`), switched the binary download from `wget` to `curl -fsSL`, and added `sha256sum -c` verification against a known checksum (`af479da9...c0dbf`) before install.
- [ ] **Automate the §4 cooldown rule.** Today the 7-day cooldown is enforced by manual reviewer discipline (check `npm view <pkg>@<ver> time` against the PR's `package.json` / `yarn.lock` diff). A small GitHub Action that diff-walks the lockfile and queries the npm registry for each newly-resolved version's publish time would catch a hot-published dep that slips past a reviewer. Sketch: parse `yarn.lock` from `base..HEAD`, extract the (name, version) tuples that are new or changed, hit `https://registry.npmjs.org/<name>` for each, fail the check if any `time[<version>]` is younger than 7 days unless the PR description includes a security-advisory ID.
- [ ] **Add unit tests for [`scripts/audit.mjs`](./scripts/audit.mjs).** The script is load-bearing for every PR's audit gate. Fixture-driven tests would exercise the parsing path, the allowlist matching, the drift-detection warnings, the ID-coercion path, and the fail-closed-on-empty-output path. Mock yarn-audit JSON in, expected exit code and stdout/stderr out. Worth wiring into CI behind the existing `lockfile-lint` job.

## References

- [GitHub advisory database](https://github.com/advisories)
- [Socket.dev](https://socket.dev/) — supply chain scanner with postinstall script detection
- [Shai-Hulud Strikes Again (v2) — Socket, Nov 2025](https://socket.dev/blog/shai-hulud-strikes-again-v2) — representative of modern npm worm class (500+ packages, 700+ versions affected)
- [lockfile-lint](https://github.com/lirantal/lockfile-lint) — validates `resolved` URLs, HTTPS, and integrity hashes in `yarn.lock`
