import { NextRequest, NextResponse } from 'next/server'
import { readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { getWorkspaces } from '@/lib/wanyrix/data'
import { methodNotAllowed } from '@/lib/wanyrix/api'
import { db } from '@/lib/db'
import {
  checkedBinaryPaths,
  execEngine,
  resolveEngineBinary,
} from '@/lib/wanyrix/engine-exec'
import {
  configuredWorkspaceRoots,
  hasRustProjectMarker,
  NOT_A_CONNECTABLE_PROJECT_REFUSAL,
  rustMarkerEntries,
  validateRegistrationPath,
  workspaceIdFor,
} from '@/lib/wanyrix/register'
import type { RegisteredWorkspace } from '@prisma/client'
import type { RegisteredWorkspaceSummary } from '@/lib/wanyrix/types'

/**
 * Workspace registry — demo fixtures + the REAL registration bridge (2-b).
 *
 * GET  /api/wanyrix/workspaces          → the demo registry + `registered`
 *   + fixture marking (issue #129): every demo entry carries
 *   `fixtureOnly: true` (web-demo data only — the engine-exec routes 404
 *   these ids: they have no executable scan target), every registered row
 *   `fixtureOnly: false`, and `execCapableIds` lists the ids the exec
 *   surfaces (engine/doctor, engine/impact, git, what-changed, export)
 *   can actually scan. Empty `execCapableIds` = nothing connected yet;
 *   engine-exec routes still serve a bare request (the repo engine crate
 *   dogfood target).
 *
 * POST /api/wanyrix/workspaces { path } → connect a local project:
 *   1. validate the path (absolute, exists, is a directory) then CONFINE it
 *      to the approved workspace roots (QA-3-B-2): the realpath-resolved
 *      candidate must sit inside `WANYRIX_WORKSPACE_ROOTS` (default: this
 *      repo's `engine/` and `fixtures/` directories plus the system temp
 *      dir). Outside roots → `400` with ONE generic refusal — no resolved
 *      path, no existence information (the host-wide existence/type oracle
 *      dies here). A contained candidate that is simply not a scannable Rust
 *      project (missing / not a directory / no marker) → `404` with ONE
 *      shared message; the specific reason goes to the server log only.
 *   2. require a Rust project marker (Cargo.toml / .wanyrix)  → 404 otherwise
 *   3. resolve the real engine binary                          → 503 otherwise
 *   4. run the REAL engine (doctor + graph, 20s each) against the path
 *      → 502 named `{ error, detail }` on failure; NOTHING is stored
 *   5. upsert a RegisteredWorkspace row keyed by a deterministic id
 *      (`ws-local-<slug>-<fnv1a8(abs path)>`) with the MEASURED counts
 *   → 200 `{ registered, workspace, verdict }`
 *
 * DELETE /api/wanyrix/workspaces?id=…   → remove one registered project.
 *
 * Security: user input never passes through a shell (execFile + args array
 * only), only validated + root-confined absolute paths are scanned, output
 * buffers are capped, and every spawn carries a timeout. Later scans
 * (engine/doctor `?workspace=`) only ever run paths stored in the DB here.
 * Response bodies never echo the resolved candidate path (QA-3-B-2 AC 1).
 *
 * Error contract: 400 malformed input / outside the allowed workspace roots ·
 * 404 no scannable Rust project directory at a CONTAINED path (one shared
 * message) / unknown id · 503 engine binary missing or store unavailable ·
 * 502 engine failure · 405 wrong methods carry `Allow: GET, POST, DELETE`.
 */

/** Wire shape of one registered workspace (mirrors the Prisma row). */
function toDto(r: RegisteredWorkspace): RegisteredWorkspaceSummary {
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    registeredAt: r.registeredAt.toISOString(),
    lastCheckedAt: r.lastCheckedAt.toISOString(),
    lastStatus: r.lastStatus as RegisteredWorkspaceSummary['lastStatus'],
    crates: r.crates,
    edges: r.edges,
    findings: r.findings,
    critical: r.critical,
    warning: r.warning,
    info: r.info,
    toolchain: r.toolchain,
    // issue #129: registered rows ARE exec-capable (unlike the demo fixtures)
    fixtureOnly: false,
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Response used for BOTH the pre-resolve 503 and a mid-request race. */
function binaryMissingResponse(): NextResponse {
  return NextResponse.json(
    {
      error: 'engine binary not found on this machine — the real execution surface is unavailable',
      checked: checkedBinaryPaths(),
      hint: 'build it: cd engine && cargo build --locked (see docs/DEVELOPMENT.md)',
    },
    { status: 503 },
  )
}

/* ------------------------------------------------------------------ GET --- */

export async function GET(_req: NextRequest) {
  let rows: RegisteredWorkspace[] = []
  try {
    rows = await db.registeredWorkspace.findMany({ orderBy: { registeredAt: 'asc' } })
  } catch (err) {
    console.error('[workspaces] GET failed:', err)
    return NextResponse.json(
      { error: 'registered-workspace store unavailable — registered projects are not listed right now' },
      { status: 503 },
    )
  }
  const demo = getWorkspaces()
  return NextResponse.json({
    workspaces: demo.workspaces.map((w) => ({ ...w, fixtureOnly: true })),
    default: demo.default,
    registered: rows.map((r) => ({ ...toDto(r), fixtureOnly: false })),
    execCapableIds: rows.map((r) => r.id),
  })
}

/* ----------------------------------------------------------------- POST --- */

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'malformed JSON body' }, { status: 400 })
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
  }
  const { path: rawPath } = body
  if (typeof rawPath !== 'string') {
    return NextResponse.json(
      { error: "path is required — POST { \"path\": \"/absolute/path/to/your/rust/project\" }" },
      { status: 400 },
    )
  }

  /* 1 — validate the candidate path, then CONFINE it to the approved roots
   * (QA-3-B-2). The `next dev` server runs from the repo root, so
   * process.cwd() is the repo root for the default-roots computation. */
  const roots = configuredWorkspaceRoots(process.env.WANYRIX_WORKSPACE_ROOTS, process.cwd())
  const check = await validateRegistrationPath(rawPath, roots)
  if (!check.ok) {
    if (check.logDetail !== undefined) {
      // The SPECIFIC reason stays server-side only — response differentials
      // must not enumerate the filesystem (QA-3-B-2).
      console.warn('[workspaces] POST refused:', check.logDetail)
    }
    const status = check.outsideRoots || check.abs === undefined ? 400 : 404
    return NextResponse.json({ error: check.reason }, { status })
  }
  const abs = check.abs as string

  /* 2 — the directory must look like a Rust project the engine can scan.
   * Entries are TYPE-CHECKED (AUD-8): only a regular-file Cargo.toml or a
   * real .wanyrix directory counts — a planted symlink named `.wanyrix` is
   * dropped, so the marker check cannot be satisfied by an alias. */
  let dirents: Dirent[]
  try {
    dirents = await readdir(abs, { withFileTypes: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[workspaces] POST readdir failed for', abs, ':', message)
    return NextResponse.json(
      { error: 'path could not be read — registration refused' },
      { status: 502 },
    )
  }
  if (!hasRustProjectMarker(rustMarkerEntries(dirents))) {
    console.warn('[workspaces] POST refused: no Cargo.toml or .wanyrix at', abs)
    return NextResponse.json(
      { error: NOT_A_CONNECTABLE_PROJECT_REFUSAL },
      { status: 404 },
    )
  }

  /* 3 — the real binary must exist; registration never fakes a scan. */
  const binary = await resolveEngineBinary()
  if (!binary) return binaryMissingResponse()

  /* Engine version for the verdict — a failed probe degrades to 'unknown'. */
  let engineVersion = 'unknown'
  const versionRun = await execEngine(['--version'])
  if (!versionRun.killed && versionRun.code === undefined) {
    const trimmed = versionRun.stdout.trim()
    if (trimmed.length > 0) engineVersion = trimmed
  }

  /* 4a — REAL doctor scan. */
  const doctorRun = await execEngine(['doctor', '--path', abs, '--json'])
  if (doctorRun.killed) {
    return NextResponse.json(
      { error: 'engine doctor did not finish within 20s — registration refused (nothing stored)' },
      { status: 502 },
    )
  }
  if (doctorRun.code !== undefined) {
    return NextResponse.json(
      {
        error: `engine doctor exited with ${doctorRun.code ?? 'non-zero'} — registration refused (nothing stored)`,
        detail: doctorRun.stderr.slice(0, 400),
      },
      { status: 502 },
    )
  }

  let doctor: {
    schema?: unknown
    workspace?: unknown
    toolchain?: unknown
    crates?: unknown
    summary?: { critical?: unknown; warning?: unknown; info?: unknown; total?: unknown }
  }
  try {
    doctor = JSON.parse(doctorRun.stdout)
  } catch (parseError) {
    return NextResponse.json(
      {
        error: 'engine emitted unparseable JSON — registration refused (nothing stored)',
        detail: parseError instanceof Error ? parseError.message.slice(0, 200) : String(parseError),
      },
      { status: 502 },
    )
  }
  if (doctor.schema !== 'wanyrix.doctor/v1') {
    return NextResponse.json(
      {
        error: 'engine output is not a wanyrix.doctor/v1 envelope — registration refused (nothing stored)',
        detail: `got: ${String(doctor.schema ?? '<no schema>')}`,
      },
      { status: 502 },
    )
  }

  /* 5a — extract the MEASURED doctor numbers (never invented). */
  const name =
    typeof doctor.workspace === 'string' && doctor.workspace.length > 0
      ? doctor.workspace
      : path.basename(abs)
  const toolchain = typeof doctor.toolchain === 'string' && doctor.toolchain.length > 0 ? doctor.toolchain : 'unknown'
  const crates = Array.isArray(doctor.crates) ? doctor.crates.length : 0
  const summary = doctor.summary ?? {}
  const critical = typeof summary.critical === 'number' ? summary.critical : 0
  const warning = typeof summary.warning === 'number' ? summary.warning : 0
  const info = typeof summary.info === 'number' ? summary.info : 0
  const findings = typeof summary.total === 'number' ? summary.total : critical + warning + info

  /* 4b — REAL graph scan (same guards; both must succeed before any write). */
  const graphRun = await execEngine(['graph', '--path', abs, '--json'])
  if (graphRun.killed) {
    return NextResponse.json(
      { error: 'engine graph did not finish within 20s — registration refused (nothing stored)' },
      { status: 502 },
    )
  }
  if (graphRun.code !== undefined) {
    return NextResponse.json(
      {
        error: `engine graph exited with ${graphRun.code ?? 'non-zero'} — registration refused (nothing stored)`,
        detail: graphRun.stderr.slice(0, 400),
      },
      { status: 502 },
    )
  }

  let graph: { schema?: unknown; edges?: unknown; meta?: { totalEdges?: unknown } }
  try {
    graph = JSON.parse(graphRun.stdout)
  } catch (parseError) {
    return NextResponse.json(
      {
        error: 'engine emitted unparseable JSON — registration refused (nothing stored)',
        detail: parseError instanceof Error ? parseError.message.slice(0, 200) : String(parseError),
      },
      { status: 502 },
    )
  }
  if (graph.schema !== 'wanyrix.graph/v1') {
    return NextResponse.json(
      {
        error: 'engine output is not a wanyrix.graph/v1 envelope — registration refused (nothing stored)',
        detail: `got: ${String(graph.schema ?? '<no schema>')}`,
      },
      { status: 502 },
    )
  }

  /* 5b — measured edge aggregate: the envelope's own `meta.totalEdges`
     (graph.rs precomputes it from the served edge list); the length of the
     served `edges` array is the honest fallback. */
  const edges =
    typeof graph.meta?.totalEdges === 'number'
      ? graph.meta.totalEdges
      : Array.isArray(graph.edges)
        ? graph.edges.length
        : 0

  /* 6 — upsert by deterministic id; registration is idempotent per path. */
  const id = workspaceIdFor(abs, name)
  const now = new Date()
  const values = {
    name,
    path: abs,
    lastCheckedAt: now,
    lastStatus: 'ok',
    crates,
    edges,
    findings,
    critical,
    warning,
    info,
    toolchain,
  }

  try {
    const row = await db.registeredWorkspace.upsert({
      where: { id },
      update: values,
      create: { id, ...values },
    })
    return NextResponse.json({
      registered: true,
      workspace: toDto(row),
      verdict: { crates, edges, critical, warning, info, findings, toolchain, engineVersion },
    })
  } catch (err) {
    console.error('[workspaces] POST upsert failed:', err)
    return NextResponse.json(
      { error: 'registered-workspace store unavailable — the engine ran, but nothing was persisted' },
      { status: 503 },
    )
  }
}

/* --------------------------------------------------------------- DELETE --- */

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (id === null || id === '') {
    return NextResponse.json(
      { error: 'id search parameter is required — pass the id of the registered workspace to remove' },
      { status: 400 },
    )
  }
  try {
    const result = await db.registeredWorkspace.deleteMany({ where: { id } })
    if (result.count === 0) {
      return NextResponse.json({ error: `no registered workspace with id ${id}` }, { status: 404 })
    }
    return NextResponse.json({ unregistered: true, id })
  } catch (err) {
    console.error('[workspaces] DELETE failed:', err)
    return NextResponse.json(
      { error: 'registered-workspace store unavailable — nothing was deleted' },
      { status: 503 },
    )
  }
}

/** GET + POST + DELETE implemented; everything else → 405 with `Allow`. */
export const PUT = () => methodNotAllowed('GET, POST, DELETE')
export const PATCH = () => methodNotAllowed('GET, POST, DELETE')
