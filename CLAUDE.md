# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Olas Predict is a Next.js-based prediction market application built for the Olas Network. It displays and interacts with prediction markets where AI agents (Quickstart and Pearl) create and trade on questions about future events.

**Tech Stack:**
- Next.js 13 with TypeScript
- React 18 with Ant Design (AntD) UI components
- Styled Components for styling
- TanStack Query (React Query) for data fetching
- Wagmi v2 for blockchain interactions on Gnosis Chain
- GraphQL for subgraph queries

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

# Analyze bundle size
yarn analyze
```

## Environment Variables

Copy `.env.example` to `.env.local` and configure:
- `NEXT_PUBLIC_SUBGRAPH_API_KEY` - API key for The Graph subgraph access
- `NEXT_PUBLIC_GNOSIS_URL` - RPC URL for Gnosis Chain (optional, falls back to default)

## Architecture Overview

### Page Structure

The app uses Next.js Pages Router with two main routes:
- `/questions` - Lists prediction market questions with filters (opened/closed/finalized)
- `/agents` - Shows agent statistics and trader information
- Root `/` redirects to `/questions?state=opened`

Dynamic routes:
- `/questions/[address]` - Individual question details
- `/agents/[address]` - Individual agent details

### Data Layer

**GraphQL Subgraphs** (`graphql/queries.ts`):
The app queries multiple subgraphs on Gnosis Chain:
- **OMEN_SUBGRAPH_URL**: Main prediction market data (markets, trades, conditions)
- **OLAS_AGENTS_SUBGRAPH_URL**: Agent service information
- **OLAS_MECH_SUBGRAPH_URL**: Mech agent predictions
- **CONDITIONAL_TOKENS_SUBGRAPH_URL**: Token position data
- **GNOSIS_STAKING_SUBGRAPH_URL**: Staking statistics
- **OMEN_THUMBNAIL_MAPPING_SUBGRAPH_URL**: Question thumbnail images

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
- Queries defined in custom hooks (`hooks/`)
- Examples: `useAgentsBets`, `useMarketTrades`, `useOlasInUsdPrice`, `useOutcomeTokenMarginalPrices`
- React Query DevTools available in development (bottom-left)

**Wagmi** for blockchain state:
- Configuration in `constants/wagmiConfig.ts`
- Connected to Gnosis Chain only
- Used for reading on-chain data (conditional tokens, positions)

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
- IPFS gateway URL construction
- Uses `IPFS_GATEWAY_URL` for content retrieval

**`utils/flipside.ts`**:
- Flipside API integration for analytics

### Constants

**`constants/index.ts`**: Central configuration
- Creator addresses (Quickstart: `0x89c5c...`, Pearl: `0xffc80...`)
- Subgraph endpoints
- External service URLs (Reality.eth, GnosisScan, Dune Analytics)
- Known broken markets list
- Invalid answer hex constant

**`constants/filters.ts`**: Filter options for markets/agents

**`constants/contracts/`**: On-chain contract ABIs and addresses
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

## Common Gotchas

- **Subgraph lag**: Data can be delayed by several blocks
- **Invalid answers**: Filter out `0xffff...` answers in market queries
- **Mobile layout**: Always test responsive behavior (breakpoint at 768px)
- **IPFS content**: May be slow to load; implement loading states
- **Gnosis Chain only**: Don't attempt multi-chain support without configuration changes
