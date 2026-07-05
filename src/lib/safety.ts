import { ComponentSpec } from "./types";

export type OpSize = "direct" | "preview";

export function classifyOp(spec: ComponentSpec): OpSize {
  const childCount = countNodes(spec);
  if (childCount <= 3 && !hasUnknownRefs(spec)) return "direct";
  return "preview";
}

function countNodes(spec: any): number {
  let count = 1;
  for (const child of spec.children || []) {
    count += countNodes(child);
  }
  return count;
}

function hasUnknownRefs(spec: any): boolean {
  for (const child of spec.children || []) {
    if (child.needsCreation) return true;
    if (child.children && hasUnknownRefs(child)) return true;
  }
  return false;
}
