/**
 * QA-5-B-3 — ONE count selector for every surface.
 *
 * The bug class the USER_GUIDE FAQ forbids: the same workspace quoting
 * different crate/edge counts on different views at the same moment. Root
 * cause: view headers mixed the SERVED `wanyrix.graph/v1` set (fixture
 * payloads carry the analysis backbone subset — helios 15 workspace nodes +
 * 72 edges) with the FULL cargo manifest totals carried by `meta`
 * (helios 47 crates · 212 edges) as if they were one truth.
 *
 * The fix under test here: `servedGraphCounts` derives BOTH figures from the
 * SAME payload every view renders, `isFullManifest` detects when served ==
 * manifest (registered projects), and `formatWorkspaceCountsLine` renders the
 * served-first line appending the manifest totals ONLY when they differ,
 * explicitly labeled. Unit-pinned with synthetic payloads shaped exactly like
 * the fixture graph (backbone subset) and the registered-project graph (full
 * manifest) — the same shapes `tests/unit/registered-workspaces.test.ts`
 * pins for the adapters.
 */
import { describe, expect, test } from 'bun:test'

import {
  formatWorkspaceCountsLine,
  isFullManifest,
  servedGraphCounts,
} from '../../src/lib/wanyrix/workspace-counts'
import type { GraphPayload } from '../../src/lib/wanyrix/types'

/* ------------------------------------------------------------ fixtures --- */

function node(
  id: string,
  kind: GraphPayload['nodes'][number]['kind'],
  band: GraphPayload['nodes'][number]['band'],
): GraphPayload['nodes'][number] {
  return { id, kind, band, buildTime: 0, fanIn: 0, fanOut: 0, downstream: 0, changeFreq: 0 }
}

/** Fixture-shaped payload: served set is a BACKBONE SUBSET of the manifest. */
const SUBSET: GraphPayload = {
  nodes: [node('cli', 'workspace', 'bin'), node('core', 'workspace', 'lib'), node('serde', 'external', 'external')],
  edges: [
    { from: 'cli', to: 'core' },
    { from: 'cli', to: 'serde' },
  ],
  duplicates: [],
  blast: [],
  meta: {
    workspaceCrates: 47, // full-manifest truth (helios-like), NOT the served 2
    totalEdges: 212,
    lastScan: '2026-09-22T20:00:00Z',
    scope: 'backbone-subset',
    servedNodes: 3,
    servedEdges: 2,
    aggregateSource: 'served-edges',
    note: 'Fixture payloads serve the analysis backbone subset.',
  },
}

/** Registered-project-shaped payload: the engine served EVERYTHING. */
const FULL: GraphPayload = {
  ...SUBSET,
  meta: {
    ...SUBSET.meta,
    workspaceCrates: 2,
    totalEdges: 2,
    scope: 'full-manifest-graph',
    servedNodes: 3,
    servedEdges: 2,
    provenance: 'registered-local-project',
  },
}

/* --------------------------------------------------------------- pins ---- */

describe('servedGraphCounts (QA-5-B-3 single count selector)', () => {
  test('derives served figures from the payload the view renders — not from meta', () => {
    const c = servedGraphCounts(SUBSET)
    expect(c.workspaceCrates).toBe(2) // kind === 'workspace' nodes
    expect(c.externalCrates).toBe(1) // the rest
    expect(c.edges).toBe(2) // served edge list
  })

  test('carries the manifest totals alongside, unchanged', () => {
    const c = servedGraphCounts(SUBSET)
    expect(c.manifestCrates).toBe(47)
    expect(c.manifestEdges).toBe(212)
  })

  test('the helios regression class: served and manifest figures are DISTINGUISHABLE', () => {
    // This is the exact bug QA-5 filed: header A quoted 15 (served), header B
    // quoted 47 (manifest) for the same workspace in the same moment. The
    // selector must return both numbers as DIFFERENT fields — never merge them.
    const c = servedGraphCounts(SUBSET)
    expect(c.workspaceCrates).not.toBe(c.manifestCrates)
    expect(c.edges).not.toBe(c.manifestEdges)
  })

  test('aggregates agree with meta.servedNodes/servedEdges on well-formed payloads', () => {
    const c = servedGraphCounts(SUBSET)
    expect(c.workspaceCrates + c.externalCrates).toBe(SUBSET.meta.servedNodes)
    expect(c.edges).toBe(SUBSET.meta.servedEdges)
  })
})

describe('isFullManifest', () => {
  test('false for backbone-subset fixture payloads', () => {
    expect(isFullManifest(servedGraphCounts(SUBSET))).toBe(false)
  })
  test('true when the engine served the complete measured graph', () => {
    expect(isFullManifest(servedGraphCounts(FULL))).toBe(true)
  })
})

describe('formatWorkspaceCountsLine — the shared honest count line', () => {
  test('subset payloads: served first, manifest appended EXPLICITLY labeled', () => {
    const line = formatWorkspaceCountsLine(servedGraphCounts(SUBSET))
    expect(line).toBe('2 workspace crates · 1 external crates · 2 edges · full manifest 47 crates / 212 edges')
    // the two truths never merge into one number
    expect(line).toContain('full manifest')
  })

  test('full-manifest payloads: served-only line, no redundant suffix', () => {
    const line = formatWorkspaceCountsLine(servedGraphCounts(FULL))
    expect(line).toBe('2 workspace crates · 1 external crates · 2 edges')
    expect(line).not.toContain('full manifest')
  })

  test('cross-view consistency property: every view calling the selector renders the SAME line', () => {
    // architecture / dependencies / graph headers all call this pair — the
    // property that kills the QA-5-B-3 bug class is that identical payloads
    // produce identical strings regardless of call site.
    const a = formatWorkspaceCountsLine(servedGraphCounts(SUBSET))
    const b = formatWorkspaceCountsLine(servedGraphCounts(SUBSET))
    expect(a).toBe(b)
  })
})
