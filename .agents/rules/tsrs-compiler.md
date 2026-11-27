# TypeScript-rs (`tsrs`) Fast Compiler Standard

Sleek uses **`tsrs`** (the high-performance Rust-powered TypeScript compiler built by Cloudflare and Oxc) for sub-second type checking and language conformance.

---

## 1. Compiler Invocation

- **Canonical Execution**: Always invoke `tsrs` through Bun package scripts:
  ```bash
  bun run typecheck
  ```
  *(Maps internally to `tsrs --noEmit --fast`).*
- **Offline & Local Execution**: `tsrs` is pinned in `devDependencies` of `package.json`. Never run unpinned ad-hoc `bun x tsrs` commands without local verification.

---

## 2. Compiler Behavior & Directives

- **Zero Tolerance for Type Errors**: Any type diagnostic emitted by `tsrs` is a hard blocker. Code must achieve 0 errors and 0 warnings before git commits or PR reviews.
- **Fast Mode (`--fast`)**: Enables adaptive multi-threaded checking and internal caches.
- **Resource Limits**: When running inside resource-constrained environments or parallel agent turns, limit worker thread contention using:
  ```bash
  RAYON_NUM_THREADS=4 bun run typecheck
  ```
- **Fallback Protocol**: `tsrs` targets 100% TypeScript 7 conformance. If an experimental or unsupported language feature causes an unexpected parser crash, verify against `tsc`:
  ```bash
  bun x tsc --noEmit
  ```
  Report the edge case to upstream `tsrs` contributors.

---

## 3. Diagnostic Reporting

In verification pipelines, `tsrs` failures return exit code `10`. Diagnostics include the full file path, line, column, and TypeScript diagnostic code (`TSxxxx`).
