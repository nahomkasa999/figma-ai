import {
  DsCatalog, RichCatalog, RichVariableCollection, RichVarEntry,
  ComponentAnatomy, ChildAnatomy, TextStyleEntry,
  VarEntry, ComponentEntry, ResolvedRef, PageEntry, FrameEntry,
} from "./types";

let cachedCatalog: DsCatalog | null = null;
let richCache: RichCatalog | null = null;

// ── Public API ──

export async function scanCurrentFile(): Promise<DsCatalog> {
  const [variables, components] = await Promise.all([scanVariables(), scanComponents()]);
  const fileKey = figma.fileKey || "local";
  const catalog: DsCatalog = { variables, components, fileKey };
  cachedCatalog = catalog;
  return catalog;
}

export async function scanRich(): Promise<RichCatalog> {
  if (richCache) return richCache;

  const [collections, components, textStyles] = await Promise.all([
    scanVariableCollections(),
    scanComponentAnatomy(),
    scanTextStyles(),
  ]);

  const fileKey = figma.fileKey || "local";
  const catalog: RichCatalog = { collections, components, textStyles, fileKey };
  richCache = catalog;
  return catalog;
}

export function getCachedCatalog(): DsCatalog | null {
  return cachedCatalog;
}

export function getRichCache(): RichCatalog | null {
  return richCache;
}

export function invalidateCache(): void {
  cachedCatalog = null;
  richCache = null;
}

export function scanForRef(ref: string): ResolvedRef | null {
  const cat = cachedCatalog;
  if (!cat) return null;

  const cleanRef = ref.replace(/^@/, "").toLowerCase();
  const candidates: ResolvedRef[] = [];

  for (const v of cat.variables) {
    const name = v.name.toLowerCase();
    if (name === cleanRef) {
      return { raw: ref, resolvedType: varTypeToResolved(v.type), id: v.id, name: v.name };
    }
    if (name.includes(cleanRef)) {
      candidates.push({ raw: ref, resolvedType: varTypeToResolved(v.type), id: v.id, name: v.name });
    }
  }

  for (const c of cat.components) {
    const name = c.name.toLowerCase();
    if (name === cleanRef) {
      return { raw: ref, resolvedType: "component", id: c.id, name: c.name };
    }
    if (name.includes(cleanRef)) {
      candidates.push({ raw: ref, resolvedType: "component", id: c.id, name: c.name });
    }
  }

  if (candidates.length === 1) return candidates[0];
  return null;
}

// ── Variable scanning (thin + rich) ──

async function scanVariables(): Promise<VarEntry[]> {
  const result: VarEntry[] = [];
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    for (const coll of collections) {
      const defaultModeId = coll.modes[0]?.modeId;
      for (const varId of coll.variableIds) {
        const variable = await figma.variables.getVariableByIdAsync(varId);
        if (variable) {
          result.push({
            id: variable.id,
            name: variable.name,
            type: variable.variableType as VarEntry["type"],
            collection: coll.name,
            resolvedValue: resolveDefaultValue(variable, defaultModeId),
          });
        }
      }
    }
  } catch (e) {
    console.error("scanVariables error:", e);
  }
  return result;
}

async function scanVariableCollections(): Promise<RichVariableCollection[]> {
  const result: RichVariableCollection[] = [];
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    for (const coll of collections) {
      const modes = coll.modes.map(m => ({ modeId: m.modeId, name: m.name }));
      const variables: RichVarEntry[] = [];

      for (const varId of coll.variableIds) {
        const variable = await figma.variables.getVariableByIdAsync(varId);
        if (!variable) continue;

        const varModes = modes.map(m => ({
          modeId: m.modeId,
          modeName: m.name,
          resolvedValue: resolveDefaultValue(variable, m.modeId),
        }));

        const groupPath = variable.name.split("/").map(s => s.trim());
        const defaultModeId = modes[0]?.modeId;

        variables.push({
          id: variable.id,
          name: variable.name,
          type: variable.variableType as RichVarEntry["type"],
          collection: coll.name,
          groupPath,
          resolvedValue: resolveDefaultValue(variable, defaultModeId),
          modes: varModes,
        });
      }

      // Group by first path segment, then second, etc.
      const groups = buildVarGroups(variables);

      result.push({ name: coll.name, modes, groups, variables });
    }
  } catch (e) {
    console.error("scanVariableCollections error:", e);
  }
  return result;
}

