import { DsCatalog, RichCatalog, NormalizedCatalog, PluginMessage, ComponentSpec, SelectionAttachment, PageEntry, ChildSpec } from "../lib/types";
import { parseRefs, hasFrameRef, buildRefPrompt } from "./resolver";
import { buildSystemPrompt, buildUserPrompt } from "../lib/prompts";
import { retrieveRelevant } from "../lib/retriever";
import { normalizeCatalog } from "../lib/normalizer";

const PROXY_URL = "http://localhost:3000/api/llm";

let catalog: DsCatalog | null = null;
let richCatalog: RichCatalog | null = null;
let normalizedCatalog: NormalizedCatalog | null = null;
let currentSpec: ComponentSpec | null = null;
let pendingPrompt: string | null = null;
let attachments: SelectionAttachment[] = [];
let pages: PageEntry[] = [];
let currentTab: "chat" | "index" = "chat";
let activeAttachmentId: string | null = null;
let currentProvider: "auto" | "gemini" | "nvidia" = "auto";

const chat = document.getElementById("chat") as HTMLElement;
const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
const sessionNew = document.getElementById("session-new") as HTMLButtonElement;
const attachmentBar = document.getElementById("attachment-bar") as HTMLElement;
const tabChat = document.getElementById("tab-chat") as HTMLButtonElement;
const tabIndex = document.getElementById("tab-index") as HTMLButtonElement;
const chatView = document.getElementById("chat-view") as HTMLElement;
const indexView = document.getElementById("index-view") as HTMLElement;
const contextBar = document.getElementById("context-bar") as HTMLElement;
const providerBtn = document.getElementById("provider-btn") as HTMLButtonElement;

promptInput.focus();
addChatMessage("assistant", "Scanning your design system...");

window.addEventListener("message", (event) => {
  const msg: PluginMessage = event.data.pluginMessage;
  if (!msg) return;

  switch (msg.type) {
    case "SCAN_RESULT": {
      catalog = msg.catalog;
      const ctx = msg.pageContext === "component" ? "components" : "design";
      addChatMessage("success", `Found ${msg.catalog.variables.length} variables, ${msg.catalog.components.length} components.`);
      addChatMessage("assistant", `I'm in **${ctx} mode**. Ask me to build something.`);
      break;
    }
    case "SCAN_RICH_RESULT":
      richCatalog = msg.richCatalog;
      normalizedCatalog = normalizeCatalog(richCatalog);
      addChatMessage("info", `Indexed ${msg.richCatalog.collections.length} collections, ${msg.richCatalog.components.length} components, ${msg.richCatalog.textStyles.length} text styles. Normalized into ${normalizedCatalog.colorTokens.length} color tokens.`);
      break;
    case "SELECTION_CHANGED":
      attachments = msg.attachments;
      renderAttachmentBar();
      break;
    case "EXECUTE_RESULT":
      if (msg.success) {
        addChatMessage("success", `Created! (${msg.nodeId})`);
      } else {
        addChatMessage("error", `Failed: ${msg.error}`);
      }
      currentSpec = null;
      break;
    case "FRAME_RESOLVED":
      if (msg.style && pendingPrompt) {
        const enhanced = buildRefPrompt(pendingPrompt, msg.style, msg.ref);
        pendingPrompt = null;
        callLlm(enhanced);
      } else if (msg.error) {
        addChatMessage("error", msg.error);
        pendingPrompt = null;
      }
      break;
    case "PAGES_SCAN_RESULT":
      pages = msg.pages;
      break;
    case "ERROR":
      addChatMessage("error", msg.message);
      break;
  }
});

tabChat.addEventListener("click", () => switchTab("chat"));
tabIndex.addEventListener("click", () => switchTab("index"));

