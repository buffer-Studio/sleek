---
name: typescript-style-guide
description: Apply, review, and explain the unified Google TypeScript, Microsoft TypeScript Compiler, and Microsoft VS Code architecture standards in Sleek. Use automatically for tasks involving type modelling, discriminated unions, function APIs, variables, naming, source organization, lifecycle/disposables, or tests.
---

# Unified TypeScript Style Guide & Engineering Standards

Sleek unifies the engineering standards of:
1. **Google TypeScript Style Guide** (`tsguide.md` & `gts`)
2. **Microsoft TypeScript Compiler Team** (`Coding-guidelines.md` & `Performance.md`)
3. **Microsoft VS Code Team** (`Coding-Guidelines.md`, `Source-Code-Organization.md`, `Extension-API-guidelines.md`, `Writing-Tests.md`)
4. **Microsoft TSDoc Standard** (`@microsoft/tsdoc`)

---

## Operational Workflow

1. **Check Repository Invariants**: Respect Bun runtime, `tsrs` fast compilation, Microsoft TSDoc documentation, and zero-leak lifecycle contracts.
2. **Consult Targeted Topic References**:
   - [references/types.md](references/types.md) — Narrowing, `interface` caching over `type &` intersections, immutability, branded types, `satisfies`, and `undefined` over `null`.
   - [references/discriminated-unions.md](references/discriminated-unions.md) — Variant modeling, exhaustive matching with `assertNever`, bitflags for >2 booleans, and state machines.
   - [references/functions.md](references/functions.md) — Top-level `export function` declarations, closures over classes for pipelines, single-object parameters, and explicit return types.
   - [references/variables.md](references/variables.md) — Ban `var`, ban `const enum`, ban mutable exports (`export let`), const assertions, and absence representation.
   - [references/naming.md](references/naming.md) — PascalCase types without `I` prefix, PascalCase enums, camelCase identifiers, `on[Did|Will]VerbSubject` events, and TSDoc.
   - [references/source-organization.md](references/source-organization.md) — 5-tier layered architecture (`base` → `platform` → `editor` → `workbench` → `code`), environments (`common`, `node`), colocation, and contribution patterns.
   - [references/react.md](references/react.md) — Component props, state separation, unidirectional data flow, and hook disposables.
   - [references/tests.md](references/tests.md) — AAA pattern, isolated test doubles, disposable leak detection (`ensureNoDisposablesAreLeakedInTestSuite`), and zero `.only`.
3. **State Trade-Offs**: Present architectural trade-offs explicitly with concrete recommendations.