function buildVarGroups(vars: RichVarEntry[]): { path: string; variables: RichVarEntry[] }[] {
  const groups: Record<string, RichVarEntry[]> = {};
  for (const v of vars) {
    const path = v.groupPath.length > 1 ? v.groupPath.slice(0, -1).join("/") : "_ungrouped";
    if (!groups[path]) groups[path] = [];
    groups[path].push(v);
  }
  return Object.entries(groups).map(([path, variables]) => ({ path, variables }));
}

// ── Component anatomy ──

async function scanComponentAnatomy(): Promise<ComponentAnatomy[]> {
  const results: ComponentAnatomy[] = [];
  const components: (ComponentNode | ComponentSetNode)[] = [];
  figma.root.findAll((node) => {
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      components.push(node as ComponentNode | ComponentSetNode);
    }
    return false;
  });

  // Thumbnail export in parallel, limit to 10 for perf
  const exportables = components.slice(0, 10);

  for (const node of components) {
    try {
      const isSet = node.type === "COMPONENT_SET";
      const anatomy: ComponentAnatomy = {
        id: node.id,
        name: node.name,
        key: node.key || "",
        type: node.type as "COMPONENT" | "COMPONENT_SET",
        boundVariables: extractBoundVars(node),
        fills: extractPaintInfo(node),
        strokes: extractStrokeInfo(node),
        children: walkChildren(node as SceneNode, 0),
      };

      if (isSet) {
        anatomy.variantProperties = extractVariantProperties(node as ComponentSetNode);
      }

      if ("layoutMode" in node) {
        const n = node as FrameNode;
        anatomy.rootLayout = {
          mode: n.layoutMode,
          paddingTop: n.paddingTop,
          paddingRight: n.paddingRight,
          paddingBottom: n.paddingBottom,
          paddingLeft: n.paddingLeft,
          itemSpacing: n.itemSpacing,
        };
      }

      // Thumbnail (best-effort)
      if (exportables.includes(node as any)) {
        try {
          const bytes = await (node as ComponentNode).exportAsync({
            format: "PNG",
            constraint: { type: "WIDTH", value: 200 },
          });
          anatomy.thumbnail = figma.base64Encode(bytes);
        } catch {}
      }

      results.push(anatomy);
    } catch (e) {
      console.error(`scanComponentAnatomy error for ${node.name}:`, e);
    }
  }

  return results;
}

function walkChildren(node: SceneNode, depth: number): ChildAnatomy[] {
  if (!("children" in node)) return [];

  const children: ChildAnatomy[] = [];
  const maxChildren = node.children.length;

  for (let i = 0; i < maxChildren; i++) {
    const child = node.children[i];
    const info: ChildAnatomy = {
      nodeId: child.id,
      name: child.name,
      type: child.type,
      depth,
      boundVariables: extractBoundVars(child),
      fills: extractPaintInfo(child),
      strokes: extractStrokeInfo(child),
      children: [],
    };

    if ("layoutMode" in child) {
      const f = child as FrameNode;
      info.layout = {
        mode: f.layoutMode,
        paddingTop: f.paddingTop,
        paddingRight: f.paddingRight,
        paddingBottom: f.paddingBottom,
        paddingLeft: f.paddingLeft,
        itemSpacing: f.itemSpacing,
      };
    }

    if (child.type === "TEXT") {
      const t = child as TextNode;
      try {
        const font = t.fontName as FontName;
        info.fontFamily = font.family;
        info.fontWeight = parseInt(font.style) || 400;
        info.fontSize = t.fontSize as number;
      } catch {}
      info.characters = t.characters.slice(0, 80);
    }

    if (depth < 3 && "children" in child && child.children.length > 0) {
      info.children = walkChildren(child, depth + 1);
    } else if ("children" in child && child.children.length > 0) {
      info.summary = `${child.children.length} children (types: ${groupTypes(child.children)})`;
    }

    children.push(info);
  }

  return children;
}

// ── Text styles ──

async function scanTextStyles(): Promise<TextStyleEntry[]> {
  const result: TextStyleEntry[] = [];
  try {
    const styles = await figma.getLocalTextStylesAsync();
    for (const s of styles) {
      result.push({
        id: s.id,
        name: s.name,
        fontFamily: s.fontName.family,
        fontPostScriptName: s.fontName.style,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight?.value ?? s.lineHeight?.unit === "AUTO" ? undefined : s.lineHeight?.value,
        letterSpacing: s.letterSpacing?.value,
      });
    }
  } catch (e) {
    console.error("scanTextStyles error:", e);
  }
  return result;
}

