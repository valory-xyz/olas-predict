# Contributing to Olas Predict

Thanks for your interest in contributing. This repo uses **Yarn** and **conventional commits** (including for PR titles).

## Quick start

1. Read the [README](README.md) for setup.
2. Check open issues; `good first issue` / `help wanted` if present are good starting points.
3. Comment on an issue before starting work to avoid duplicate effort.

## Development workflow

### Branch naming (kebab-case)

- Features: `feature/your-feature-name`
- Bug fixes: `fix/issue-description`
- Chores: `chore/description`

### Commits and PR titles

Use **conventional commits** for both commit messages and **PR titles**. Format:

```
<type>(<optional scope>): <description>
```

Full list and examples: **[Conventional Commit types & examples](https://gist.github.com/qoomon/5dfcdf8eec66a051ecd85625518cfd13#types)**.

Examples:

- `feat: add plausible integration`
- `fix: resolve navigation issue on mobile`
- `docs: update contribute.md`

### Use Yarn

We use **Yarn** for installs and scripts. Please run:

```bash
yarn install
yarn dev
yarn lint
yarn build
```

Use these in docs and PRs instead of npm/pnpm equivalents.

## Before submitting a PR

1. **Checks**
   - `yarn lint`
   - `yarn build`
2. Branch is up to date with the base branch.
3. PR title follows conventional commits (see link above).
4. PR description explains what changed and why; add screenshots for UI changes.

## Code quality

- **ESLint & Prettier**: Follow project config.
- **TypeScript**: Use for components and utilities.
- **Structure**: Put shared logic in `utils/`; keep components focused on UI.
- **Style**: Descriptive names, JSDoc for non-obvious logic, small focused functions.

## File layout (reference)

- `pages/` – Next.js pages router pages and API routes
- `components/` – React components
- `graphql/` – GraphQL queries and auto-generated types
- `hooks/` – Custom React hooks
- `utils/` – Shared utilities and helpers
- `constants/` – App-wide constants and configuration
- `public/` – Static assets

## Getting help

- Setup and usage: [README](README.md)
- Bugs and features: open or search [GitHub issues](https://github.com/valory-xyz/olas-predict-app/issues)
- Security: [SECURITY.md](SECURITY.md) if present

## License

Contributions are under the same license as the project (see [LICENSE](LICENSE)).
