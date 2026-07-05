import { RichCatalog, NormalizedCatalog, NormalizedToken, TextStyleEntry } from "./types";

// ── Primary entry: uses the normalized, curated catalog ──

export function buildSystemPrompt(catalog: NormalizedCatalog): string;
export function buildSystemPrompt(catalog: RichCatalog): string;
export function buildSystemPrompt(catalog: NormalizedCatalog | RichCatalog): string {
  if ("colorTokens" in catalog) return buildNormalizedPrompt(catalog as NormalizedCatalog);
  return buildRichFallbackPrompt(catalog as RichCatalog);
}

function buildNormalizedPrompt(catalog: NormalizedCatalog): string {
  const fp = catalog.fingerprint;
  return `You are a Figma design system generator embedded in the user's own file. Output ONLY valid JSON — no markdown, no fences, no explanation. Every design you build MUST match the user's house style below.

When asked to build a page/screen/section, start from these defaults and only deviate when the request explicitly requires it. This is how you stay consistent with what already exists — like Cursor matching the codebase.

## COLOR TOKENS — USE THESE IDs, NEVER RAW HEX
For every fill, stroke, or text color, set "variableId" to one of these IDs. Do NOT invent hex values.
${renderColorTokensByRole(catalog.colorTokens)}

## SPACING SCALE — USE THESE VALUES, BIND WHEN POSSIBLE
Base unit: ${catalog.spacing.unit}px. Allowed spacing values: ${catalog.spacing.values.join(", ") || "(none observed)"}.
${Object.keys(catalog.spacing.varIds).length > 0
  ? "Spacing variable IDs by value:\n" + Object.entries(catalog.spacing.varIds).map(([val, id]) => `  - ${val}px → ${id}`).join("\n")
  : "No spacing variables defined; use the raw scale values above."}
When setting itemSpacing, prefer a value from the scale. If a matching spacing variable exists, also set "spacingVarId" to its ID so the value stays bound to the design system.

## COMPONENT LIBRARY — REUSE WHEN POSSIBLE
For interactive or structural elements, prefer embedding an existing component via "instanceComponentId" rather than rebuilding. If no match exists, build primitives from the tokens above.
${renderNormalizedComponents(catalog.components)}

## TEXT STYLES
${renderTextStyles(catalog.textStyles)}

## OUTPUT SCHEMA
{
  "type": "COMPONENT" | "FRAME",
  "name": string,
  "layout": { "mode": "VERTICAL"|"HORIZONTAL"|"NONE", "paddingTop": number, "paddingRight": number, "paddingBottom": number, "paddingLeft": number, "itemSpacing": number, "primaryAxisSizingMode": "FIXED"|"AUTO", "counterAxisSizingMode": "FIXED"|"AUTO" },
  "cornerRadius"?: number,
  "fills"?: [{ "type": "SOLID", "variableId": string, "opacity"?: number }],
  "strokes"?: [{ "type": "SOLID", "variableId": string, "opacity"?: number }],
  "children": [NodeSpec, ...]
}
NodeSpec:
{
  "type": "FRAME"|"TEXT"|"INSTANCE",
  "name": string,
  "characters"?: string,
  "colorVarId"?: string,
  "fontVarId"?: string,
  "spacingVarId"?: string,
  "instanceComponentId"?: string,
  "layout"?: {...},
  "fills"?: [{ "type": "SOLID", "variableId": string, "opacity"?: number }],
  "strokes"?: [{ "type": "SOLID", "variableId": string, "opacity"?: number }],
  "cornerRadius"?: number,
  "children"?: [NodeSpec, ...]
}

## CRITICAL RULES
1. NEVER output raw hex colors. Always reference a color token via "variableId". If you genuinely cannot find a match, omit "color" entirely — the executor will fall back; do NOT guess hex.
2. NEVER invent spacing values outside the scale. Use only: ${catalog.spacing.values.join(", ") || "defaults"}.
3. When SELECTED NODES are provided, their creationRule dictates the output type — reproduce exactly (INSTANCE, FRAME, COMPONENT, or TEXT).
4. Prefer instanceComponentId for known components (buttons, inputs, icons, cards) over rebuilding.
5. Apply the house style defaults from above unless the request overrides them.
6. Output ONLY the JSON object. No prose, no code fences.`;
}

function tokenRef(catalog: NormalizedCatalog, id?: string): string {
  if (!id) return "";
  const t = catalog.colorTokens.find(t => t.id === id || t.sourceIds.includes(id));
  return t ? `"${t.canonicalName}" (id: ${t.id})` : "";
}

