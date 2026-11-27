# Sleek Agentic Operating Contract

Welcome to the **Sleek** repository. This document is the single source of truth for all human engineers and autonomous AI coding agents working in this workspace.

---

## 1. Executive Architecture Invariants

- **Runtime & Execution**: Sleek is TypeScript executed natively on the **Bun runtime**, paired with a bounded Rust `napi-rs` native workspace under `native/` (`sleek_gateway`, `sleek_napi`). Never invoke `node`, `npm`, `npx`, `pnpm`, or `yarn`.
- **Fast Type Checking**: Fast type checking is powered by **`tsrs`** (the high-performance Rust-powered TypeScript compiler built by Cloudflare and Oxc). It is invoked via `bun run typecheck`.
- **Style Standard**: Code semantics, naming conventions, and typing follow the **Google TypeScript Style Guide** (`tsguide.md`), the **Microsoft TypeScript Compiler Team Guidelines** (`Coding-guidelines.md`), and **Microsoft VS Code Architecture** (`vscode.wiki`).
- **Two-Tier Verification**:
  - Pre-commit hook: Verifies only staged files in sub-second time.
  - Pre-push / Agent Pre-flight: Full repository check (`bun run verify`).

---

## 2. Canonical Commands & Workflow

All operations must be run using Bun package scripts:

| Command | Purpose | When to Run |
| :--- | :--- | :--- |
| `bun install` | Installs pinned dependencies and configures git hooks | Initial setup or dependency updates |
| `bun run typecheck` | Runs `tsrs --noEmit --fast` for sub-second type checking | After modifying types or interfaces |
| `bun test` | Executes unit and integration tests via Bun test runner | TDD cycle; before committing changes |
| `bun run lint:style` | Validates Google TypeScript Style (GTS) and compiler rules | Before staging code |
| `bun run lint` | Runs full ESLint suite with type-checked rules | Full code quality verification |
| `bun run lint:fix` | Automatically fixes ESLint errors | Code formatting & automated lint cleanup |
| `bun run format` | Formats all code with Prettier | Before staging or opening PRs |
| `bun run format:check` | Verifies all files follow Prettier code style | CI / Pre-push verification |
| `bun run clean` | Safely removes build output (`build/`) and caches | Before clean builds or after refactors |
| `bun run verify:staged` | Pre-commit check verifying staged files and type health | Executed automatically by pre-commit hook |
| `bun run verify:ts` | TypeScript-only verification (typecheck + GTS + ESLint + Prettier + tests) | Fast offline TS verification |
| `bun run verify` | Full verification runner (TS checks + `cargo check` + `cargo test`) | Pre-flight check before declaring work complete |
| `bun run build:native` | Compiles `native/crates/sleek_napi` `.node` addon with `@napi-rs/cli` | After modifying Rust crates in `native/` |

---

## 3. Modular Rules Directory (`.agents/rules/`)

Coding agents must read and adhere to the specialized modular rule files:

