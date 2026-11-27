---
name: typescript-react
description: Apply, review, and explain React conventions from the TypeScript Style Guide. Use automatically for TypeScript and TSX tasks involving prop-derived state, prop typing, component responsibilities, data flow, compound components, or client and server state.
---

# React & Component Design Standards

Conventions for React components, props modeling, and hook lifecycles.

---

## 1. Functional Components & Explicit Props

Always use functional components with explicit props interfaces:

```tsx
export interface UserBadgeProps {
  readonly username: string;
  readonly avatarUrl?: string;
  readonly isOnline?: boolean;
}

export function UserBadge({ username, avatarUrl, isOnline = false }: UserBadgeProps): JSX.Element {
  return (
    <div className="user-badge">
      {avatarUrl && <img src={avatarUrl} alt={username} />}
      <span className="username">{username}</span>
      {isOnline && <span className="status-indicator" />}
    </div>
  );
}
```

---

## 2. Discriminated Union Props

Use discriminated unions to represent mutually exclusive component states, preventing impossible prop combinations:

```tsx
export type StatusCardProps =
  | { readonly status: 'success'; readonly transactionId: string }
  | { readonly status: 'error'; readonly errorMessage: string }
  | { readonly status: 'loading' };

export function StatusCard(props: StatusCardProps): JSX.Element {
  switch (props.status) {
    case 'success':
      return <div className="card-success">Success: {props.transactionId}</div>;
    case 'error':
      return <div className="card-error">Error: {props.errorMessage}</div>;
    case 'loading':
      return <div className="card-loading">Loading...</div>;
  }
}
```

---

## 3. Clean Hook Lifecycles & Disposables

When subscribing to external resources inside `useEffect`, return an explicit cleanup function to prevent memory leaks:

```tsx
export function useEventSubscription<T>(
  eventEmitter: EventEmitter<T>,
  handler: (data: T) => void,
): void {
  useEffect(() => {
    const disposable = eventEmitter.subscribe(handler);
    return () => {
      disposable.dispose();
    };
  }, [eventEmitter, handler]);
}
```