function switchTab(tab: "chat" | "index") {
  currentTab = tab;
  tabChat.classList.toggle("active", tab === "chat");
  tabIndex.classList.toggle("active", tab === "index");
  chatView.style.display = tab === "chat" ? "flex" : "none";
  indexView.style.display = tab === "index" ? "block" : "none";
  contextBar.style.display = tab === "chat" ? "" : "none";
  if (tab === "index") renderIndex();
  else promptInput.focus();
}

sessionNew.addEventListener("click", newSession);

providerBtn.addEventListener("click", () => {
  const cycle: (typeof currentProvider)[] = ["auto", "gemini", "nvidia"];
  const idx = cycle.indexOf(currentProvider);
  currentProvider = cycle[(idx + 1) % cycle.length];
  const labels: Record<string, string> = { auto: "Auto", gemini: "Gemini", nvidia: "GLM-5.2" };
  providerBtn.textContent = labels[currentProvider];
  addChatMessage("info", `Switched to **${labels[currentProvider]}** provider.`);
});

function newSession() {
  chat.innerHTML = "";
  attachments = [];
  activeAttachmentId = null;
  currentSpec = null;
  pendingPrompt = null;
  promptInput.value = "";
  promptInput.style.height = "auto";
  attachmentBar.style.display = "none";
  addChatMessage("assistant", "New session. Ask me to build something.");
  promptInput.focus();
}

function submitPrompt() {
  const text = promptInput.value.trim();
  if (!text) return;
  if (!catalog) {
    addChatMessage("error", "Still scanning... wait a moment.");
    return;
  }
  promptInput.value = "";
  promptInput.style.height = "auto";
  handlePrompt(text);
}

promptInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitPrompt();
  }
});

promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 200) + "px";
});

sendBtn.addEventListener("click", submitPrompt);

