/**
 * Task 3-b — scan-run recording in scan-store.ts (unit suite).
 *
 * Pins the additive persisted scan-run log: deterministic ids
 * (`run-<count>-<startedAt>`), the record shape, the 50-run cap (oldest
 * evicted), per-workspace isolation, and — via the real zustand persist
 * middleware pointed at an in-memory storage — the exact persisted envelope
 * under `wanyrix.scan-store` (same legacy-migration storage contract as the
 * other stores). The server-side `wanyrix.scan-history/v1` flavor stays
 * honestly empty (see flavors.ts); these runs are LOCAL ONLY.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { createJSONStorage, type StateStorage } from 'zustand/middleware'

import { createMigratingStorage } from '../../src/lib/wanyrix/legacy-migration'
import {
  SCAN_RUNS_CAP,
  scanRunId,
  useScanStore,
  type ScanRunRecord,
} from '../../src/lib/wanyrix/scan-store'

/* ---------------------------------------------------------------- helpers -- */

const BASE = Date.parse('2026-09-18T12:00:00.000Z')

/** Full state reset — the store under test is a module singleton. */
beforeEach(() => {
  useScanStore.setState({ history: {}, runs: {}, runSeq: {}, scanTick: 0, lastTrigger: 'manual' })
})

let n = 0
function runInput(overrides: Partial<Parameters<ReturnType<typeof useScanStore.getState>['recordScanRun']>[0]> = {}) {
  n += 1
  const startedAt = BASE + n * 1000
  return {
    workspaceId: 'helios-platform',
    startedAt,
    finishedAt: startedAt + 5_000,
    findingCount: 17,
    severityCounts: { critical: 2, warning: 5, info: 10 },
    ...overrides,
  }
}

/* ------------------------------------------------------- recording + shape -- */

describe('recordScanRun — recording + deterministic ids', () => {
  test('assigns the deterministic id run-<count>-<startedAt> and prepends (newest first)', () => {
    const store = useScanStore.getState()
    const first = store.recordScanRun(runInput())
    const second = store.recordScanRun(runInput())

    expect(first.id).toBe(scanRunId(1, first.startedAt))
    expect(second.id).toBe(scanRunId(2, second.startedAt))
    expect(second.id).toMatch(/^run-2-\d+$/)

    const list = useScanStore.getState().runs['helios-platform']
    expect(list.map((r) => r.id)).toEqual([second.id, first.id])
  })

  test('record shape is pinned: id, workspaceId, startedAt, finishedAt, durationMs, findingCount, severityCounts, trigger', () => {
    const record = useScanStore.getState().recordScanRun(runInput())
    expect(Object.keys(record).sort()).toEqual(
      ['durationMs', 'findingCount', 'finishedAt', 'id', 'severityCounts', 'startedAt', 'trigger', 'workspaceId'].sort(),
    )
    expect(record.workspaceId).toBe('helios-platform')
    expect(record.durationMs).toBe(5_000)
    expect(record.findingCount).toBe(17)
    expect(record.severityCounts).toEqual({ critical: 2, warning: 5, info: 10 })
  })

  test('R7: a run WITH a fingerprint gains exactly findingIds (+truncated only when true)', () => {
    const withIds = useScanStore.getState().recordScanRun(
      runInput({ findingIds: ['WAN-BLD-002', 'WAN-BLD-001'] }),
    )
    expect(Object.keys(withIds).sort()).toEqual(
      [
        'durationMs', 'findingCount', 'finishedAt', 'id', 'severityCounts',
        'startedAt', 'trigger', 'workspaceId', 'findingIds',
      ].sort(),
    )
    expect(withIds.findingIds).toEqual(['WAN-BLD-002', 'WAN-BLD-001']) // verbatim — caller normalizes
    expect(withIds).not.toHaveProperty('findingIdsTruncated') // false stays OFF the record

    const truncated = useScanStore.getState().recordScanRun(
      runInput({ findingIds: ['WAN-BLD-001'], findingIdsTruncated: true }),
    )
    expect(truncated.findingIdsTruncated).toBe(true)
  })

  test('trigger defaults to manual; an explicit origin is preserved', () => {
    const manual = useScanStore.getState().recordScanRun(runInput())
    expect(manual.trigger).toBe('manual')

    const topbar = useScanStore.getState().recordScanRun(runInput({ trigger: 'topbar' }))
    expect(topbar.trigger).toBe('topbar')
  })

  test('durationMs defaults to finishedAt − startedAt; an explicit measured value wins', () => {
    const derived = useScanStore.getState().recordScanRun(runInput())
    expect(derived.durationMs).toBe(5_000)

    const input = runInput()
    const measured = useScanStore.getState().recordScanRun({ ...input, durationMs: 4_213 })
    expect(measured.durationMs).toBe(4_213)
    expect(measured.startedAt).toBe(input.startedAt)
    expect(measured.finishedAt).toBe(input.finishedAt)
  })

  test('an explicit id (replay/migration) is honored verbatim', () => {
    const record = useScanStore.getState().recordScanRun(runInput({ id: 'run-9-replay' }))
    expect(record.id).toBe('run-9-replay')
    // the sequence still advances so the next auto id cannot collide
    const next = useScanStore.getState().recordScanRun(runInput())
    expect(next.id).toBe(scanRunId(2, next.startedAt))
  })

  test('recording a run never touches the legacy history log (and vice versa)', () => {
    const store = useScanStore.getState()
    store.addEntry('helios-platform', {
      id: 'entry-1',
      workspace: 'helios-platform',
      at: BASE,
      durationMs: 1_000,
      findings: 3,
      critical: 1,
      warning: 1,
      info: 1,
      buildTime: 40,
      estimatedFrom: 36,
      estimatedTo: 39,
      trigger: 'manual',
    })
    store.recordScanRun(runInput())

    const state = useScanStore.getState()
    expect(state.history['helios-platform']).toHaveLength(1) // untouched by recordScanRun
    expect(state.runs['helios-platform']).toHaveLength(1) // separate log
  })
})

