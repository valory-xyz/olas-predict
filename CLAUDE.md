# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Olas Predict is a Next.js-based prediction market application built for the Olas Network. It displays and interacts with prediction markets where AI agents (Quickstart and Pearl) create and trade on questions about future events.

**Tech Stack:**
- Next.js 15 (Pages Router) with TypeScript
- React 18 with Ant Design (AntD) UI components
- Styled Components for styling
- TanStack Query (React Query) for data fetching
- Viem for read-only Gnosis Chain access (`publicClient.readContract` / `getLogs` only — no wallet connectors, no signing). Wagmi was removed; see `constants/viemConfig.ts` and `SUPPLY-CHAIN-SECURITY.md` §5a.
- GraphQL (graphql-request) for subgraph queries
- Vercel Blob for achievement OG-image lookups (SSR only)

## Development Commands

```bash
# Install dependencies
yarn

# Start development server (runs on http://localhost:3000)
yarn dev

# Build production bundle
yarn run build

# Start production server
yarn start

# Lint codebase
yarn lint

# Lint the yarn.lock file (registry origins, integrity hashes)
yarn lint:lockfile

# Run the production dependency audit gate (blocks on unallowlisted high/critical CVEs)
yarn audit:prod

# Analyze bundle size
yarn analyze
```

## Environment Variables

Copy `.env.example` to `.env.local` and configure:
- `NEXT_PUBLIC_SUBGRAPH_API_KEY` - API key for The Graph subgraph access
- `NEXT_PUBLIC_GNOSIS_URL` - RPC URL for Gnosis Chain (optional, falls back to default)
- `NEXT_PUBLIC_REGISTRY_GRAPH_URL` - Olas registry subgraph (used by `utils/registry.ts` for the 7-day DAA banner)
- `NEXT_PUBLIC_PREDICT_POLYMARKET_URL` - Polymarket subgraph (used by `usePolystratBet` on achievement pages)

Runtime-only secrets (not in `.env.example`, configured in the Vercel dashboard):
- `BLOB_READ_WRITE_TOKEN` - Vercel Blob read token used by `utils/achievements.ts` during SSR. Must stay runtime-only — never expose to the bundle.

## Architecture Overview

### Page Structure

The app uses Next.js Pages Router. Top-level routes:
- `/questions` - Lists prediction market questions with filters (all/opened/closed)
- `/agents` - Three sections: trader agents, creator agents, mech agents
- Root `/` redirects to `/questions?state=opened` (configured in `next.config.js`, no `pages/index.tsx`)

Dynamic routes:
- `/questions/[id]` - Individual market detail (param is the FPMM address, lowercased before query)
- `/agents/[id]` - Individual trader agent detail (param is the agent address)
- `/[agent]/achievement/...` - Server-rendered achievement / payout cards (e.g. `/polystrat/payout?betId=...`). `getServerSideProps` validates the agent + type against enums (`AGENTS`, `ACHIEVEMENT_TYPES` in `constants/index.ts`) and pulls the OG-image URL from Vercel Blob via `utils/achievements.ts`. Bypasses the main `Layout` wrapper.

### Data Layer

**GraphQL Subgraphs** (`graphql/queries.ts`):
The app queries multiple subgraphs (mostly Gnosis Chain):
- **OMEN_SUBGRAPH_URL**: Main prediction market data (markets, trades, conditions, liquidity)
- **OLAS_AGENTS_SUBGRAPH_URL**: Trader/creator agents, bets, global stats
- **OLAS_MECH_SUBGRAPH_URL**: Mech agents and requests
- **CONDITIONAL_TOKENS_SUBGRAPH_URL**: Token position data (currently unused by UI)
- **GNOSIS_STAKING_SUBGRAPH_URL**: Staking statistics
- **OMEN_THUMBNAIL_MAPPING_SUBGRAPH_URL**: Question thumbnail images
- **XDAI_BLOCKS_SUBGRAPH_URL**: Maps timestamps to block numbers for the price-history chart
- **Registry subgraph** (env: `NEXT_PUBLIC_REGISTRY_GRAPH_URL`): 7-day DAA averages for the `LiveAgentsBanner` (see `utils/registry.ts`)
- **Polymarket subgraph** (env: `NEXT_PUBLIC_PREDICT_POLYMARKET_URL`): bet lookups for achievement pages (see `hooks/usePolystratBet.ts`)

All GraphQL types are auto-generated in `graphql/types.ts` (ignored by ESLint).

