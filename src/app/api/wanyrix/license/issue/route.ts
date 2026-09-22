import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { DEFAULT_MAX_BUFFER, execEngine } from '@/lib/wanyrix/engine-exec'
import {
  engineTimeoutResponse,
  probeBinary,
  schemaMismatchResponse,
  unparseableResponse,
} from '@/lib/wanyrix/engine-surface'
import {
  ACTIVATION_HINT,
  ISSUE_ROUTE_SCHEMA,
  TOKEN_SCHEMA,
  issueArgsFor,
  issueHonestyFor,
  parseIssuePlan,
  parseSeats,
  validateTeamId,
} from '@/lib/wanyrix/license'
import { notAllowedOnPostOnly } from '@/lib/wanyrix/api'

/**
 * Sandbox license issuer — `POST /api/wanyrix/license/issue` (issue #94 E1).
 *
 * Wraps the REAL engine binary's `wanyrix license issue … --json` and returns
 * the engine-issued signed token VERBATIM (parsed only to validate the
 * `wanyrix.entitlement.token/v1` envelope schema) plus the honesty label —
 * the same verbatim-passthrough discipline as the #69/#91 exec routes.
 *
 * Honesty contract (this route NEVER fakes a payment):
 *   - the issuer only exists when the operator configured the dev signing
 *     key via `WANYRIX_SIGNING_KEY` (path to the hex ed25519 private key —
 *     the same env documented in engine/src/entitlement.rs). Without it the
 *     route answers an honest 503 — it does not simulate a license.
 *   - every issued token carries `honesty.label = "estimated"`: sandbox-local
 *     issuance, no payment method, no charge, never a real purchase.
 *   - no private key is ever committed to the repository; operators mint one
 *     with `wanyrix license keygen` into an out-of-repo directory.
 *
 * Request (JSON body): `{ plan: 'team' | 'trial', team: string, seats?: number }`
 *   - `plan ∈ {team, trial}` — unknown values are a named 400 (the engine
 *     itself refuses `free` — the free tier needs no license — and the
 *     sandbox deliberately does not mint `enterprise`, which belongs to the
 *     on-prem entitlement server, roadmap #66);
 *   - `team` — 1..=128 chars after trim, sane identifier charset (400 on
 *     violation; the engine independently enforces its own limits);
 *   - `seats` — optional integer 1..=100000 (defaults to the engine's 5).
 *
 * No workspace parameter exists on this surface: it is a web-only platform
 * feature (see docs/CLI.md "Web-only surfaces"), so the family's 404-for-
 * unknown-workspace case has no counterpart here; 404 remains the router's
 * answer for unknown license paths (e.g. `/api/wanyrix/license/renew` —
 * there is no renewal until a payment backend exists, and none is faked).
 *
 * Error contract: 400 bad/missing plan|team|seats or non-JSON body · 405
 * wrong method (`Allow: POST`) · 503 honest "issuer not configured" (env
 * missing or key file unreadable) and binary-missing (checked list + build
 * hint, family shape) · 502 engine exit (stderr verbatim in `detail`) ·
 * 502 unparseable/schema mismatch · 504 timeout.
 */

export async function POST(req: NextRequest) {
  const startedAt = Date.now()

  /* ---- request validation (named 400s, never silent coercion) ---------- */
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'request body is not valid JSON — expected { plan, team, seats? }' },
      { status: 400 },
    )
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'request body must be a JSON object: { plan, team, seats? }' },
      { status: 400 },
    )
  }
  const { plan: rawPlan, team: rawTeam, seats: rawSeats } = body as Record<string, unknown>

  const plan = parseIssuePlan(rawPlan)
  if (!plan) {
    return NextResponse.json(
      {
        error: `unknown plan ${JSON.stringify(rawPlan ?? null)} — the sandbox issuer mints 'team' (full Team tier) or 'trial' (14 days, no payment method); 'free' is never issued (it needs no license) and 'enterprise' is issued by the on-prem entitlement server at release (roadmap #66)`,
      },
      { status: 400 },
    )
  }

  const team = validateTeamId(rawTeam)
  if (!team) {
    return NextResponse.json(
      {
        error:
          'team must be a non-empty identifier of at most 128 characters (alphanumerics plus . _ + - and spaces)',
      },
      { status: 400 },
    )
  }

  const seats = parseSeats(rawSeats)
  if (!seats) {
    return NextResponse.json(
      { error: 'seats must be an integer within 1..=100000 when provided' },
      { status: 400 },
    )
  }

  /* ---- issuer configuration (honest 503 — never a simulated license) --- */
  const signingKey = process.env.WANYRIX_SIGNING_KEY?.trim()
  if (!signingKey) {
    return NextResponse.json(
      {
        error:
          'sandbox license issuer is not configured — WANYRIX_SIGNING_KEY is not set, so no license can be issued (issuance is never simulated)',
        env: 'WANYRIX_SIGNING_KEY',
        hint: 'mint a dev keypair out-of-repo with `wanyrix license keygen --out <dir>` and point WANYRIX_SIGNING_KEY at wanyrix-license-priv.hex; the engine independently verifies tokens offline on activation',
      },
      { status: 503 },
    )
  }
  try {
    await access(signingKey, constants.R_OK)
  } catch {
    return NextResponse.json(
      {
        error: `WANYRIX_SIGNING_KEY points at an unreadable signing key file (${signingKey}) — the issuer refuses to guess`,
        env: 'WANYRIX_SIGNING_KEY',
        hint: 'regenerate with `wanyrix license keygen --out <dir>` (existing keys are never overwritten)',
      },
      { status: 503 },
    )
  }

  /* ---- real engine execution (family plumbing) ------------------------- */
  const probed = await probeBinary()
  if (probed instanceof NextResponse) return probed
  const { binary, version } = probed

  const run = await execEngine(issueArgsFor(plan, team, signingKey, seats), undefined, DEFAULT_MAX_BUFFER)
  if (run.killed) return engineTimeoutResponse()
  if (run.code !== undefined) {
    return NextResponse.json(
      {
        error: `license issue failed — engine exited with ${run.code}`,
        detail: run.stderr.slice(0, 400),
      },
      { status: 502 },
    )
  }

  let token: unknown
  try {
    token = JSON.parse(run.stdout)
  } catch (parseError) {
    return unparseableResponse(parseError)
  }
  if (
    typeof token !== 'object' ||
    token === null ||
    Array.isArray(token) ||
    (token as { schema?: unknown }).schema !== TOKEN_SCHEMA
  ) {
    return schemaMismatchResponse(TOKEN_SCHEMA, token)
  }

  return NextResponse.json({
    schema: ISSUE_ROUTE_SCHEMA,
    surface: 'license.issue',
    executedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    binary: { version, profile: binary.profile },
    /** The engine-issued signed token, VERBATIM (parsed only for the schema check). */
    token,
    honesty: issueHonestyFor(plan),
    activation: {
      hint: ACTIVATION_HINT,
      network: 'none — activation is 100% offline (issue #94 E2/E3); zero sockets are opened',
    },
  })
}

/** POST only — issuance is a mutating act; everything else → 405 with `Allow: POST` (ENG-TCA-6a). */
export const GET = notAllowedOnPostOnly.GET
export const PUT = notAllowedOnPostOnly.PUT
export const DELETE = notAllowedOnPostOnly.DELETE
export const PATCH = notAllowedOnPostOnly.PATCH
