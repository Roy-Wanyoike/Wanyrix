import type { BlockingCondition, Gate, GatesPayload } from './types'
import type { ScanHistoryEntry } from './scan-store'
import { GATES } from './data'

/**
 * Machine-readable flavor builders (ENG-TCA-2) + client download exporters
 * (Task 3-b consolidation).
 *
 * The product advertises three versioned JSON flavors. `wanyrix.report/v1`
 * lives in report.ts; the other two — `wanyrix.release-scorecard/v1` and
 * `wanyrix.scan-history/v1` — were previously assembled ONLY inside browser
 * components (scorecard-view.tsx / scan-history.tsx download exports), which
 * made them unreachable for CI/pipeline consumers. These server builders
 * produce the SAME envelope shapes (field-for-field) so the HTTP surface can
 * serve both flavors additively:
 *
 *   GET /api/wanyrix/report?flavor=scorecard&ws=…    → wanyrix.release-scorecard/v1
 *   GET /api/wanyrix/report?flavor=scan-history&ws=… → wanyrix.scan-history/v1
 *
 * Single source of truth (Task 3-b, ENG-TCA-2 follow-up): the client download
 * exporters at the bottom of this module (`buildClientScorecardExport`,
 * `buildClientScanHistoryExport`) are the SAME builders the HTTP flavors use,
 * so a browser download and its HTTP counterpart are field-for-field
 * identical by construction — they cannot drift. The browser components'
 * local copies (src/components/** — UI-agent ownership) should be replaced by
 * one imports from this module; the shapes here mirror those copies exactly,
 * pinned field-for-field by tests/unit/client-export.test.ts.
 */

/**
 * Release line served in the scorecard flavor. MUST stay in sync with the
 * `RELEASE` const in scorecard-view.tsx (client-owned) and the version string
 * in the markdown report header.
 */
export const WANYRIX_RELEASE = '0.4.2'

/* ------------------------------------------------- release-scorecard/v1 -- */

/** Field-for-field mirror of the client exporter in scorecard-view.tsx. */
export interface ReleaseScorecardFlavor {
  schema: 'wanyrix.release-scorecard/v1'
  generatedAt: string
  release: string
  verdict: GatesPayload['verdict']
  rationale: string
  gates: Gate[]
  blockingConditions: BlockingCondition[]
}

export function buildReleaseScorecardFlavor(now = new Date()): ReleaseScorecardFlavor {
  return {
    schema: 'wanyrix.release-scorecard/v1',
    generatedAt: now.toISOString(),
    release: WANYRIX_RELEASE,
    verdict: GATES.verdict,
    rationale: GATES.rationale,
    gates: GATES.gates,
    blockingConditions: GATES.blockingConditions,
  }
}

/* ---------------------------------------------------- scan-history/v1 ---- */

/**
 * One recorded doctor-scan run — field-for-field mirror of the client
 * exporter in scan-history.tsx (which maps its localStorage entries onto
 * exactly these keys).
 */
export interface ScanHistoryRunFlavor {
  id: string
  at: string
  trigger: string
  findings: number
  critical: number
  warning: number
  info: number
  buildTimeSeconds: number
  estimatedFromSeconds: number
  estimatedToSeconds: number
  wallClockMs: number
  /** R7: optional findings fingerprint — included only when the entry has one. */
  findingIds?: string[]
  findingIdsTruncated?: boolean
  /**
   * R8: present (and `'not-measured'`) only on engine-exec rows whose build
   * time is a visible zero — never on measured demo rows (additive key).
   */
  buildTimeStatus?: 'not-measured'
}

export interface ScanHistoryFlavor {
  schema: 'wanyrix.scan-history/v1'
  workspace: string
  exportedAt: string
  note: string
  runs: ScanHistoryRunFlavor[]
}

/**
 * TASK 3-B HONESTY CONTRACT — the server-side scan log stays EMPTY by design.
 * Scan runs ARE now recorded client-side (scan-store.ts `recordScanRun`,
 * persisted to localStorage under `wanyrix.scan-store`), but those local runs
 * must NEVER be fabricated into the HTTP flavor: they are per-browser data
 * the server does not own, and inventing wall-clock durations server-side
 * would violate Gate 21. CI consumers therefore always get `runs: []` with a
 * note that says so. Do not "populate" this from the client log.
 */
export const SERVER_SCAN_HISTORY_NOTE =
  'Server-side scan log. Run entries mirror the client exporter exactly (id, at, trigger, findings, critical, warning, info, buildTimeSeconds, estimatedFromSeconds, estimatedToSeconds, wallClockMs, plus the optional R7 findings fingerprint findingIds/findingIdsTruncated when the run carried one). Scan runs are recorded client-side per browser (localStorage) in this demo, so THIS export log stays empty — runs synced to the durable server log are served by GET /api/wanyrix/scan-runs (wanyrix.scan-runs/v1) and are never merged or fabricated here (Gate 21: measured vs estimated labeled per run).'

/** Shared envelope constructor — one shape, two honest notes (server/client). */
function scanHistoryEnvelope(
  ws: string,
  note: string,
  runs: ScanHistoryRunFlavor[],
  now: Date,
): ScanHistoryFlavor {
  return {
    schema: 'wanyrix.scan-history/v1',
    workspace: ws,
    exportedAt: now.toISOString(),
    note,
    runs,
  }
}

