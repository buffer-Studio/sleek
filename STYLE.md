# Sleek Coding Standards

This document defines the complete TypeScript, architecture, JSON, and runtime standards for **Sleek**. All contributions must follow these rules.

---

## 1. Source File Structure & Module Invariants

* **Modules, Not Namespaces:** Use standard ES modules (`import`/`export`). The `namespace Foo { ... }` construct is strictly banned.
* **No Mutable Exports:** Never export mutable variables (`export let` is banned). Exports must be immutable (`export const`, `export function`, `export class`, `export interface`). If mutable internal state must be exposed, provide accessor functions (`getCounter()`).
* **No Container Classes:** Do not create classes containing only static methods. Use module-level exported functions instead.
* **Top-Level Named Functions:** Always use `function name(...) { ... }` declarations for top-level named functions. Never use `export const name = (...) => { ... }`. Function declarations guarantee clear stack traces during debugging and testing.
* **Explicit Type Imports & Exports:** Always use `import type { Foo }` and `export type { Bar }` when importing or re-exporting types.
* **One File Per Logical Component:** Group code by distinct logical responsibility (e.g. scanner, parser, checker, emitter).
* **Types Defined First:** Within any TypeScript file, type declarations (`interface`, `type`, `enum`) must precede functions and classes.
* **Shared Types in `types.ts`:** Types shared across multiple components within a feature or domain must be defined in a collocated `types.ts` file.
* **Minimal Export Surface:** Do not export types or functions unless required by multiple components. Keep helper utilities private to their module.
* **Generated Code Suffix:** Any machine-generated files must use the `.generated.*` suffix (e.g. `schema.generated.ts`). Never manually edit generated files.

---

## 2. Strict Typing & Soundness Invariants

* **Ban `any`:** Never use the `any` type. Use `unknown` for unbounded external data and narrow using type guards or Zod validation schemas.
* **Use `undefined`, Ban `null`:** Represent absence with `undefined`. Do not introduce `null` into internal domain models or function returns.
  * Declare missing properties as optional (`age?: number`), which yields `number | undefined`.
  * When consuming third-party APIs that return `null`, immediately normalize the boundary value to `undefined` or a tagged union.
* **Ban `{}` and `Object` as Types:** The `{}` and `Object` types allow almost any value except `null` and `undefined`. For key-value dictionaries, use `Record<string, unknown>` or a concrete interface.
* **No Non-Null Assertions:** Avoid the `!` non-null assertion operator. Use explicit conditional checks or throw meaningful domain errors.
* **Array Types:**
  * Use `T[]` for simple element types (`string[]`, `number[]`, `Guild[]`).
  * Use `Array<T>` or `ReadonlyArray<T>` for complex types (`Array<string | number>`, `ReadonlyArray<{ id: string }>`).
* **Interfaces Over Type Intersections:** Prefer `interface extends` over `type &` for object types. Interfaces create flat, cached shapes in the type checker, while intersections recalculate relationships recursively:
  ```ts
  // Fast: Flat cached interface
  export interface UserWithProfile extends User, Profile {}

  // Slow: Recursive intersection type
  export type UserWithProfile = User & Profile;
  ```
* **Name Complex Types:** Do not inline large anonymous object types or complex mapped types in function signatures. Assign them a named `type` or `interface`.
* **Avoid Deeply Nested Unions:** Keep discriminated union variants focused. Excessively large unions (>50 variants) should be partitioned into hierarchical sub-unions.
* **Disallowed Language Features:**
  * `const enum` is strictly banned (use string literal unions or standard `enum`).
  * Wrapper objects (`new String()`, `new Number()`, `new Boolean()`) are banned.
  * `eval()`, `with`, and `debugger` statements are strictly banned.

---

## 3. Immutability & Functional Pipelines

* **Immutable Data Structures:** Treat domain entities, AST nodes, and data transfer objects as immutable outside the component that created them.
* **Immutable Arrays:** Treat arrays as immutable after creation. Prefer `ReadonlyArray<T>` or `readonly T[]` for public signatures and stored state.
* **Pure Transformations:** Favor pure array transforms (`.map()`, `.filter()`, `.reduce()`) over mutating loops (`.push()`, `.splice()`).
* **Closures Over Classes:** For consistency, high throughput, and memory efficiency, avoid class hierarchies in core execution pipelines. Use pure function closures and modules.
* **Stateless Operations:** Functions in pipeline stages must accept all needed state via parameters and return new immutable values.
* **No `for..in` Loops:** Never use `for..in` statements. Use `for..of Object.keys()`, `for..of Object.values()`, or array higher-order methods.

---

## 4. Boolean Explosion Prevention (Flag Bitfields)

When an entity or node type requires more than 2 related boolean properties, do not add individual boolean fields. Instead, define an enum flag bitfield:

