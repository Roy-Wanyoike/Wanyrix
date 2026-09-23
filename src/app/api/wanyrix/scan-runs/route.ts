import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  methodNotAllowed,
  workspaceParam,
  WORKSPACE_IDS,
} from '@/lib/wanyrix/api'
import { isRegisteredWorkspaceId } from '@/lib/wanyrix/register'
import { resolveScanRunWorkspace } from '@/lib/wanyrix/registered-workspace'
import { withNoStore } from '@/lib/http-hygiene'
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
 * Error contract (ENG-TCA series): missing/empty `ws` (GET) or `workspaceId`
 * (POST) → 400 with the known-workspace guidance (issue #140 — a MISSING id is
 * a client input error, never the old `unknown workspace 'undefined'` lookup
 * and never a phantom `""` query); unknown `ws`/`workspaceId` → 404
 * `{ error, knownWorkspaces }` (never a silent substitution); malformed body
 * → 400 with a named reason; wrong methods → 405 carrying `Allow`.
 *
 * AUD-14: the workspace resolution covers the FULL registry — the demo
 * fixtures AND the registered local projects (QA-5-B-1 made them
 * first-class everywhere else; the durable sync was the one fixture-only
 * holdout). The ids come from the SAME store GET /api/wanyrix/workspaces
 * serves (`db.registeredWorkspace` — mergeWorkspaceRegistry's source of
 * truth); `knownWorkspaces` on a 404 lists registered ids first (merge
 * order), then fixtures. A registered-SHAPED id (`ws-local-…`) that cannot
 * be checked because the store is down answers 503 — it is never invented
 * into a 404.
 */

const SCHEMA = 'wanyrix.scan-runs/v1'
const TRIGGERS = new Set(['manual', 'topbar', 'palette', 'engine-exec'])

/** Body cap — scan-run payloads are tiny; 64 KB is generous. */
const MAX_BODY_BYTES = 64 * 1024

/** Wire refusal when a registered-shaped id cannot be checked (AUD-14). */
const REGISTERED_STORE_UNAVAILABLE =
  'registered-workspace store unavailable — registered workspace ids cannot be resolved right now'

/**
 * AUD-14 — the registered ids, from the SAME rows GET /api/wanyrix/workspaces
 * serves. Returns null when the store is unavailable; the caller answers 503
 * for a registered-SHAPED id (it could be real — no invented 404) and 404
 * with the fixture list for a non-registered-shaped id (those can never be
 * registered — the prefix is a documented invariant, register.ts).
 */
async function registeredWorkspaceIds(): Promise<string[] | null> {
  try {
    const rows = await db.registeredWorkspace.findMany({
      select: { id: true },
      orderBy: { registeredAt: 'asc' },
    })
    return rows.map((r) => r.id)
  } catch (err) {
    console.error('[scan-runs] registered-workspace lookup failed:', err)
    return null
  }
}

/** The #129 404 envelope — registered ids first (merge order), then fixtures. */
function unknownWorkspaceResponse(id: string, registeredIds: string[]): NextResponse {
  const { knownWorkspaces } = resolveScanRunWorkspace(id, WORKSPACE_IDS, registeredIds)
  return NextResponse.json(
    { error: `unknown workspace '${id}'`, knownWorkspaces },
    { status: 404 },
  )
}

/**
 * Issue #140 — the named 400 for an absent/empty workspace id (query param
 * `ws` on GET, body field `workspaceId` on POST). Same guidance envelope as
 * the 404 family: the full registry, registered ids first (AUD-14 merge
 * order). `''` counts as missing (#140: empty = absent — the old
 * `raw ?? default` readers served a phantom `""` workspace instead).
 */
function missingWorkspaceResponse(param: 'ws' | 'workspaceId', registeredIds: string[]): NextResponse {
  return NextResponse.json(
    {
      error:
        param === 'ws'
          ? 'workspace param is required — pass ?ws=<workspace id> (alias: ?workspace=)'
          : 'workspaceId is required — a run must name the workspace it belongs to',
      knownWorkspaces: [...registeredIds, ...WORKSPACE_IDS],
    },
    { status: 400 },
  )
}

/**
 * AUD-14 resolution, shared by GET (param) and POST (body):
 *   - a known fixture id needs no db round-trip;
 *   - otherwise the registered ids are fetched and the decision is made by
 *     the pure `resolveScanRunWorkspace` (registered-workspace.ts);
 *   - a registered-shaped id with the store down → 503 (never a fake 404);
 *   - a truly-unknown id → the #129 404 envelope.
 * Returns the resolved workspace id, or the pre-built error response.
 */
