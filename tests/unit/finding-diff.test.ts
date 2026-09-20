/**
 * R7 — findings-fingerprint helpers (unit suite).
 *
 * Covers `capFindingIds` (normalize/dedupe/sort/cap + truncation flag) and
 * `diffFindingIds` (stable / added / resolved sets, refusal when either side
 * lacks a fingerprint). Also pins `isValidFindingIdList` — the exact guard
 * the POST /api/wanyrix/scan-runs route applies before persisting.
 */
import { describe, expect, test } from 'bun:test'

import {
  capFindingIds,
  diffFindingIds,
  isValidFindingIdList,
  FINDING_IDS_CAP,
} from '../../src/lib/wanyrix/finding-diff'

describe('capFindingIds — normalize for persistence', () => {
  test('dedupes, trims, drops empties and sorts lexicographically', () => {
    const { ids, truncated } = capFindingIds([
      'WAN-DEP-006',
      ' WAN-BLD-001 ',
      'WAN-DEP-006',
      '',
      'WAN-BLD-001',
      'WAN-WRK-007',
    ])
    expect(truncated).toBe(false)
    expect(ids).toEqual(['WAN-BLD-001', 'WAN-DEP-006', 'WAN-WRK-007'])
  })

  test(`caps at ${FINDING_IDS_CAP} and flags the fingerprint as truncated`, () => {
    const many = Array.from({ length: FINDING_IDS_CAP + 25 }, (_, i) => `WAN-X-${String(i).padStart(4, '0')}`)
    const { ids, truncated } = capFindingIds(many)
    expect(truncated).toBe(true)
    expect(ids).toHaveLength(FINDING_IDS_CAP)
    expect(ids[0]).toBe('WAN-X-0000') // sorted head kept, tail dropped + labeled
  })

  test('an exact-cap list is NOT truncated', () => {
    const exact = Array.from({ length: FINDING_IDS_CAP }, (_, i) => `WAN-Y-${i}`)
    expect(capFindingIds(exact).truncated).toBe(false)
  })

  test('a custom cap is honored (UI smoke lists use small caps)', () => {
    expect(capFindingIds(['b', 'a', 'c'], 2)).toEqual({ ids: ['a', 'b'], truncated: true })
  })
})

describe('diffFindingIds — stable / added / resolved', () => {
  test('partitions two fingerprints into stable, added and resolved', () => {
    const diff = diffFindingIds(
      ['WAN-BLD-001', 'WAN-DEP-006', 'WAN-WRK-007'],
      ['WAN-BLD-001', 'WAN-DEP-006', 'WAN-BLD-002'],
    )
    expect(diff.comparable).toBe(true)
    expect(diff.stable).toEqual(['WAN-BLD-001', 'WAN-DEP-006'])
    expect(diff.added).toEqual(['WAN-BLD-002'])
    expect(diff.resolved).toEqual(['WAN-WRK-007'])
  })

  test('identical fingerprints → everything stable, nothing changed', () => {
    const ids = ['WAN-BLD-001', 'WAN-DEP-006']
    const diff = diffFindingIds(ids, [...ids].reverse()) // order must not matter
    expect(diff.stable).toEqual(['WAN-BLD-001', 'WAN-DEP-006'])
    expect(diff.added).toEqual([])
    expect(diff.resolved).toEqual([])
  })

  test('refuses to guess when either side lacks a fingerprint', () => {
    expect(diffFindingIds(undefined, ['WAN-BLD-001']).comparable).toBe(false)
    expect(diffFindingIds(['WAN-BLD-001'], undefined).comparable).toBe(false)
    expect(diffFindingIds(undefined, undefined).comparable).toBe(false)
  })

  test('empty fingerprints on both sides are comparable (and empty)', () => {
    const diff = diffFindingIds([], [])
    expect(diff.comparable).toBe(true)
    expect(diff.stable).toEqual([])
    expect(diff.added).toEqual([])
    expect(diff.resolved).toEqual([])
  })

  test('duplicate ids on one side do not create phantom diffs', () => {
    const diff = diffFindingIds(['WAN-BLD-001', 'WAN-BLD-001'], ['WAN-BLD-001'])
    expect(diff.stable).toEqual(['WAN-BLD-001'])
    expect(diff.added).toEqual([])
    expect(diff.resolved).toEqual([])
  })
})

describe('isValidFindingIdList — server-side POST guard', () => {
  test('accepts sorted-or-not string arrays within the cap', () => {
    expect(isValidFindingIdList(['WAN-BLD-001'])).toBe(true)
    expect(isValidFindingIdList([])).toBe(true)
    expect(isValidFindingIdList(['WAN-BLD-001', 'WAN-DEP-006'])).toBe(true)
  })

  test('rejects non-arrays, wrong element types and charset violations', () => {
    expect(isValidFindingIdList('WAN-BLD-001')).toBe(false)
    expect(isValidFindingIdList([1, 2])).toBe(false)
    expect(isValidFindingIdList(['has space'])).toBe(false)
    expect(isValidFindingIdList([''])).toBe(false)
    expect(isValidFindingIdList(['semi;colon'])).toBe(false)
  })

  test(`rejects lists longer than the ${FINDING_IDS_CAP} cap`, () => {
    const tooMany = Array.from({ length: FINDING_IDS_CAP + 1 }, (_, i) => `WAN-Z-${i}`)
    expect(isValidFindingIdList(tooMany)).toBe(false)
  })

  test('allows the documented charset (alnum, dot, underscore, colon, plus, dash)', () => {
    expect(isValidFindingIdList(['WAN-BLD.001_2:3+4'])).toBe(true)
  })
})