function renderAttachmentBar() {
  if (attachments.length === 0) {
    attachmentBar.style.display = "none";
    return;
  }
  attachmentBar.style.display = "flex";
  attachmentBar.innerHTML = attachments.map((a, i) =>
    `<span class="attachment-chip ${a.id === activeAttachmentId ? 'selected' : ''}" data-index="${i}">
      <span class="chip-icon">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
          <polyline points="13 2 13 9 20 9"></polyline>
        </svg>
      </span>
      <span class="chip-name">${a.name}</span>
      <span class="chip-type">${a.type}</span>
      <span class="remove" data-index="${i}">×</span>
    </span>`
  ).join("");
  attachmentBar.innerHTML += `<div id="attachment-detail" style="display:none"></div>`;

  attachmentBar.querySelectorAll(".attachment-chip").forEach((el) => {
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("remove")) return;
      const idx = parseInt((el as HTMLElement).dataset.index!);
      const a = attachments[idx];
      if (activeAttachmentId === a.id) {
        activeAttachmentId = null;
      } else {
        activeAttachmentId = a.id;
      }
      renderAttachmentBar();
    });
  });
  attachmentBar.querySelectorAll(".remove").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt((e.target as HTMLElement).dataset.index!);
      attachments.splice(idx, 1);
      if (activeAttachmentId && !attachments.some(a => a.id === activeAttachmentId)) {
        activeAttachmentId = null;
      }
      renderAttachmentBar();
    });
  });

  if (activeAttachmentId) {
    const a = attachments.find(x => x.id === activeAttachmentId);
    if (a) {
      const detail = document.getElementById("attachment-detail")!;
      detail.style.display = "block";
      detail.className = "attachment-detail";
      detail.innerHTML = `
        <div class="detail-header">
          <span class="detail-tab">FIGMA RAW</span>
          <span class="detail-divider">|</span>
          <span class="detail-tab active">AI SPEC</span>
        </div>
        <div class="detail-split">
          <div class="detail-pane detail-raw">${escapeHtml(a.rawDump)}</div>
          <div class="detail-pane detail-edited">${escapeHtml(buildAISpec(a))}</div>
        </div>
      `;
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildAISpec(a: SelectionAttachment): string {
  let raw: Record<string, any> = {};
  try { raw = JSON.parse(a.rawDump); } catch {}

  const s: Record<string, any> = {};

  s._prompt = `Reproduce this ${a.type} exactly. Follow creationRule. Bind fills, strokes, spacing, and radius by variable ID — never hardcode colors, typography, or tokens.`;

  s.name = a.name;
  s.type = a.type;
  s.creationRule = raw.creationRule || `MUST be created as ${a.type}`;

  if (a.type === "INSTANCE" && raw.instance?.mainComponent) {
    s.mainComponentReference = {
      key: raw.instance.mainComponent.key,
      name: raw.instance.mainComponent.name,
      _instruction: "Set instanceComponentId to this key. Do not rebuild from primitives.",
    };
  }

  if (raw.x !== undefined) { s.x = raw.x; s.y = raw.y; s.width = raw.width; s.height = raw.height; }

  if (raw.layout) {
    const layout: Record<string, any> = {};
    layout.mode = raw.layout.mode;
    layout.padding = raw.layout.padding;
    layout.itemSpacing = raw.layout.itemSpacing;
    if (raw.boundVariables?.itemSpacing) {
      layout.itemSpacing = {
        value: raw.layout.itemSpacing,
        variableId: raw.boundVariables.itemSpacing[0].id,
        name: raw.boundVariables.itemSpacing[0].name,
      };
    }
    layout.primaryAxisSizingMode = raw.layout.primaryAxisSizingMode;
    layout.counterAxisSizingMode = raw.layout.counterAxisSizingMode;
    layout.primaryAxisAlignItems = raw.layout.primaryAxisAlignItems;
    layout.counterAxisAlignItems = raw.layout.counterAxisAlignItems;
    s.layout = layout;
    s.clipsContent = raw.clipsContent;
    s.layoutSizingHorizontal = raw.layoutSizingHorizontal;
    s.layoutSizingVertical = raw.layoutSizingVertical;
  }

  if (raw.cornerRadius !== undefined) {
    if (raw.boundVariables?.cornerRadius) {
      s.cornerRadius = { value: raw.cornerRadius, variableId: raw.boundVariables.cornerRadius[0].id, name: raw.boundVariables.cornerRadius[0].name };
    } else {
      s.cornerRadius = raw.cornerRadius;
    }
  }

  s.fills = (raw.fills || []).map((f: any, i: number) => {
    const bv = raw.boundVariables?.fills?.[i];
    if (f.type === "SOLID" && bv) {
      return { type: "SOLID", variableId: bv.id, name: bv.name, opacity: f.opacity };
    }
    return f;
  });

  s.strokes = (raw.strokes || []).map((f: any, i: number) => {
    const bv = raw.boundVariables?.strokes?.[i];
    if (f.type === "SOLID" && bv) {
      return { type: "SOLID", variableId: bv.id, name: bv.name, opacity: f.opacity };
    }
    return f;
  });

  if (raw.strokeWeight !== undefined) s.strokeWeight = raw.strokeWeight;
  if (raw.strokeAlign !== undefined) s.strokeAlign = raw.strokeAlign;
  if (raw.effects) s.effects = raw.effects;
  if (raw.opacity !== undefined) s.opacity = raw.opacity;
  if (raw.rotation) s.rotation = raw.rotation;

  if (a.children.length > 0) {
    s.children = a.children.map(c => buildChildAISpec(c, a.resolvedVars));
  }

  const usedVars: Record<string, { name: string; usages: string[] }> = {};
  collectVarRefs(raw, usedVars, "root");
  collectChildVarRefs(a.children, usedVars);
  const varList = Object.entries(usedVars).map(([id, info]) => ({
    variableId: id,
    name: info.name,
    usedBy: [...new Set(info.usages)],
  }));
  if (varList.length > 0) s.variableReferences = varList;

  return JSON.stringify(s, null, 2);
}

function buildChildAISpec(c: ChildSpec, resolvedVars: Record<string, string>): Record<string, any> {
  const child: Record<string, any> = { name: c.name, type: c.type };

  if (c.type === "INSTANCE" && c.instanceComponentId) {
    child.instanceComponentId = c.instanceComponentId;
    child._instruction = "Set instanceComponentId to this key. Do not rebuild from primitives.";
  }

  if (c.characters != null) child.characters = c.characters;
  if (c.fontFamily) child.fontFamily = c.fontFamily;
  if (c.fontSize) child.fontSize = c.fontSize;

  if (c.layout) {
    child.layout = c.layout;
  }

  if (c.fills.length > 0) {
    child.fills = c.fills.map((hex, i) => {
      const varId = c.boundVarIds[i];
      const name = varId ? resolvedVars[varId] : undefined;
      if (varId && name) return { type: "SOLID", variableId: varId, name };
      return { hex };
    });
  } else {
    const varIds = c.boundVarIds.filter(id => resolvedVars[id]?.match(/color/i));
    if (varIds.length > 0) {
      child.fills = varIds.map(id => ({ type: "SOLID", variableId: id, name: resolvedVars[id] }));
    }
  }

  if (c.strokes.length > 0) {
    child.strokes = c.strokes.map((hex, i) => {
      const varId = c.boundVarIds[i] || c.boundVarIds[0];
      const name = varId ? resolvedVars[varId] : undefined;
      if (varId && name) return { type: "SOLID", variableId: varId, name };
      return { hex };
    });
  }

  if (c.children.length > 0) {
    child.children = c.children.map(ch => buildChildAISpec(ch, resolvedVars));
  }

  return child;
}

function collectVarRefs(raw: Record<string, any>, usedVars: Record<string, { name: string; usages: string[] }>, context: string) {
  if (raw.boundVariables) {
    for (const [prop, arr] of Object.entries(raw.boundVariables)) {
      if (Array.isArray(arr)) {
        for (const entry of arr) {
          if (entry?.id) {
            if (!usedVars[entry.id]) usedVars[entry.id] = { name: entry.name || entry.id, usages: [] };
            usedVars[entry.id].usages.push(entry.usage || prop);
          }
        }
      }
    }
  }
}

function collectChildVarRefs(children: ChildSpec[], usedVars: Record<string, { name: string; usages: string[] }>) {
  for (const c of children) {
    for (const id of c.boundVarIds) {
      if (!usedVars[id]) usedVars[id] = { name: id, usages: [] };
      usedVars[id].usages.push("child:" + c.name);
    }
    if (c.children.length > 0) collectChildVarRefs(c.children, usedVars);
  }
}

function renderAttachmentTree(a: SelectionAttachment, indent: string): string {
  const lines: string[] = [];
  lines.push(`${indent}${a.type} "${a.name}"`);
  if (a.layout) lines.push(`${indent}  layout: ${a.layout}`);
  if (a.fills.length > 0) lines.push(`${indent}  fills: ${a.fills.join(", ")}`);
  if (a.strokes.length > 0) lines.push(`${indent}  strokes: ${a.strokes.join(", ")}`);
  const namedVars = a.boundVarIds.map(id => {
    const name = a.resolvedVars[id];
    return name && name !== id ? `${name} (${id})` : id;
  });
  if (namedVars.length > 0) lines.push(`${indent}  bound: ${namedVars.join(", ")}`);
  if (a.children.length > 0) {
    lines.push(`${indent}  children:`);
    for (const c of a.children) lines.push(renderChildTree(c, `${indent}    `));
  }
  return lines.join("\n");
}

function renderChildTree(c: ChildSpec, indent: string): string {
  const lines: string[] = [];
  const meta: string[] = [];
  if (c.instanceComponentId) meta.push(`key=${c.instanceComponentId.slice(0, 8)}`);
  if (c.characters != null) meta.push(`"${c.characters.replace(/"/g, "'")}"`);
  if (c.fontFamily) meta.push(`${c.fontFamily} ${c.fontSize || ""}`);
  if (c.layout) meta.push(c.layout);
  if (c.fills.length > 0) meta.push(`fills=${c.fills.join(",")}`);
  const named = c.boundVarIds.map(id => {
    // resolvedVars isn't available here, just show raw IDs for children
    return id;
  });
  if (named.length > 0) meta.push(`vars=${named.join(",")}`);
  const metaStr = meta.length > 0 ? `  // ${meta.join(" · ")}` : "";
  lines.push(`${indent}${c.type} "${c.name}"${metaStr}`);
  for (const ch of c.children) lines.push(renderChildTree(ch, `${indent}  `));
  return lines.join("\n");
}

async function handlePrompt(text: string) {
  addChatMessage("user", text);

  const refs = parseRefs(text);
  const frameRef = hasFrameRef(refs);

  if (frameRef) {
    pendingPrompt = text;
    addChatMessage("info", `Analyzing ${frameRef}...`);
    parent.postMessage({ pluginMessage: { type: "RESOLVE_FRAME", ref: frameRef } }, "*");
    return;
  }

  await callLlm(text);
}

async function callLlm(text: string) {
  const thinkingEl = showThinking();

  const sysPrompt = `You are a Figma builder. Reproduce the selected node exactly. Only change what the user explicitly asks to change. Output ONLY valid JSON — no markdown, no fences.

Expected output schema for the root node:
{
  "type": "FRAME" | "COMPONENT",
  "name": string,
  "layout": {
    "mode": "NONE" | "VERTICAL" | "HORIZONTAL",
    "paddingTop": number,
    "paddingRight": number,
    "paddingBottom": number,
    "paddingLeft": number,
    "itemSpacing": number,
    "primaryAxisSizingMode": "FIXED" | "AUTO",
    "counterAxisSizingMode": "FIXED" | "AUTO"
  },
  "fills": [{ "type": "SOLID", "variableId": string, "color": string (hex like "#ff0000"), "opacity": number }],
  "strokes": [{ "type": "SOLID", "variableId": string, "color": string (hex), "opacity": number }],
  "cornerRadius": number,
  "children": [ NodeSpec ]
}

NodeSpec:
- FRAME: same layout/fills/strokes pattern as root; optionally "spacingVarId": string
- TEXT: { "type": "TEXT", "name": string, "characters": string, "colorVarId": string (for text color), "fontVarId": string, "fillColor": string (hex fallback) }
- INSTANCE: { "type": "INSTANCE", "name": string, "instanceComponentId": string (key from the selected node) }

IMPORTANT RULES:
1. "color" in fills/strokes MUST be a hex string like "#f24141" — NOT an object with r/g/b.
2. Use "variableId" to reference Figma color variables instead of hardcoding hex.
3. For INSTANCE nodes, preserve the "instanceComponentId" from the selected node.
4. For TEXT nodes, use "colorVarId" for the text fill variable, or "fillColor" as hex fallback.
5. When the raw node has "boundVariables", convert each to the proper field: boundVariables.fills → fills[].variableId, boundVariables.itemSpacing → spacingVarId, cornerRadius → cornerRadius, paddingLeft/Top/Right/Bottom → layout.padding*, topLeftRadius/topRightRadius etc → cornerRadius.
6. Keep all child nodes exactly as they are — only change what the user asks.
7. Output ONLY the JSON object. No explanations.`;

  let attachSection = "";
  if (attachments.length > 0) {
    attachSection = "\n\n=== SELECTED NODES (raw) ===\n" +
      attachments.map(a => a.rawDump).join("\n\n");
  }

  const userPrompt = `User request: ${text}${attachSection}`;

  // ── Show what's being sent ──
  addChatMessage("debug", "── Sent to LLM ──");
  const debugEl = document.createElement("div");
  debugEl.className = "message debug-prompt";
  debugEl.innerHTML = `<pre style="white-space:pre-wrap;font-size:11px;line-height:1.4;max-height:400px;overflow:auto;background:#1a1a2e;color:#e0e0e0;padding:12px;border-radius:8px;border:1px solid #333;">${escapeHtml(JSON.stringify({ system: sysPrompt, user: userPrompt, provider: currentProvider }, null, 2))}</pre>`;
  chat.appendChild(debugEl);
  chat.scrollTop = chat.scrollHeight;

  try {
    const resp = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system: sysPrompt, user: userPrompt, provider: currentProvider }),
    });

    const data = await resp.json();
    thinkingEl.remove();
    if (data.error) { addChatMessage("error", data.error); return; }
    if (!data.content) { addChatMessage("error", "LLM returned empty content."); return; }

    const cleaned = data.content.replace(/```(?:json)?\n?/g, "").trim();
    const providerTag = data.provider ? ` [via ${data.provider}${data.model ? `:${data.model}` : ""}]` : "";
    let spec: ComponentSpec;
    try { spec = JSON.parse(cleaned); }
    catch (e: any) { addChatMessage("error", `Invalid JSON:\n${cleaned.slice(0, 500)}`); return; }

    currentSpec = spec;
    const msgEl = addChatMessage("assistant", (spec.name || "Untitled") + providerTag);
    addPreview(msgEl, spec);
  } catch (e: any) {
    thinkingEl.remove();
    addChatMessage("error", `Proxy error: ${e.message}`);
  }
}

function addChatMessage(role: "user" | "assistant" | "info" | "error" | "success", text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  if (role === "assistant") {
    el.innerHTML = text + `<span class="cursor-blink"></span>`;
  } else {
    el.textContent = text;
  }
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

function showThinking(): HTMLElement {
  const el = document.createElement("div");
  el.className = "thinking-row";
  el.innerHTML = `
    <span class="thinking-label">Thinking</span>
    <span class="thinking-dots">
      <span class="thinking-dot"></span>
      <span class="thinking-dot"></span>
      <span class="thinking-dot"></span>
    </span>
  `;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

function addPreview(msgEl: HTMLElement, spec: ComponentSpec) {
  const card = document.createElement("div");
  card.className = "preview-card";
  card.textContent = JSON.stringify(spec, null, 2);
  msgEl.appendChild(card);

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.innerHTML = `<button class="btn-apply">Apply</button><button class="btn-cancel">Cancel</button>`;
  msgEl.appendChild(actions);

  actions.querySelector(".btn-apply")!.addEventListener("click", () => {
    if (currentSpec) {
      parent.postMessage({ pluginMessage: { type: "EXECUTE_SPEC", spec: currentSpec } }, "*");
      actions.querySelector(".btn-apply")!.textContent = "Applying...";
    }
  });

  actions.querySelector(".btn-cancel")!.addEventListener("click", () => {
    msgEl.remove();
    currentSpec = null;
  });

  chat.scrollTop = chat.scrollHeight;
}

// ── Index tab ──

function renderIndex() {
  let html = `<div style="display:flex;gap:8px;margin-bottom:8px;">
    <button id="export-btn" class="index-export-btn">Export All</button>
  </div>`;
  html += renderSection("Variables", renderVariables());
  html += renderSection("Components", renderComponents());
  html += renderSection("Pages & Frames", renderPages());
  html += renderSection("Text Styles", renderTextStyles());
  indexView.innerHTML = html || "<div class='index-empty'>No data yet — wait for scan to finish.</div>";
  document.getElementById("export-btn")?.addEventListener("click", handleExport);
}

function handleExport() {
  const payload = {
    catalog,
    richCatalog,
    pages,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `figma-catalog-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function renderSection(title: string, content: string): string {
  if (!content) return "";
  return `<div class="index-section">
    <div class="index-section-title">${title}</div>
    ${content}
  </div>`;
}

function renderVariables(): string {
  if (!richCatalog && !catalog) return "";
  const cols = richCatalog?.collections;
  if (cols && cols.length > 0) {
    return cols.map(c => {
      const byType = groupBy(c.variables, v => v.type);
      const typeBlocks = Object.entries(byType).map(([type, vars]) => `
        <div class="index-subsection">
          <div class="index-subsection-title">${type} (${vars.length})</div>
          ${vars.map(v => `<div class="index-row">
            <span class="index-var-name">${v.name}</span>
            ${type === "COLOR" ? `<span class="index-swatch" style="background:${v.resolvedValue || '#888'}"></span>` : ""}
            <span class="index-var-val">${v.resolvedValue || "—"}</span>
            <span class="index-var-coll">${v.collection}</span>
          </div>`).join("")}
        </div>
      `).join("");
      return `<div class="index-collection">
        <div class="index-collection-name">${c.name}</div>
        ${typeBlocks}
      </div>`;
    }).join("");
  }
  if (catalog) {
    const byType = groupBy(catalog.variables, v => v.type);
    return Object.entries(byType).map(([type, vars]) => `
      <div class="index-subsection">
        <div class="index-subsection-title">${type} (${vars.length})</div>
        ${vars.map(v => `<div class="index-row">
          <span class="index-var-name">${v.name}</span>
          <span class="index-var-val">${v.resolvedValue || "—"}</span>
          <span class="index-var-coll">${v.collection}</span>
        </div>`).join("")}
      </div>
    `).join("");
  }
  return "";
}

function renderComponents(): string {
  const comps = richCatalog?.components;
  if (comps && comps.length > 0) {
    return comps.map(c => {
      const info = c.rootLayout
        ? `layout: ${c.rootLayout.mode} | padding: ${c.rootLayout.paddingTop},${c.rootLayout.paddingRight},${c.rootLayout.paddingBottom},${c.rootLayout.paddingLeft} | spacing: ${c.rootLayout.itemSpacing}`
        : "";
      const variants = c.variantProperties
        ? Object.entries(c.variantProperties).map(([k, v]) => `${k}: ${v}`).join(", ")
        : "";
      const childSummary = c.children?.length ? `${c.children.length} children` : "";
      return `<div class="index-card">
        <div class="index-card-name">${c.name}</div>
        <div class="index-card-meta">${c.type}</div>
        ${info ? `<div class="index-card-info">${info}</div>` : ""}
        ${variants ? `<div class="index-card-info">variants: ${variants}</div>` : ""}
        ${childSummary ? `<div class="index-card-info">${childSummary}</div>` : ""}
      </div>`;
    }).join("");
  }
  if (catalog?.components && catalog.components.length > 0) {
    return catalog.components.map(c => `
      <div class="index-card">
        <div class="index-card-name">${c.name}</div>
        <div class="index-card-meta">${c.isComponentSet ? "COMPONENT_SET" : "COMPONENT"}</div>
        <div class="index-card-info">key: ${c.key}</div>
      </div>
    `).join("");
  }
  return "";
}

function renderPages(): string {
  if (pages.length === 0) return "";
  return pages.map(p => `
    <div class="index-page">
      <div class="index-page-name">${p.name}</div>
      ${p.frames.length === 0 ? `<div class="index-empty-small">No top-level frames</div>` : ""}
      ${p.frames.map(f => `<div class="index-row index-frame-row">
        <span class="index-frame-icon">▣</span>
        <span class="index-var-name">${f.name}</span>
        <span class="index-frame-type">${f.type}</span>
        <span class="index-var-val">${f.count} children</span>
      </div>`).join("")}
    </div>
  `).join("");
}

function renderTextStyles(): string {
  const styles = richCatalog?.textStyles;
  if (!styles || styles.length === 0) return "";
  return styles.map(s => `
    <div class="index-row">
      <span class="index-var-name">${s.name}</span>
      <span class="index-var-val">${s.fontSize}px / ${s.fontWeight} · ${s.fontFamily}</span>
    </div>
  `).join("");
}

function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const map: Record<string, T[]> = {};
  for (const item of arr) {
    const k = keyFn(item);
    if (!map[k]) map[k] = [];
    map[k].push(item);
  }
  return map;
}
