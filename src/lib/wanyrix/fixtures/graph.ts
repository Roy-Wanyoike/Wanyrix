/**
 * fixtures/graph — engineering-graph fixtures for both workspaces.
 *
 * Part of the data.ts decomposition (GitHub issue #53): `src/lib/wanyrix/data.ts`
 * is now a pure re-export barrel; the public surface (DerivedGraphMath,
 * GRAPH_EDGES, GRAPH_NODES, GRAPH_EDGES_ATLAS, GRAPH_NODES_ATLAS) is unchanged.
 *
 * Types moved with their domain (documented per issue #53):
 *  - DerivedGraphMath (exported interface) — defined HERE, not in ../types.
 *  - RawGraphNode — was a private type alias in data.ts; it is exported here
 *    so sibling fixture modules (duplicates.ts) and the fixture generator
 *    script (scripts/fixture-gen.ts) can reuse it. NOT re-exported by the
 *    barrel, so the old public surface stays identical.
 *
 * Also exported for sibling modules / the generator script only (not part of
 * the old public surface): computeGraphMath, RAW_GRAPH_NODES,
 * RAW_GRAPH_NODES_ATLAS, HELIOS_MATH, ATLAS_MATH.
 */
import type { GraphEdge, GraphNode } from '../types'

// ---------------------------------------------------------------------------
// Engineering graph
// ---------------------------------------------------------------------------

/**
 * Raw node fixture — WITHOUT the derived aggregates. ENG-TCA-3: fanIn/fanOut
 * and downstream are computed from the served edge list at module load
 * (see computeGraphMath) and must never be hand-typed here.
 */
export type RawGraphNode = Omit<GraphNode, 'fanIn' | 'fanOut' | 'downstream'>

const W = (over: Partial<RawGraphNode> & { id: string }): RawGraphNode => ({
  band: 'lib',
  kind: 'workspace',
  buildTime: 4,
  changeFreq: 5,
  ...over,
})

const E = (id: string, buildTime: number, over: Partial<RawGraphNode> = {}): RawGraphNode => ({
  id,
  band: 'external',
  kind: 'external',
  buildTime,
  changeFreq: 0,
  ...over,
})

const P = (id: string, buildTime: number, over: Partial<RawGraphNode> = {}): RawGraphNode => ({
  id,
  band: 'external',
  kind: 'proc-macro',
  buildTime,
  changeFreq: 0,
  ...over,
})

export const RAW_GRAPH_NODES: RawGraphNode[] = [
  // bins
  W({ id: 'gateway', band: 'bin', buildTime: 9.8, changeFreq: 14 }),
  W({ id: 'api', band: 'bin', buildTime: 12.7, changeFreq: 38, critical: true }),
  W({ id: 'worker', band: 'bin', buildTime: 11.2, changeFreq: 21 }),
  W({ id: 'cli', band: 'bin', buildTime: 6.4, changeFreq: 9 }),
  // libs
  W({ id: 'payments-core', buildTime: 10.4, changeFreq: 17 }),
  W({ id: 'auth', buildTime: 7.1, changeFreq: 8 }),
  W({ id: 'database', buildTime: 8.9, changeFreq: 19 }),
  W({ id: 'http-client', buildTime: 5.2, changeFreq: 6 }),
  W({ id: 'common-runtime', buildTime: 18.3, changeFreq: 23, critical: true }),
  W({ id: 'telemetry', buildTime: 4.1, changeFreq: 4 }),
  W({ id: 'cache', buildTime: 3.6, changeFreq: 2 }),
  W({ id: 'config', buildTime: 2.2, changeFreq: 3 }),
  W({ id: 'common', buildTime: 6.8, changeFreq: 31, critical: true }),
  // full-workspace crates referenced by findings/duplicates/upgrade notes —
  // served so every reference resolves against the graph (ENG-TCA-3)
  W({ id: 'legacy-cache', buildTime: 2.4, changeFreq: 1 }),
  W({ id: 'old-sdk', buildTime: 3.1, changeFreq: 0 }),
  // external
  E('tokio', 8.2, { versions: ['1.34.2', '1.40.0'], duplicate: true }),
  E('syn', 7.8),
  E('serde', 6.1, { versions: ['1.0.203', '1.0.210'], duplicate: true }),
  E('sqlx', 9.6),
  E('reqwest', 5.8),
  E('tracing', 2.4),
  E('tonic', 6.9),
  E('prost', 4.4),
  E('hyper', 5.3),
  E('tower', 3.2),
  E('rustls', 4.9),
  E('ring', 3.8),
  E('uuid', 2.1, { versions: ['0.8.2', '1.8.0'], duplicate: true }),
  E('anyhow', 1.2),
  E('thiserror', 1.1),
  E('clap', 3.1),
  P('serde_derive', 5.4),
  P('tokio-macros', 2.8),
  P('sqlx-macros', 6.2),
  P('thiserror-impl', 1.4),
  P('clap_derive', 2.2),
  E('proc-macro2', 1.5),
  E('quote', 1.9),
  // reqwest's wasm client target binds through wasm-bindgen — served so the
  // wasm-bindgen upgrade scenario derives its recompile count from the graph
  E('wasm-bindgen', 1.6),
]

