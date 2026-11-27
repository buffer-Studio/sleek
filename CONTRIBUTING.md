# Contributing to Sleek

Thank you for your interest in contributing to Sleek.

## Prerequisites

* **Bun**: Sleek runs on the Bun runtime. Do not use `node`, `npm`, `npx`, `pnpm`, or `yarn`.
* **Rust**: Required only if you modify native crates under `native/`.

## Setup

```bash
bun install
```

This installs dependencies and configures the git pre-commit hook.

## Coding Standards

All code in Sleek must follow the rules in [STYLE.md](STYLE.md). Key highlights:

### TypeScript & JavaScript
* **Strict typing:** Never use `any`; use `unknown` and narrow with explicit schemas or type guards.
* **Undefined over null:** Use `undefined` for absent values; reserve `null` only for external JSON/API boundaries.
* **Immutability:** Prefer `readonly` properties, `as const` assertions, and pure functions. Do not export mutable variables.
* **Functions:** Use top-level `export function` declarations with explicit return types. Keep functions small with shallow nesting (max depth 3) and early returns.
* **Naming & types:** Use `PascalCase` for types/interfaces/enums (no `I` prefix on interfaces) and `camelCase` for functions/variables. Never use `const enum`.
* **Equality & variables:** Always use strict equality (`===` / `!==`). Never use `var`.
* **Error handling:** Always throw `Error` instances (or subclasses); never swallow errors silently.
* **Tests:** Follow the Arrange-Act-Assert (AAA) pattern. Never leave `.only` in test files.
* **Lifecycle:** Clean up resources and disposables (`IDisposable`) to prevent leaks.

### Formatting & Linting
* Automated checks enforce style, linting, and formatting on every commit via `bun run verify:staged`.

## Verification Commands

Run these checks before opening a pull request:

```bash
bun run typecheck      # Fast type check with tsrs
bun run lint:style     # Google TypeScript Style (GTS) check
bun run lint           # ESLint check
bun run format:check   # Prettier formatting check
bun test               # Unit and integration tests
bun run verify         # Full verification (TS checks + cargo check + cargo test)
```

If you modify Rust code in `native/`, rebuild the native addon:

```bash
bun run build:native
```

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages:

```text
<type>(<scope>): <short summary>
```

Allowed types:
* `feat`: New feature
* `fix`: Bug fix
* `refactor`: Code change that neither fixes a bug nor adds a feature
* `docs`: Documentation changes
* `test`: Adding or updating tests
* `chore`: Maintenance, dependencies, or build changes

Examples:
* `feat(security): add rate limit guard`
* `fix(gateway): handle reconnect timeout`
* `docs: update STYLE.md`

## Pull Requests

1. Fork the repository and create a branch from `sleek`.
2. Keep changes focused and include tests for new behavior or bug fixes.
3. Ensure `bun run verify` passes with zero errors.
4. Open a pull request describing what changed and why.

## License

By contributing, you agree that your contributions will be licensed under `(AGPL-3.0-or-later OR GPL-3.0-or-later OR Apache-2.0)`. See [LICENSE-AGPL-3.0](LICENSE-AGPL-3.0), [LICENSE-GPL-3.0](LICENSE-GPL-3.0), and [LICENSE-APACHE-2.0](LICENSE-APACHE-2.0).
