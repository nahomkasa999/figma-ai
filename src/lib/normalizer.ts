import {
  RichCatalog, RichVarEntry, ComponentAnatomy, ChildAnatomy,
  NormalizedCatalog, NormalizedToken, NormalizedComponent,
  SpacingScale, StyleFingerprint, TextStyleEntry,
} from "./types";

// ── Public API ──

export function normalizeCatalog(catalog: RichCatalog): NormalizedCatalog {
  const usage = analyzeUsage(catalog);

  const colorTokens = buildColorTokens(catalog, usage);
  const spacing = buildSpacingScale(catalog);
  const components = buildComponents(catalog, usage);
  const fingerprint = buildFingerprint(catalog, colorTokens);

  return {
    colorTokens,
    spacing,
    components,
    textStyles: catalog.textStyles,
    fingerprint,
    fileKey: catalog.fileKey,
  };
}

// ── Usage analysis: how is each variable actually used in components? ──

interface VarUsage {
  fills: number;
  strokes: number;
  textFills: number;
  frameFills: number;
  spacing: number;
}

function analyzeUsage(catalog: RichCatalog): Map<string, VarUsage> {
  const map = new Map<string, VarUsage>();

  for (const comp of catalog.components) {
    countUsage(comp.boundVariables, comp.children, map);
  }
  return map;
}

function countUsage(
  boundVars: Record<string, string[]>,
  children: ChildAnatomy[],
  map: Map<string, VarUsage>,
  parentType?: string
): void {
  for (const [prop, ids] of Object.entries(boundVars || {})) {
    for (const id of ids) {
      const u = map.get(id) || { fills: 0, strokes: 0, textFills: 0, frameFills: 0, spacing: 0 };
      if (prop === "fills" || prop === "fillPaints") {
        u.fills++;
        if (parentType === "TEXT" || prop === "textFills") u.textFills++;
        else u.frameFills++;
      } else if (prop === "strokes" || prop === "strokePaints") {
        u.strokes++;
      } else if (prop === "itemSpacing" || prop === "paddingTop" || prop === "paddingLeft" || prop === "paddingBottom" || prop === "paddingRight") {
        u.spacing++;
      }
      map.set(id, u);
    }
  }

  for (const child of children) {
    countUsage(child.boundVariables, child.children, map, child.type);
  }
}

function getRole(v: RichVarEntry, usage: VarUsage | undefined): NormalizedToken["role"] {
  if (v.type !== "COLOR") return "surface";
  if (!usage) {
    return classifyByColorValue(v.resolvedValue);
  }
  const { textFills, frameFills, strokes, fills } = usage;
  const total = fills + strokes;
  if (total === 0) return classifyByColorValue(v.resolvedValue);
  if (textFills > frameFills && textFills >= strokes) return "text";
  if (strokes > fills) return "border";
  if (frameFills > 0 && frameFills >= textFills) {
    return isSemanticName(v.name) ? "semantic" : "background";
  }
  return "background";
}

function classifyByColorValue(hex?: string): NormalizedToken["role"] {
  if (!hex) return "background";
  const h = hex.toLowerCase();
  if (h === "#ffffff" || h === "#fff" || h === "#fafafa" || h === "#f5f5f5") return "background";
  if (h === "#000000" || h === "#000" || h === "#0d0d0d" || h === "#111111") return "text";
  return "surface";
}

function isSemanticName(name: string): boolean {
  const n = name.toLowerCase();
  return /(warning|success|danger|error|info|message)/.test(n);
}

// ── Color tokens: classify, dedupe by resolved value, pick canonical name ──

