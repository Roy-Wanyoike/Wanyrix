/**
 * fixtures/duplicates — duplicate-version group fixtures (both workspaces).
 *
 * Part of the data.ts decomposition (GitHub issue #53): `src/lib/wanyrix/data.ts`
 * is now a pure re-export barrel; the public surface (DUPLICATES,
 * DUPLICATES_ATLAS) is unchanged.
 * Types: DuplicateGroup comes from ../types — no type is defined in this module.
 * RAW_DUPLICATES / RAW_DUPLICATES_ATLAS / deriveDependents stay module-private,
 * exactly as they were inside data.ts.
 */
import type { DuplicateGroup } from '../types'
import type { DerivedGraphMath, RawGraphNode } from './graph'
import { ATLAS_MATH, HELIOS_MATH, RAW_GRAPH_NODES, RAW_GRAPH_NODES_ATLAS } from './graph'

/**
 * Duplicate-version groups. `dependents` is DERIVED from the served edge list
 * (direct in-edge sources, kind-annotated) so every label resolves to a node —
 * ENG-TCA-3 removed the hand-typed lists that referenced unserved crates.
 */
const RAW_DUPLICATES: Omit<DuplicateGroup, 'dependents'>[] = [
  { name: 'tokio', versions: ['1.34.2', '1.40.0'], wastedSeconds: 8.2 },
  { name: 'serde', versions: ['1.0.203', '1.0.210'], wastedSeconds: 6.1 },
  { name: 'uuid', versions: ['0.8.2', '1.8.0'], wastedSeconds: 2.1 },
]

function deriveDependents(
  name: string,
  math: DerivedGraphMath,
  nodes: RawGraphNode[],
): string[] {
  return (math.dependents[name] ?? []).map((id) => {
    const node = nodes.find((n) => n.id === id)
    return node ? `${id} (${node.kind})` : id
  })
}

export const DUPLICATES: DuplicateGroup[] = RAW_DUPLICATES.map((d) => ({
  ...d,
  dependents: deriveDependents(d.name, HELIOS_MATH, RAW_GRAPH_NODES),
}))

const RAW_DUPLICATES_ATLAS: Omit<DuplicateGroup, 'dependents'>[] = [
  { name: 'arrow', versions: ['53.3.0', '54.2.0'], wastedSeconds: 4.1 },
  { name: 'bytes', versions: ['1.8.0', '1.9.0'], wastedSeconds: 0.6 },
]

export const DUPLICATES_ATLAS: DuplicateGroup[] = RAW_DUPLICATES_ATLAS.map((d) => ({
  ...d,
  dependents: deriveDependents(d.name, ATLAS_MATH, RAW_GRAPH_NODES_ATLAS),
}))

