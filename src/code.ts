import { scanCurrentFile, scanRich, scanPagesAndFrames, invalidateCache, getCachedCatalog } from "./lib/scanner";
import { PluginMessage, ComponentSpec, PageContext, FrameStyleRef, PaintSpec, DsCatalog, VarEntry, SelectionAttachment, ChildSpec } from "./lib/types";

let catalogCache: DsCatalog | null = null;

figma.on("run", () => {
  figma.showUI(__html__, { width: 520, height: 600 });

  figma.ui.onmessage = (msg: PluginMessage) => {
    switch (msg.type) {
      case "EXECUTE_SPEC":
        handleExecuteSpec(msg.spec);
        break;
      case "RESOLVE_FRAME":
        handleResolveFrame(msg.ref);
        break;
      case "APPLY_CONFIRMED":
        figma.ui.postMessage({ type: "APPLY_CONFIRMED" });
        break;
      case "APPLY_CANCELLED":
        figma.ui.postMessage({ type: "APPLY_CANCELLED" });
        break;
    }
  };

  figma.on("selectionchange", () => {
    const attachments = figma.currentPage.selection.map(extractAttachment);
    figma.ui.postMessage({
      type: "SELECTION_CHANGED",
      nodeCount: figma.currentPage.selection.length,
      attachments,
    });
  });

  figma.on("documentchange", () => {
    invalidateCache();
    catalogCache = null;
    figma.ui.postMessage({ type: "DOCUMENT_CHANGED" });
  });

  scanCurrentFile()
    .then((catalog) => {
      catalogCache = catalog;
      const pageContext = getPageContext();
      figma.ui.postMessage({ type: "SCAN_RESULT", catalog, pageContext } as PluginMessage);
    })
    .catch((err) => {
      figma.ui.postMessage({ type: "ERROR", message: String(err) } as PluginMessage);
    });

  // Rich index (async — includes thumbnails)
  scanRich()
    .then((richCatalog) => {
      figma.ui.postMessage({ type: "SCAN_RICH_RESULT", richCatalog } as PluginMessage);
    })
    .catch(() => {});

  // Pages & frames
  const pages = scanPagesAndFrames();
  figma.ui.postMessage({ type: "PAGES_SCAN_RESULT", pages } as PluginMessage);
});

function handleExecuteSpec(spec: ComponentSpec) {
  try {
    const context = getPageContext();
    const vars = catalogCache?.variables || [];
    const colorMap = buildColorMap(vars);

    if (context === "design" && spec.type === "COMPONENT") {
      spec.type = "FRAME";
    }

    const node = spec.type === "COMPONENT" ? figma.createComponent() : figma.createFrame();
    node.name = spec.name;

    node.layoutMode = layoutModeToFigma(spec.layout.mode);
    if (spec.layout.paddingTop !== undefined) node.paddingTop = spec.layout.paddingTop;
    if (spec.layout.paddingRight !== undefined) node.paddingRight = spec.layout.paddingRight;
    if (spec.layout.paddingBottom !== undefined) node.paddingBottom = spec.layout.paddingBottom;
    if (spec.layout.paddingLeft !== undefined) node.paddingLeft = spec.layout.paddingLeft;
    if (spec.layout.itemSpacing !== undefined) node.itemSpacing = spec.layout.itemSpacing;
    if (spec.layout.primaryAxisSizingMode) node.primaryAxisSizingMode = spec.layout.primaryAxisSizingMode;
    if (spec.layout.counterAxisSizingMode) node.counterAxisSizingMode = spec.layout.counterAxisSizingMode;

    if (spec.cornerRadius !== undefined) node.cornerRadius = spec.cornerRadius;

    if (spec.fills && spec.fills.length > 0) {
      applyPaints(node, spec.fills, colorMap);
    }
    if (spec.strokes && spec.strokes.length > 0) {
      applyStrokes(node, spec.strokes, colorMap);
    }

    if (spec.children) {
      for (const childSpec of spec.children) {
        createNode(childSpec, node, colorMap, vars);
      }
    }

    const center = figma.viewport.center;
    node.x = center.x - node.width / 2;
    node.y = center.y - node.height / 2;

    figma.currentPage.appendChild(node);
    figma.notify(`Created: ${spec.name}`);

    figma.ui.postMessage({
      type: "EXECUTE_RESULT",
      success: true,
      nodeId: node.id,
    } as PluginMessage);
  } catch (e) {
    figma.ui.postMessage({
      type: "EXECUTE_RESULT",
      success: false,
      error: String(e),
    } as PluginMessage);
  }
}

