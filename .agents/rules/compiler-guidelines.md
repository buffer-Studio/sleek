# Microsoft TypeScript Compiler Engineering Guidelines

Sleek incorporates the operational and architectural standards used by the **Microsoft TypeScript Compiler Team** ([`.refs/TypeScript.wiki/Coding-guidelines.md`](file:///c:/Users/buffe/Desktop/Sleek/.refs/TypeScript.wiki/Coding-guidelines.md) and [`Performance.md`](file:///c:/Users/buffe/Desktop/Sleek/.refs/TypeScript.wiki/Performance.md)).

---

## 1. Component & File Anatomy

- **One File Per Logical Component**: Group code by distinct logical responsibility (e.g. scanner, parser, checker, emitter).
- **Types Defined First**: Within any TypeScript file, type declarations (`interface`, `type`, `enum`) must precede functions and classes.
- **Shared Types in `types.ts`**: Types shared across multiple components within a feature or domain must be defined in a collocated `types.ts` file.
- **Minimal Export Surface**: Do not export types or functions unless required by multiple components. Keep helper utilities private to their module.
- **Generated Code Suffix**: Any machine-generated files must use the `.generated.*` suffix (e.g. `schema.generated.ts`). Never manually edit generated files.

---

## 2. Immutability Invariants

- **Immutable Data Structures**: Treat domain entities, AST nodes, and data transfer objects as immutable outside the component that created them.
- **Immutable Arrays**: Treat arrays as immutable after creation. Prefer `ReadonlyArray<T>` or `readonly T[]` for public signatures and stored state.
- **Pure Transformations**: Favor pure array transforms (`.map()`, `.filter()`, `.reduce()`) over mutating loops (`.push()`, `.splice()`).

---

## 3. Functional Pipelines Over Classes

- **Closures Over Classes**: For consistency, high throughput, and memory efficiency, avoid class hierarchies in core execution pipelines. Use pure function closures and modules.
- **Stateless Operations**: Functions in pipeline stages must accept all needed state via parameters and return new immutable values.
- **No `for..in` Loops**: Never use `for..in` statements. Use `for..of Object.keys()`, `for..of Object.values()`, or array higher-order methods.

---

## 4. Boolean Explosion Prevention (Flag Bitfields)

- **Flag Bitfields for >2 Booleans**: When an entity or node type requires more than 2 related boolean properties, do not add individual boolean fields. Instead, define an enum flag bitfield:
  ```ts
  export enum EntityFlags {
    None = 0,
    Active = 1 << 0,
    Verified = 1 << 1,
    Suspended = 1 << 2,
    SystemAdmin = 1 << 3,
  }

  export interface UserAccount {
    readonly id: string;
    readonly username: string;
    readonly flags: EntityFlags;
  }
  ```
- **Bitwise Checking**: Use bitwise operations (`(flags & EntityFlags.Active) !== 0`) to test state, reducing memory allocation and object layout overhead.

---

## 5. Strict Nullability: Exclusive Preference for `undefined`

- **Use `undefined`, Ban `null`**: Follow TypeScript compiler convention: represent absence with `undefined`. Do not introduce `null` into internal domain models or function returns.
- **Optional Properties**: Declare missing properties as optional (`age?: number`), which yields `number | undefined`.
- **Interoperability**: When consuming third-party APIs that return `null`, immediately normalize the boundary value to `undefined` or a tagged union.

---

## 6. Compiler Performance & Type Optimization (`Performance.md`)

- **Interfaces Over Type Intersections**: Prefer `interface extends` over `type &` for object types. Interfaces create flat, cached shapes in `tsrs`/`tsc`, while intersections recalculate relationships recursively:
  ```ts
  // ✅ Fast: Flat cached interface
  export interface UserWithProfile extends User, Profile {}

  // ❌ Slow: Recursive intersection type
  export type UserWithProfile = User & Profile;
  ```
- **Explicit Return Types on Exports**: All exported functions and methods must provide explicit return type annotations. This prevents the compiler from running expensive deep-type inference cascades across file boundaries.
- **Name Complex Types**: Do not inline large anonymous object types or complex mapped types in function signatures. Assign them a named `type` or `interface`.
- **Avoid Deeply Nested Unions**: Keep discriminated union variants focused. Excessively large unions (>50 variants) should be partitioned into hierarchical sub-unions.

---

## 7. Diagnostic Message Grammar & Codes

All internal diagnostic, validation, and error messages must adhere to compiler grammar standards:

- **Indefinite Entities**: Use indefinite articles ("A property...", "An argument...").
- **Definite Entities**: Name the exact entity ("Property 'id' is missing...").
- **Singular Subjects**: When stating rules, the subject must be singular ("A guild cannot...", not "Guilds cannot...").
- **Tense & Punctuation**: Use active voice, present tense, and end with a period.
- **Diagnostic Code Ranges**:
  - `1000–1999`: Syntactic and structure diagnostics.
  - `2000–2999`: Semantic, domain, and validation diagnostics.
  - `4000–4999`: Serialization and contract diagnostics.
  - `5000–5999`: Configuration and options diagnostics.
