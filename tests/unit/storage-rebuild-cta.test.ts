/**
 * QA-1 F-3 — storage dialog "Simulate scan rebuild" CTA is honest.
 *
 * The CTA used to be disabled whenever the reclaimable rows were at their
 * baseline (rebuildableMB < 1) with NO visible reason. Pins:
 *
 *   1. CTA state — disabled now means PENDING only; the at-baseline case is
 *      enabled and labeled without a fake "+0 MB" suffix; the tooltip (title)
 *      names both the simulation and the honest 0 MB outcome;
 *   2. server honesty — `rebuildCaches()` (the exact function behind
 *      POST /api/wanyrix/storage/rebuild) accepts an at-baseline rebuild and
 *      answers rebuiltMB 0 with empty detail — the condition that used to
 *      disable the button was satisfiable all along, and the no-op is labeled
 *      by the dialog's existing "Caches are already at their working-set
 *      size" toast (empty detail === that branch).
 *
 * The storage singleton (globalThis) is snapshotted and restored so the
 * shared bun process stays clean.
 */
import { describe, expect, test } from 'bun:test'

import { rebuildCtaState } from '../../src/components/wanyrix/storage-dialog'
import { rebuildCaches, reclaimCaches } from '../../src/lib/wanyrix/storage-state'

const SINGLETON_KEY = '__wanyrix_storage_state__'
const globalStore = globalThis as unknown as Record<string, unknown>

function withFreshStorageState<T>(fn: () => T): T {
  const saved = globalStore[SINGLETON_KEY]
  delete globalStore[SINGLETON_KEY]
  try {
    return fn()
  } finally {
    if (saved === undefined) delete globalStore[SINGLETON_KEY]
    else globalStore[SINGLETON_KEY] = saved
  }
}

describe('rebuildCtaState — disabled means pending, not "at baseline" (F-3)', () => {
  test('at-baseline caches (0 MB rebuildable) leave the CTA ENABLED', () => {
    const cta = rebuildCtaState({ rebuildableMB: 0, rebuildPending: false, reclaimPending: false })
    expect(cta.disabled).toBeFalse()
  })

  test('the label never claims a fake "+0 MB" gain', () => {
    const atBaseline = rebuildCtaState({ rebuildableMB: 0, rebuildPending: false, reclaimPending: false })
    const postReclaim = rebuildCtaState({ rebuildableMB: 108, rebuildPending: false, reclaimPending: false })
    expect(atBaseline.label).toBe('Simulate scan rebuild')
    expect(postReclaim.label).toBe('Simulate scan rebuild (+108 MB)')
  })

  test('in-flight mutations still disable the CTA (double-submit guard stays)', () => {
    expect(
      rebuildCtaState({ rebuildableMB: 0, rebuildPending: true, reclaimPending: false }).disabled,
    ).toBeTrue()
    expect(
      rebuildCtaState({ rebuildableMB: 108, rebuildPending: false, reclaimPending: true }).disabled,
    ).toBeTrue()
  })

  test('the tooltip states the simulation AND the honest 0 MB outcome (visible reason)', () => {
    const { hint } = rebuildCtaState({ rebuildableMB: 0, rebuildPending: false, reclaimPending: false })
    expect(hint).toContain('Gate 21: simulated')
    expect(hint).toContain('adds 0 MB')
  })
})

describe('server honesty — an at-baseline rebuild is accepted and labeled', () => {
  test('full caches: rebuildCaches() returns rebuiltMB 0 + empty detail, no error', () => {
    withFreshStorageState(() => {
      const res = rebuildCaches()
      expect(res.rebuiltMB).toBe(0)
      expect(res.detail).toEqual([])
    })
  })

  test('after a reclaim the same CTA really rebuilds (the condition is satisfiable)', () => {
    withFreshStorageState(() => {
      const reclaimed = reclaimCaches()
      expect(reclaimed.reclaimedMB).toBeGreaterThan(0)
      const rebuilt = rebuildCaches()
      expect(rebuilt.rebuiltMB).toBeGreaterThan(0)
      expect(rebuilt.detail.length).toBeGreaterThan(0)
    })
  })
})
