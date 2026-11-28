---
name: typescript-source-organization
description: Apply, review, and explain TypeScript source organization conventions. Use automatically for tasks involving feature-based organization, code colocation, import paths, import sorting, monorepos, or frontend and backend project structure.
---

# Source Organization & Layered Architecture

Sleek organizes source code using Microsoft VS Code's 5-tier layered architecture and strict environment boundaries.

---

## 1. The 5 Architecture Layers

Dependency flow is strictly unidirectional (downward only):

1. **`code` / `entry`**: Application and CLI bootstrap entry points.
2. **`workbench`**: Contributions, orchestrators, and application UI.
3. **`core` / `editor`**: Core domain engines and calculations.
4. **`platform`**: Dependency injection contracts, service identifiers, and base services.
5. **`base`**: Pure utilities, collections, and primitives. Zero external dependencies.

```
src/
├── base/          # Zero-dependency utilities, collections, disposables
├── platform/      # DI contracts, service identifiers, storage
├── core/          # Domain models, core engine pipelines
├── workbench/     # Feature contributions, orchestrators
│   └── contrib/   # Modular feature packages
└── code/          # CLI and runtime bootstrapping
```

---

## 2. Target Environments (`common` vs `node`/`bun`)

Source code is partitioned by target runtime environment:

- **`common`**: Isomorphic code that requires only standard JavaScript / TypeScript runtime APIs. Runs in any JS engine. Never imports Node or Bun APIs.
- **`node` / `bun`**: Code requiring OS, filesystem, sockets, or process primitives.
- **Rule**: Code in `common` must never import from `node` or `bun`.

---

## 3. Contribution Pattern

Every feature in `workbench/contrib/` follows the self-contained contribution pattern:

- **Entrypoint**: A single `*.contribution.ts` file registers the feature into the service container or workbench.
- **Public Facade**: The feature exposes its public contracts through a single common file (e.g. `contrib/search/common/search.ts`).
- **No Internal Leaks**: Outside code must never import private files within `contrib/search/`. All communication goes through the public facade or registered services.

---

## 4. One File Per Logical Component (Compiler Standard)

- Group code by single logical responsibility.
- Place shared types in `types.ts`.
- Place unit tests in collocated `*.test.ts` files adjacent to the source under test.