export const GRAPH_EDGES: GraphEdge[] = [
  { from: 'gateway', to: 'api' },
  { from: 'gateway', to: 'auth' },
  { from: 'gateway', to: 'common' },
  { from: 'gateway', to: 'common-runtime' },
  { from: 'gateway', to: 'telemetry' },
  { from: 'api', to: 'payments-core' },
  { from: 'api', to: 'database' },
  { from: 'api', to: 'auth' },
  { from: 'api', to: 'common' },
  { from: 'api', to: 'telemetry' },
  { from: 'api', to: 'http-client' },
  { from: 'worker', to: 'payments-core' },
  { from: 'worker', to: 'database' },
  { from: 'worker', to: 'common' },
  { from: 'worker', to: 'telemetry' },
  { from: 'worker', to: 'cache' },
  { from: 'cli', to: 'config' },
  { from: 'cli', to: 'database' },
  { from: 'cli', to: 'common' },
  { from: 'cli', to: 'clap' },
  { from: 'payments-core', to: 'common' },
  { from: 'payments-core', to: 'database' },
  { from: 'payments-core', to: 'http-client' },
  { from: 'payments-core', to: 'common-runtime' },
  { from: 'payments-core', to: 'tonic' },
  { from: 'auth', to: 'common' },
  { from: 'auth', to: 'http-client' },
  { from: 'auth', to: 'telemetry' },
  { from: 'database', to: 'sqlx' },
  { from: 'database', to: 'common' },
  { from: 'database', to: 'config' },
  { from: 'http-client', to: 'reqwest' },
  { from: 'http-client', to: 'tower' },
  { from: 'http-client', to: 'common' },
  { from: 'common-runtime', to: 'tokio' },
  { from: 'common-runtime', to: 'tracing' },
  { from: 'common-runtime', to: 'telemetry' },
  { from: 'telemetry', to: 'tracing' },
  { from: 'telemetry', to: 'common' },
  { from: 'cache', to: 'tokio' },
  { from: 'cache', to: 'common' },
  { from: 'config', to: 'common' },
  { from: 'common', to: 'serde' },
  { from: 'common', to: 'thiserror' },
  { from: 'common', to: 'uuid' },
  { from: 'common', to: 'anyhow' },
  { from: 'sqlx', to: 'tokio' },
  { from: 'sqlx', to: 'sqlx-macros' },
  { from: 'reqwest', to: 'hyper' },
  { from: 'reqwest', to: 'rustls' },
  { from: 'reqwest', to: 'tokio' },
  { from: 'hyper', to: 'tokio' },
  { from: 'hyper', to: 'ring' },
  { from: 'rustls', to: 'ring' },
  { from: 'tonic', to: 'hyper' },
  { from: 'tonic', to: 'prost' },
  { from: 'tokio', to: 'tokio-macros' },
  { from: 'serde', to: 'serde_derive' },
  { from: 'thiserror', to: 'thiserror-impl' },
  { from: 'clap', to: 'clap_derive' },
  { from: 'serde_derive', to: 'syn' },
  { from: 'serde_derive', to: 'quote' },
  { from: 'tokio-macros', to: 'syn' },
  { from: 'sqlx-macros', to: 'syn' },
  { from: 'thiserror-impl', to: 'syn' },
  { from: 'clap_derive', to: 'syn' },
  { from: 'syn', to: 'proc-macro2' },
  { from: 'quote', to: 'proc-macro2' },
  // full-workspace crates that were previously ghost references (ENG-TCA-3)
  { from: 'legacy-cache', to: 'tokio' }, // pins tokio 1.34.2 (WAN-BLD-002)
  { from: 'legacy-cache', to: 'uuid' }, // pins uuid 0.8.2 (WAN-BLD-002)
  { from: 'old-sdk', to: 'serde' }, // old-sdk 2.1 pins serde 1.0.203
  { from: 'reqwest', to: 'wasm-bindgen' }, // wasm client target
]