- [`.agents/rules/bun-runtime.md`](file:///c:/Users/buffe/Desktop/Sleek/.agents/rules/bun-runtime.md) — Native Bun APIs, `bun test` conventions, and package management invariants.
- [`.agents/rules/compiler-guidelines.md`](file:///c:/Users/buffe/Desktop/Sleek/.agents/rules/compiler-guidelines.md) — Microsoft TypeScript compiler engineering guidelines: immutability, `undefined` over `null`, closures over classes for pipelines, bitflag enums for >2 booleans, interface caching vs intersections, and standardized diagnostic codes.
- [`.agents/rules/google-json-standard.md`](file:///c:/Users/buffe/Desktop/Sleek/.agents/rules/google-json-standard.md) — Google JSON format (`jsoncguide.md`): camelCase keys, ISO 8601 dates, envelope patterns, and null omission.
- [`.agents/rules/tsrs-compiler.md`](file:///c:/Users/buffe/Desktop/Sleek/.agents/rules/tsrs-compiler.md) — Fast compilation flags, thread limits (`RAYON_NUM_THREADS`), and fallback protocol.
- [`.agents/rules/typescript-patterns.md`](file:///c:/Users/buffe/Desktop/Sleek/.agents/rules/typescript-patterns.md) — GTS & `tsguide.md` rules: strict typing, top-level `export function` declarations, discriminated unions, error throwing, and no `.only` in tests.
- [`.agents/rules/vscode-architecture.md`](file:///c:/Users/buffe/Desktop/Sleek/.agents/rules/vscode-architecture.md) — Microsoft VS Code architecture standards: 5 horizontal layers (`base` -> `platform` -> `editor` -> `workbench` -> `code`), target environments (`common`, `node`), constructor dependency injection, contribution patterns, shy objects, and disposable lifecycle management (`IDisposable`, zero leak verification).

---

## 4. Verification & Diagnostic Scripts (`.agents/scripts/`)

Verification scripts enforce automated quality gates:

- [`.agents/scripts/check-gts.ts`](file:///c:/Users/buffe/Desktop/Sleek/.agents/scripts/check-gts.ts) — Validates GTS rules (no `.only`, no `var`, strict `===`, no trailing whitespace, no `const enum`, only throw `Error`, no mutable exports, `export function` for top-level functions [GTS009], no `I` prefix on interfaces [GTS010]). Exits with code `30` on failure.
- [`.agents/scripts/clean.ts`](file:///c:/Users/buffe/Desktop/Sleek/.agents/scripts/clean.ts) — Safely cleans output directory (`build/`) and agent logs.
- [`.agents/scripts/verify-staged.ts`](file:///c:/Users/buffe/Desktop/Sleek/.agents/scripts/verify-staged.ts) — Validates staged git files in sub-second time during `pre-commit`.
- [`.agents/scripts/verify-all.ts`](file:///c:/Users/buffe/Desktop/Sleek/.agents/scripts/verify-all.ts) — Full multi-stage verification runner with discrete exit codes:
  - Exit `10`: `tsrs` type-checking error.
  - Exit `30`: GTS linter / style error.
  - Exit `35`: ESLint ultra type-strict error.
  - Exit `36`: Prettier formatting error.
  - Exit `40`: Test failure.
  - Exit `50`: Script internal error.

---

## 5. Git Pre-Commit Hook (`.agents/hooks/`)

- [`.agents/hooks/pre-commit`](file:///c:/Users/buffe/Desktop/Sleek/.agents/hooks/pre-commit) executes `bun run verify:staged` before every git commit.
- **Emergency Bypass**: Set `SLEEK_SKIP_VERIFY=1` or run `git commit --no-verify` only during critical rebases or WIP branch stashing.

---

## 6. Active Skills Registry (`.agents/skills/`)

The unified TypeScript engineering skills guide agent design across Google, TypeScript compiler, and VS Code standards:

- [`typescript-discriminated-unions`](file:///c:/Users/buffe/Desktop/Sleek/.agents/skills/typescript-discriminated-unions/SKILL.md) — State modeling, exhaustive checks (`assertNever`), bitflag enums for >2 booleans.
- [`typescript-functions`](file:///c:/Users/buffe/Desktop/Sleek/.agents/skills/typescript-functions/SKILL.md) — Single responsibility, `export function` declarations, closures over classes for pipelines, explicit return types.
- [`typescript-naming`](file:///c:/Users/buffe/Desktop/Sleek/.agents/skills/typescript-naming/SKILL.md) — PascalCase types without `I` prefix, PascalCase enums, camelCase identifiers, `on[Did|Will]VerbSubject` event naming.
- [`typescript-react`](file:///c:/Users/buffe/Desktop/Sleek/.agents/skills/typescript-react/SKILL.md) — Functional components, explicit props interfaces, clean hook disposal.
- [`typescript-source-organization`](file:///c:/Users/buffe/Desktop/Sleek/.agents/skills/typescript-source-organization/SKILL.md) — 5-tier layered architecture, environment boundaries (`common` vs `node`), contribution pattern.
- [`typescript-style-guide`](file:///c:/Users/buffe/Desktop/Sleek/.agents/skills/typescript-style-guide/SKILL.md) — Master unified engineering guide synthesizing Google TS, TypeScript compiler, and VS Code standards.
- [`typescript-tests`](file:///c:/Users/buffe/Desktop/Sleek/.agents/skills/typescript-tests/SKILL.md) — AAA pattern, isolated test doubles, disposable leak detection, zero `.only`.
- [`typescript-types`](file:///c:/Users/buffe/Desktop/Sleek/.agents/skills/typescript-types/SKILL.md) — Type narrowing, `interface extends` caching vs intersections, branded nominal types, zero `any`.
- [`typescript-variables`](file:///c:/Users/buffe/Desktop/Sleek/.agents/skills/typescript-variables/SKILL.md) — Const assertions, ban `const enum`, ban mutable exports, `undefined` over `null`.

---

## 7. Upstream Compiler Scope (`.agents/skills/upstream/`)

- Upstream skills are strictly isolated in [`.agents/skills/upstream/`](file:///c:/Users/buffe/Desktop/Sleek/.agents/skills/upstream/):
  - `pr-writer`: Writing pull requests for the upstream `oxc-project/tsrs` Rust compiler.
  - `triage`: Triaging compiler parity defects against the Microsoft reference checkout.
- **Rule for Sleek Application Tasks**: **NEVER** invoke upstream compiler skills during Sleek application tasks. They apply strictly to upstream compiler contributions.

---

## 8. Standards Precedence Hierarchy

When conflicting instructions arise, follow this strict priority order:

1. **Security & Prompt Defense Guidelines** (Non-negotiable).
2. **`AGENTS.md` and `.agents/rules/`** (Project-level operational invariants).
3. **Google TypeScript Style Guide, TypeScript Compiler Guidelines & VS Code Architecture** (`tsguide.md`, `compiler-guidelines.md`, `vscode-architecture.md`).
4. **Legacy Documentation in `docs/archive/rust-architecture/`** (Archived history; superseded by [ADR 0005](file:///c:/Users/buffe/Desktop/Sleek/docs/decisions/0005-bun-typescript-agentic-architecture.md)).
