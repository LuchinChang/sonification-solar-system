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

// Explicit-register (call from main.ts): Unit 6 / 7 / 10 / 14 expose their own
// register*Nodes() entry point so tests can reset + re-register cleanly.
export { registerDataNodes } from './nodes/data';

// Side-effect register-on-import (Unit 8 / 9): loading this barrel registers
// the NodeDefinitions immediately. Fine for production; tests reset via
// _resetRegistryForTests then re-register from their own beforeEach.
import './nodes/sound-effects';
