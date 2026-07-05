// ── Thin catalog (legacy, kept for backward compat) ──
export interface VarEntry {
  id: string;
  name: string;
  type: "COLOR" | "FLOAT" | "STRING";
  collection: string;
  resolvedValue?: string;
}

export interface ComponentEntry {
  id: string;
  name: string;
  key: string;
  isComponentSet: boolean;
}

export interface DsCatalog {
  variables: VarEntry[];
  components: ComponentEntry[];
  fileKey: string;
}

// ── Rich index (new) ──
export interface RichVarEntry {
  id: string;
  name: string;
  type: "COLOR" | "FLOAT" | "STRING";
  collection: string;
  groupPath: string[];          // ["color", "bg", "primary"]
  resolvedValue?: string;
  modes: { modeId: string; modeName: string; resolvedValue?: string }[];
}

export interface RichVariableCollection {
  name: string;
  modes: { modeId: string; name: string }[];
  groups: { path: string; variables: RichVarEntry[] }[];
  variables: RichVarEntry[];
}

export interface ChildAnatomy {
  nodeId: string;
  name: string;
  type: string;
  depth: number;
  layout?: {
    mode: "NONE" | "VERTICAL" | "HORIZONTAL";
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    itemSpacing: number;
  };
  fills: { variableId?: string; hex?: string; opacity?: number }[];
  strokes: { variableId?: string; hex?: string; opacity?: number }[];
  boundVariables: Record<string, string[]>;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  characters?: string;
  children: ChildAnatomy[];
  summary?: string;             // non-null when depth > 3, says "X children of type Y"
}

export interface ComponentAnatomy {
  id: string;
  name: string;
  key: string;
  type: "COMPONENT" | "COMPONENT_SET";
  variantProperties?: Record<string, string>;
  rootLayout?: {
    mode: "NONE" | "VERTICAL" | "HORIZONTAL";
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    itemSpacing: number;
  };
  boundVariables: Record<string, string[]>;
  fills: { variableId?: string; hex?: string; opacity?: number }[];
  strokes: { variableId?: string; hex?: string; opacity?: number }[];
  children: ChildAnatomy[];
  thumbnail?: string;           // data:image/png;base64,...
}

export interface TextStyleEntry {
  id: string;
  name: string;
  fontFamily: string;
  fontPostScriptName: string;
  fontSize: number;
  fontWeight: number;
  lineHeight?: number;
  letterSpacing?: number;
}

export interface RichCatalog {
  collections: RichVariableCollection[];
  components: ComponentAnatomy[];
  textStyles: TextStyleEntry[];
  fileKey: string;
}

// ── Existing types (unchanged) ──
export interface ResolvedRef {
  raw: string;
  resolvedType: "color-var" | "spacing-var" | "font-var" | "component";
  id: string;
  name: string;
}

export interface ComponentSpec {
  type: "COMPONENT";
  name: string;
  description: string;
  layout: {
    mode: "NONE" | "VERTICAL" | "HORIZONTAL";
    paddingTop?: number;
    paddingRight?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    itemSpacing?: number;
    primaryAxisSizingMode?: "FIXED" | "AUTO";
    counterAxisSizingMode?: "FIXED" | "AUTO";
  };
  children: NodeSpec[];
  fills?: PaintSpec[];
  strokes?: PaintSpec[];
  cornerRadius?: number;
}

export interface NodeSpec {
  type: "FRAME" | "TEXT" | "INSTANCE";
  name: string;
  characters?: string;
  fontVarId?: string;
  colorVarId?: string;
  fillColor?: string;
  layout?: NodeLayout;
  children?: NodeSpec[];
  instanceComponentId?: string;
  needsCreation?: boolean;
  fills?: PaintSpec[];
  strokes?: PaintSpec[];
  cornerRadius?: number;
  spacingVarId?: string;
}

export interface NodeLayout {
  mode?: "NONE" | "VERTICAL" | "HORIZONTAL";
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  sizing?: "FIXED" | "AUTO" | "FILL";
  width?: number;
  height?: number;
}

export interface PaintSpec {
  type: "SOLID";
  variableId?: string;
  color?: string;
  opacity?: number;
}

