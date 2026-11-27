# Google TypeScript Style Standard (`tsguide.md` Aligned)

Sleek adheres strictly to the **Google TypeScript Style Guide** ([`.refs/styleguide/tsguide.md`](file:///c:/Users/buffe/Desktop/Sleek/.refs/styleguide/tsguide.md)), the **Microsoft TypeScript Compiler Guidelines** ([`compiler-guidelines.md`](file:///c:/Users/buffe/Desktop/Sleek/.agents/rules/compiler-guidelines.md)), and **Microsoft VS Code Architecture** ([`vscode-architecture.md`](file:///c:/Users/buffe/Desktop/Sleek/.agents/rules/vscode-architecture.md)).

---

## 1. Source File Structure & Module Invariants

- **Modules, Not Namespaces**: Use standard ES modules (`import`/`export`). The `namespace Foo { ... }` construct is strictly banned.
- **No Mutable Exports**: Never export mutable variables (`export let` is banned). exports must be immutable (`export const`, `export function`, `export class`, `export interface`). If mutable internal state must be exposed, provide accessor functions (`getCounter()`).
- **No Container Classes**: Do not create classes containing only static methods. Use module-level exported functions instead.
- **Top-Level Named Functions**: Always use `function name(...) { ... }` declarations for top-level named functions. Never use `export const name = (...) => { ... }`. Function declarations guarantee clear stack traces during debugging and testing.
- **Explicit Type Imports & Exports**: Always use `import type { Foo }` and `export type { Bar }` when importing or re-exporting types.

---

## 2. Strict Typing & Soundness Invariants

- **Ban `any`**: Never use the `any` type. Use `unknown` for unbounded external data and narrow using type guards or Zod validation schemas.
- **Sound Nullability (Undefined Over Null)**: Handle `null` and `undefined` explicitly. Prefer `undefined` over `null` in domain models and function returns.
- **Ban `{}` and `Object` as Types**: The `{}` and `Object` types allow almost any value except `null` and `undefined`. For key-value dictionaries, use `Record<string, unknown>` or a concrete interface.
- **No Non-Null Assertions**: Avoid the `!` non-null assertion operator. Use explicit conditional checks or throw meaningful domain errors.
- **Array Types (GTS Simple Rule)**:
  - Use `T[]` for simple element types (`string[]`, `number[]`, `Guild[]`).
  - Use `Array<T>` or `ReadonlyArray<T>` for complex types (`Array<string | number>`, `ReadonlyArray<{ id: string }>`).
- **Interfaces Over Type Intersections**: Prefer `interface extends` over `type &` for object models to maximize compiler type-caching performance.
- **Disallowed Language Features**:
  - `const enum` is strictly banned (use string literal unions or standard `enum`).
  - Wrapper objects (`new String()`, `new Number()`, `new Boolean()`) are banned.
  - `eval()`, `with`, and `debugger` statements are strictly banned.

---

## 3. Function & Callback Declarations

- **Function Declarations for Named Functions**: Use `function name(...) { ... }` for top-level named functions.
- **Arrow Functions for Callbacks**: Use arrow functions (`(...) => { ... }`) for inline callbacks, array transforms (`.map()`, `.filter()`), and closures.
- **Explicit Return Types on Public Exports**: All exported top-level functions and public class methods must specify an explicit return type.

---

## 4. Asynchronous Safety & Promise Invariants

- **No Floating Promises (GTS Rule)**: Every `Promise` must be handled:
  - Await the promise: `await saveGuild(guild);`
  - Or explicitly discard with `void` for fire-and-forget: `void notifySubscribers(event);`
  - Never leave unhandled floating promises.
- **Async Functions**: Any function returning a `Promise` must be declared `async`.

---

## 5. Control Structures & Exception Handling

- **Strict Equality (`eqeqeq`)**: Always use `===` and `!==`. Never use loose `==` or `!=` except when checking for both `null` and `undefined` (`if (x == null)`).
- **Variable Declarations**:
  - `var` is strictly banned.
  - One variable declaration per statement (`const a = 1, b = 2;` is banned).
  - Use `const` by default for all bindings that are not reassigned.
  - Use `let` only when reassignment is necessary.
- **Only Throw `Error` Instances**:
  - Always throw an instance of `Error` (e.g. `throw new Error(...)`, `throw new DomainError(...)`).
  - Never throw primitive strings, numbers, or objects (`throw 'error'` is strictly banned).
  - When catching and re-throwing errors, preserve the underlying cause:
    ```ts
    try {
      await fetchRemoteData();
    } catch (err) {
      throw new Error('Failed to fetch remote data', { cause: err });
    }
    ```
- **No Test Focus Modifiers**:
  - Committing `describe.only`, `it.only`, or `test.only` is strictly banned. Verification gates will reject these commits.

---

## 6. Naming Conventions

- **Identifiers**:
  - `camelCase` for functions, methods, parameters, local variables, and object properties.
  - `PascalCase` for classes, interfaces, type aliases, enums, and components.
  - No `I` prefix for interface names (`Guild` not `IGuild`, except standard `IDisposable`).
  - `PascalCase` for enum values.
  - `UPPER_SNAKE_CASE` for global immutable constants.
  - Type parameters should be single uppercase letters (`T`, `U`) or descriptive names starting with `T` or ending with `T` (`TKey`, `ItemT`).
- **No Privacy Prefixes**:
  - Do not use underscore prefixes or suffixes (`_privateField` is banned). Use TypeScript's `private` or `#private` fields.

---

## 7. Discriminated Unions for Domain State

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
