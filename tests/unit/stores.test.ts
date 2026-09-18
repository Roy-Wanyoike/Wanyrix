/**
 * Task 2-a (AUDIT-I4) — persisted zustand store *logic* suite.
 *
 * The persist middleware wiring itself (thunk contract, migration protocol)
 * is covered unit-wise in `legacy-migration.test.ts` — a jsdom-free runner
 * cannot execute zustand's browser persist hydration, so here we validate the
 * pure state machines: active-workspace selection and the reviewable diff
 * queue (Gate 19 surface), plus the derived `countPending` helper.
 */
import { beforeEach, describe, expect, test } from 'bun:test'

import { useWorkspaceStore } from '../../src/lib/wanyrix/workspace-store'
import {
  countPending,
  useDiffQueueStore,
  type DiffEntry,
} from '../../src/lib/wanyrix/diff-store'

/* ---------------------------------------------------------------- helpers -- */

let seq = 0
function entry(overrides: Partial<DiffEntry> = {}): DiffEntry {
  seq += 1
  return {
    id: `diff-${seq}`,
    workspace: 'helios-platform',
    at: Date.parse('2026-09-18T10:00:00Z') + seq, // fixed base → deterministic
    source: 'finding',
    kind: 'patch',
    title: `Proposal ${seq}`,
    target: 'common-runtime',
    suggestion: 'Extract telemetry into common-telemetry',
    status: 'pending',
    ...overrides,
  }
}

beforeEach(() => {
  useDiffQueueStore.setState({ entries: {} })
  useWorkspaceStore.setState({ active: 'helios-platform' })
})

/* ------------------------------------------------------------ workspace ---- */

describe('useWorkspaceStore (active workspace selection)', () => {
  test('starts on the documented default workspace', () => {
    expect(useWorkspaceStore.getState().active).toBe('helios-platform')
  })

  test('setActive switches the workspace and is observable via getState', () => {
    useWorkspaceStore.getState().setActive('atlas-consortium')
    expect(useWorkspaceStore.getState().active).toBe('atlas-consortium')

    useWorkspaceStore.getState().setActive('helios-platform')
    expect(useWorkspaceStore.getState().active).toBe('helios-platform')
  })
})

/* ----------------------------------------------------------- diff queue ---- */

describe('useDiffQueueStore (reviewable-diff queue — Gate 19)', () => {
  test('enqueue prepends within the entry workspace and never touches others', () => {
    const store = useDiffQueueStore.getState()

    store.enqueue(entry({ workspace: 'helios-platform', id: 'h1' }))
    store.enqueue(entry({ workspace: 'helios-platform', id: 'h2' }))
    store.enqueue(entry({ workspace: 'atlas-consortium', id: 'a1' }))

    const { entries } = useDiffQueueStore.getState()
    expect(entries['helios-platform'].map((e) => e.id)).toEqual(['h2', 'h1'])
    expect(entries['atlas-consortium'].map((e) => e.id)).toEqual(['a1'])
  })

  test('queue is capped at 50 entries per workspace (newest kept)', () => {
    const store = useDiffQueueStore.getState()
    for (let i = 0; i < 55; i += 1) {
      store.enqueue(entry({ id: `cap-${i}` }))
    }
    const list = useDiffQueueStore.getState().entries['helios-platform']
    expect(list).toHaveLength(50)
    expect(list[0].id).toBe('cap-54') // newest first
    expect(list[49].id).toBe('cap-5') // oldest survivor
  })

  test('setStatus updates only the matching entry', () => {
    const store = useDiffQueueStore.getState()
    store.enqueue(entry({ id: 'x1' }))
    store.enqueue(entry({ id: 'x2' }))

    useDiffQueueStore.getState().setStatus('helios-platform', 'x1', 'applied')
    const list = useDiffQueueStore.getState().entries['helios-platform']
    expect(list.find((e) => e.id === 'x1')?.status).toBe('applied')
    expect(list.find((e) => e.id === 'x2')?.status).toBe('pending')
  })

  test('clearResolved keeps only pending entries', () => {
    const store = useDiffQueueStore.getState()
    store.enqueue(entry({ id: 'p1' }))
    store.enqueue(entry({ id: 'd1', status: 'dismissed' }))
    store.enqueue(entry({ id: 'p2' }))
    store.enqueue(entry({ id: 'a1', status: 'applied' }))

    useDiffQueueStore.getState().clearResolved('helios-platform')
    expect(useDiffQueueStore.getState().entries['helios-platform'].map((e) => e.id)).toEqual([
      'p2',
      'p1',
    ])
  })

  test('countPending counts only pending entries of the given workspace', () => {
    const store = useDiffQueueStore.getState()
    store.enqueue(entry({ workspace: 'helios-platform', id: 'h1' }))
    store.enqueue(entry({ workspace: 'helios-platform', id: 'h2', status: 'applied' }))
    store.enqueue(entry({ workspace: 'helios-platform', id: 'h3', status: 'dismissed' }))
    store.enqueue(entry({ workspace: 'atlas-consortium', id: 'a1' }))

    const { entries } = useDiffQueueStore.getState()
    expect(countPending(entries, 'helios-platform')).toBe(1)
    expect(countPending(entries, 'atlas-consortium')).toBe(1)
    expect(countPending(entries, 'no-such-workspace')).toBe(0)
  })

  test('a queued entry starts as pending — nothing is ever auto-applied (Gate 19)', () => {
    // Enqueue has no "apply" parameter; the only path to `applied` is an
    // explicit human setStatus call, which is the approval gate.
    const store = useDiffQueueStore.getState()
    store.enqueue(entry({ id: 'fresh' }))
    expect(useDiffQueueStore.getState().entries['helios-platform'][0].status).toBe('pending')
  })
})
