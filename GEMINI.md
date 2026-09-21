# Global Rules — BeMe (Figma AI Plugin)

## Workflow

- Treat this file as the default engineering workflow for the project.
- Before changing code, inspect the repository's `AGENTS.md`, package scripts, and Figma plugin API guidelines; local project rules override this file when they conflict.
- For each issue: inspect the problem, make the smallest scoped change, verify it with the project's checks (`bun run build`), and summarize changed files and verification results.
- Preserve unrelated user changes and do not perform destructive operations unless explicitly requested.
- These rules are hard constraints. Follow them consistently across the codebase.

## Package Manager

- Use **Bun** exclusively: `bun install`, `bun add`, `bun run <script>`, `bunx`.
- **Never use npm/yarn/pnpm — never run `npm` commands.**
- Root scripts:
  - `bun run build`: Build both code and UI bundles into `dist/`.
  - `bun run build:code`: Build Figma sandbox script (`src/code.ts` → `dist/code.js`).
  - `bun run build:ui`: Build Figma UI single-file bundle (`src/ui/index.html` → `dist/index.html`).
  - `bun run watch`: Concurrently watch and build sandbox and UI.
  - `bun run proxy`: Run the LLM proxy server.
  - `bun run proxy:dev`: Run the LLM proxy server with hot reload (`bun --watch server.js`).

## Core Principles

- **The unplug test:** A feature or utility module must be self-contained. Removing one module must not break unrelated features.
- **Dependency direction:** Clean separation between sandbox (`src/code.ts`), core libraries (`src/lib/`), UI shell (`src/ui/`), and proxy (`proxy/`). Dependencies flow inward: `ui` / `code` → `lib` → pure types.
- Keep components and helpers swappable: no tight coupling or cyclic dependencies.

## Minimal Code

- Write the **least amount of code** that solves the problem correctly. No speculative features, no premature abstraction.
- One line of well-named code beats ten lines of clever code. Favor readability and simplicity over brevity tricks, but never add code that does nothing.
- No boilerplate repetition — extract helpers only when the same logic is needed 2+ times. Keep helpers small and single-purpose.
- Delete dead code as you find it; do not leave commented-out blocks, unused imports, or unused variables behind.
- Solve with existing utilities before writing anything new.

## TypeScript Typing

- **NEVER use `any`** — no `any` annotations, no `as any` casts, no `Foo<any>` generics, no implicit `any`. Everything must be explicitly and precisely typed.
- **NEVER use the `never` type** as an escape hatch, and avoid loose or undefined types. Types must be defined.
- If a Figma typing gap exists (e.g. `boundVariables` or paint bindings), define a dedicated interface in `src/lib/types.ts` rather than falling back to `any`.
- Safely handle `figma.mixed` using guarded helper checks (e.g., `tryGet` or checking `value === figma.mixed`) to avoid runtime crashes in Figma.

## Hard Boundaries

- **Sandbox vs. UI:**
  - `src/code.ts` runs inside the Figma sandbox with access to the `figma` global document object. It has NO DOM access.
  - `src/ui/` runs inside an iframe with full DOM and browser APIs. It has NO access to `figma.*` globals.
  - Communication between the sandbox and UI is **strictly message-based** via `figma.ui.postMessage` and `parent.postMessage`.
  - All messages must conform to the `PluginMessage` discriminated union in `src/lib/types.ts`.
- **UI vs. Proxy:**
  - The UI connects to the local proxy via HTTP (`http://localhost:3000/api/llm`).
  - API keys are NEVER stored in plugin frontend code; they reside in `proxy/.env`.
- **Proxy Server:**
  - `proxy/server.js` runs via Bun/Node as a lightweight Express service. Keep dependencies minimal.

## Naming Conventions

- **Files:** `kebab-case.ts` (e.g. `scanner.ts`, `normalizer.ts`).
- **Interfaces & Types:** `PascalCase` (e.g. `ComponentSpec`, `PluginMessage`, `DsCatalog`).
- **Functions & Variables:** `camelCase` (e.g. `scanCurrentFile`, `handleExecuteSpec`).
- **Constants & Union Literals:** `SCREAMING_SNAKE_CASE` (e.g. `BUILD_TARGET`, message types like `"EXECUTE_SPEC"`).
- Names must be descriptive and specific — avoid single-letter or vague variable names (`x`, `data`, `temp`, `obj`).

## Verification (Before Finishing Any Task)

- Run `bun run build` and ensure both code and UI bundles compile cleanly without errors.
- Confirm that outputs in `dist/` (`dist/code.js` and `dist/index.html`) match the entries in `manifest.json`.
- Test proxy startup if proxy code was modified: `bun run proxy:dev`.
- Maintain clean git status and do not commit temporary files or secrets (`.env`).

## Writing Style

- Be concise and direct. No filler, no over-explaining.
- When a rule has an obvious reason, state it in one line; do not restate agent defaults.
