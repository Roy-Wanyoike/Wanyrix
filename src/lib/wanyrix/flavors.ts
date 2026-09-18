import type { BlockingCondition, Gate, GatesPayload } from './types'
import { GATES } from './data'

/**
 * Machine-readable flavor builders (ENG-TCA-2).
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
 * Component ownership note: the client exporters still carry their own copies
 * (src/components/** is owned by the UI agent). The shapes here mirror those
 * exporters exactly; consolidating both onto this module is a follow-up for
 * the component owner (tracked in ENG-TCA-2 evidence).
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
}

export interface ScanHistoryFlavor {
  schema: 'wanyrix.scan-history/v1'
  workspace: string
  exportedAt: string
  note: string
  runs: ScanHistoryRunFlavor[]
}

/**
 * Scan history is, by design, a per-browser client log (localStorage,
 * `wanyrix.scan-store` — see scan-store.ts). The server keeps the same log
 * shape so CI consumers always get a valid `wanyrix.scan-history/v1`
 * envelope; in this demo the server-side log is EMPTY (never fabricated:
 * a run without a measured wall-clock duration must not be invented —
 * Gate 21). The note field states this explicitly in every response.
 */
export function buildScanHistoryFlavor(ws: string, now = new Date()): ScanHistoryFlavor {
  return {
    schema: 'wanyrix.scan-history/v1',
    workspace: ws,
    exportedAt: now.toISOString(),
    note:
      'Server-side scan log. Run entries mirror the client exporter exactly (id, at, trigger, findings, critical, warning, info, buildTimeSeconds, estimatedFromSeconds, estimatedToSeconds, wallClockMs). Scan runs are recorded client-side per browser (localStorage) in this demo, so the server log is empty — no runs are fabricated; figures mirror the doctor payload when present (Gate 21: measured vs estimated labeled per run).',
    runs: [],
  }
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
  // same stamp format as the client exporter: ISO with [:.] → '-', first 19 chars
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return {
    filename: `${ws}-scan-history-${stamp}.json`,
    json,
    bytes: new TextEncoder().encode(JSON.stringify(json)).length,
  }
}
