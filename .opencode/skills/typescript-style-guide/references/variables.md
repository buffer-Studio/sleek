# Variables, Enums & Absence Representation

Guidelines for variable declarations, enum usage, and absence representation.

---

## 1. Variable Declarations: Ban `var`

- `var` is strictly banned (`GTS002`).
- Use `const` by default for all variable bindings.
- Use `let` only when reassignment is required.
- Declare one variable per statement (`const x = 1, y = 2;` is banned).

---

## 2. Ban `const enum` & Mutable Exports

- **No `const enum` (`GTS006`)**: Never use `const enum`. Use standard `enum` or string literal unions:
  ```ts
  // ❌ Banned
  export const enum ChannelType { Text, Voice }

  // ✅ Allowed
  export enum ChannelType {
    Text = 'text',
    Voice = 'voice',
  }
  // OR
  export type ChannelType = 'text' | 'voice';
  ```
- **No Mutable Exports (`GTS008`)**: Never use `export let` or `export var`. All exports must be immutable (`export const`, `export function`, `export class`). Use accessor functions for mutable internal state.

---

## 3. Absence Representation: Prefer `undefined` (TS Compiler Standard)

In Sleek domain models, represent absence using `undefined` exclusively. Do not introduce `null` into internal types:

```ts
// ❌ Avoid null in domain interfaces
export interface UserProfile {
  readonly bio: string | null;
}

// ✅ Use undefined (or optional field)
export interface UserProfile {
  readonly bio?: string; // string | undefined
}
```

Normalize boundary `null` values from external libraries to `undefined` upon ingestion.

---

## 4. Const Assertions (`as const`)

Use `as const` to freeze primitive literals and array tuples:

```ts
export const DEFAULT_PAGE_SIZES = [10, 25, 50, 100] as const;
export type PageSize = (typeof DEFAULT_PAGE_SIZES)[number];
```
