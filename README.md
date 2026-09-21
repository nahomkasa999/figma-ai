# BeMe — AI-Powered Figma Plugin

BeMe brings AI capabilities directly into your Figma workflow. It scans your active document's design tokens, variables, component anatomy, and text styles, sends context-aware design specs to an LLM via a local proxy, and generates Figma components and frames automatically.

## Quick Start

### 1. Install Dependencies
Make sure [Bun](https://bun.sh) is installed.
```bash
bun install
```

### 2. Build the Plugin
```bash
bun run build
```
This generates `dist/code.js` (Figma sandbox code) and `dist/index.html` (single-file UI bundle).

### 3. Setup and Run the Proxy Server
```bash
cp proxy/.env.example proxy/.env
```
Edit `proxy/.env` to provide your `GEMINI_API_KEY` and/or `NVIDIA_API_KEY`.

Start the proxy server:
```bash
bun run proxy:dev
```

### 4. Load in Figma Desktop
1. Open the Figma Desktop app.
2. Navigate to **Plugins** → **Development** → **Import plugin from manifest...**
3. Select `manifest.json` from the root of this project.
4. Run the plugin anytime from **Plugins** → **Development** → **BeMe**.

## Development
To develop with live rebuilds on file change:
```bash
bun run watch
```

For agent and engineering guidelines, see [AGENTS.md](file:///home/nahomkasa/Documents/coding/BeMe/AGENTS.md) and [GEMINI.md](file:///home/nahomkasa/Documents/coding/BeMe/GEMINI.md).
