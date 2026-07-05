import { FrameStyleRef, ResolvedRef } from "../lib/types";

export function parseRefs(text: string): string[] {
  const matches = text.match(/@[\w\/-]+/g);
  return matches || [];
}

export function hasFrameRef(refs: string[]): string | null {
  for (const r of refs) {
    if (r.endsWith("-frame")) return r;
  }
  return null;
}

export function buildRefPrompt(
  text: string,
  frameStyle: FrameStyleRef | null,
  ref: string | null
): string {
  let prompt = text;

  if (frameStyle && ref) {
    prompt = text.replace(
      ref,
      `[use the style of "${frameStyle.name}": layout=${frameStyle.layoutMode}, padding=[${frameStyle.paddingTop},${frameStyle.paddingRight},${frameStyle.paddingBottom},${frameStyle.paddingLeft}], spacing=${frameStyle.itemSpacing}, sizing=${frameStyle.primaryAxisSizingMode}/${frameStyle.counterAxisSizingMode}, ${frameStyle.fills.length} fills, ${frameStyle.strokes.length} strokes, radius=${frameStyle.cornerRadius}, ${frameStyle.children.length} children]`
    );
  }

  return prompt;
}