**Key Data Concepts:**
- **FixedProductMarketMaker (FPMM)**: Core prediction market contract
- **Conditions**: The underlying question/oracle combination
- **Outcome Tokens**: ERC-1155 tokens representing Yes/No positions
- **Marginal Prices**: Current probability implied by market prices

### Component Architecture

**Layout** (`components/Layout/`):
- Desktop: Fixed sidebar navigation (Menu) with centered content
- Mobile: Top mobile menu with hamburger
- All pages wrapped in `Layout` component with beta banner

**Theming** (`components/Theme/`):
- `AutonolasThemeProvider`: Configures AntD theme with custom colors
- `GlobalStyle`: Styled-components global styles
- Theme constants in `constants/theme.ts` (colors, breakpoints, media queries)

**Shared Components** (`components/shared/`):
- Reusable UI elements across the app
- Card components, loading states, error boundaries

**Feature Components**:
- `QuestionCard`: Displays market summary with probability chart
- `QuestionDetailsCard`: Full market details with trade history
- `AgentDetailsCard`: Agent performance and statistics
- `Activity`: Transaction/trade feed
- `Pagination`: Custom pagination with URL query params

### State Management

**TanStack Query** for server state:
- Queries defined in custom hooks (`hooks/`):
  - `useMarketTrades` — last 1000 trades on a market
  - `useOutcomeTokenMarginalPrices` — handles closed markets by falling back to the last liquidity event
  - `useAgentsBets` — per-outcome agent participation aggregated from trades
  - `useOlasInUsdPrice` — OLAS spot from CoinGecko
  - `usePolystratBet` — Polymarket bet lookup for achievement pages
  - `useScreen`, `useDropdown` — UI helpers (AntD breakpoints, mobile menu state)
- React Query DevTools available in development (bottom-left)

**Viem** for read-only blockchain access:
- Configuration in `constants/viemConfig.ts` exports a single `publicClient` (Gnosis Chain transport).
- The only PROD code path that actually reads on-chain is `components/MechAgents.tsx` (calls `publicClient.readContract` + `publicClient.getLogs` for mech agent hashes). Every other "data" hook in `hooks/` uses subgraphs via `graphql-request`.
- **Wagmi was dropped** in favor of bare viem because the app has no wallet flow (no `useConnect`, no `useAccount`, no `writeContract`, no signing). Carrying the wagmi connector tree (`@wagmi/connectors`, `@walletconnect/*`, `@metamask/sdk`, `@coinbase/wallet-sdk`) added ~18 kB to the shared bundle, three native install hooks (`bufferutil`, `keccak`, `utf-8-validate`), and a long tail of Dependabot transitive-CVE alerts for code paths this app never invoked. See `SUPPLY-CHAIN-SECURITY.md` §5a for the migration rationale.
- The contract ABIs in `constants/contracts/` are used by `MechAgents.tsx`; `serviceRegistry` is currently defined but unused.

### Utility Modules

**`utils/agents.ts`**:
- Agent data formatting and aggregation
- Maps agent services to readable statistics

**`utils/questions.ts`**:
- Market state calculations
- Question categorization logic

**`utils/time.ts`**:
- Date formatting utilities
- Timestamp conversions

**`utils/ipfs.ts`**:
- IPFS gateway URL construction (CIDv0 decoding from bytes32)
- Uses `IPFS_GATEWAY_URL` for content retrieval

**`utils/registry.ts`**:
- Fetches 7-day average daily active agents from the Olas registry subgraph
- Powers the `LiveAgentsBanner` on `/questions`
- Hardcodes the predict agent IDs allowlist

**`utils/achievements.ts`**:
- Vercel Blob lookup for per-bet achievement OG-image entries
- Used server-side in `getServerSideProps` of the `/[agent]/achievement` route
- Has a legacy monolithic-file fallback gated by `NEXT_PUBLIC_SKIP_LEGACY_ACHIEVEMENTS`

**`utils/flipside.ts`**:
- Legacy Flipside DAA fetcher — superseded by `utils/registry.ts`. Don't extend; remove if you touch it.

### Constants

**`constants/index.ts`**: Central configuration
- Creator addresses (Quickstart: `0x89c5c...`, Pearl: `0xffc80...`)
- Subgraph endpoints
- External service URLs (Reality.eth, GnosisScan, Dune Analytics)
- Known broken markets list
- Invalid answer hex constant
- Agent + achievement-type enums (`AGENTS`, `ACHIEVEMENT_TYPES`) used by the achievement route validator

