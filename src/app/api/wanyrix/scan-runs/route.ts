import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { methodNotAllowed, resolveWorkspace, WORKSPACE_IDS } from '@/lib/wanyrix/api'
import { isValidFindingIdList, FINDING_IDS_CAP } from '@/lib/wanyrix/finding-diff'

/**
 * Server-side scan-run log — `wanyrix.scan-runs/v1`.
 *
 * The web platform is local-first: the UI source of truth for scan history is
 * per-browser localStorage (scan-store.ts). This route is the OPTIONAL
 * durable sync target:
 *   - `POST /api/wanyrix/scan-runs` — the client fire-and-forget syncs each
 *     completed run; the server persists EXACTLY what was measured and sent
 *     (idempotent upsert on the client's deterministic run id). R7: a run may
 *     also carry its findings fingerprint (sorted unique finding ids) so
 *     finding-level diffs survive across sessions/browsers.
 *   - `GET /api/wanyrix/scan-runs?ws=…` — serves the persisted runs, newest
 *     first, verbatim. Nothing is invented: no runs were POSTed → `runs: []`.
 *
 * Honesty contract (Gate 21): the server never fabricates runs, durations or
 * figures — every row was measured in a real browser session and POSTed by
 * it. The `wanyrix.scan-history/v1` report flavor remains a client-export
 * mirror and is unaffected (its server log stays empty by contract).
 *
 * Error contract (ENG-TCA series): unknown `ws`/`workspaceId` → 404
 * `{ error, knownWorkspaces }` (never a silent substitution); malformed body
 * → 400 with a named reason; wrong methods → 405 carrying `Allow`.
 */

const SCHEMA = 'wanyrix.scan-runs/v1'
const TRIGGERS = new Set(['manual', 'topbar', 'palette'])

/** Body cap — scan-run payloads are tiny; 64 KB is generous. */
const MAX_BODY_BYTES = 64 * 1024

/** Wire shape of one persisted run (mirrors `ScanRunRecord`). */
interface ScanRunDto {
  id: string
  workspaceId: string
  startedAt: number
  finishedAt: number
  durationMs: number
  findingCount: number
  severityCounts: { critical: number; warning: number; info: number }
  trigger: string
  syncedAt: string
  /** R7 findings fingerprint — present only when the run carried one. */
  findingIds?: string[]
  findingIdsTruncated?: boolean
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Non-negative safe integer. */
function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
}

/** Non-negative finite number — client-measured durations may be fractional
 * (performance.now() deltas); they are rounded to whole ms for storage. */
