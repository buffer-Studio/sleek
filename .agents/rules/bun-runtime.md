# Bun Runtime & Tooling Standard

All application code, scripts, test suites, and workflows in Sleek must run exclusively on the **Bun runtime**.

---

## 1. Core Runtime Directives

- **Exclusive Runtime**: Use `bun` for execution, package management, and testing. Never invoke `node`, `npm`, `npx`, `pnpm`, or `yarn`.
- **Application Stack Invariant**: Sleek application code is 100% TypeScript executed natively on Bun. Zero Rust crates, zero `Cargo.toml` files, and zero native compilation toolchains are allowed in Sleek application code.
- **Package Installation**: Install dependencies using `bun add <pkg>` or `bun add -d <pkg>`. Commit `bun.lock` after package changes.
- **Native Bun APIs**: Prefer Bun native built-in APIs over Node emulation where applicable:
  - File I/O: `Bun.file(path)` and `await Bun.write(path, data)`.
  - Hashing: `bun:crypto` (e.g., `Bun.CryptoHasher`).
  - Environment: `Bun.env` instead of `process.env`.
  - Subprocesses: `Bun.spawn()` and `Bun.spawnSync()`.

---

## 2. Testing Standard

- **Test Runner**: Execute tests exclusively via `bun test`.
- **Test File Naming**: Colocate test files alongside source files with `.test.ts` or `.spec.ts` suffixes.
- **Assertions**: Use Bun's native test library:
  ```ts
  import { describe, expect, it } from "bun:test";

  describe("TokenBucket", () => {
    it("should allow tokens within burst limit", () => {
      const bucket = new TokenBucket({ capacity: 10 });
      expect(bucket.take()).toBe(true);
    });
  });
  ```
- **Determinism**: Eliminate network access and unseeded randomness in unit tests. Every test must be isolated, in-memory, and run in under 5ms.

---

## 3. Package Scripts

Always execute standard tasks through the canonical `package.json` scripts:
- `bun run typecheck` — Runs `tsrs --noEmit --fast`.
- `bun run verify` — Runs full repository verification (`verify-all.ts`).
- `bun run verify:staged` — Runs fast staged diff checks (`verify-staged.ts`).
- `bun run lint:tsdoc` — Runs TSDoc validation (`check-tsdoc.ts`).
- `bun test` — Executes all automated tests.
