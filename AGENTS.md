# AGENTS.md — BeMe (AI-Powered Figma Plugin)

## Project Overview

**BeMe** is an AI-powered Figma plugin that scans an active Figma document (design tokens, variables, component anatomy, text styles), presents a curated UI inside Figma, sends context-aware design specs to an LLM via a local proxy, and generates Figma frames/components based on structured JSON responses.

It features:
- **Design System Normalizer:** Classifies design tokens by semantic role (`background`, `text`, `border`, `accent`, `surface`), deduplicates aliases, infers spacing scales, and computes style fingerprints.
- **Attachment & Reference System:** Captures user-selected Figma nodes, provides a dual view (FIGMA RAW | AI SPEC), and resolves `@ref` frame anchors.
- **Multi-Provider LLM Proxy:** Supports Google Gemini (`gemini-flash-latest`), OpenRouter with free models (`openrouter/free`), and NVIDIA (`z-ai/glm-5.2`) with two-way automatic fallback.

---

## Tech Stack

- **Runtime & Package Manager:** **Bun** exclusively (`bun install`, `bun run build`, `bun run watch`)
- **Language:** TypeScript (ES2020, strict mode) for sandbox & UI; vanilla ESM JavaScript for proxy
- **Build System:** Vite 5 with `vite-plugin-singlefile` (inlines all UI CSS/JS into a single `dist/index.html`)
- **Figma API:** `@figma/plugin-typings`
- **Proxy Server:** Express 4 + CORS running via Bun (`proxy/server.js`) on port 3000

---

## Package Manager & Commands

> [!IMPORTANT]
> Always use **Bun**. Never use `npm`, `yarn`, or `pnpm`.

### Plugin Commands (Root)
| Command | Action |
|---------|--------|
| `bun install` | Install all dependencies |
| `bun run build` | Full production build (`dist/code.js` + `dist/index.html`) |
| `bun run build:code` | Build Figma sandbox entry point (`src/code.ts` → `dist/code.js`) |
| `bun run build:ui` | Build UI into single-file bundle (`src/ui/index.html` → `dist/index.html`) |
| `bun run watch` | Concurrently watch and rebuild sandbox and UI on change |
| `bun run proxy` | Start the local LLM proxy server |
| `bun run proxy:dev` | Start the local LLM proxy server with hot reload (`bun --watch`) |

### Proxy Commands (`proxy/`)
| Command | Action |
|---------|--------|
| `bun install` | Install proxy dependencies |
| `bun start` | Start proxy server |
| `bun run dev` | Start proxy server with file watching (`bun --watch server.js`) |

---

## Running in Figma

1. **Build the plugin:**
   ```bash
   bun install
   bun run build
   ```
2. **Start the LLM proxy:**
   ```bash
   # In a separate terminal
   cp proxy/.env.example proxy/.env
   # Add your GEMINI_API_KEY and/or OPENROUTER_API_KEY in proxy/.env
   bun run proxy:dev
   ```
3. **Import into Figma Desktop App:**
   - Open Figma Desktop.
   - Go to **Plugins** → **Development** → **Import plugin from manifest...**
   - Select the `manifest.json` file in this repository root (`/home/nahomkasa/Documents/coding/BeMe/manifest.json`).
4. **Run BeMe:**
   - Right-click anywhere on the canvas or press `Shift + I` → **Plugins** → **Development** → **BeMe**.

---

## Directory Layout

```text
.
├── manifest.json            # Figma plugin manifest (ID: 1683843974484325445)
├── package.json             # Root package config (Bun scripts)
├── bun.lock                 # Bun lockfile
├── tsconfig.json            # TypeScript configuration
├── vite.config.ts           # Dual-target Vite build (sandbox CJS + UI single-file HTML)
├── dist/                    # Compiled distribution files
│   ├── code.js              # Compiled Figma sandbox runtime
│   └── index.html           # Inlined single-file plugin UI
├── src/
│   ├── code.ts              # Figma sandbox entry: scanning + node creation
│   ├── lib/
│   │   ├── types.ts         # All TypeScript interfaces and discriminated unions
│   │   ├── scanner.ts       # Document scanner (fast thin + rich catalog)
│   │   ├── normalizer.ts    # Token normalizer: role classification, spacing scale
│   │   ├── prompts.ts       # LLM prompt builder (normalized path + fallback)
│   │   ├── retriever.ts     # Relevance retrieval for large catalogs
│   │   ├── safety.ts        # Operation size checks
│   │   └── validator.ts     # Component spec validation
│   └── ui/
│       ├── index.html       # UI HTML shell
│       ├── main.ts          # Chat UI logic, proxy calls, attachment management
│       ├── resolver.ts      # @ref frame reference resolver
│       └── styles.css       # Dark-theme UI stylesheet
└── proxy/
    ├── .env.example         # Template for GEMINI_API_KEY & NVIDIA_API_KEY
    ├── package.json         # Proxy package configuration
    └── server.js            # Express proxy to Gemini & NVIDIA (Bun/Node ESM)
```

---

## Architecture & Hard Boundaries

1. **Figma Sandbox (`src/code.ts`):**
   - Runs in the Figma desktop sandbox with direct access to `figma.currentPage`, `figma.variables`, `figma.createRectangle`, etc.
   - **No DOM access:** Cannot access `window`, `document`, or browser APIs.
   - Interacts with the UI strictly via `figma.ui.postMessage(msg)` and `figma.ui.onmessage`.

2. **Plugin UI (`src/ui/`):**
   - Runs inside an `<iframe>` with full DOM and browser networking capabilities.
   - Inlined into `dist/index.html` by `vite-plugin-singlefile`.
   - **No direct Figma API access:** Must send messages to the sandbox via `parent.postMessage({ pluginMessage: msg }, "*")`.

3. **Message Protocol:**
   - Communication between sandbox and UI uses the strictly-typed `PluginMessage` discriminated union defined in `src/lib/types.ts`.
   - Any new command or event must be declared in `PluginMessage`.

4. **Local Proxy (`proxy/server.js`):**
   - Runs locally at `http://localhost:3000`.
   - Handles LLM requests to Google Gemini and NVIDIA API without exposing API keys inside the Figma plugin.
   - Manifest explicitly whitelists `http://localhost:3000`, `http://localhost:3001`, and `https://integrate.api.nvidia.com`.

---

## Engineering Rules & Principles

- **Workflow:** For each issue, inspect the code, make the smallest scoped change, verify with `bun run build`, and summarize changes.
- **Minimal Code:** Write the least amount of code that solves the problem correctly. Delete dead code and unused imports.
- **Strict TypeScript Typing:**
  - **NEVER use `any`** — no `any` annotations, no `as any` casts, no implicit `any`. Everything must be explicitly and precisely typed.
  - **NEVER use `never`** as an escape hatch.
  - If a Figma typing gap exists (e.g. `boundVariables`), define a dedicated interface in `src/lib/types.ts`.
  - Always guard against `figma.mixed` using `tryGet` or explicit type checks before reading Figma node properties.
- **Naming Conventions:**
  - Files: `kebab-case.ts`
  - Interfaces/Types: `PascalCase`
  - Variables/Functions: `camelCase`
  - Constants/Action Types: `UPPER_SNAKE_CASE`
- **Security:**
  - Never commit `.env` or API keys.
  - Keep `proxy/server.js` clean and dependencies audited.

---

## Verification Checklist

Before finishing any change:
1. Run `bun run build` and ensure both code and UI compile without errors.
2. Confirm `dist/code.js` and `dist/index.html` exist and match `manifest.json`.
3. Verify that `bun.lock` is up-to-date and no `npm` lockfiles exist.