function isMs(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

function toDto(r: {
  id: string
  workspaceId: string
  startedAt: Date
  finishedAt: Date
  durationMs: number
  findingCount: number
  critical: number
  warning: number
  info: number
  trigger: string
  syncedAt: Date
  findingIds: string | null
  findingIdsTruncated: boolean
}): ScanRunDto {
  const dto: ScanRunDto = {
    id: r.id,
    workspaceId: r.workspaceId,
    startedAt: r.startedAt.getTime(),
    finishedAt: r.finishedAt.getTime(),
    durationMs: r.durationMs,
    findingCount: r.findingCount,
    severityCounts: { critical: r.critical, warning: r.warning, info: r.info },
    trigger: r.trigger,
    syncedAt: r.syncedAt.toISOString(),
  }
  // R7: fingerprint comes back verbatim (JSON-encoded column → array). Runs
  // synced before R7 (or without a fingerprint) simply omit the keys.
  if (r.findingIds !== null) {
    try {
      const parsed: unknown = JSON.parse(r.findingIds)
      if (Array.isArray(parsed)) dto.findingIds = parsed.map(String)
    } catch {
      // unparsable stored value → omit the fingerprint rather than lie
    }
  }
  if (r.findingIdsTruncated) dto.findingIdsTruncated = true
  return dto
}

/* ------------------------------------------------------------------ GET --- */

export async function GET(req: NextRequest) {
  const { ws, error } = resolveWorkspace(req)
  if (error) return error

  let rows: Awaited<ReturnType<typeof db.scanRun.findMany>> = []
  try {
    rows = await db.scanRun.findMany({
      where: { workspaceId: ws },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    })
  } catch (err) {
    console.error('[scan-runs] GET failed:', err)
    return NextResponse.json(
      { error: 'scan-run store unavailable — the run log is not persisted right now' },
      { status: 503 },
    )
  }

  return NextResponse.json({
    schema: SCHEMA,
    workspace: ws,
    count: rows.length,
    note:
      'Durable server log of scan runs synced from browser sessions (POST here). ' +
      'Empty when nothing has been synced — runs are never fabricated server-side (Gate 21). ' +
      'The per-browser UI log (localStorage) stays the UI source of truth.',
    runs: rows.map(toDto),
  })
}

/* ----------------------------------------------------------------- POST --- */

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `request body too large — max ${MAX_BODY_BYTES} bytes` },
      { status: 413 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'malformed JSON body' }, { status: 400 })
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
  }

  const { workspaceId } = body
  if (typeof workspaceId !== 'string' || !WORKSPACE_IDS.includes(workspaceId)) {
    return NextResponse.json(
      { error: `unknown workspace '${String(workspaceId)}'`, knownWorkspaces: WORKSPACE_IDS },
      { status: 404 },
    )
  }

  const { startedAt, finishedAt, findingCount, severityCounts, trigger, id, durationMs } = body
  const bad = (reason: string) => NextResponse.json({ error: reason }, { status: 400 })

  if (!isCount(startedAt) || !isCount(finishedAt)) {
    return bad('startedAt and finishedAt must be non-negative integers (epoch ms)')
  }
  if (finishedAt < startedAt) return bad('finishedAt must be ≥ startedAt')
  if (!isCount(findingCount)) return bad('findingCount must be a non-negative integer')
  if (!isRecord(severityCounts)) {
    return bad('severityCounts must be an object {critical, warning, info}')
  }
  const { critical, warning, info } = severityCounts
  if (!isCount(critical) || !isCount(warning) || !isCount(info)) {
    return bad('severityCounts.{critical,warning,info} must be non-negative integers')
  }
  if (critical + warning + info !== findingCount) {
    return bad('severityCounts must sum to findingCount')
  }
  if (trigger !== undefined && (typeof trigger !== 'string' || !TRIGGERS.has(trigger))) {
    return bad(`trigger must be one of: ${[...TRIGGERS].join(', ')}`)
  }
  if (id !== undefined && (typeof id !== 'string' || id.length === 0 || id.length > 128)) {
    return bad('id must be a non-empty string (≤128 chars)')
  }
  if (durationMs !== undefined && !isMs(durationMs)) {
    return bad('durationMs must be a non-negative finite number (ms)')
  }
  // R7 findings fingerprint — optional; when present it must be a well-formed
  // capped id list (see finding-diff.ts). Persisted verbatim after validation.
  const { findingIds, findingIdsTruncated } = body as {
    findingIds?: unknown
    findingIdsTruncated?: unknown
  }
  if (findingIds !== undefined && !isValidFindingIdList(findingIds)) {
    return bad(
      `findingIds must be an array of finding-id strings (≤96 chars each, max ${FINDING_IDS_CAP} entries)`,
    )
  }
  if (findingIdsTruncated !== undefined && typeof findingIdsTruncated !== 'boolean') {
    return bad('findingIdsTruncated must be a boolean')
  }

  const runId = typeof id === 'string' ? id : `run-srv-${startedAt}-${workspaceId}`
  const values = {
    workspaceId,
    startedAt: new Date(startedAt),
    finishedAt: new Date(finishedAt),
    durationMs:
      typeof durationMs === 'number' ? Math.round(durationMs) : Math.max(0, finishedAt - startedAt),
    findingCount,
    critical,
    warning,
    info,
    trigger: typeof trigger === 'string' ? trigger : 'manual',
    findingIds: Array.isArray(findingIds) ? JSON.stringify(findingIds) : null,
    findingIdsTruncated: findingIdsTruncated === true,
  }

  try {
    const row = await db.scanRun.upsert({
      where: { id: runId },
      update: values,
      create: { id: runId, ...values },
    })
    return NextResponse.json({ schema: SCHEMA, run: toDto(row) }, { status: 201 })
  } catch (err) {
    console.error('[scan-runs] POST failed:', err)
    return NextResponse.json(
      { error: 'scan-run store unavailable — the run was NOT persisted (the browser-local log is unaffected)' },
      { status: 503 },
    )
  }
}

/** GET + POST implemented; everything else → 405 with `Allow: GET, POST`. */
export const PUT = () => methodNotAllowed('GET, POST')
export const DELETE = () => methodNotAllowed('GET, POST')
export const PATCH = () => methodNotAllowed('GET, POST')
