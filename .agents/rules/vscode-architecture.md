# Microsoft VS Code Architecture & Engineering Guidelines

Sleek incorporates the operational and architectural standards used by the **Microsoft VS Code Team** ([`.refs/vscode.wiki/Coding-Guidelines.md`](file:///c:/Users/buffe/Desktop/Sleek/.refs/vscode.wiki/Coding-Guidelines.md), [`Source-Code-Organization.md`](file:///c:/Users/buffe/Desktop/Sleek/.refs/vscode.wiki/Source-Code-Organization.md), [`Extension-API-guidelines.md`](file:///c:/Users/buffe/Desktop/Sleek/.refs/vscode.wiki/Extension-API-guidelines.md), and [`Writing-Tests.md`](file:///c:/Users/buffe/Desktop/Sleek/.refs/vscode.wiki/Writing-Tests.md)).

---

## 1. Layered Architecture

Sleek code is partitioned into strict horizontal layers with unidirectional dependency flow (layers may only import from layers below them):

```
┌──────────────────────────────────────────────┐
│  code / entry        (CLI, App bootstrapping)│
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│  workbench           (Contributions, UI, Hub)│
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│  editor / core       (Core domain engines)   │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│  platform            (DI Services & registry)│
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│  base                (Pure utils & primitives│
└──────────────────────────────────────────────┘
```

- **`base`**: General utilities, collections, string/math primitives, and disposable containers. Must have zero external dependencies and zero platform/service awareness.
- **`platform`**: Dependency injection contracts, service identifiers, and base services shared across domains.
- **`core` / `editor`**: Core engine logic and domain calculations. Must never depend on `workbench` or application-level entry points.
- **`workbench`**: Feature contributions, lifecycle coordinators, and application panels.
- **`code`**: Entry points that stitch layers together and start the application.

---

## 2. Target Runtime Environments

Source code is partitioned by target runtime environment to prevent platform API leakage:

- **`common`**: Isomorphic code that requires only standard JavaScript / TypeScript runtime APIs. Runs identically anywhere. Never imports Node or Bun APIs.
- **`node` / `bun`**: Code that requires operating system, file system, network socket, or process APIs.
- **Boundary Invariant**: Code in `common` must never import from `node` or `bun`.

---

## 3. Dependency Injection & Service Registry

- **Constructor Injection**: Services are consumed via constructor parameters decorated with service identifiers:
  ```ts
  export interface IConfigService {
    readonly get: (key: string) => string | undefined;
  }
  export const IConfigService = createServiceDecorator<IConfigService>('configService');

  export class ConfigConsumer {
    public constructor(@IConfigService private readonly configService: IConfigService) {}
  }
  ```
- **Singleton Registration**: Services are registered into the service container using `registerSingleton` with delayed (lazy) instantiation:
  ```ts
  registerSingleton(IConfigService, ConfigService, InstantiationType.Delayed);
  ```
- **Interface vs Implementation**: Consumers must depend exclusively on the service interface, never the concrete implementation class.

---

## 4. Contribution Pattern

- **Single `.contribution.ts` Entrypoint**: Every modular feature or contribution registers itself via a single `.contribution.ts` file (e.g. `src/workbench/contrib/search/search.contribution.ts`).
- **Internal API Facade**: Every contribution exposes its public surface through a single common contract file (e.g. `src/workbench/contrib/search/common/search.ts`).
- **No Internal Reaching**: Code outside a contribution must never import private files inside that contribution. Only the common contract file may be imported.
- **Zero Outside Inward Coupling**: No code in `base`, `platform`, or `core` may import from `contrib`.

---

## 5. Lifecycle Management & Disposable Invariants

- **The `IDisposable` Contract**: Any object managing intervals, listeners, sockets, or allocated native handles must implement `IDisposable`:
  ```ts
  export interface IDisposable {
    dispose(): void;
  }
  ```
- **`DisposableStore`**: Group related disposables in a `DisposableStore` to guarantee deterministic cleanup:
  ```ts
  export class MetricMonitor implements IDisposable {
    private readonly disposables = new DisposableStore();

    public constructor() {
      const timer = setInterval(() => this.tick(), 1000);
      this.disposables.add({ dispose: () => clearInterval(timer) });
    }

    public dispose(): void {
      this.disposables.dispose();
    }
  }
  ```
- **Zero Leak Verification in Tests**: Test suites must verify that no disposables are leaked using teardown assertions (`ensureNoDisposablesAreLeakedInTestSuite()`).

---

## 6. Shy Objects (API Encapsulation)

- **Do Not Leak Internals**: Public objects handed out by APIs must contain only what the interface contract defines.
- **Encapsulate Hidden State**: Hide internal implementation state using module closures or `#private` fields. Never expose internal properties that users might inadvertently program against.

---

## 7. Event Model & Ergonomics

- **Event Naming**: Domain events follow the `on[Did|Will]VerbSubject` pattern:
  - `onDidChangeActiveSession`
  - `onWillSaveDocument`
  - `onDidCreateResource`
- **Global Event Pattern**: Events are exposed from top-level namespaces or services, passing the affected entity in the event payload. This avoids managing subscriptions across millions of individual transient objects.
- **Fast Synchronous Reads**: State reading must be synchronous from memory cache. State mutations may execute asynchronously in the background while updating the local cache synchronously.
