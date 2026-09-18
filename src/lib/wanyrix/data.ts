/**
 * Wanyrix fixture data — public barrel (GitHub issue #53).
 *
 * The former 3,006-line data.ts was decomposed into per-domain modules under
 * `src/lib/wanyrix/fixtures/`; this file is a PURE re-export barrel. Every
 * export keeps its original name and value, so all existing
 * `@/lib/wanyrix/data` consumers work unchanged. Domain-module internals
 * (RAW_* data, graph math, atlas catalogs, helper types) stay encapsulated.
 * Shared types live in ../types; domain-owned types are documented in each
 * module's header (graph.ts: DerivedGraphMath + RawGraphNode; catalog.ts:
 * UpgradeCatalogEntry).
 */
export { REPO_URL } from './fixtures/shared'
export { WORKSPACE, WORKSPACE_ATLAS, WORKSPACES, WORKSPACES_DEFAULT } from './fixtures/workspaces'
export { FINDINGS } from './fixtures/findings'
export { DOCTOR, DOCTOR_ATLAS } from './fixtures/doctor'
export { HEALTH, HEALTH_ATLAS } from './fixtures/health'
export { GRAPH_EDGES, GRAPH_NODES, GRAPH_EDGES_ATLAS, GRAPH_NODES_ATLAS } from './fixtures/graph'
export type { DerivedGraphMath } from './fixtures/graph'
export { DUPLICATES, DUPLICATES_ATLAS } from './fixtures/duplicates'
export { BLAST, BLAST_ATLAS } from './fixtures/blast'
export { ADD_DEP_CATALOG } from './fixtures/catalog'
export { SPLIT_SIM } from './fixtures/simulator'
export { DIAGNOSTICS, DIAGNOSTICS_ATLAS } from './fixtures/diagnostics'
export { PR_184, PR_97_ATLAS } from './fixtures/pr'
export { EXPERIMENTS } from './fixtures/experiments'
export { GATES } from './fixtures/gates'
export { ISSUES } from './fixtures/issues'
export { ORGANIZATION } from './fixtures/organization'
export {
  getWorkspaces,
  getHealth,
  getDoctor,
  getDiagnostics,
  getPRAnalysis,
  getGraphPayload,
  getImpact,
  getExperiments,
} from './fixtures/selectors'
