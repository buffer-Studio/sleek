# Testing Standards & Zero-Leak Verification

Sleek test suites adhere to the **AAA Pattern** (Arrange, Act, Assert) executed via **`bun test`**, with VS Code-grade disposable teardown verification.

---

## 1. AAA Pattern (Arrange, Act, Assert)

Structure every unit and integration test into three clear phases:

```ts
import { describe, expect, it } from 'bun:test';
import { calculateBackoff } from './backoff';

describe('calculateBackoff', () => {
  it('calculates exponential delay with base multiplier', () => {
    // Arrange
    const attempt = 3;
    const baseDelay = 100;

    // Act
    const result = calculateBackoff(attempt, baseDelay);

    // Assert
    expect(result).toBe(800);
  });
});
```

---

## 2. Ban Test Focus Modifiers (`GTS001`)

Never commit test isolation modifiers (`describe.only`, `it.only`, `test.only`). Verification gates (`bun run verify`) will reject these with exit code `30`.

---

## 3. Lifecycle Teardown & Zero Memory Leaks (VS Code Standard)

Any test creating background intervals, event listeners, or service containers must ensure clean teardown:

```ts
import { describe, it, setup, teardown } from 'bun:test';

describe('MetricService', () => {
  let service: MetricService | undefined;

  setup(() => {
    service = new MetricService();
  });

  teardown(() => {
    service?.dispose();
    service = undefined;
  });

  it('collects metrics without leaking timers', () => {
    // Test logic
  });
});
```

---

## 4. Deterministic Test Doubles

- Avoid real network or timer dependencies in unit tests.
- Use explicit in-memory mocks and stubs.
- Clean up mocks in `teardown()` to prevent test pollution.
