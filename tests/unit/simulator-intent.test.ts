/**
 * Task 2-a (AUDIT-I4) — cross-view simulator intent store + impact math.
 *
 * `simulator-intent.ts` must keep its consume-once semantics ("no stale
 * selections"): the intent is consumed exactly once on simulator mount and
 * clears itself. The impact-math block pins the invariants of the simulated
 * cost model (monotonic, finite, always labeled `estimated` — Gate 10/21).
 */
import { beforeEach, describe, expect, test } from 'bun:test'

import {
  getGraphPayload,
  getImpact,
  getWorkspaces,
} from '../../src/lib/wanyrix/data'
import type {
  AddDepImpact,
  EditFileImpact,
  SplitImpact,
  UpgradeImpact,
} from '../../src/lib/wanyrix/types'
import {
  useSimulatorIntentStore,
  type SimulatorIntent,
} from '../../src/lib/wanyrix/simulator-intent'

const WS_IDS = getWorkspaces().workspaces.map((w) => w.id)

/**
 * GraphPayload.catalog is typed optional (payloads may omit it), but every
 * shipped fixture carries one — assert that here so the math tests can index
 * it without `?.` noise. A missing catalog would fail these tests loudly.
 */
function catalogOf(ws: string): NonNullable<ReturnType<typeof getGraphPayload>['catalog']> {
  const catalog = getGraphPayload(ws).catalog
  expect(catalog).toBeDefined()
  if (!catalog) throw new Error(`simulator catalog missing for workspace '${ws}'`)
  return catalog
}

/* ------------------------------------------------------------------ intent -- */

describe('simulator intent store (consume-once deep links)', () => {
  beforeEach(() => {
    useSimulatorIntentStore.setState({ intent: null })
  })

  test('starts empty', () => {
    expect(useSimulatorIntentStore.getState().intent).toBeNull()
    expect(useSimulatorIntentStore.getState().consumeIntent()).toBeNull()
  })

  test('setIntent stores the full intent payload', () => {
    const intent: SimulatorIntent = {
      mode: 'upgrade-dep',
      target: 'tokio',
      source: 'graph:duplicates',
    }
    useSimulatorIntentStore.getState().setIntent(intent)
    expect(useSimulatorIntentStore.getState().intent).toEqual(intent)
  })

  test('consumeIntent returns the intent exactly once, then clears it', () => {
    const intent: SimulatorIntent = {
      mode: 'edit-file',
      file: 'common/src/error.rs',
      source: 'graph:blast',
    }
    useSimulatorIntentStore.getState().setIntent(intent)

    expect(useSimulatorIntentStore.getState().consumeIntent()).toEqual(intent)
    expect(useSimulatorIntentStore.getState().intent).toBeNull()
    expect(useSimulatorIntentStore.getState().consumeIntent()).toBeNull() // stale-proof
  })

  test('a newer intent overwrites the previous one (no stale selections)', () => {
    useSimulatorIntentStore.getState().setIntent({ mode: 'add-dep', target: 'sqlx', source: 'a' })
    useSimulatorIntentStore
      .getState()
      .setIntent({ mode: 'split-crate', target: 'common', source: 'b' })

    expect(useSimulatorIntentStore.getState().consumeIntent()?.source).toBe('b')
  })

  test('supports every documented intent mode', () => {
    const modes: SimulatorIntent['mode'][] = ['add-dep', 'upgrade-dep', 'edit-file', 'split-crate']
    for (const mode of modes) {
      useSimulatorIntentStore.getState().setIntent({ mode, source: `test:${mode}` })
      expect(useSimulatorIntentStore.getState().consumeIntent()?.mode).toBe(mode)
    }
  })
})

/* ------------------------------------------------------------- impact math -- */

