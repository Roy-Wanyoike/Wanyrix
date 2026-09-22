/**
 * Workspace count reconciliation (QA-5-B-3).
 *
 * THE bug class the USER_GUIDE FAQ says must not exist: the same workspace
 * quoting different crate/edge counts on different surfaces at the same
 * moment. Root cause: two legitimate datasets were conflated WITHOUT labels —
 *
 *   - the served `wanyrix.graph/v1` set (fixture payloads serve the analysis
 *     backbone subset: helios 15 workspace-kind nodes + 24 externals + 72
 *     edges), and
 *   - the full cargo manifest totals carried by /health, /workspaces and
 *     graph.meta (helios 47 crates · 212 edges),
 *
 * and view headers mixed the two as one truth (Overview header: manifest;
 * Overview architecture card: served; Dependencies/Graph headers: manifest
 * numbers over a payload link that does not contain them).
 *
 * The fix: ONE pure selector over the served payload — every header derives
 * its figures from the SAME payload the view renders, and the full-manifest
 * totals appear only with an explicit `full manifest` label. For registered
 * local projects (QA-5-B-1) the engine serves the full-manifest graph, so
 * served == manifest and no label is needed.
 *
 * Unit-pinned in tests/unit/workspace-count-consistency.test.ts.
 */

import type { GraphPayload } from './types'

export interface ServedGraphCounts {
  /** workspace-kind nodes in the SERVED payload */
  workspaceCrates: number
  /** external + proc-macro nodes in the SERVED payload */
  externalCrates: number
  /** edges in the SERVED payload */
  edges: number
  /** full-workspace totals carried by the payload meta (manifest/registry) */
  manifestCrates: number
  manifestEdges: number
}

/** The single count selector: derive BOTH figures from one GraphPayload. */
export function servedGraphCounts(payload: GraphPayload): ServedGraphCounts {
  const workspaceCrates = payload.nodes.filter((n) => n.kind === 'workspace').length
  return {
    workspaceCrates,
    externalCrates: payload.nodes.length - workspaceCrates,
    edges: payload.edges.length,
    manifestCrates: payload.meta.workspaceCrates,
    manifestEdges: payload.meta.totalEdges,
  }
}

/** True when the served set IS the whole workspace (registered projects). */
export function isFullManifest(c: ServedGraphCounts): boolean {
  return c.workspaceCrates === c.manifestCrates && c.edges === c.manifestEdges
}

/**
 * The shared honest count line. The served figures come first (they describe
 * the payload the view actually renders); the manifest totals are appended
 * ONLY when they differ, explicitly labeled — never mixed as one number.
 */
export function formatWorkspaceCountsLine(c: ServedGraphCounts): string {
  const served = `${c.workspaceCrates} workspace crates · ${c.externalCrates} external crates · ${c.edges} edges`
  if (isFullManifest(c)) return served
  return `${served} · full manifest ${c.manifestCrates} crates / ${c.manifestEdges} edges`
}