async function resolveScanWorkspaceId(raw: string): Promise<{ ws: string } | { error: NextResponse }> {
  if (WORKSPACE_IDS.includes(raw)) return { ws: raw }
  const prefixShaped = isRegisteredWorkspaceId(raw)
  const registeredIds = await registeredWorkspaceIds()
  if (registeredIds === null) {
    if (prefixShaped) {
      return { error: NextResponse.json({ error: REGISTERED_STORE_UNAVAILABLE }, { status: 503 }) }
    }
    // no prefix ⇒ can never be registered ⇒ the 404 is exact even store-down
    return { error: unknownWorkspaceResponse(raw, []) }
  }
  const { known } = resolveScanRunWorkspace(raw, WORKSPACE_IDS, registeredIds)
  if (known) return { ws: raw }
  return { error: unknownWorkspaceResponse(raw, registeredIds) }
}

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
  /** Issue #128 — `true` when the run replayed the stored report (no engine invocation). */
  replay?: boolean
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
  replay: boolean
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
  // Issue #128: the replay marker comes back verbatim — runs synced before
  // the field existed (or persisted during the pre-regeneration fallback
  // below) omit the key entirely rather than claiming a false negative.
  if (r.replay) dto.replay = true
  return dto
}

/* ------------------------------------------------------------------ GET --- */

export async function GET(req: NextRequest) {
  const raw = workspaceParam(req)
  if (raw === null || raw === '') {
    // Issue #140: a missing/empty param is a named 400 — never a
    // default-workspace substitution and never a phantom `""` DB query
    // (the old `raw ?? WORKSPACES_DEFAULT` served workspace:"" for ?ws=).
    const registeredIds = await registeredWorkspaceIds()
    return missingWorkspaceResponse('ws', registeredIds ?? [])
  }
  const resolved = await resolveScanWorkspaceId(raw)
  if ('error' in resolved) return resolved.error
  const ws = resolved.ws

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

export const POST = withNoStore(async function POST(req: NextRequest) {
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
  if (workspaceId === undefined || workspaceId === '') {
    // Issue #140: a MISSING id is a client input error (named 400), not an
    // unknown-workspace lookup — the old path answered 404 with the
    // meaningless `unknown workspace 'undefined'` (String(undefined)).
    const registeredIds = await registeredWorkspaceIds()
    return missingWorkspaceResponse('workspaceId', registeredIds ?? [])
  }
  if (typeof workspaceId !== 'string') {
    return NextResponse.json(
      { error: `unknown workspace '${String(workspaceId)}'`, knownWorkspaces: WORKSPACE_IDS },
      { status: 404 },
    )
  }
  if (!WORKSPACE_IDS.includes(workspaceId)) {
    const resolved = await resolveScanWorkspaceId(workspaceId)
    if ('error' in resolved) return resolved.error
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
  const { findingIds, findingIdsTruncated, replay } = body as {
    findingIds?: unknown
    findingIdsTruncated?: unknown
    replay?: unknown
  }
  if (findingIds !== undefined && !isValidFindingIdList(findingIds)) {
    return bad(
      `findingIds must be an array of finding-id strings (≤96 chars each, max ${FINDING_IDS_CAP} entries)`,
    )
  }
  if (findingIdsTruncated !== undefined && typeof findingIdsTruncated !== 'boolean') {
    return bad('findingIdsTruncated must be a boolean')
  }
  // Issue #128 — the replay marker: optional boolean, persisted verbatim. The
  // server NEVER derives or second-guesses it: a replay run is exactly what
  // the client says it replayed (Gate 21).
  if (replay !== undefined && typeof replay !== 'boolean') {
    return bad('replay must be a boolean')
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
    replay: replay === true,
  }

  try {
    const row = await db.scanRun.upsert({
      where: { id: runId },
      update: values,
      create: { id: runId, ...values },
    })
    return NextResponse.json({ schema: SCHEMA, run: toDto(row) }, { status: 201 })
  } catch (err) {
    // Issue #128 degraded mode: a deployed Prisma client predating the
    // additive `replay` column rejects the unknown key. The run itself is
    // still measured data worth persisting — retry WITHOUT the marker rather
    // than dropping the run; the key is simply absent from that row (the DTO
    // omits it, no false replay/fail claim anywhere).
    const msg = err instanceof Error ? err.message : String(err)
    if (replay === true && msg.includes('Unknown argument')) {
      try {
        const { replay: _omitted, ...legacyValues } = values
        const row = await db.scanRun.upsert({
          where: { id: runId },
          update: legacyValues,
          create: { id: runId, ...legacyValues },
        })
        console.warn(
          '[scan-runs] persisted WITHOUT the replay marker — Prisma client predates the column; run `prisma generate` post-merge',
        )
        return NextResponse.json({ schema: SCHEMA, run: toDto(row) }, { status: 201 })
      } catch (retryErr) {
        console.error('[scan-runs] POST (legacy retry) failed:', retryErr)
      }
    } else {
      console.error('[scan-runs] POST failed:', err)
    }
    return NextResponse.json(
      { error: 'scan-run store unavailable — the run was NOT persisted (the browser-local log is unaffected)' },
      { status: 503 },
    )
  }
})

/** GET + POST implemented; everything else → 405 with `Allow: GET, POST`. */
export const PUT = () => methodNotAllowed('GET, POST')
export const DELETE = () => methodNotAllowed('GET, POST')
export const PATCH = () => methodNotAllowed('GET, POST')
