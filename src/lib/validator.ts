import { ComponentSpec, ResolvedRef } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  needsUserInput: boolean;
}

export function validateSpec(spec: ComponentSpec, refs: ResolvedRef[]): ValidationResult {
  const errors: string[] = [];

  if (!spec.name) errors.push("Missing component name");
  if (!spec.type || spec.type !== "COMPONENT") errors.push("type must be COMPONENT");
  if (!spec.children) errors.push("Component must have at least one child");

  for (const child of spec.children || []) {
    if (child.needsCreation) {
      errors.push(`Child "${child.name}" needs creation — requires user approval`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    needsUserInput: spec.children?.some(c => c.needsCreation) ?? false,
  };
}