// ── Page / Frame scanning ──

export function scanPagesAndFrames(): PageEntry[] {
  const pages: PageEntry[] = [];
  try {
    for (const page of figma.root.children) {
      const frames: FrameEntry[] = [];
      for (const node of page.children) {
        if (node.type === "FRAME" || node.type === "GROUP" || node.type === "COMPONENT" || node.type === "COMPONENT_SET" || node.type === "INSTANCE") {
          frames.push({
            id: node.id,
            name: node.name,
            type: node.type,
            count: "children" in node ? node.children.length : 0,
          });
        }
      }
      pages.push({ id: page.id, name: page.name, frames });
    }
  } catch (e) {
    console.error("scanPagesAndFrames error:", e);
  }
  return pages;
}

// ── Helpers ──

function resolveDefaultValue(variable: Variable, modeId?: string): string | undefined {
  if (!modeId) return undefined;
  const val = variable.valuesByMode[modeId];
  if (!val) return undefined;

  if (variable.variableType === "COLOR" && typeof val === "object" && "r" in val) {
    const c = val as { r: number; g: number; b: number; a?: number };
    return `#${chan(c.r)}${chan(c.g)}${chan(c.b)}`;
  }
  if (variable.variableType === "FLOAT" && typeof val === "number") {
    return String(val);
  }
  if (variable.variableType === "STRING" && typeof val === "string") {
    return val;
  }
  return undefined;
}

function chan(v: number): string {
  return Math.round(v * 255).toString(16).padStart(2, "0");
}

function extractBoundVars(node: SceneNode): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  try {
    const bv = (node as any).boundVariables;
    if (bv) {
      for (const key of Object.keys(bv)) {
        const val = bv[key];
        if (val === undefined || val === null) continue;
        result[key] = Array.isArray(val) ? val.map((x: any) => x?.id).filter(Boolean) : [val.id];
      }
    }
  } catch {}
  return result;
}

function extractPaintInfo(node: SceneNode): { variableId?: string; hex?: string; opacity?: number }[] {
  const result: { variableId?: string; hex?: string; opacity?: number }[] = [];
  try {
    if ("fills" in node && node.fills !== figma.mixed) {
      for (const p of node.fills as Paint[]) {
        const entry: any = { opacity: p.opacity };
        if (p.type === "SOLID") {
          const sp = p as SolidPaint;
          entry.hex = `#${chan(sp.color.r)}${chan(sp.color.g)}${chan(sp.color.b)}`;
        } else {
          entry.hex = p.type;
        }
        result.push(entry);
      }
    }
  } catch {}
  return result;
}

function extractStrokeInfo(node: SceneNode): { variableId?: string; hex?: string; opacity?: number }[] {
  const result: { variableId?: string; hex?: string; opacity?: number }[] = [];
  try {
    if ("strokes" in node && node.strokes !== figma.mixed) {
      for (const p of node.strokes as Paint[]) {
        const entry: any = { opacity: p.opacity };
        if (p.type === "SOLID") {
          const sp = p as SolidPaint;
          entry.hex = `#${chan(sp.color.r)}${chan(sp.color.g)}${chan(sp.color.b)}`;
        } else {
          entry.hex = p.type;
        }
        result.push(entry);
      }
    }
  } catch {}
  return result;
}

function extractVariantProperties(set: ComponentSetNode): Record<string, string> {
  const props: Record<string, string> = {};
  try {
    for (const [key, values] of Object.entries(set.componentPropertyDefinitions)) {
      props[key] = Array.isArray(values) ? values.slice(0, 3).join(", ") : String(values);
    }
  } catch {}
  return props;
}

function groupTypes(children: SceneNode[]): string {
  const counts: Record<string, number> = {};
  for (const c of children) {
    counts[c.type] = (counts[c.type] || 0) + 1;
  }
  return Object.entries(counts).map(([t, n]) => `${n}x${t}`).join(", ");
}

function varTypeToResolved(t: string): ResolvedRef["resolvedType"] {
  switch (t) {
    case "COLOR": return "color-var";
    case "FLOAT": return "spacing-var";
    case "STRING": return "font-var";
    default: return "color-var";
  }
}

function scanComponents(): ComponentEntry[] {
  const result: ComponentEntry[] = [];
  figma.root.findAll((node) => {
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      result.push({
        id: node.id,
        name: node.name,
        key: node.key || "",
        isComponentSet: node.type === "COMPONENT_SET",
      });
    }
    return false;
  });
  return result;
}
