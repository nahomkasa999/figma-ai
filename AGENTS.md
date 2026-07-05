# AGENTS.md — Cursor for Design

## Project Overview
AI-powered Figma plugin that scans a Figma document (variables, components, text styles), sends the catalog + a user prompt to an LLM (via a local proxy with multiple backends), then generates new Figma frames/components from the LLM's JSON response. Includes a **normalizer layer** that classifies design tokens by role and serves an AI-friendly curated spec.

## Tech Stack
- **Language:** TypeScript (ES2020, strict mode), vanilla JS for proxy
- **Build:** Vite 5 + `vite-plugin-singlefile` (UI inlined to single HTML)
- **Test/Lint:** None configured
- **Figma:** `@figma/plugin-typings` v1.106
- **LLM providers:** Google Gemini (`gemini-flash-latest`) + NVIDIA (`z-ai/glm-5.2`) via local Express proxy, with auto-fallback
- **Proxy:** Express 4 + CORS, plain JS ESM (NO TypeScript syntax), auto-restart via `node --watch`

## Directory Layout
```
├── src/
│   ├── code.ts              # Figma sandbox entry: scanning + node creation
│   ├── lib/
│   │   ├── types.ts         # All TS interfaces (VarEntry, ComponentSpec, ChildSpec, NormalizedCatalog, etc.)
│   │   ├── scanner.ts       # Document scanner (thin + rich catalog)
│   │   ├── normalizer.ts    # Token normalizer: role classification, dedup, spacing scale, fingerprint
│   │   ├── prompts.ts       # LLM prompt builder (normalized path + legacy fallback)
│   │   ├── retriever.ts     # Relevance retrieval for large catalogs (legacy fallback only)
│   │   ├── safety.ts        # Operation size classification (direct vs preview)
│   │   └── validator.ts     # Spec validation
│   └── ui/
│       ├── index.html       # UI shell (context bar with provider toggle + new session)
│       ├── main.ts          # Chat UI logic, LLM call, attachment bar, split detail view
│       ├── resolver.ts      # @ref frame reference resolver
│       └── styles.css       # Dark-theme CSS
├── proxy/
│   ├── .env                 # GEMINI_API_KEY + NVIDIA_API_KEY + PORT
│   ├── server.js            # Express proxy -> Gemini + NVIDIA (plain JS, no TS syntax)
│   └── package.json
├── manifest.json            # Figma plugin manifest
├── vite.config.ts           # Dual-target build (code CJS + UI single-file)
├── tsconfig.json
└── package.json
```

## Build/Run Commands
### Plugin (root)
| Command | Action |
|---------|--------|
| `npm run build` | Full production build (code + UI) |
| `npm run build:code` | Build `src/code.ts` → `dist/code.js` (CJS) |
| `npm run build:ui` | Build UI → `dist/index.html` (single-file) |
| `npm run watch` | Watch both code + UI concurrently |

### Proxy (`proxy/`)
| Command | Action |
|---------|--------|
| `npm start` | Start Express server |
| `npm run dev` | Start with auto-restart (`node --watch`) |

## Architecture
- **Message-driven:** Figma sandbox ↔ UI communicate via `postMessage` / `PluginMessage` discriminated union
- **No framework:** Vanilla TS in both sandbox and UI; direct DOM manipulation
- **No classes:** Functions + module-level state throughout
- **Dual catalog:** "Thin" `DsCatalog` (fast) vs "Rich" `RichCatalog` (full anatomy, groups, modes, text styles)
- **Normalizer layer** (`normalizer.ts`): converts `RichCatalog` → `NormalizedCatalog`; classifies color tokens by role (background/text/border/accent/surface/semantic), dedupes aliases, infers spacing scale, computes style fingerprint
- **Attachment system:** User-selected Figma nodes are extracted into `SelectionAttachment` with rich `rawDump` (native Figma properties) and displayed as a split view (FIGMA RAW | AI SPEC) — the AI SPEC side is an AI-friendly prompt with creation rules, bound variable IDs, and usage hints
- **Provider toggle:** UI has an `Auto` button cycling through Auto → Gemini → NVIDIA, passed as `provider` field to the proxy

## Coding Conventions
- **Files:** `kebab-case.ts`
- **Interfaces:** PascalCase
- **Functions/Vars:** camelCase
- **Constants:** UPPER_SNAKE_CASE string union types (no enums)
- **Error handling:** `try/catch` with `console.error`; many empty `catch {}` blocks
- **`as any` casts** used for `boundVariables` / `setBoundVariableForPaint` (Figma typings gap)
- **`isolatedModules: true`** — each file is a standalone module
- **`proxy/server.js` is plain JS ESM** — NO TypeScript syntax (`: string`, `as const`, `Record<>`, etc.) — Node.js runs it directly
- **`escapeHtml()` in `main.ts`** used before injecting `rawDump` / `buildAISpec` into innerHTML
- **`tryGet(() => ...)` wrapper** in `code.ts` safely handles `figma.mixed` without crashing

## Known Issues / Gotchas
1. **`.env` in proxy/ contains live API keys** — do not commit publicly.
2. **No `.gitignore`** — `node_modules/` would be tracked if git is initialized.
3. **`manifest.json`** allows `localhost:3000`, `localhost:3001`, and `nvidia.com` domains.
4. **`workbench/` dir** is empty (placeholder for future features).
5. **`renderChildTree` doesn't use `resolvedVars`** for child-level variable names (only top-level attachment uses it from `resolvedVars` map).
6. **`retriever.ts` is legacy-only** — the normalized path (`buildSystemPrompt` with `NormalizedCatalog`) bypasses it entirely.