// ---------------------------------------------------------------------------
// Graph math — the single source of truth for every derived aggregate.
// ---------------------------------------------------------------------------
// Edge direction follows cargo semantics: `from` DEPENDS ON `to`. All per-node
// numbers are COMPUTED from the served edge list at module load (ENG-TCA-3):
//   - fanIn / fanOut  = served in/out degrees (direct dependents / dependencies)
//   - downstream      = served WORKSPACE-kind crates that transitively depend
//                       on the node (reverse reachability over `edges`)
//   - blast           = the same closure, restated per analyzed file
//   - duplicates[].dependents = direct in-edge sources, kind-annotated
// Nothing below may be hand-typed; narrative numbers that describe the FULL
// workspace (47 crates · 212 edges) live in the doctor findings and are
// reconciled by GraphPayload.meta's explicit subset declaration.

export interface DerivedGraphMath {
  /** direct dependents (in-degree over the served edges) */
  fanIn: Record<string, number>
  /** direct dependencies (out-degree over the served edges) */
  fanOut: Record<string, number>
  /** workspace-kind crates that transitively depend on the key node */
  downstream: Record<string, number>
  /** direct dependent ids, in deterministic node order */
  dependents: Record<string, string[]>
  /** deterministic sample invalidation path: crate → … → a node with no dependents */
  chainToRoot: (crate: string) => string[]
  /** the workspace blast radius of a crate (= downstream[crate]) */
  workspaceBlastRadius: (crate: string) => number
}

export function computeGraphMath(nodes: RawGraphNode[], edges: GraphEdge[]): DerivedGraphMath {
  const order = new Map(nodes.map((n, i) => [n.id, i]))
  const kind = new Map(nodes.map((n) => [n.id, n.kind]))
  const byNodeOrder = (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0)

  const dependents: Record<string, string[]> = {}
  const dependencies: Record<string, string[]> = {}
  for (const n of nodes) {
    dependents[n.id] = []
    dependencies[n.id] = []
  }
  for (const e of edges) {
    dependents[e.to]?.push(e.from)
    dependencies[e.from]?.push(e.to)
  }
  for (const id of Object.keys(dependents)) {
    dependents[id].sort(byNodeOrder)
    dependencies[id].sort(byNodeOrder)
  }

  // transitive dependents (reverse reachability), workspace-kind only
  const downstream: Record<string, number> = {}
  for (const n of nodes) {
    const seen = new Set<string>([n.id])
    const queue = [...dependents[n.id]]
    while (queue.length > 0) {
      const cur = queue.shift() as string
      if (seen.has(cur)) continue
      seen.add(cur)
      for (const next of dependents[cur] ?? []) if (!seen.has(next)) queue.push(next)
    }
    seen.delete(n.id)
    downstream[n.id] = [...seen].filter((id) => kind.get(id) === 'workspace').length
  }

  const chainCache = new Map<string, string[]>()
  const chainToRoot = (crate: string): string[] => {
    const cached = chainCache.get(crate)
    if (cached) return cached
    // BFS across dependents; the first path reaching a node with no dependents
    // (a bin) is the deterministic sample chain served as `chain`.
    const prev = new Map<string, string | null>([[crate, null]])
    const queue = [crate]
    let end: string | null = null
    while (queue.length > 0) {
      const cur = queue.shift() as string
      if (cur !== crate && (dependents[cur] ?? []).length === 0) {
        end = cur
        break
      }
      for (const d of dependents[cur] ?? []) {
        if (!prev.has(d)) {
          prev.set(d, cur)
          queue.push(d)
        }
      }
    }
    const chain: string[] = []
    let cur: string | null | undefined = end ?? crate
    while (cur) {
      chain.unshift(cur)
      cur = prev.get(cur) ?? null
    }
    chainCache.set(crate, chain)
    return chain
  }

  return {
    fanIn: Object.fromEntries(nodes.map((n) => [n.id, dependents[n.id].length])),
    fanOut: Object.fromEntries(nodes.map((n) => [n.id, dependencies[n.id].length])),
    downstream,
    dependents,
    chainToRoot,
    workspaceBlastRadius: (crate: string) => downstream[crate] ?? 0,
  }
}

