// src/node-editor/registry.ts
//
// Runtime registry of NodeDefinitions.
//
// Units 5–10 will each call `registerNodeDef(def)` at module load to add
// their data / sound / sweeper nodes. Unit 4 leaves the registry EMPTY —
// but the shape of this API is frozen so later units drop in cleanly.
//
// No globals: the Map is module-scoped, so tests can `import fresh` to
// reset it (see __tests__/node-editor.test.ts).

import type { NodeDefinition, NodeSide } from './types';

const defs = new Map<string, NodeDefinition>();

/** Register a node. Duplicate `type` keys throw — catches copy-paste bugs. */
export function registerNodeDef(def: NodeDefinition): void {
  if (defs.has(def.type)) {
    throw new Error(`[node-editor] duplicate NodeDefinition type: "${def.type}"`);
  }
  defs.set(def.type, def);
}

/** Lookup a registered definition. Returns undefined if not found. */
export function getNodeDef(type: string): NodeDefinition | undefined {
  return defs.get(type);
}

/** List all registered defs, optionally filtered by side (left/right column). */
export function listNodeDefs(side?: NodeSide): NodeDefinition[] {
  const all = Array.from(defs.values());
  return side === undefined ? all : all.filter(d => d.side === side);
}

/** Test-only: wipe the registry. Not exported from the barrel. */
export function _resetRegistryForTests(): void {
  defs.clear();
}
