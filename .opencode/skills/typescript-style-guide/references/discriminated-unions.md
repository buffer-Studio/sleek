# Discriminated Unions & State Modeling

Discriminated unions model mutually exclusive states, preventing invalid states at compile time.

---

## 1. Discriminated Union Structure

Every variant must share a common literal discriminator tag (e.g. `kind`, `status`, or `type`):

```ts
export type NetworkRequestState<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly startedAt: number }
  | { readonly status: 'success'; readonly data: T; readonly receivedAt: number }
  | { readonly status: 'error'; readonly error: Error };
```

---

## 2. Exhaustive Matching (`assertNever`)

Always provide an exhaustive `default` case using an `assertNever` helper:

```ts
export function assertNever(value: never): never {
  throw new Error(`Unhandled discriminated union variant: ${JSON.stringify(value)}`);
}

export function renderState<T>(state: NetworkRequestState<T>): string {
  switch (state.status) {
    case 'idle':
      return 'Ready';
    case 'loading':
      return `Loading since ${state.startedAt}...`;
    case 'success':
      return 'Completed successfully';
    case 'error':
      return `Failed: ${state.error.message}`;
    default:
      return assertNever(state);
  }
}
```

---

## 3. Bitflags vs Discriminated Unions (Compiler Rule)

- Use **Discriminated Unions** when variants have different accompanying payload data.
- Use **Bitflag Enums** when an entity has more than 2 related, independent boolean flags:

```ts
export enum MemberFlags {
  None = 0,
  Verified = 1 << 0,
  Bot = 1 << 1,
  Muted = 1 << 2,
  Admin = 1 << 3,
}

export interface GuildMember {
  readonly id: string;
  readonly flags: MemberFlags;
}

export function isMemberAdmin(member: GuildMember): boolean {
  return (member.flags & MemberFlags.Admin) !== 0;
}
```