export const HELIOS_MATH = computeGraphMath(RAW_GRAPH_NODES, GRAPH_EDGES)

const withDerivedAggregates = (n: RawGraphNode, math: DerivedGraphMath): GraphNode => ({
  ...n,
  fanIn: math.fanIn[n.id] ?? 0,
  fanOut: math.fanOut[n.id] ?? 0,
  downstream: math.downstream[n.id] ?? 0,
})

/** Served helios backbone nodes — fanIn/fanOut/downstream derived from GRAPH_EDGES. */
export const GRAPH_NODES: GraphNode[] = RAW_GRAPH_NODES.map((n) => withDerivedAggregates(n, HELIOS_MATH))

// --------------------------------------------------------------- atlas: graph

const W_A = (over: Partial<RawGraphNode> & { id: string }): RawGraphNode => ({
  band: 'lib',
  kind: 'workspace',
  buildTime: 3,
  changeFreq: 5,
  ...over,
})

const E_A = (id: string, buildTime: number, over: Partial<RawGraphNode> = {}): RawGraphNode => ({
  id,
  band: 'external',
  kind: 'external',
  buildTime,
  changeFreq: 0,
  ...over,
})

export const RAW_GRAPH_NODES_ATLAS: RawGraphNode[] = [
  W_A({ id: 'atlas-cli', band: 'bin', buildTime: 2.1, changeFreq: 6 }),
  W_A({ id: 'atlas-server', band: 'bin', buildTime: 3.4, changeFreq: 9 }),
  W_A({ id: 'atlas-ingest', buildTime: 5.8, changeFreq: 14 }),
  W_A({ id: 'atlas-query', buildTime: 9.6, changeFreq: 19, critical: true }),
  W_A({ id: 'atlas-store', buildTime: 14.2, changeFreq: 41, critical: true }),
  W_A({ id: 'atlas-common', buildTime: 4.6, changeFreq: 28, critical: true }),
  W_A({ id: 'atlas-schema', buildTime: 2.2, changeFreq: 3 }),
  W_A({ id: 'atlas-bytes', buildTime: 1.4, changeFreq: 2 }),
  W_A({ id: 'atlas-parquet', buildTime: 3.7, changeFreq: 7 }),
  W_A({ id: 'atlas-lsm', buildTime: 6.1, changeFreq: 22 }),
  W_A({ id: 'atlas-sst', buildTime: 3.2, changeFreq: 8 }),
  W_A({ id: 'atlas-compaction', buildTime: 2.9, changeFreq: 6 }),
  W_A({ id: 'atlas-planner', buildTime: 4.8, changeFreq: 12 }),
  W_A({ id: 'atlas-exec', buildTime: 3.6, changeFreq: 9 }),
  W_A({ id: 'atlas-proto', kind: 'proc-macro', buildTime: 1.8, changeFreq: 1 }),
  W_A({ id: 'atlas-testkit', band: 'bin', buildTime: 1.9, changeFreq: 4 }),
  E_A('tokio', 4.4),
  E_A('arrow', 5.2, { duplicate: true, versions: ['53.3.0', '54.2.0'] }),
  E_A('parquet', 3.9),
  E_A('datafusion', 6.4),
  E_A('serde', 2.1),
  E_A('thiserror', 0.8),
  E_A('prost', 1.6),
  E_A('clap', 1.2),
  // the bytes duplicate group (DUPLICATES_ATLAS) — served so its dependents
  // resolve against the graph and its upgrade scenario derives recompile counts
  E_A('bytes', 0.5, { duplicate: true, versions: ['1.8.0', '1.9.0'] }),
  // sqlx is touched only by atlas-store (see ATLAS_UPGRADE_CATALOG.sqlx note)
  E_A('sqlx', 2.6),
]

