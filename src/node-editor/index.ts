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
  canAddEdge,
} from './graph';

export {
  initCables,
  pathForEndpoints,
  GRAPH_CHANGED_EVENT,
} from './cables';

export {
  initNodeEditor,
  openEditor,
  closeEditor,
  isEditorOpen,
  currentSweeperId,
  currentGraph,
} from './panel';
