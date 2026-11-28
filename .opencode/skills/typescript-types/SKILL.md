---
name: typescript-types
description: Apply, review, and explain TypeScript type conventions. Use automatically for tasks involving inference, readonly data, type-safe constants, template literal types, any and unknown, assertions, type errors, type definitions, arrays, type imports, or generated service types.
---

# TypeScript Types & Compiler Optimization

Expressive, narrow typing ensures compile-time safety and self-documenting code.

---

## 1. Type Narrowing & Inference

Explicitly declare types when narrowing wide inference; rely on inference when the compiler infers the exact narrowed literal:

```ts
// ❌ Avoid redundant or wide declarations
const userRole: string = 'admin'; // Inferred as wide 'string'
const map = new Map(); // Inferred as Map<any, any>

// ✅ Use narrowed types
type UserRole = 'admin' | 'moderator' | 'member';
const currentRole: UserRole = 'admin';
const cache = new Map<string, number>();
```

---

## 2. Compiler Optimization: Interfaces vs Intersections (`Performance.md`)

In `tsrs` and `tsc`, `interface extends` creates flat, cached type entries. Intersections (`type &`) calculate recursive relationships on every check:

```ts
// ❌ Slow: Recursive intersection recalculation
export type UserSession = User & Session & Permissions;

// ✅ Fast: Flat cached interface
export interface UserSession extends User, Session, Permissions {}
```

- Always use `interface extends` for object shapes.
- Reserve `type` aliases for unions, primitives, tuples, and mapped types.

---

## 3. Data Immutability

Mark properties and arrays immutable by default:

```ts
export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly allowedOrigins: readonly string[];
}
```

Use `as const` for fixed lookup tables and literal tuples:
```ts
export const HTTP_STATUS = {
  OK: 200,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
} as const;
```

---

## 4. Strict Typing: Ban `any`

Never use `any`. Use `unknown` for unbounded external data and narrow with type guards or schemas:

```ts
// ❌ Unsafe
export function parsePayload(raw: any): string {
  return raw.data.name;
}

// ✅ Safe narrowing
export function parsePayload(raw: unknown): string {
  if (typeof raw === 'object' && raw !== null && 'name' in raw) {
    const candidate = (raw as Record<string, unknown>).name;
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  throw new Error("Invalid payload: missing 'name' string property.");
}
```

---

## 5. Branded Nominal Types

Prevent accidental mixing of identical primitive types (e.g. `UserId` vs `GuildId`):

```ts
export type UserId = string & { readonly __brand: unique symbol };
export type GuildId = string & { readonly __brand: unique symbol };

export function createUserId(id: string): UserId {
  return id as UserId;
}
```

---

## 6. Type Assertions: Prefer `satisfies`

Use `satisfies` to validate type conformity without widening literal types:

```ts
// ✅ Validates shape while preserving specific literal keys
export const palette = {
  primary: '#0055ff',
  secondary: '#ff5500',
} satisfies Record<string, string>;
```

---

## 7. File Structure: Types Defined First (Compiler Rule)

Within every file, type definitions (`interface`, `type`, `enum`) must appear before functions and classes. Shared types across multiple files must reside in `types.ts`.