export interface FrameStyleRef {
  name: string;
  layoutMode: "NONE" | "VERTICAL" | "HORIZONTAL";
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  itemSpacing: number;
  primaryAxisSizingMode: "FIXED" | "AUTO";
  counterAxisSizingMode: "FIXED" | "AUTO";
  fills: PaintSpec[];
  strokes: PaintSpec[];
  cornerRadius: number;
  boundVarIds: string[];
  children: { type: string; name: string; boundVarIds: string[] }[];
}

export interface ChildSpec {
  name: string;
  type: string;
  fills: string[];
  strokes: string[];
  boundVarIds: string[];
  fontFamily?: string;
  fontSize?: number;
  characters?: string;
  layout?: string;
  instanceComponentId?: string;
  children: ChildSpec[];
}

export interface SelectionAttachment {
  id: string;
  name: string;
  type: string;
  layout: string;
  fills: string[];
  strokes: string[];
  boundVarIds: string[];
  childCount: number;
  children: ChildSpec[];
  resolvedVars: Record<string, string>;
  rawDump: string;
}

export type PageContext = "component" | "design";

// ── Page / Frame structure ──
export interface FrameEntry {
  id: string;
  name: string;
  type: string;
  count: number;
}

export interface PageEntry {
  id: string;
  name: string;
  frames: FrameEntry[];
}

// ── Normalized catalog (curated design system spec for LLM) ──
export interface NormalizedToken {
  id: string;
  role: "background" | "text" | "border" | "accent" | "surface" | "semantic";
  category: "color" | "spacing" | "typography";
  canonicalName: string;
  originalName: string;
  resolvedValue?: string;
  aliases: string[];
  sourceIds: string[];
  usageCount: number;
}

export interface NormalizedComponent {
  id: string;
  key: string;
  name: string;
  type: "COMPONENT" | "COMPONENT_SET";
  inferredPurpose: string;
  variantCount: number;
  rootLayout?: {
    mode: "NONE" | "VERTICAL" | "HORIZONTAL";
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    itemSpacing: number;
  };
  boundTokenIds: string[];
}

export interface SpacingScale {
  values: number[];
  unit: number;
  varIds: Record<number, string>;
}

export interface StyleFingerprint {
  defaultPadding: number;
  defaultSpacing: number;
  defaultBgTokenId?: string;
  defaultTextTokenId?: string;
  defaultBorderTokenId?: string;
  defaultAccentTokenId?: string;
  preferredLayout: "VERTICAL" | "HORIZONTAL";
  preferredCornerRadius: number;
}

export interface NormalizedCatalog {
  colorTokens: NormalizedToken[];
  spacing: SpacingScale;
  components: NormalizedComponent[];
  textStyles: TextStyleEntry[];
  fingerprint: StyleFingerprint;
  fileKey: string;
}

export type PluginMessage =
  | { type: "SCAN_RESULT"; catalog: DsCatalog; pageContext: PageContext }
  | { type: "RESOLVED_REFS"; refs: ResolvedRef[] }
  | { type: "EXECUTE_SPEC"; spec: ComponentSpec }
  | { type: "EXECUTE_RESULT"; success: boolean; nodeId?: string; error?: string }
  | { type: "SELECTION_CHANGED"; nodeCount: number; attachments: SelectionAttachment[] }
  | { type: "DOCUMENT_CHANGED" }
  | { type: "QUERY_USER"; question: string; options: string[]; id: string }
  | { type: "USER_ANSWER"; id: string; answer: string }
  | { type: "SHOW_PREVIEW"; spec: ComponentSpec; refs: ResolvedRef[] }
  | { type: "APPLY_CONFIRMED" }
  | { type: "APPLY_CANCELLED" }
  | { type: "ERROR"; message: string }
  | { type: "TEST_HELLO"; message: string }
  | { type: "RESOLVE_FRAME"; ref: string }
  | { type: "FRAME_RESOLVED"; ref: string; style: FrameStyleRef | null; error?: string }
  | { type: "SCAN_RICH_RESULT"; richCatalog: RichCatalog }
  | { type: "PAGES_SCAN_RESULT"; pages: PageEntry[] };