```ts
export enum EntityFlags {
  None = 0,
  Active = 1 << 0,
  Verified = 1 << 1,
  Suspended = 1 << 2,
  SystemAdmin = 1 << 3,
}

export interface UserAccount {
  readonly id: string;
  readonly username: string;
  readonly flags: EntityFlags;
}
```

Use bitwise operations (`(flags & EntityFlags.Active) !== 0`) to test state, reducing memory allocation and object layout overhead.

---

## 5. Discriminated Unions for Domain State

Model state transitions and polymorphic events using discriminated unions with a single tag field (e.g. `status`, `kind`, or `type`):

```ts
export type GuildStatus =
  | { readonly status: 'active'; readonly memberCount: number }
  | { readonly status: 'suspended'; readonly reason: string; readonly expiresAt: Date }
  | { readonly status: 'pending_verification' };

export function formatGuildStatus(guild: GuildStatus): string {
  switch (guild.status) {
    case 'active':
      return `Active with ${guild.memberCount} members`;
    case 'suspended':
      return `Suspended until ${guild.expiresAt.toISOString()}: ${guild.reason}`;
    case 'pending_verification':
      return 'Pending verification';
  }
}
```

---

## 6. Function & Callback Declarations

* **Function Declarations for Named Functions:** Use `function name(...) { ... }` for top-level named functions.
* **Arrow Functions for Callbacks:** Use arrow functions (`(...) => { ... }`) for inline callbacks, array transforms (`.map()`, `.filter()`), and closures.
* **Explicit Return Types on Public Exports:** All exported top-level functions and public class methods must specify an explicit return type. This prevents the compiler from running expensive deep-type inference cascades across file boundaries.

---

## 7. Asynchronous Safety & Promise Invariants

* **No Floating Promises:** Every `Promise` must be handled:
  * Await the promise: `await saveGuild(guild);`
  * Or explicitly discard with `void` for fire-and-forget: `void notifySubscribers(event);`
  * Never leave unhandled floating promises.
* **Async Functions:** Any function returning a `Promise` must be declared `async`.

---

## 8. Control Structures & Exception Handling

* **Strict Equality:** Always use `===` and `!==`. Never use loose `==` or `!=` except when checking for both `null` and `undefined` (`if (x == null)`).
* **Variable Declarations:**
  * `var` is strictly banned.
  * One variable declaration per statement (`const a = 1, b = 2;` is banned).
  * Use `const` by default for all bindings that are not reassigned.
  * Use `let` only when reassignment is necessary.
* **Only Throw `Error` Instances:**
  * Always throw an instance of `Error` (e.g. `throw new Error(...)`, `throw new DomainError(...)`).
  * Never throw primitive strings, numbers, or objects (`throw 'error'` is strictly banned).
  * When catching and re-throwing errors, preserve the underlying cause:
    ```ts
    try {
      await fetchRemoteData();
    } catch (err) {
      throw new Error('Failed to fetch remote data', { cause: err });
    }
    ```
* **No Test Focus Modifiers:** Committing `describe.only`, `it.only`, or `test.only` is strictly banned.

---

## 9. Naming Conventions

* **Identifiers:**
  * `camelCase` for functions, methods, parameters, local variables, and object properties.
  * `PascalCase` for classes, interfaces, type aliases, enums, and components.
  * No `I` prefix for interface names (`Guild` not `IGuild`, except standard `IDisposable`).
  * `PascalCase` for enum values.
  * `UPPER_SNAKE_CASE` for global immutable constants.
  * Type parameters should be single uppercase letters (`T`, `U`) or descriptive names starting with `T` or ending with `T` (`TKey`, `ItemT`).
* **No Privacy Prefixes:** Do not use underscore prefixes or suffixes (`_privateField` is banned). Use TypeScript's `private` or `#private` fields.

---

## 10. Diagnostic Message Grammar & Codes

All internal diagnostic, validation, and error messages must follow these grammar rules:

* **Indefinite Entities:** Use indefinite articles ("A property...", "An argument...").
* **Definite Entities:** Name the exact entity ("Property 'id' is missing...").
* **Singular Subjects:** When stating rules, the subject must be singular ("A guild cannot...", not "Guilds cannot...").
* **Tense & Punctuation:** Use active voice, present tense, and end with a period.
* **Diagnostic Code Ranges:**
  * `1000–1999`: Syntactic and structure diagnostics.
  * `2000–2999`: Semantic, domain, and validation diagnostics.
  * `4000–4999`: Serialization and contract diagnostics.
  * `5000–5999`: Configuration and options diagnostics.

---

## 11. Layered Architecture & Boundaries

Sleek code is partitioned into strict horizontal layers with unidirectional dependency flow (layers may only import from layers below them):