describe('impact math (simulated cost model — Gate 10/21)', () => {
  test('every payload is explicitly labeled `estimated` — never measured/verified', () => {
    for (const ws of WS_IDS) {
      const graph = getGraphPayload(ws)
      const catalog = catalogOf(ws)
      const payloads = [
        ...catalog.addDeps.map((d) => getImpact('add-dep', d.id, ws)),
        ...graph.blast.map((b) => getImpact('edit-file', b.file, ws)),
        getImpact('split-crate', catalog.splitCandidates[0], ws),
        ...catalog.upgrades.map((u) => getImpact('upgrade-dep', u.id, ws)),
      ]
      expect(payloads.length).toBeGreaterThan(0)
      for (const p of payloads) {
        expect(p).not.toBeNull()
        expect(p?.measurementStatus).toBe('estimated')
      }
    }
  })

  test('add-dep: finite and monotonic 0 ≤ incremental ≤ clean ≤ ci, for every catalog crate', () => {
    for (const ws of WS_IDS) {
      for (const { id } of catalogOf(ws).addDeps) {
        const r = getImpact('add-dep', id, ws) as AddDepImpact
        expect(r.kind).toBe('add-dep')
        for (const v of [r.incrementalDelta, r.cleanDelta, r.ciDelta]) {
          expect(Number.isFinite(v)).toBe(true)
        }
        expect(r.incrementalDelta).toBeGreaterThanOrEqual(0)
        expect(r.cleanDelta).toBeGreaterThanOrEqual(r.incrementalDelta)
        expect(r.ciDelta).toBeGreaterThanOrEqual(r.cleanDelta)
        // dependency-tree sanity
        expect(r.cratesAdded).toBeGreaterThanOrEqual(1)
        expect(r.transitiveDeps).toBeGreaterThanOrEqual(0)
        expect(r.targetMB).toBeGreaterThan(0)
        expect(r.chain.length).toBeGreaterThan(0)
        expect(r.suggestions.length).toBeGreaterThan(0)
      }
    }
  })

  test('edit-file: CI delta is the documented 1.6× model of the incremental delta', () => {
    for (const ws of WS_IDS) {
      for (const b of getGraphPayload(ws).blast) {
        const r = getImpact('edit-file', b.file, ws) as EditFileImpact
        expect(r.kind).toBe('edit-file')
        expect(r.incrementalDelta).toBeGreaterThan(0)
        const expectedCi = Math.round(r.incrementalDelta * 1.6 * 10) / 10
        expect(r.ciDelta).toBeCloseTo(expectedCi, 5)
        expect(r.ciDelta).toBeGreaterThanOrEqual(r.incrementalDelta) // monotonic
        expect(r.affectedWorkspace).toBeGreaterThan(0)
        expect(r.chain.length).toBeGreaterThan(0)
        expect(r.suggestion.length).toBeGreaterThan(0)
      }
    }
  })

  test('split-crate: proposal strictly improves the build and the % is consistent', () => {
    for (const ws of WS_IDS) {
      const source = catalogOf(ws).splitCandidates[0]
      const r = getImpact('split-crate', source, ws) as SplitImpact
      expect(r.kind).toBe('split-crate')
      expect(r.source).toBe(source)
      expect(r.proposal.buildSeconds).toBeGreaterThan(0)
      expect(r.before.buildSeconds).toBeGreaterThan(r.proposal.buildSeconds) // strict win

      const implied = (1 - r.proposal.buildSeconds / r.before.buildSeconds) * 100
      expect(r.improvementPct).toBeCloseTo(implied, 1)
      expect(r.improvementPct).toBeGreaterThan(0)
      expect(r.improvementPct).toBeLessThan(100)
      expect(r.migration.length).toBeGreaterThan(0)
      for (const crate of r.proposal.crates) {
        expect(crate.buildSeconds).toBeGreaterThan(0)
        expect(crate.modules.length).toBeGreaterThan(0)
      }
    }
  })

  test('upgrade-dep: semver-bounded, finite deltas, non-negative recompiles', () => {
    for (const ws of WS_IDS) {
      for (const { id } of catalogOf(ws).upgrades) {
        const r = getImpact('upgrade-dep', id, ws) as UpgradeImpact
        expect(r.kind).toBe('upgrade-dep')
        expect(r.from).not.toBe(r.to)
        expect(['major', 'minor', 'patch']).toContain(r.semver)
        expect(r.recompileCrates).toBeGreaterThanOrEqual(0)
        for (const v of [r.cleanDelta, r.incrementalDelta, r.ciDelta]) {
          expect(Number.isFinite(v)).toBe(true)
        }
        // migration snippets are honest (code + note) — never fabricated diffs
        for (const m of r.migrations) {
          expect(m.code.length).toBeGreaterThan(0)
          expect(m.note.length).toBeGreaterThan(0)
        }
        for (const b of r.breaking) {
          expect(b.title.length).toBeGreaterThan(0)
          expect(b.detail.length).toBeGreaterThan(0)
        }
      }
    }
  })

  test('unknown targets return null for every scenario type (UI never invents numbers)', () => {
    const ws = WS_IDS[0]
    expect(getImpact('add-dep', 'no-such-crate', ws)).toBeNull()
    expect(getImpact('upgrade-dep', 'no-such-crate', ws)).toBeNull()
    expect(getImpact('edit-file', 'no/such/file.rs', ws)).toBeNull()
  })
})
