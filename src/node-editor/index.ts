// src/node-editor/index.ts
//
// Barrel re-exports for the node-editor module.
// Keep this surface minimal — callers should import from here, not the
// individual files, so we can refactor internals without churn.

export type {
  NodeDefinition,
  NodeGraph,
  Node,
  Edge,
  Port,
  PortSpec,
  PortKind,
  PortDirection,
  NodeSide,
  CodegenCtx,
} from './types';

export {
  registerNodeDef,
  getNodeDef,
  listNodeDefs,
} from './registry';

export {
  createGraph,
  addNode,
  removeNode,
  addEdge,
  removeEdge,
  incomingEdges,
} from './graph';

export {
  initNodeEditor,
  openEditor,
  closeEditor,
  isEditorOpen,
  currentSweeperId,
  currentGraph,
} from './panel';

// Side-effect imports: registering NodeDefinitions at module load.
// Units 5–10 each import their nodes file here so a single import of
// `./node-editor` populates the registry.
import './nodes/sound-effects';