**`constants/filters.ts`**: Filter options for markets/agents

**`constants/seo.ts`**: Per-page meta-tag config and helpers (`getMarketDescription`, `getAgentDescription`, `getQuestionsSeoContent`, `truncateForMeta`)

**`constants/theme.ts`**: Colors, breakpoints (`sm: 576px`, `xl: 1240px`), `MEDIA_QUERY` helpers, AntD theme tokens

**`constants/contracts/`**: On-chain contract ABIs and addresses (defined but not currently called)
- `agentRegistry.ts`
- `serviceRegistry.ts`

## Code Style Guidelines

**Import Ordering** (enforced by Prettier):
1. Third-party modules
2. Internal modules: `store`, `components`, `constants`, `utils`, `hooks`, `context`, `types`
3. Relative imports

**ESLint Rules**:
- No unused imports (auto-removed)
- Console methods forbidden except `console.error`
- Unused variables prefixed with `_` are allowed
- React hooks exhaustive-deps warnings enforced

**TypeScript**:
- Strict mode enabled
- Path aliases configured for cleaner imports
- GraphQL types auto-generated (do not edit `graphql/types.ts`)

## Next.js Configuration

**Security Headers** (`next.config.js`):
- CSP with `frame-ancestors 'none'`
- HSTS enabled
- Content type sniffing disabled

**Image Optimization**:
- Configured for IPFS images from `ipfs.io` domain

**Styled Components**:
- Compiler option enabled for better SSR performance

## Working with Markets

Markets are filtered by several criteria:
- State: opened, closed, finalized
- Creator: Quickstart vs Pearl agents
- Broken markets excluded via `BROKEN_MARKETS` array
- Invalid answers filtered using `INVALID_ANSWER_HEX`

When adding market features:
1. Check `graphql/queries.ts` for available fields
2. Use `marketDataFragment` for consistent field selection
3. Handle loading/error states with `LoadingError` component
4. Respect pagination with `ITEMS_PER_PAGE` constants

## GraphQL Code Generation

Types are generated from subgraph schemas. If schemas change:
```bash
# Regenerate types (requires @graphql-codegen/cli)
npx graphql-codegen
```

## Supply-chain security

This repo has a hardened dependency workflow — read `SUPPLY-CHAIN-SECURITY.md` before touching `package.json` or `yarn.lock`.

- All direct **and** transitive deps are pinned to exact versions (no `^`/`~`). Transitive pins live in the `resolutions` block.
- `yarn` is pinned to 1.22.22 via the `packageManager` field; CI uses `--frozen-lockfile`.
- CI gates that block merges (aggregated by `all-checks-passed`):
  - `build` — `next build`
  - `audit` — `yarn audit:prod` blocks high/critical advisories not in `.supply-chain/audit-allowlist.json` (schema: top-level `entries[]`)
  - `lockfile-lint` — `yarn lint:lockfile` enforces registry origins + integrity hashes in `yarn.lock`
  - `scan` — gitleaks v8.30.1 with SHA-256-verified binary download
  - `install-hooks` — `scripts/audit-install-hooks.mjs` diffs the postinstall surface against `.supply-chain/install-hooks.allowlist` (1 entry: `sharp`)
- New versions should wait ~7 days after release before being added (security advisories override this).
- GitHub Actions are SHA-pinned in `.github/workflows/`.

## Common Gotchas

- **Subgraph lag**: Data can be delayed by several blocks
- **Invalid answers**: Filter out `0xffff...` answers in market queries
- **Mobile layout**: Always test responsive behavior — actual breakpoints are `sm: 576px` and `xl: 1240px` (see `constants/theme.ts` / `MEDIA_QUERY`)
- **IPFS content**: May be slow to load; implement loading states
- **Gnosis Chain only**: Don't attempt multi-chain support without configuration changes
- **Read-only on-chain access via viem**: `MechAgents.tsx` is the only PROD file calling viem (`publicClient.readContract` + `publicClient.getLogs`). Wagmi was removed; do NOT add wagmi back when you need a new on-chain read — use the existing `publicClient` from `constants/viemConfig.ts`. Adding wagmi reintroduces the wallet-stack supply-chain surface and ~18 kB of bundle.
- **Achievement pages bypass `Layout`**: They're SSR with their own full-screen card and depend on `BLOB_READ_WRITE_TOKEN` at runtime.
