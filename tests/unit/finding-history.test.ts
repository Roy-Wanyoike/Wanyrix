/**
 * R9 — per-finding presence timeline (unit suite).
 *
 * Covers `findingPresence` (chronological presence points over the scan
 * history window, comparable-registry scoping, first/last seen, resolved
 * verdict) and `registryOf`. The honesty rules are pinned here:
 * legacy (fingerprint-less) runs and cross-registry fingerprints (e.g. a
 * real FER-ENG-* engine-exec run vs a WAN-* demo finding) count as
 * `unknown` — never as an absence, and never as a resolution.
 */
import { describe, expect, test } from 'bun:test'

import {
  findingPresence,
  presenceLabel,
  registryOf,
  PRESENCE_WINDOW,
  type FindingPresence,
} from '../../src/lib/wanyrix/finding-history'
import type { ScanHistoryEntry, ScanTrigger } from '../../src/lib/wanyrix/scan-store'

/** Build a history entry with sensible defaults (newest-first lists). */
function entry(
  at: number,
  findingIds: string[] | undefined,
  trigger: ScanTrigger = 'manual',
): ScanHistoryEntry {
  const base: ScanHistoryEntry = {
    id: `scan-${at}`,
    workspace: 'helios-platform',
    at,
    durationMs: 1200,
    findings: findingIds?.length ?? 0,
    critical: 0,
    warning: 0,
    info: findingIds?.length ?? 0,
    buildTime: 87.4,
    estimatedFrom: 52,
    estimatedTo: 61,
    trigger,
  }
  if (findingIds !== undefined) {
    base.findingIds = findingIds
  }
  return base
}

const WAN = 'WAN-BLD-001'
const OTHER = 'WAN-DEP-006'

describe('registryOf — first dash segment', () => {
  test('splits demo + engine ids into their registries', () => {
    expect(registryOf('WAN-BLD-001')).toBe('WAN')
    expect(registryOf('FER-ENG-004')).toBe('FER')
    expect(registryOf('SOLO')).toBe('SOLO') // no dash → own registry
  })
})

describe('findingPresence — window, ordering and states', () => {
  test('empty/undefined history → the all-null empty summary', () => {
    const none: FindingPresence = findingPresence(undefined, WAN)
    expect(none.points).toEqual([])
    expect(none.totalScanned).toBe(0)
    expect(none.resolvedInLatest).toBeNull()
    expect(findingPresence([], WAN).totalScanned).toBe(0)
    expect(findingPresence([entry(1, [WAN])], '').totalScanned).toBe(0)
  })

  test('maps fingerprinted entries to observed/absent, oldest first', () => {
    // newest-first input (store contract): t3 has it, t2 not, t1 has it
    const entries = [entry(3000, [OTHER]), entry(2000, [WAN, OTHER]), entry(1000, [WAN])]
    const p = findingPresence(entries, WAN)
    expect(p.points.map((pt) => [pt.at, pt.state])).toEqual([
      [1000, 'observed'],
      [2000, 'observed'],
      [3000, 'absent'],
    ])
    expect(p.comparableCount).toBe(3)
    expect(p.observedCount).toBe(2)
    expect(p.absentCount).toBe(1)
    expect(p.firstSeenAt).toBe(1000)
    expect(p.lastSeenAt).toBe(2000)
  })

  test(`caps the window at the most recent ${PRESENCE_WINDOW} entries (newest-first input)`, () => {
    // store contract: entries[0] is the NEWEST run → at descends with index
    const entries = Array.from({ length: PRESENCE_WINDOW + 6 }, (_, i) =>
      entry(9000 - i, i % 2 === 0 ? [WAN] : [OTHER]),
    )
    const p = findingPresence(entries, WAN)
    expect(p.totalScanned).toBe(PRESENCE_WINDOW)
    // the 6 oldest (at 8981..8986) fell off; the displayed window spans 8987..9000
    expect(p.points[0]?.at).toBe(8987)
    expect(p.points[p.points.length - 1]?.at).toBe(9000)
  })

  test('trigger is carried through for tooltips', () => {
    const p = findingPresence([entry(10, [WAN], 'engine-exec')], WAN)
    expect(p.points[0]?.trigger).toBe('engine-exec')
  })
})

describe('findingPresence — honesty: unknown beats absence', () => {
  test('a legacy entry without a fingerprint is unknown, never absent', () => {
    const p = findingPresence([entry(2000, [OTHER]), entry(1000, undefined)], WAN)
    expect(p.points.map((pt) => pt.state)).toEqual(['unknown', 'absent'])
    expect(p.comparableCount).toBe(1)
  })

  test('a cross-registry fingerprint (FER-ENG run vs WAN finding) is unknown', () => {
    const p = findingPresence(
      [entry(2000, ['FER-ENG-001', 'FER-ENG-002'], 'engine-exec'), entry(1000, [WAN])],
      WAN,
    )
    expect(p.points.map((pt) => pt.state)).toEqual(['observed', 'unknown'])
    expect(p.comparableCount).toBe(1)
    expect(p.observedCount).toBe(1)
  })

  test('an empty fingerprint witnesses NO registry → unknown (stricter than the R7 diff)', () => {
    // a zero-finding run cannot prove WHICH scan target it covered, so it
    // must never turn into an "absent" for a specific finding
    const p = findingPresence([entry(2000, []), entry(1000, [WAN])], WAN)
    expect(p.points.map((pt) => pt.state)).toEqual(['observed', 'unknown'])
    expect(p.comparableCount).toBe(1)
    expect(p.resolvedInLatest).toBe(false) // latest COMPARABLE run still observes it
  })
})

describe('findingPresence — resolved verdict', () => {
  test('resolved only when the latest comparable run lacks an earlier observation', () => {
    const p = findingPresence([entry(3000, [OTHER]), entry(2000, [WAN, OTHER]), entry(1000, [WAN])], WAN)
    expect(p.resolvedInLatest).toBe(true)
  })

  test('still observed in the latest comparable run → false', () => {
    const p = findingPresence([entry(3000, [WAN]), entry(1000, [WAN])], WAN)
    expect(p.resolvedInLatest).toBe(false)
  })

  test('absent everywhere with no earlier observation → null (nothing to resolve)', () => {
    const p = findingPresence([entry(3000, [OTHER]), entry(2000, [OTHER])], WAN)
    expect(p.resolvedInLatest).toBeNull()
  })

  test('unknown latest run does NOT mask an earlier resolution', () => {
    // latest is a legacy run (unknown) — the latest COMPARABLE run decides
    const p = findingPresence([entry(3000, undefined), entry(2000, [OTHER]), entry(1000, [WAN])], WAN)
    expect(p.resolvedInLatest).toBe(true)
  })

  test('cross-registry latest run does NOT fabricate a resolution', () => {
    // engine-exec run saw no WAN ids → unknown for this WAN finding → the
    // verdict must stay false (latest comparable WAN run still observed it)
    const p = findingPresence(
      [entry(3000, ['FER-ENG-009'], 'engine-exec'), entry(2000, [WAN])],
      WAN,
    )
    expect(p.resolvedInLatest).toBe(false)
  })
})

describe('presenceLabel — shared UI wording', () => {
  test('labels the three states', () => {
    expect(presenceLabel('observed')).toBe('observed')
    expect(presenceLabel('absent')).toBe('not observed')
    expect(presenceLabel('unknown')).toBe('no comparable fingerprint')
  })
})
