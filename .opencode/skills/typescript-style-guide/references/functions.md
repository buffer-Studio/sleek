# Functions & Pipelines

Write clear, predictable, and maintainable functions adhering to Google TS, TS Compiler, and VS Code standards.

---

## 1. Top-Level Named Functions (Google TS & VS Code Rule)

Always use `function name(...) { ... }` declarations for top-level exported functions. Never use `export const name = (...) => { ... }`:

```ts
// ❌ Avoid: Exported arrow function assignment
export const formatGuildName = (name: string): string => name.trim();

// ✅ Use: Function declaration (guarantees clear stack traces during debugging)
export function formatGuildName(name: string): string {
  return name.trim();
}
```

Use arrow functions for callbacks, array transforms (`.map()`, `.filter()`), and inline closures.

---

## 2. Closures Over Classes in Core Pipelines (TS Compiler Rule)

For high-throughput execution pipelines, avoid class hierarchies. Use function closures:

```ts
export interface TokenScanner {
  readonly nextToken: () => Token;
  readonly getPosition: () => number;
}

export function createTokenScanner(source: string): TokenScanner {
  let pos = 0;

  function nextToken(): Token {
    // Pipeline logic
    return { kind: TokenKind.Identifier, pos: pos++ };
  }

  function getPosition(): number {
    return pos;
  }

  return { nextToken, getPosition };
}
```

---

## 3. Explicit Return Types

All exported functions and public methods must specify an explicit return type:

```ts
// ✅ Explicit return type prevents compiler inference cascade
export function calculateChecksum(buffer: Uint8Array): string {
  return Buffer.from(buffer).toString('hex');
}
```

---

## 4. Single-Object Parameters for Multi-Argument Functions

When a function accepts more than 3 parameters, package them into a typed options interface:

```ts
// ❌ Hard to read and error-prone positional arguments
export function connect(host: string, port: number, retry: boolean, timeout: number): Connection { ... }

// ✅ Clear, named options object
export interface ConnectOptions {
  readonly host: string;
  readonly port: number;
  readonly retry?: boolean;
  readonly timeout?: number;
}

export function connect(options: ConnectOptions): Connection {
  const { host, port, retry = false, timeout = 5000 } = options;
  // ...
}
```

---

## 5. Early Return Guard Clauses

Keep nesting depth $\le 3$. Check preconditions early and return:

```ts
export function processMessage(message?: Message): void {
  if (!message) {
    return;
  }
  if (!message.content.trim()) {
    return;
  }
  dispatch(message);
}
```
