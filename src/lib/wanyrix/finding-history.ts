/**
 * Per-finding presence timeline (R9) — pure helpers shared by the
 * FindingSheet drawer and unit tests.
 *
 * Given a workspace's scan history (each entry optionally carrying the R7
 * findings fingerprint — the sorted unique finding ids that run observed),
 * this computes WHEN a specific finding id was seen: a chronological
 * presence timeline plus first/last-seen facts and a resolved-in-latest
 * verdict.
 *
 * Honesty contract (Gate 21) — two kinds of "we don't know":
 * - a legacy entry WITHOUT a fingerprint is `unknown` (the run may or may
 *   not have observed the finding — it simply didn't record ids);
 * - a fingerprinted entry from a DIFFERENT id registry is `unknown` too.
 *   Registry = the id's first dash segment (`WAN-BLD-001` → `WAN`,
 *   `FER-ENG-004` → `FER`). A real engine-exec run scans the engine crate
 *   and only ever emits `FER-ENG-*` ids, so it can NOT witness a `WAN-*`
 *   demo finding — counting it "absent" would fabricate a resolution.
 *
 * `resolvedInLatest` is therefore computed ONLY across comparable
 * (same-registry fingerprinted) runs and is `null` when it cannot be
 * determined. Nothing is inferred beyond what the fingerprints contain.
 */

import type { ScanHistoryEntry, ScanTrigger } from './scan-store'

/** Presence of the finding in one history entry. */
export type PresenceState = 'observed' | 'absent' | 'unknown'

/** One timeline point, chronological order (oldest first). */
export interface PresencePoint {
  /** epoch ms — when the run completed. */
  at: number
  /** what kind of run produced this entry. */
  trigger: ScanTrigger
  state: PresenceState
}

/** Presence summary for one finding across a workspace's scan history. */
export interface FindingPresence {
  /** timeline points, OLDEST FIRST, capped at the most recent `maxPoints`. */
  points: PresencePoint[]
  /** entries examined (the capped window actually displayed). */
  totalScanned: number
  /** entries whose fingerprint is comparable (fingerprinted + same registry). */
  comparableCount: number
  /** comparable entries that observed the finding. */
  observedCount: number
  /** comparable entries that did NOT observe the finding. */
  absentCount: number
  /** epoch ms of the earliest comparable observation, null when never seen. */
  firstSeenAt: number | null
  /** epoch ms of the most recent comparable observation, null when never seen. */
  lastSeenAt: number | null
  /**
   * true  — the latest comparable run lacks the finding while an earlier one
   *         had it (measured resolution within this window);
   * false — the latest comparable run still observes it;
   * null  — no comparable runs (or the finding was never observed).
   */
  resolvedInLatest: boolean | null
}

/**
 * A finding id's registry — its first dash segment. `WAN-BLD-001` → `WAN`,
 * `FER-ENG-004` → `FER`. Ids without a dash form their own registry.
 */
export function registryOf(findingId: string): string {
  const dash = findingId.indexOf('-')
  return dash === -1 ? findingId : findingId.slice(0, dash)
}

/** Default timeline length — the most recent N scans are displayed. */
export const PRESENCE_WINDOW = 14

/**
 * Compute a finding's presence across a workspace's scan history.
 *
 * @param entries the workspace's history entries, NEWEST FIRST (the
 *   scan-store contract). The most recent `maxPoints` entries are examined
 *   and returned oldest-first.
 */
export function findingPresence(
  entries: readonly ScanHistoryEntry[] | undefined,
  findingId: string,
  maxPoints = PRESENCE_WINDOW,
): FindingPresence {
  const empty: FindingPresence = {
    points: [],
    totalScanned: 0,
    comparableCount: 0,
    observedCount: 0,
    absentCount: 0,
    firstSeenAt: null,
    lastSeenAt: null,
    resolvedInLatest: null,
  }
  if (!findingId || !Array.isArray(entries) || entries.length === 0) return empty

  const registry = registryOf(findingId)

  // newest-first slice of the window, then mapped oldest-first for display
  const window = entries.slice(0, Math.max(1, maxPoints))
  const points: PresencePoint[] = []

  for (const entry of window) {
    const ids = entry.findingIds
    let state: PresenceState = 'unknown'
    if (Array.isArray(ids)) {
      // comparable only when the fingerprint witnesses THIS registry at all
      const sameRegistry = ids.some((id) => registryOf(id) === registry)
      if (sameRegistry) state = ids.includes(findingId) ? 'observed' : 'absent'
    }
    points.push({ at: entry.at, trigger: entry.trigger, state })
  }
  points.reverse() // chronological (oldest first)

  const comparableCount = points.filter((p) => p.state !== 'unknown').length
  const observedPoints = points.filter((p) => p.state === 'observed')
  const observedCount = observedPoints.length
  const absentCount = points.filter((p) => p.state === 'absent').length

  const firstSeenAt = observedPoints.length ? observedPoints[0]!.at : null
  const lastSeenAt = observedPoints.length ? observedPoints[observedPoints.length - 1]!.at : null

  // resolution verdict — only the latest COMPARABLE point decides, and only
  // when an earlier comparable point observed the finding (otherwise there
  // is no "since" to speak of).
  let resolvedInLatest: boolean | null = null
  if (comparableCount > 0) {
    const latestComparable = [...points].reverse().find((p) => p.state !== 'unknown')!
    if (latestComparable.state === 'observed') {
      resolvedInLatest = false
    } else {
      const earlierObserved = points.some(
        (p) => p.state === 'observed' && p.at < latestComparable.at,
      )
      resolvedInLatest = earlierObserved ? true : null
    }
  }

  return {
    points,
    totalScanned: points.length,
    comparableCount,
    observedCount,
    absentCount,
    firstSeenAt,
    lastSeenAt,
    resolvedInLatest,
  }
}

/**
 * Human label for a presence state (shared by the UI legend + tests).
 */
export function presenceLabel(state: PresenceState): string {
  switch (state) {
    case 'observed':
      return 'observed'
    case 'absent':
      return 'not observed'
    case 'unknown':
      return 'no comparable fingerprint'
  }
}