function createNode(spec: any, parent: FrameNode | ComponentNode, colorMap: Record<string, string>, vars: VarEntry[] = []) {
  let node: SceneNode;

  switch (spec.type) {
    case "FRAME": {
      const frame = figma.createFrame();
      frame.name = spec.name || "Frame";
      if (spec.layout) {
        if (spec.layout.mode) frame.layoutMode = layoutModeToFigma(spec.layout.mode);
        if (spec.layout.paddingTop !== undefined) frame.paddingTop = spec.layout.paddingTop;
        if (spec.layout.paddingRight !== undefined) frame.paddingRight = spec.layout.paddingRight;
        if (spec.layout.paddingBottom !== undefined) frame.paddingBottom = spec.layout.paddingBottom;
        if (spec.layout.paddingLeft !== undefined) frame.paddingLeft = spec.layout.paddingLeft;
        if (spec.layout.itemSpacing !== undefined) frame.itemSpacing = spec.layout.itemSpacing;
        if (spec.layout.width) frame.resize(spec.layout.width, frame.height);
        if (spec.layout.height) frame.resize(frame.width, spec.layout.height);
      }
      if (spec.cornerRadius !== undefined) frame.cornerRadius = spec.cornerRadius;
      if (spec.fills) applyPaints(frame, spec.fills, colorMap);
      if (spec.strokes) applyStrokes(frame, spec.strokes, colorMap);

      // Spacing variable binding
      if (spec.spacingVarId && spec.layout?.itemSpacing !== undefined) {
        bindFloatVariable(frame, "itemSpacing", spec.spacingVarId, vars);
      }

      if (spec.children) {
        for (const c of spec.children) createNode(c, frame, colorMap, vars);
      }
      node = frame;
      break;
    }
    case "TEXT": {
      const text = figma.createText();
      text.name = spec.name || "Text";

      // Font variable binding
      let fontVar: Variable | null = null;
      if (spec.fontVarId) {
        try {
          const v = figma.variables.getVariableById(spec.fontVarId);
          if (v && v.variableType === "STRING") fontVar = v;
        } catch {}
      }

      if (spec.characters) {
        figma.loadFontAsync(text.fontName as FontName).then(() => {
          text.characters = spec.characters;
        });
      }

      // Color binding: prefer colorVarId, fall back to fillColor → colorMap
      const colorVarId = spec.colorVarId;
      const hexColor = spec.fillColor;
      let bound = false;

      if (colorVarId) {
        try {
          const variable = figma.variables.getVariableById(colorVarId);
          if (variable && variable.variableType === "COLOR") {
            const paint: SolidPaint = { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
            const boundPaint = (text as any).setBoundVariableForPaint(paint, "color", variable);
            text.fills = [boundPaint];
            bound = true;
          }
        } catch {}
      }

      if (!bound && hexColor) {
        const hex = hexColor.toLowerCase();
        const varId = colorMap[hex];
        if (varId) {
          try {
            const variable = figma.variables.getVariableById(varId);
            if (variable && variable.variableType === "COLOR") {
              const paint: SolidPaint = { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
              const boundPaint = (text as any).setBoundVariableForPaint(paint, "color", variable);
              text.fills = [boundPaint];
              bound = true;
            }
          } catch {}
        }
      }

      if (!bound && hexColor) {
        const c = hexColor.replace("#", "");
        text.fills = [{ type: "SOLID", color: { r: parseInt(c.substring(0, 2), 16) / 255, g: parseInt(c.substring(2, 4), 16) / 255, b: parseInt(c.substring(4, 6), 16) / 255 } } as SolidPaint];
      }

      node = text;
      break;
    }
    case "INSTANCE": {
      if (spec.instanceComponentId) {
        try {
          const mainComp = figma.getNodeById(spec.instanceComponentId);
          if (mainComp && "createInstance" in mainComp) {
            node = (mainComp as ComponentNode).createInstance();
            node.name = spec.name || "Instance";
          } else {
            node = figma.createFrame();
            node.name = `${spec.name || "Instance"} (missing)`;
          }
        } catch {
          node = figma.createFrame();
          node.name = `${spec.name || "Instance"} (missing)`;
        }
      } else {
        node = figma.createFrame();
        node.name = spec.name || "Instance";
      }
      break;
    }
    default:
      node = figma.createFrame();
      node.name = spec.name || "Node";
  }

  parent.appendChild(node);
}

function buildColorMap(vars: VarEntry[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const v of vars) {
    if (v.type === "COLOR" && v.resolvedValue) {
      map[v.resolvedValue.toLowerCase()] = v.id;
    }
  }
  return map;
}

function applyPaints(node: BaseNode, paints: any[], colorMap: Record<string, string>) {
  if (!("fills" in node)) return;
  const fillPaints: Paint[] = [];
  for (const p of paints) {
    let variable: Variable | null = null;

    if (p.variableId) {
      try { variable = figma.variables.getVariableById(p.variableId); } catch {}
    }

    if (!variable && p.color) {
      const hex = p.color.toLowerCase();
      const varId = colorMap[hex];
      if (varId) {
        try { variable = figma.variables.getVariableById(varId); } catch {}
      }
    }

    if (variable && variable.variableType === "COLOR") {
      const paint: SolidPaint = { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
      try {
        const bound = (node as any).setBoundVariableForPaint(paint, "color", variable);
        fillPaints.push(bound);
        continue;
      } catch {}
    }

    if (p.color) {
      const hex = p.color.replace("#", "");
      fillPaints.push({
        type: "SOLID",
        color: {
          r: parseInt(hex.substring(0, 2), 16) / 255,
          g: parseInt(hex.substring(2, 4), 16) / 255,
          b: parseInt(hex.substring(4, 6), 16) / 255,
        },
        opacity: p.opacity ?? 1,
      } as SolidPaint);
    } else {
      fillPaints.push({ type: "SOLID", color: { r: 0.8, g: 0.8, b: 0.8 } } as SolidPaint);
    }
  }
  (node as any).fills = fillPaints;
}

function applyStrokes(node: BaseNode, paints: any[], colorMap: Record<string, string>) {
  if (!("strokes" in node)) return;
  const strokePaints: Paint[] = [];
  for (const p of paints) {
    let variable: Variable | null = null;

    if (p.variableId) {
      try { variable = figma.variables.getVariableById(p.variableId); } catch {}
    }

    if (!variable && p.color) {
      const hex = p.color.toLowerCase();
      const varId = colorMap[hex];
      if (varId) {
        try { variable = figma.variables.getVariableById(varId); } catch {}
      }
    }

    if (variable && variable.variableType === "COLOR") {
      const paint: SolidPaint = { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
      try {
        const bound = (node as any).setBoundVariableForPaint(paint, "color", variable);
        strokePaints.push(bound);
        continue;
      } catch {}
    }

    if (p.color) {
      const hex = p.color.replace("#", "");
      strokePaints.push({
        type: "SOLID",
        color: {
          r: parseInt(hex.substring(0, 2), 16) / 255,
          g: parseInt(hex.substring(2, 4), 16) / 255,
          b: parseInt(hex.substring(4, 6), 16) / 255,
        },
        opacity: p.opacity ?? 1,
      } as SolidPaint);
    } else {
      strokePaints.push({ type: "SOLID", color: { r: 0, g: 0, b: 0 } } as SolidPaint);
    }
  }
  (node as any).strokes = strokePaints;
}

function layoutModeToFigma(mode: string): "NONE" | "VERTICAL" | "HORIZONTAL" {
  if (mode === "VERTICAL") return "VERTICAL";
  if (mode === "HORIZONTAL") return "HORIZONTAL";
  return "NONE";
}

function getPageContext(): PageContext {
  let hasComponent = false;
  figma.currentPage.findAll((n) => {
    if (n.type === "COMPONENT" || n.type === "COMPONENT_SET") hasComponent = true;
    return false;
  });
  return hasComponent ? "component" : "design";
}

function handleResolveFrame(ref: string) {
  const name = ref.replace(/^@/, "").replace(/-frame$/, "");
  const frameName = name.replace(/-/g, " ");

  const nodes = figma.currentPage.findAll(
    (n) => n.type === "FRAME" && n.name.toLowerCase() === frameName.toLowerCase()
  );

  if (nodes.length === 0) {
    figma.ui.postMessage({
      type: "FRAME_RESOLVED",
      ref,
      style: null,
      error: `No frame named "${frameName}" found on current page.`,
    } as PluginMessage);
    return;
  }

  const frame = nodes[0] as FrameNode;
  const style = extractFrameStyle(frame);
  figma.ui.postMessage({ type: "FRAME_RESOLVED", ref, style } as PluginMessage);
}

function extractFrameStyle(frame: FrameNode): FrameStyleRef {
  const boundVarIds: string[] = [];
  try {
    const boundVars = frame.boundVariables;
    if (boundVars) {
      for (const prop of Object.keys(boundVars)) {
        const v = (boundVars as any)[prop];
        if (Array.isArray(v)) v.forEach((x: any) => x?.id && boundVarIds.push(x.id));
        else if (v?.id) boundVarIds.push(v.id);
      }
    }
  } catch {}

  const fills: PaintSpec[] = [];
  try {
    if (frame.fills !== figma.mixed) {
      for (const p of frame.fills as Paint[]) {
        fills.push({ type: "SOLID", color: (p as SolidPaint).color ? rgbToHex((p as SolidPaint).color) : undefined, opacity: p.opacity });
      }
    }
  } catch {}

  const strokes: PaintSpec[] = [];
  try {
    if (frame.strokes !== figma.mixed) {
      for (const p of frame.strokes as Paint[]) {
        strokes.push({ type: "SOLID", color: (p as SolidPaint).color ? rgbToHex((p as SolidPaint).color) : undefined, opacity: p.opacity });
      }
    }
  } catch {}

  const children: { type: string; name: string; boundVarIds: string[] }[] = [];
  for (const child of frame.children) {
    const childVars: string[] = [];
    try {
      const bv = (child as any).boundVariables;
      if (bv) {
        for (const prop of Object.keys(bv)) {
          const v = (bv as any)[prop];
          if (Array.isArray(v)) v.forEach((x: any) => x?.id && childVars.push(x.id));
          else if (v?.id) childVars.push(v.id);
        }
      }
    } catch {}
    children.push({ type: child.type, name: child.name, boundVarIds: childVars });
  }

  return {
    name: frame.name,
    layoutMode: frame.layoutMode,
    paddingTop: frame.paddingTop,
    paddingRight: frame.paddingRight,
    paddingBottom: frame.paddingBottom,
    paddingLeft: frame.paddingLeft,
    itemSpacing: frame.itemSpacing,
    primaryAxisSizingMode: frame.primaryAxisSizingMode as "FIXED" | "AUTO",
    counterAxisSizingMode: frame.counterAxisSizingMode as "FIXED" | "AUTO",
    fills,
    strokes,
    cornerRadius: frame.cornerRadius,
    boundVarIds,
    children,
  };
}

const varNameCache = new Map<string, string>();

function getVarName(varId: string): string {
  if (varNameCache.has(varId)) return varNameCache.get(varId)!;
  try {
    const v = figma.variables.getVariableById(varId);
    if (v) {
      const name = v.name;
      varNameCache.set(varId, name);
      return name;
    }
  } catch {}
  varNameCache.set(varId, varId);
  return varId;
}

function extractChildSpec(node: SceneNode): ChildSpec {
  const boundVarIds: string[] = [];
  try {
    const bv = (node as any).boundVariables;
    if (bv) {
      for (const key of Object.keys(bv)) {
        const v = bv[key];
        if (Array.isArray(v)) v.forEach((x: any) => x?.id && boundVarIds.push(x.id));
        else if (v?.id) boundVarIds.push(v.id);
      }
    }
  } catch {}

  let layout = "";
  if ("layoutMode" in node) {
    const n = node as FrameNode;
    layout = `[${n.layoutMode} p:${n.paddingTop},${n.paddingRight},${n.paddingBottom},${n.paddingLeft} s:${n.itemSpacing}]`;
  }

  const fills: string[] = [];
  try {
    if ("fills" in node && node.fills !== figma.mixed) {
      for (const p of node.fills as Paint[]) {
        if (p.type === "SOLID") {
          const c = (p as SolidPaint).color;
          const hex = c ? `#${Math.round(c.r*255).toString(16).padStart(2,"0")}${Math.round(c.g*255).toString(16).padStart(2,"0")}${Math.round(c.b*255).toString(16).padStart(2,"0")}` : "";
          fills.push(hex || p.type);
        } else {
          fills.push(p.type);
        }
      }
    }
  } catch {}

  const strokes: string[] = [];
  try {
    if ("strokes" in node && node.strokes !== figma.mixed) {
      for (const p of node.strokes as Paint[]) {
        if (p.type === "SOLID") {
          const c = (p as SolidPaint).color;
          const hex = c ? `#${Math.round(c.r*255).toString(16).padStart(2,"0")}${Math.round(c.g*255).toString(16).padStart(2,"0")}${Math.round(c.b*255).toString(16).padStart(2,"0")}` : "";
          strokes.push(hex || p.type);
        } else {
          strokes.push(p.type);
        }
      }
    }
  } catch {}

  let characters: string | undefined;
  let fontFamily: string | undefined;
  let fontSize: number | undefined;
  let instanceComponentId: string | undefined;

  if (node.type === "TEXT") {
    const t = node as TextNode;
    try {
      const font = t.fontName as FontName;
      fontFamily = font.family;
      fontSize = t.fontSize as number;
    } catch {}
    characters = t.characters.slice(0, 40);
  }

  if (node.type === "INSTANCE") {
    try {
      const main = (node as InstanceNode).mainComponent;
      if (main) instanceComponentId = main.key || main.id;
    } catch {}
  }

  const children: ChildSpec[] = [];
  if ("children" in node) {
    for (const ch of node.children) {
      children.push(extractChildSpec(ch));
    }
  }

  return { name: node.name, type: node.type, fills, strokes, boundVarIds, fontFamily, fontSize, characters, layout, instanceComponentId, children };
}

function extractAttachment(node: SceneNode): SelectionAttachment {
  const spec = extractChildSpec(node);

  const resolvedVars: Record<string, string> = {};
  const allIds = new Set<string>(spec.boundVarIds);
  function collectIds(c: ChildSpec) {
    for (const id of c.boundVarIds) allIds.add(id);
    for (const ch of c.children) collectIds(ch);
  }
  collectIds(spec);
  for (const id of allIds) resolvedVars[id] = getVarName(id);

  return {
    id: node.id,
    name: spec.name,
    type: spec.type,
    layout: spec.layout || "",
    fills: spec.fills,
    strokes: spec.strokes,
    boundVarIds: spec.boundVarIds,
    childCount: spec.children.length,
    children: spec.children,
    resolvedVars,
    rawDump: dumpNodeRaw(node),
  };
}

function usageHint(prop: string): string {
  const hints: Record<string, string> = {
    fills: "use this as the fill color",
    strokes: "use this as the stroke color",
    itemSpacing: "use this as the gap between children",
    paddingTop: "use this as the top padding",
    paddingRight: "use this as the right padding",
    paddingBottom: "use this as the bottom padding",
    paddingLeft: "use this as the left padding",
    topLeftRadius: "use this as the top-left corner radius",
    topRightRadius: "use this as the top-right corner radius",
    bottomLeftRadius: "use this as the bottom-left corner radius",
    bottomRightRadius: "use this as the bottom-right corner radius",
    cornerRadius: "use this as the corner radius",
    fontSize: "use this as the font size",
    width: "use this as the width",
    height: "use this as the height",
    opacity: "use this as the opacity",
    strokeWeight: "use this as the stroke weight",
    lineHeight: "use this as the line height",
    letterSpacing: "use this as the letter spacing",
    layoutMode: "use this as the layout direction",
  };
  return hints[prop] || `bind this to property "${prop}"`;
}

type CreationRule = "MUST be created as INSTANCE — set instanceComponentId to mainComponent.key" | "MUST be created as FRAME" | "MUST be created as COMPONENT" | "MUST be created as TEXT";

function creationRuleFor(type: string): CreationRule {
  switch (type) {
    case "INSTANCE": return "MUST be created as INSTANCE — set instanceComponentId to mainComponent.key";
    case "FRAME": return "MUST be created as FRAME";
    case "COMPONENT": return "MUST be created as COMPONENT";
    case "COMPONENT_SET": return "MUST be created as COMPONENT";
    case "TEXT": return "MUST be created as TEXT";
    default: return "MUST be created as FRAME";
  }
}

function resolveBoundVars(node: SceneNode): Record<string, any> | undefined {
  const bv = (node as any).boundVariables;
  if (!bv) return undefined;
  const resolved: Record<string, any> = {};
  for (const [prop, val] of Object.entries(bv)) {
    const arr = (Array.isArray(val) ? val : [val]).filter(Boolean) as any[];
    resolved[prop] = arr.map(x => ({
      id: x.id,
      name: getVarName(x.id),
      usage: usageHint(prop),
    }));
  }
  return resolved;
}

function dumpNodeRaw(node: SceneNode): string {
  const raw: Record<string, any> = {};
  try {
    raw._instruction = "This is a real node from the user's file. When asked to reproduce or reference something similar, follow this structure and bind to the same design tokens by ID.";
    raw.id = node.id;
    raw.name = node.name;
    raw.type = node.type;
    raw.creationRule = creationRuleFor(node.type);
    raw.visible = (node as any).visible;
    raw.locked = (node as any).locked;
    raw.opacity = (node as any).opacity;
    raw.rotation = (node as any).rotation;

    if ("width" in node) {
      raw.x = node.x;
      raw.y = node.y;
      raw.width = node.width;
      raw.height = node.height;
    }

    if ("layoutMode" in node) {
      const f = node as FrameNode;
      raw.layout = {
        mode: f.layoutMode,
        padding: { top: f.paddingTop, right: f.paddingRight, bottom: f.paddingBottom, left: f.paddingLeft },
        itemSpacing: f.itemSpacing,
        primaryAxisSizingMode: (f as any).primaryAxisSizingMode,
        counterAxisSizingMode: (f as any).counterAxisSizingMode,
        primaryAxisAlignItems: (f as any).primaryAxisAlignItems,
        counterAxisAlignItems: (f as any).counterAxisAlignItems,
      };
      raw.clipsContent = (f as any).clipsContent;
      raw.layoutSizingHorizontal = (f as any).layoutSizingHorizontal;
      raw.layoutSizingVertical = (f as any).layoutSizingVertical;
    }

    raw.cornerRadius = (node as any).cornerRadius;
    raw.topLeftRadius = tryGet(() => (node as any).topLeftRadius);
    raw.topRightRadius = tryGet(() => (node as any).topRightRadius);
    raw.bottomLeftRadius = tryGet(() => (node as any).bottomLeftRadius);
    raw.bottomRightRadius = tryGet(() => (node as any).bottomRightRadius);

    if (node.type === "TEXT") {
      const t = node as TextNode;
      raw.text = {
        fontName: tryGet(() => t.fontName as FontName),
        fontSize: t.fontSize,
        fontWeight: t.fontWeight,
        letterSpacing: t.letterSpacing,
        lineHeight: t.lineHeight,
        textAutoResize: t.textAutoResize,
        characters: t.characters.slice(0, 120),
      };
    }

    if (node.type === "INSTANCE") {
      const m = tryGet(() => (node as InstanceNode).mainComponent);
      raw.instance = {
        mainComponent: m ? { key: m.key, name: m.name } : null,
        _rule: "When generating, set type=\"INSTANCE\" and instanceComponentId to mainComponent.key above. Do NOT rebuild this from primitives.",
      };
    }

    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      raw.componentPropertyDefinitions = tryGet(() => (node as any).componentPropertyDefinitions);
    }

    raw.boundVariables = resolveBoundVars(node);

    raw.fills = tryGet(() => {
      if (!("fills" in node)) return undefined;
      return (node.fills as Paint[]).map(p => p.type === "SOLID"
        ? { type: "SOLID", color: { r: (p as SolidPaint).color.r, g: (p as SolidPaint).color.g, b: (p as SolidPaint).color.b }, opacity: p.opacity }
        : { type: p.type, opacity: p.opacity });
    });

    raw.strokes = tryGet(() => {
      if (!("strokes" in node)) return undefined;
      return (node.strokes as Paint[]).map(p => p.type === "SOLID"
        ? { type: "SOLID", color: { r: (p as SolidPaint).color.r, g: (p as SolidPaint).color.g, b: (p as SolidPaint).color.b }, opacity: p.opacity }
        : { type: p.type, opacity: p.opacity });
    });

    raw.strokeWeight = tryGet(() => (node as any).strokeWeight);
    raw.strokeAlign = tryGet(() => (node as any).strokeAlign);
    raw.dashPattern = tryGet(() => (node as any).dashPattern);
    raw.constraints = tryGet(() => (node as any).constraints);
    raw.effects = tryGet(() => (node as any).effects);
    raw.children = "children" in node ? { count: node.children.length } : undefined;
  } catch (e) {
    raw._error = String(e);
  }
  return JSON.stringify(raw, null, 2);
}

function tryGet<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function bindFloatVariable(node: FrameNode | ComponentNode, property: string, varId: string, vars: VarEntry[]) {
  try {
    const variable = figma.variables.getVariableById(varId);
    if (variable && variable.variableType === "FLOAT") {
      (node as any).setBoundVariable(property, variable);
    }
  } catch {}
}

function rgbToHex(color: { r: number; g: number; b: number } | undefined): string | undefined {
  if (!color) return undefined;
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