function buildColorTokens(catalog: RichCatalog, usage: Map<string, VarUsage>): NormalizedToken[] {
  const allVars: RichVarEntry[] = [];
  for (const coll of catalog.collections) {
    for (const v of coll.variables) {
      if (v.type === "COLOR") allVars.push(v);
    }
  }

  const byValue = new Map<string, RichVarEntry[]>();
  for (const v of allVars) {
    const key = (v.resolvedValue || v.id).toLowerCase();
    if (!byValue.has(key)) byValue.set(key, []);
    byValue.get(key)!.push(v);
  }

  const tokens: NormalizedToken[] = [];
  for (const [value, group] of byValue) {
    let best = group[0];
    let bestUsage = -1;
    for (const v of group) {
      const u = usage.get(v.id);
      const c = u ? u.fills + u.strokes + u.textFills + u.frameFills : 0;
      if (c > bestUsage) { bestUsage = c; best = v; }
    }
    const role = getRole(best, usage.get(best.id));
    const canonical = pickCanonicalName(group, role);
    const usageCount = group.reduce((sum, v) => {
      const u = usage.get(v.id);
      return sum + (u ? u.fills + u.strokes + u.textFills + u.frameFills : 0);
    }, 0);

    tokens.push({
      id: best.id,
      role,
      category: "color",
      canonicalName: canonical,
      originalName: best.name,
      resolvedValue: best.resolvedValue,
      aliases: group.map(v => v.name).filter(n => n !== best.name),
      sourceIds: group.map(v => v.id),
      usageCount,
    });
  }

  tokens.sort((a, b) => b.usageCount - a.usageCount);
  return tokens;
}

function pickCanonicalName(group: RichVarEntry[], role: NormalizedToken["role"]): string {
  const preferredParts: Record<NormalizedToken["role"], string[]> = {
    background: ["bg", "background", "surface", "card"],
    text: ["text", "font", "foreground", "readable"],
    border: ["border", "stroke", "separator", "divider"],
    accent: ["accent", "primary", "btn", "cta"],
    surface: ["surface", "card", "panel"],
    semantic: ["success", "warning", "danger", "info", "message"],
  };
  const preferred = preferredParts[role] || [];
  let best = group[0].name;
  let bestScore = -1;
  for (const v of group) {
    const n = v.name.toLowerCase();
    let score = 0;
    for (const part of preferred) if (n.includes(part)) score += 5;
    if (!/(componet|waringin|separetor|untitled|\bcomponent \d)/.test(n)) score += 2;
    if (n.length < best.length + 20) score += 1;
    const segs = n.split("/");
    if (segs.length <= 3) score += 2;
    if (score > bestScore) { bestScore = score; best = v.name; }
  }
  return best;
}

// ── Spacing scale: infer from observed padding/spacing in components ──

function buildSpacingScale(catalog: RichCatalog): SpacingScale {
  const counts = new Map<number, number>();
  const clearVarIds = new Set<string>();

  for (const coll of catalog.collections) {
    for (const v of coll.variables) {
      if (v.type === "FLOAT" && v.resolvedValue) clearVarIds.add(v.id);
    }
  }

  const collect = (n: number) => {
    if (n == null || n === 0 || Number.isNaN(n)) return;
    counts.set(n, (counts.get(n) || 0) + 1);
  };

  for (const comp of catalog.components) {
    if (comp.rootLayout) {
      collect(comp.rootLayout.paddingTop);
      collect(comp.rootLayout.paddingRight);
      collect(comp.rootLayout.paddingBottom);
      collect(comp.rootLayout.paddingLeft);
      collect(comp.rootLayout.itemSpacing);
    }
  }

  const valueToVar = new Map<number, string>();
  for (const coll of catalog.collections) {
    for (const v of coll.variables) {
      if (v.type === "FLOAT" && v.resolvedValue) {
        const n = parseFloat(v.resolvedValue);
        if (!valueToVar.has(n)) valueToVar.set(n, v.id);
      }
    }
  }

  const values = Array.from(counts.keys()).sort((a, b) => a - b);
  const varIds: Record<number, string> = {};
  for (const v of values) {
    if (valueToVar.has(v)) varIds[v] = valueToVar.get(v)!;
  }

  return {
    values,
    unit: inferUnit(values),
    varIds,
  };
}

function inferUnit(values: number[]): number {
  if (values.length === 0) return 4;
  for (const unit of [4, 8, 2, 5, 10]) {
    if (values.every(v => v % unit === 0)) return unit;
  }
  return 4;
}

