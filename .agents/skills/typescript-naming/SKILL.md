---
name: typescript-naming
description: Apply, review, and explain TypeScript naming conventions. Use automatically for tasks involving exports, identifiers, generic type parameters, acronyms, React props and handlers, hooks, comments, or TSDoc.
---

# Naming Conventions & TSDoc Standards

Consistent naming improves code readability and developer velocity.

---

## 1. Identifier Conventions

| Entity | Casing | Example | Notes |
| :--- | :--- | :--- | :--- |
| **Interfaces / Types** | `PascalCase` | `GuildMember`, `SessionToken` | **No `I` prefix** (TS compiler standard: `Guild` not `IGuild`) |
| **Classes** | `PascalCase` | `ServiceContainer`, `TokenParser` | Concrete implementations |
| **Enums** | `PascalCase` | `HttpMethod`, `TokenKind` | Enum members must also be `PascalCase` (`HttpMethod.Get`) |
| **Functions / Methods** | `camelCase` | `parseHeader()`, `createSession()` | Active verb-first naming |
| **Variables / Properties**| `camelCase` | `userCount`, `timeoutMs` | Whole words; no cryptic abbreviations |
| **Global Constants** | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT`, `DEFAULT_TIMEOUT` | Truly immutable top-level constants |
| **Type Parameters** | Single letter or `T`-prefixed | `T`, `U`, `TKey`, `TValue` | Clear generic parameters |

---

## 2. No Privacy Prefixes

Do not use underscore prefixes (`_privateMethod` is banned). Use TypeScript's `private` keyword or ECMAScript `#private` fields.

---

## 3. Event Naming: `on[Did|Will]VerbSubject` (VS Code Standard)

Events follow the VS Code standard event naming pattern:

- `onDidChangeActiveSession`
- `onWillSaveDocument`
- `onDidCreateResource`
- `onDidTerminateProcess`

---

## 4. Boolean Variables

Prefix boolean variables and properties with `is`, `has`, `can`, or `should`:

```ts
const isValid = validateToken(token);
const hasPermission = checkAcl(user);
const canRetry = attempts < MAX_ATTEMPTS;
```

---

## 5. Microsoft TSDoc Standard (`@microsoft/tsdoc`)

All public exported symbols (`export function`, `export class`, `export interface`, `export type`) must include TSDoc comments:

```ts
/**
 * Calculates exponential backoff delay with randomized jitter.
 *
 * @param attempt - The zero-indexed retry attempt number.
 * @param baseDelayMs - Base delay duration in milliseconds.
 * @returns The calculated backoff delay in milliseconds.
 * @throws {RangeError} Thrown when attempt is negative.
 */
export function calculateBackoff(attempt: number, baseDelayMs = 100): number {
  if (attempt < 0) {
    throw new RangeError('Attempt index must not be negative.');
  }
  return Math.min(baseDelayMs * 2 ** attempt, 30_000);
}
```