function renderColorTokensByRole(tokens: NormalizedToken[]): string {
  const byRole: Record<string, NormalizedToken[]> = {};
  for (const t of tokens) (byRole[t.role] ||= []).push(t);
  const lines: string[] = [];
  for (const role of ["background", "surface", "text", "border", "accent", "semantic"]) {
    const list = byRole[role];
    if (!list || list.length === 0) continue;
    lines.push(`### ${role.toUpperCase()}`);
    for (const t of list) {
      const alias = t.aliases.length > 0 ? ` (also: ${t.aliases.slice(0, 3).join(", ")})` : "";
      lines.push(`  - "${t.canonicalName}" → ${t.id} | value: ${t.resolvedValue || "?"}${alias}`);
    }
  }
  return lines.join("\n") || "No color tokens.";
}

function renderNormalizedComponents(comps: NormalizedCatalog["components"]): string {
  if (comps.length === 0) return "No components.";
  return comps.map(c => {
    const layout = c.rootLayout
      ? ` | ${c.rootLayout.mode} pad=${c.rootLayout.paddingTop}/${c.rootLayout.paddingLeft} spacing=${c.rootLayout.itemSpacing}`
      : "";
    const variants = c.variantCount > 0 ? ` | ${c.variantCount} variant axes` : "";
    return `  - "${c.name}" [${c.inferredPurpose}] → id: ${c.id}${layout}${variants}`;
  }).join("\n");
}

function renderTextStyles(styles: TextStyleEntry[]): string {
  if (styles.length === 0) return "No text styles defined.";
  return styles.map(t =>
    `  - "${t.name}" → ${t.fontFamily} ${t.fontWeight} ${t.fontSize}px${t.lineHeight ? ` lh=${t.lineHeight}` : ""}${t.letterSpacing ? ` ls=${t.letterSpacing}` : ""}`
  ).join("\n");
}

export function buildUserPrompt(userText: string, attachSection: string): string {
  return `User request: ${userText}${attachSection}`;
}

// ── Legacy fallback for un-normalized RichCatalog (kept for safety) ──

function buildRichFallbackPrompt(catalog: RichCatalog): string {
  return `You are a Figma component generator. Output ONLY valid JSON — no markdown, no explanation, no code fences.

CRITICAL RULE — reference existing variables by ID; fall back to hex only when nothing matches.

VARIABLE INDEX
${buildVarTableLegacy(catalog)}

COMPONENT INDEX (with anatomy)
${buildComponentTableLegacy(catalog)}

TEXT STYLES
${buildTextStyleTableLegacy(catalog)}

SCHEMA:
{
  "type": "COMPONENT" | "FRAME",
  "name": string,
  "layout": { "mode": "VERTICAL"|"HORIZONTAL"|"NONE", "paddingTop": number, "paddingRight": number, "paddingBottom": number, "paddingLeft": number, "itemSpacing": number, "primaryAxisSizingMode": "FIXED"|"AUTO", "counterAxisSizingMode": "FIXED"|"AUTO" },
  "children": [{ "type": "FRAME"|"TEXT"|"INSTANCE", "name": string, "characters"?: string, "colorVarId"?: string, "fontVarId"?: string, "fillColor"?: string, "spacingVarId"?: string, "layout"?: {...}, "fills"?: [{ "type": "SOLID", "variableId": string, "opacity": number }], "strokes"?: [{ "type": "SOLID", "variableId": string, "opacity": number }], "instanceComponentId"?: string, "cornerRadius"?: number, "children"?: [...] }],
  "fills"?: [{ "type": "SOLID", "variableId": string, "color"?: string, "opacity": number }],
  "strokes"?: [{ "type": "SOLID", "variableId": string, "color"?: string, "opacity": number }],
  "cornerRadius"?: number
}`;
}

function buildVarTableLegacy(catalog: RichCatalog): string {
  const lines: string[] = [];
  for (const coll of catalog.collections) {
    lines.push(`\nCollection: "${coll.name}" (modes: ${coll.modes.map(m => m.name).join(", ")})`);
    for (const group of coll.groups) {
      lines.push(`  ${group.path}`);
      for (const v of group.variables) {
        lines.push(`    - "${v.name}" → ${v.id} | ${v.type} | ${v.resolvedValue || "?"}`);
      }
    }
  }
  return lines.join("\n") || "No variables found.";
}

function buildComponentTableLegacy(catalog: RichCatalog): string {
  const lines: string[] = [];
  for (const comp of catalog.components) {
    lines.push(`\n- "${comp.name}" (${comp.type}) id=${comp.id}`);
    if (comp.rootLayout) lines.push(`  layout: ${comp.rootLayout.mode} pad spacing=${comp.rootLayout.itemSpacing}`);
    if (comp.children.length > 0) lines.push(`  ${comp.children.length} children`);
  }
  return lines.join("\n") || "No components found.";
}

function buildTextStyleTableLegacy(catalog: RichCatalog): string {
  if (catalog.textStyles.length === 0) return "No text styles defined.";
  return catalog.textStyles.map(t => `- "${t.name}" → ${t.fontFamily} ${t.fontWeight} ${t.fontSize}px`).join("\n");
}
