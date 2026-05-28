# Olas Predict App

This repo contains the UI for the [Olas Predict](https://olas.network/agent-economies/predict)

## Tech Stack

- Node.js 22.x (pinned in [`.nvmrc`](./.nvmrc); enforced by `engines.node` in [`package.json`](./package.json))
- Yarn 1.22.22 (corepack-activated; see [`SUPPLY-CHAIN-SECURITY.md`](./SUPPLY-CHAIN-SECURITY.md) §2)
- Next.js 15 (Pages Router) with TypeScript
- React 18 + Ant Design (AntD) + styled-components
- TanStack Query for server state
- viem for read-only Gnosis Chain access (no wallet flow — see [`CLAUDE.md`](./CLAUDE.md) and [`SUPPLY-CHAIN-SECURITY.md`](./SUPPLY-CHAIN-SECURITY.md) §5a)
- GraphQL via `graphql-request` against multiple subgraphs

See [`CLAUDE.md`](./CLAUDE.md) for the architecture overview and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the contribution workflow.

### Installation

`yarn` (Node 22.x required)

### Start the app

`yarn dev`

### Build the app

`yarn run build`