// ── Components: classify purpose and link bound tokens ──

function buildComponents(catalog: RichCatalog, usage: Map<string, VarUsage>): NormalizedComponent[] {
  return catalog.components.map(c => ({
    id: c.id,
    key: c.key,
    name: c.name,
    type: c.type,
    inferredPurpose: inferPurpose(c),
    variantCount: c.variantProperties ? Object.keys(c.variantProperties).length : 0,
    rootLayout: c.rootLayout,
    boundTokenIds: collectBoundIds(c),
  }));
}

function inferPurpose(c: ComponentAnatomy): string {
  const name = c.name.toLowerCase();
  if (/icon|arrow|chevron|close|x/.test(name)) return "icon";
  if (/btn|button/.test(name)) return "button";
  if (/input|field|text-area|textarea/.test(name)) return "input";
  if (/card|panel|container/.test(name)) return "container";
  if (/modal|dialog|popup/.test(name)) return "overlay";
  if (/tab|nav|menu|sidebar/.test(name)) return "navigation";
  const allText = (children: ChildAnatomy[]): boolean =>
    children.length > 0 && children.every(ch => ch.type === "TEXT" || (ch.children && allText(ch.children)));
  if (allText(c.children)) return "text-content";
  const childTypes = new Set(c.children.map(ch => ch.type));
  if (childTypes.has("VECTOR") && childTypes.size === 1) return "icon-set";
  return "generic";
}

function collectBoundIds(c: ComponentAnatomy): string[] {
  const ids = new Set<string>();
  const walk = (bv: Record<string, string[]>, children: ChildAnatomy[]) => {
    for (const arr of Object.values(bv || {})) for (const id of arr) if (id) ids.add(id);
    for (const ch of children) walk(ch.boundVariables, ch.children);
  };
  walk(c.boundVariables, c.children);
  return Array.from(ids);
}

// ── Style fingerprint: the house style defaults ──

function buildFingerprint(catalog: RichCatalog, colorTokens: NormalizedToken[]): StyleFingerprint {
  const paddingCounts = new Map<number, number>();
  const spacingCounts = new Map<number, number>();
  let vert = 0, horiz = 0;
  let cornerSum = 0;
  let cornerCount = 0;

  for (const comp of catalog.components) {
    if (comp.rootLayout) {
      const l = comp.rootLayout;
      [l.paddingTop, l.paddingLeft].forEach(p => {
        if (p != null && p > 0) paddingCounts.set(p, (paddingCounts.get(p) || 0) + 1);
      });
      if (l.itemSpacing > 0) spacingCounts.set(l.itemSpacing, (spacingCounts.get(l.itemSpacing) || 0) + 1);
      if (l.mode === "VERTICAL") vert++;
      if (l.mode === "HORIZONTAL") horiz++;
    }
    if ((comp as any).cornerRadius != null && typeof (comp as any).cornerRadius === "number") {
      cornerSum += (comp as any).cornerRadius as number;
      cornerCount++;
    }
  }

  const byRole = (role: NormalizedToken["role"]) =>
    colorTokens.filter(t => t.role === role).sort((a, b) => b.usageCount - a.usageCount)[0];

  return {
    defaultPadding: mode(paddingCounts) ?? 16,
    defaultSpacing: mode(spacingCounts) ?? 12,
    defaultBgTokenId: byRole("background")?.id,
    defaultTextTokenId: byRole("text")?.id,
    defaultBorderTokenId: byRole("border")?.id,
    defaultAccentTokenId: byRole("accent")?.id || byRole("semantic")?.id,
    preferredLayout: vert >= horiz ? "VERTICAL" : "HORIZONTAL",
    preferredCornerRadius: cornerCount > 0 ? Math.round(cornerSum / cornerCount) : 8,
  };
}

function mode(m: Map<number, number>): number | undefined {
  let best: number | undefined;
  let bestCount = -1;
  for (const [k, v] of m) if (v > bestCount) { bestCount = v; best = k; }
  return best;
}