/**
 * Served atlas backbone edges. Direction follows cargo semantics (`from`
 * DEPENDS ON `to`) — the previous list mixed this with an invalidation-flow
 * direction, which is why derived numbers could not reconcile (ENG-TCA-3).
 * The hub wiring makes ATL-WRK-005's claim derivable: 11 workspace crates
 * depend directly on atlas-common.
 */
export const GRAPH_EDGES_ATLAS: GraphEdge[] = [
  // hub: 11 direct dependents of atlas-common (ATL-WRK-005)
  { from: 'atlas-ingest', to: 'atlas-common' },
  { from: 'atlas-query', to: 'atlas-common' },
  { from: 'atlas-store', to: 'atlas-common' },
  { from: 'atlas-lsm', to: 'atlas-common' },
  { from: 'atlas-sst', to: 'atlas-common' },
  { from: 'atlas-cli', to: 'atlas-common' },
  { from: 'atlas-server', to: 'atlas-common' },
  { from: 'atlas-compaction', to: 'atlas-common' },
  { from: 'atlas-planner', to: 'atlas-common' },
  { from: 'atlas-exec', to: 'atlas-common' },
  { from: 'atlas-testkit', to: 'atlas-common' },
  // the stable extracts are dependencies of the hub
  { from: 'atlas-common', to: 'atlas-schema' },
  { from: 'atlas-common', to: 'atlas-bytes' },
  // store engine internals
  { from: 'atlas-store', to: 'atlas-lsm' },
  { from: 'atlas-lsm', to: 'atlas-sst' },
  { from: 'atlas-compaction', to: 'atlas-lsm' },
  // query engine
  { from: 'atlas-query', to: 'atlas-planner' },
  { from: 'atlas-query', to: 'atlas-exec' },
  { from: 'atlas-planner', to: 'atlas-exec' },
  // service topology
  { from: 'atlas-server', to: 'atlas-store' },
  { from: 'atlas-server', to: 'atlas-ingest' },
  { from: 'atlas-server', to: 'atlas-proto' },
  { from: 'atlas-ingest', to: 'atlas-parquet' },
  { from: 'atlas-ingest', to: 'atlas-schema' },
  { from: 'atlas-query', to: 'atlas-parquet' },
  { from: 'atlas-cli', to: 'atlas-query' },
  { from: 'atlas-cli', to: 'atlas-store' },
  { from: 'atlas-testkit', to: 'atlas-lsm' },
  { from: 'atlas-testkit', to: 'atlas-planner' },
  // externals — workspace crates depend on them
  { from: 'atlas-store', to: 'tokio' },
  { from: 'atlas-ingest', to: 'tokio' },
  { from: 'atlas-server', to: 'tokio' },
  { from: 'atlas-query', to: 'datafusion' },
  { from: 'atlas-cli', to: 'datafusion' },
  { from: 'datafusion', to: 'arrow' }, // arrow 54.2 path (ATL-DEP-003)
  { from: 'atlas-ingest', to: 'parquet' },
  { from: 'parquet', to: 'arrow' }, // arrow 53.3 path (ATL-DEP-003)
  { from: 'atlas-parquet', to: 'parquet' },
  { from: 'atlas-parquet', to: 'arrow' },
  { from: 'atlas-common', to: 'serde' },
  { from: 'atlas-common', to: 'thiserror' },
  { from: 'atlas-proto', to: 'prost' },
  { from: 'atlas-cli', to: 'clap' },
  { from: 'atlas-store', to: 'sqlx' }, // the only sqlx toucher (ATLAS_UPGRADE_CATALOG.sqlx)
  { from: 'sqlx', to: 'tokio' },
  // bytes duplicate group dependents (DUPLICATES_ATLAS)
  { from: 'atlas-common', to: 'bytes' },
  { from: 'atlas-lsm', to: 'bytes' },
  { from: 'tokio', to: 'bytes' },
  { from: 'prost', to: 'bytes' },
]

export const ATLAS_MATH = computeGraphMath(RAW_GRAPH_NODES_ATLAS, GRAPH_EDGES_ATLAS)

/** Served atlas backbone nodes — fanIn/fanOut/downstream derived from GRAPH_EDGES_ATLAS. */
export const GRAPH_NODES_ATLAS: GraphNode[] = RAW_GRAPH_NODES_ATLAS.map((n) =>
  withDerivedAggregates(n, ATLAS_MATH),
)

