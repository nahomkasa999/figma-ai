import { RichCatalog, RichVariableCollection, RichVarEntry, ComponentAnatomy, ChildAnatomy, TextStyleEntry, SelectionAttachment } from "./types";

interface Scored<T> { item: T; score: number }

export function retrieveRelevant(
  query: string,
  catalog: RichCatalog,
  attachments: SelectionAttachment[]
): RichCatalog {
  const keywords = tokenize(query);
  if (keywords.length === 0) return capAll(catalog, 30, 10);

  const attachmentCompIds = new Set(attachments.map(a => a.id));

  // Score variables
  const scoredVars = catalog.collections.flatMap(coll =>
    coll.variables.map(v => ({
      item: v,
      score: scoreVariable(v, coll.name, keywords, attachmentCompIds),
    }))
  );
  scoredVars.sort((a, b) => b.score - a.score);
  const topVars = new Set(scoredVars.slice(0, 30).map(s => s.item.id));
  const forcedVars = scoredVars.filter(s => s.score >= 10).map(s => s.item.id);
  forcedVars.forEach(id => topVars.add(id));

  // Score components
  const scoredComps = catalog.components.map(c => ({
    item: c,
    score: scoreComponent(c, keywords, attachmentCompIds),
  }));
  scoredComps.sort((a, b) => b.score - a.score);
  const topComps = new Set(scoredComps.slice(0, 10).map(s => s.item.id));
  const forcedComps = scoredComps.filter(s => s.score >= 10).map(s => s.item.id);
  forcedComps.forEach(id => topComps.add(id));

  return buildFilteredCatalog(catalog, topVars, topComps);
}

function tokenize(query: string): string[] {
  return query.toLowerCase()
    .replace(/[^a-z0-9\s\/-]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 1);
}

function scoreVariable(
  v: RichVarEntry,
  collName: string,
  keywords: string[],
  attachmentCompIds: Set<string>
): number {
  let score = 0;
  const name = v.name.toLowerCase();
  const groupPath = v.groupPath.map(s => s.toLowerCase());

  for (const kw of keywords) {
    if (name === kw) score += 10;
    else if (name.includes(kw)) score += 5;
    else if (groupPath.some(s => s === kw)) score += 3;
    else if (groupPath.some(s => s.includes(kw))) score += 2;
    else if (collName.toLowerCase().includes(kw)) score += 1;
  }

  return score;
}

function scoreComponent(
  c: ComponentAnatomy,
  keywords: string[],
  attachmentCompIds: Set<string>
): number {
  if (attachmentCompIds.has(c.id)) return 20;

  let score = 0;
  const name = c.name.toLowerCase();

  for (const kw of keywords) {
    if (name === kw) score += 10;
    else if (name.includes(kw)) score += 5;

    // Score against child names
    forEachChildName(c.children, childName => {
      if (childName === kw) score += 3;
      else if (childName.includes(kw)) score += 1;
    });

    // Score against fill hexes
    for (const f of c.fills) {
      if (f.hex?.toLowerCase().includes(kw)) score += 1;
    }
  }

  return score;
}

function forEachChildName(children: ChildAnatomy[], fn: (name: string) => void) {
  for (const c of children) {
    fn(c.name.toLowerCase());
    if (c.children) forEachChildName(c.children, fn);
  }
}

function buildFilteredCatalog(
  original: RichCatalog,
  keepVarIds: Set<string>,
  keepCompIds: Set<string>
): RichCatalog {
  const collections: RichVariableCollection[] = [];
  for (const coll of original.collections) {
    const kept = coll.variables.filter(v => keepVarIds.has(v.id));
    if (kept.length === 0) continue;

    const keptIds = new Set(kept.map(v => v.id));
    const groups = coll.groups
      .map(g => ({
        path: g.path,
        variables: g.variables.filter(v => keptIds.has(v.id)),
      }))
      .filter(g => g.variables.length > 0);

    collections.push({ ...coll, variables: kept, groups });
  }

  return {
    collections,
    components: original.components.filter(c => keepCompIds.has(c.id)),
    textStyles: original.textStyles,
    fileKey: original.fileKey,
  };
}

function capAll(catalog: RichCatalog, maxVars: number, maxComps: number): RichCatalog {
  const allVars = catalog.collections.flatMap(c => c.variables);
  if (allVars.length <= maxVars && catalog.components.length <= maxComps) return catalog;

  const keepVarIds = new Set(allVars.slice(0, maxVars).map(v => v.id));
  const keepCompIds = new Set(catalog.components.slice(0, maxComps).map(c => c.id));
  return buildFilteredCatalog(catalog, keepVarIds, keepCompIds);
}