/* ----------------------------------------------------------- cap + spaces -- */

describe('recordScanRun — cap, isolation, monotonic ids', () => {
  test('runs are capped at 50 per workspace; the OLDEST runs are evicted', () => {
    expect(SCAN_RUNS_CAP).toBe(50)
    const store = useScanStore.getState()
    for (let i = 0; i < 55; i += 1) store.recordScanRun(runInput())

    const list = useScanStore.getState().runs['helios-platform']
    expect(list).toHaveLength(50)
    expect(list[0].id).toBe(scanRunId(55, list[0].startedAt)) // newest kept
    expect(list[49].id).toBe(scanRunId(6, list[49].startedAt)) // run-1..5 evicted
  })

  test('the per-workspace sequence keeps counting past the cap — ids never repeat', () => {
    const store = useScanStore.getState()
    for (let i = 0; i < 55; i += 1) store.recordScanRun(runInput())

    const latest = useScanStore.getState().recordScanRun(runInput())
    expect(latest.id).toBe(scanRunId(56, latest.startedAt))
    const list = useScanStore.getState().runs['helios-platform']
    expect(list).toHaveLength(50)
    expect(new Set(list.map((r) => r.id)).size).toBe(50) // unique
  })

  test('workspaces are isolated — separate lists AND separate id sequences', () => {
    const store = useScanStore.getState()
    const h = store.recordScanRun(runInput())
    const a = store.recordScanRun(runInput({ workspaceId: 'atlas-consortium' }))

    expect(a.id).toBe(scanRunId(1, a.startedAt)) // atlas seq starts at 1
    expect(h.id).toBe(scanRunId(1, h.startedAt))
    expect(useScanStore.getState().runs['helios-platform'].map((r) => r.id)).toEqual([h.id])
    expect(useScanStore.getState().runs['atlas-consortium'].map((r) => r.id)).toEqual([a.id])
  })

  test('clearScanRuns empties only the given workspace', () => {
    const store = useScanStore.getState()
    store.recordScanRun(runInput())
    store.recordScanRun(runInput({ workspaceId: 'atlas-consortium' }))

    useScanStore.getState().clearScanRuns('helios-platform')
    expect(useScanStore.getState().runs['helios-platform']).toEqual([])
    expect(useScanStore.getState().runs['atlas-consortium']).toHaveLength(1)
  })
})

/* -------------------------------------------------------------- persistence */

describe('recordScanRun — persisted envelope (real persist middleware, in-memory storage)', () => {
  let map: Map<string, string>

  beforeEach(() => {
    map = new Map()
    const storage: StateStorage = {
      getItem: (name) => map.get(name) ?? null,
      setItem: (name, value) => void map.set(name, value),
      removeItem: (name) => void map.delete(name),
    }
    useScanStore.persist.setOptions({ storage: createJSONStorage(() => storage) })
  })

  afterAll(() => {
    // restore the exact production wiring (migrating storage thunk)
    useScanStore.persist.setOptions({ storage: createJSONStorage(createMigratingStorage) })
  })

  test('recordScanRun persists { history, runs, runSeq } under wanyrix.scan-store (version 0)', () => {
    useScanStore.getState().recordScanRun(runInput())

    const raw = map.get('wanyrix.scan-store')
    expect(typeof raw).toBe('string')
    const envelope = JSON.parse(raw as string) as {
      state: Record<string, unknown>
      version: number
    }

    // same zustand-persist envelope the legacy-migration layer expects
    expect(envelope.version).toBe(0)
    expect(Object.keys(envelope.state).sort()).toEqual(['history', 'runSeq', 'runs'])

    const persisted = (envelope.state.runs as Record<string, ScanRunRecord[]>)['helios-platform']
    expect(persisted).toHaveLength(1)
    expect(persisted[0].id).toMatch(/^run-1-\d+$/)
    expect(persisted[0].severityCounts).toEqual({ critical: 2, warning: 5, info: 10 })
    expect(envelope.state.runSeq).toEqual({ 'helios-platform': 1 })
  })

  test('transient fields (scanTick, lastTrigger) are NOT persisted', () => {
    useScanStore.getState().bumpScan('topbar')
    useScanStore.getState().recordScanRun(runInput())

    const envelope = JSON.parse(map.get('wanyrix.scan-store') as string) as {
      state: Record<string, unknown>
    }
    expect(envelope.state).not.toHaveProperty('scanTick')
    expect(envelope.state).not.toHaveProperty('lastTrigger')
  })
})