```
code / entry   (CLI, App bootstrapping)
     │
     ▼
workbench      (Contributions, UI, Hub)
     │
     ▼
editor / core  (Core domain engines)
     │
     ▼
platform       (DI Services & registry)
     │
     ▼
base           (Pure utils & primitives)
```

* **`base`:** General utilities, collections, string/math primitives, and disposable containers. Must have zero external dependencies and zero platform/service awareness.
* **`platform`:** Dependency injection contracts, service identifiers, and base services shared across domains.
* **`core` / `editor`:** Core engine logic and domain calculations. Must never depend on `workbench` or application-level entry points.
* **`workbench`:** Feature contributions, lifecycle coordinators, and application panels.
* **`code`:** Entry points that stitch layers together and start the application.

### Target Runtime Environments
* **`common`:** Isomorphic code that requires only standard JavaScript / TypeScript runtime APIs. Runs identically anywhere. Never imports Node or Bun APIs.
* **`node` / `bun`:** Code that requires operating system, file system, network socket, or process APIs.
* **Boundary Invariant:** Code in `common` must never import from `node` or `bun`.

### Dependency Injection & Service Registry
* **Constructor Injection:** Services are consumed via constructor parameters decorated with service identifiers.
* **Singleton Registration:** Services are registered into the service container using `registerSingleton` with delayed (lazy) instantiation.
* **Interface vs Implementation:** Consumers must depend exclusively on the service interface, never the concrete implementation class.

### Contribution Pattern
* **Single `.contribution.ts` Entrypoint:** Every modular feature registers itself via a single `.contribution.ts` file.
* **Internal API Facade:** Every contribution exposes its public surface through a single common contract file.
* **No Internal Reaching:** Code outside a contribution must never import private files inside that contribution.
* **Zero Outside Inward Coupling:** No code in `base`, `platform`, or `core` may import from `contrib`.

---

## 12. Lifecycle Management & Encapsulation

* **The `IDisposable` Contract:** Any object managing intervals, listeners, sockets, or allocated native handles must implement `IDisposable` (`dispose(): void`).
* **`DisposableStore`:** Group related disposables in a `DisposableStore` to guarantee deterministic cleanup.
* **Zero Leak Verification in Tests:** Test suites must verify that no disposables are leaked using teardown assertions (`ensureNoDisposablesAreLeakedInTestSuite()`).
* **Shy Objects:** Public objects handed out by APIs must contain only what the interface contract defines. Hide internal implementation state using module closures or `#private` fields.
* **Event Naming:** Domain events follow the `on[Did|Will]VerbSubject` pattern (e.g. `onDidChangeActiveSession`, `onWillSaveDocument`, `onDidCreateResource`).
* **Global Event Pattern:** Events are exposed from top-level namespaces or services, passing the affected entity in the event payload.
* **Fast Synchronous Reads:** State reading must be synchronous from memory cache. State mutations may execute asynchronously in the background while updating the local cache synchronously.

---

## 13. JSON Standard

All JSON API payloads, configuration files, serialized schemas, and HTTP endpoints must follow these rules:

* **Strict `camelCase`:** Property names must be `camelCase`, beginning with a lowercase letter and containing only alphanumeric ASCII characters (`guildId`, `memberCount`, `createdAt`).
* **Singular vs. Plural:** Use singular names for single values (`user`, `role`, `status`) and plural names for arrays (`items`, `roles`, `members`).
* **Date Values:** Format all timestamps and dates as ISO 8601 strings (`"2026-11-24T20:30:00.000Z"`).
* **Empty / Null Properties:** Prefer omitting optional fields over emitting `"property": null` or `"property": ""`.
* **Enum Values:** Serialize enums as meaningful string literals matching their TypeScript union representation.
* **Response Envelope:**
  * Success responses use `{ "apiVersion": "1.0", "data": { "kind": "sleek#...", ..., "items": [] } }` with `items` placed at the end of `data`.
  * Error responses use `{ "apiVersion": "1.0", "error": { "code": 403, "message": "...", "errors": [...] } }`.
* **Paging Properties:** Use `totalItems`, `itemsPerPage`, `pageIndex`, `totalPages`, `startIndex`, and `currentItemCount` inside `data`.

---

## 14. Bun Runtime & Testing Standard

* **Exclusive Runtime:** Use `bun` for execution, package management, and testing. Never invoke `node`, `npm`, `npx`, `pnpm`, or `yarn`.
* **Native Bun APIs:** Prefer `Bun.file()`, `Bun.write()`, `bun:crypto`, `Bun.env`, and `Bun.spawn()` over Node compatibility APIs.
* **Test Runner:** Execute tests exclusively via `bun test`.
* **Test File Naming:** Colocate test files alongside source files with `.test.ts` or `.spec.ts` suffixes.
* **Determinism:** Eliminate network access and unseeded randomness in unit tests. Every unit test must be isolated, in-memory, and fast (<5ms).
