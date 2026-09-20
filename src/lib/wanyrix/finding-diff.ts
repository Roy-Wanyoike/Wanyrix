/**
 * Findings-fingerprint diff (R7) — pure helpers shared by the scan store, the
 * server scan-run route and the Compare panel.
 *
 * Each recorded run may persist the SORTED UNIQUE finding ids it observed
 * (`WAN-BLD-001`-style engine finding ids). Diffing two such fingerprints
 * yields which findings are stable, new in B and resolved since A — at
 * finding-id granularity instead of only severity tallies.
 *
 * Honesty contract (Gate 21): the fingerprint is exactly what the run's
 * payload contained — nothing modeled, nothing inferred. When either side
 * lacks a fingerprint (legacy runs, or >FINDING_IDS_CAP truncated rows) the
 * diff says "not comparable" instead of guessing.
 */

/** Max finding ids persisted per run. Overflow drops the fingerprint tail. */
export const FINDING_IDS_CAP = 400

/** Finding ids are engine identifiers like `WAN-BLD-001` / `WAN-DEP-006`. */
const ID_PATTERN = /^[A-Za-z0-9._:+-]{1,96}$/

export interface CappedFindingIds {
  ids: string[]
  truncated: boolean
}

/**
 * Normalize a run's finding-id list for persistence: trim, drop empties,
 * dedupe, sort, cap. Returns the capped list + whether the source exceeded
 * the cap (so the UI can label the fingerprint PARTIAL rather than pretend
 * the tail doesn't exist).
 */
export function capFindingIds(source: readonly string[], cap = FINDING_IDS_CAP): CappedFindingIds {
  const unique = new Set<string>()
  for (const raw of source) {
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (id) unique.add(id)
  }
  const sorted = [...unique].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const truncated = sorted.length > cap
  return { ids: truncated ? sorted.slice(0, cap) : sorted, truncated }
}

/** Result of diffing two finding fingerprints. */
export interface FindingIdDiff {
  /** true only when BOTH sides carry a fingerprint (≥ empty list). */
  comparable: boolean
  /** ids present in both runs (sorted). */
  stable: string[]
  /** ids only in B — new findings since A (sorted). */
  added: string[]
  /** ids only in A — resolved between A and B (sorted). */
  resolved: string[]
}

const NO_DIFF: FindingIdDiff = { comparable: false, stable: [], added: [], resolved: [] }

/**
 * Diff two fingerprints. `undefined` (or a truncated row on either side is
 * the CALLER's concern — this function only refuses when a side is absent).
 */
export function diffFindingIds(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): FindingIdDiff {
  if (!Array.isArray(a) || !Array.isArray(b)) return NO_DIFF
  const setA = new Set(a)
  const setB = new Set(b)
  const stable: string[] = []
  const added: string[] = []
  const resolved: string[] = []
  for (const id of setA) if (setB.has(id)) stable.push(id)
  for (const id of setB) if (!setA.has(id)) added.push(id)
  for (const id of setA) if (!setB.has(id)) resolved.push(id)
  const byId = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
  return {
    comparable: true,
    stable: stable.sort(byId),
    added: added.sort(byId),
    resolved: resolved.sort(byId),
  }
}

/** Server-side guard: is this a valid persisted fingerprint list? */
export function isValidFindingIdList(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.length <= FINDING_IDS_CAP &&
    v.every((id) => typeof id === 'string' && ID_PATTERN.test(id))
  )
}