export function buildScanHistoryFlavor(ws: string, now = new Date()): ScanHistoryFlavor {
  return scanHistoryEnvelope(ws, SERVER_SCAN_HISTORY_NOTE, [], now)
}

/* ------------------------------------------------------- route bundles --- */

/** Envelope style shared with the report route's `{filename, json, bytes}`. */
export interface FlavorBundle {
  filename: string
  json: ReleaseScorecardFlavor | ScanHistoryFlavor
  bytes: number
}

export function buildScorecardBundle(now = new Date()): FlavorBundle {
  const json = buildReleaseScorecardFlavor(now)
  return {
    // same download name the client exporter uses
    filename: `wanyrix-scorecard-${WANYRIX_RELEASE}.json`,
    json,
    bytes: new TextEncoder().encode(JSON.stringify(json)).length,
  }
}

export function buildScanHistoryBundle(ws: string, now = new Date()): FlavorBundle {
  const json = buildScanHistoryFlavor(ws, now)
  return {
    // same stamp format as the client exporter: ISO with [:.] → '-', first 19 chars
    filename: clientScanHistoryFilename(ws, now),
    json,
    bytes: new TextEncoder().encode(JSON.stringify(json)).length,
  }
}

/* ========================================================================= */
/*  Client download exporters (Task 3-b — ENG-TCA-2 consolidation).           */
/*                                                                            */
/*  The browser components' download actions previously re-assembled these    */
/*  envelopes by hand. They now have ONE source: the functions below delegate */
/*  to the exact builders the HTTP flavors use, so a client download and its  */
/*  HTTP counterpart are field-for-field identical by construction. The UI    */
/*  agent swaps the component-local copies for these imports (public export   */
/*  behavior — filename, JSON shape, version strings — unchanged).            */
/* ========================================================================= */

/**
 * The honesty note carried by a CLIENT-side `wanyrix.scan-history/v1`
 * download. Byte-for-byte the string the browser exporter has always emitted;
 * deliberately different from {@link SERVER_SCAN_HISTORY_NOTE} — the client
 * log is real local data, the server log is honestly empty.
 */
export const CLIENT_SCAN_HISTORY_NOTE =
  'client-side scan log for the web dashboard demo — durations are terminal wall clock; figures mirror the doctor payload (Gate 21: measured vs estimated labeled per run)'

/**
 * Map one persisted scan-history log entry (scan-store.ts) onto the flavor's
 * run shape — the exact key mapping the client exporter has always applied.
 * Unit of consolidation: both the HTTP flavor docs and the client download
 * route entries through this single mapper, so key names cannot drift.
 */
export function toScanHistoryRunFlavor(entry: ScanHistoryEntry): ScanHistoryRunFlavor {
  return {
    id: entry.id,
    at: new Date(entry.at).toISOString(),
    trigger: entry.trigger,
    findings: entry.findings,
    critical: entry.critical,
    warning: entry.warning,
    info: entry.info,
    buildTimeSeconds: entry.buildTime,
    estimatedFromSeconds: entry.estimatedFrom,
    estimatedToSeconds: entry.estimatedTo,
    wallClockMs: entry.durationMs,
    // R7: fingerprint keys are included ONLY when the entry carries one, so
    // legacy entries keep the exact pinned key set.
    ...(entry.findingIds !== undefined
      ? {
          findingIds: entry.findingIds,
          ...(entry.findingIdsTruncated ? { findingIdsTruncated: true } : {}),
        }
      : {}),
    // R8: the not-measured build-time marker travels with the row so every
    // export surfaces the visible zero AS a visible zero (additive key).
    ...(entry.buildTimeStatus === 'not-measured' ? { buildTimeStatus: 'not-measured' as const } : {}),
  }
}

/**
 * CLIENT download exporter for `wanyrix.release-scorecard/v1`.
 * Delegates to the HTTP flavor builder — identical envelope, identical
 * `generatedAt` semantics (call-site clock).
 */
export function buildClientScorecardExport(now = new Date()): ReleaseScorecardFlavor {
  return buildReleaseScorecardFlavor(now)
}

/** Same download filename the client exporter has always used. */
export function clientScorecardFilename(): string {
  return `wanyrix-scorecard-${WANYRIX_RELEASE}.json`
}

/**
 * CLIENT download exporter for `wanyrix.scan-history/v1` — the local
 * (per-browser) run log mapped onto the exact flavor envelope. Same keys,
 * same version string, same run-entry shape as the HTTP flavor; only `note`
 * and `runs` differ honestly (client log is real local activity, the server
 * log stays empty — see the honesty comment above).
 */
export function buildClientScanHistoryExport(
  ws: string,
  entries: readonly ScanHistoryEntry[],
  now = new Date(),
): ScanHistoryFlavor {
  return scanHistoryEnvelope(ws, CLIENT_SCAN_HISTORY_NOTE, entries.map(toScanHistoryRunFlavor), now)
}

/** Same download filename the client exporter has always used (stamp = ISO → '-', 19 chars). */
export function clientScanHistoryFilename(ws: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${ws}-scan-history-${stamp}.json`
}
