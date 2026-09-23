import { NextRequest, NextResponse } from 'next/server'
import { WORKSPACES } from './data'

/**
 * Shared API-route contract helpers.
 *
 * ENG-TCA-1: workspace-scoped routes MUST NOT silently substitute the default
 * workspace for an unknown/misspelled workspace parameter. Every fixture-scoped
 * route resolves the param through `workspaceGuard` below, which validates
 * against the SAME registry the /api/wanyrix/workspaces route serves.
 *
 * Issue #129 — ONE param contract across every ws-scoped surface:
 *   - both spellings are accepted everywhere: `?ws=<id>` (canonical) and
 *     `?workspace=<id>` (documented alias);
 *   - `workspaceParam` is the single reader — no route may call
 *     `searchParams.get('ws' | 'workspace')` on its own;
 *   - an unknown id under EITHER spelling ⇒ the established 404 envelope
 *     `{ error, knownWorkspaces }` — never default-workspace data.
 *
 * Issue #140 — the param is now REQUIRED on workspace-scoped routes: an
 * absent OR empty (`?ws=`) value is a named 400 `{ error, knownWorkspaces }`
 * (the same contract family as the unknown-name 404), never a silent
 * substitution of the registry default and never a phantom `""` workspace.
 * `raw ?? default` missed `''` (nullish ≠ falsy), which served fixture data
 * under the bogus id `""` (report artifacts named `wanyrix-report--*.json`).
 * The engine-EXEC family (git / what-changed / export / engine/doctor /
 * engine/impact) keeps its documented optional-`workspace` dogfood contract —
 * there the param selects a REGISTERED scan target and already treats `''`
 * as absent (engine-surface.ts), so it does not go through resolveWorkspace.
 */

/** The known workspace ids — same source the workspaces route serves. */
export const WORKSPACE_IDS: string[] = WORKSPACES.map((w) => w.id)

/**
 * Returns a ready-to-send 404 response when `raw` names an unknown workspace,
 * or null when the request may proceed.
 *
 * - `null`/`''` → null (param absent or empty — the MISSING-PARAM decision
 *   belongs to `resolveWorkspace`, which answers the #140 named 400)
 * - known id    → null
 * - anything else → 404 JSON `{ error, knownWorkspaces }`
 */
export function workspaceGuard(raw: string | null): NextResponse | null {
  if (raw === null || raw === '') return null
  if (WORKSPACE_IDS.includes(raw)) return null
  return NextResponse.json(
    {
      error: `unknown workspace '${raw}'`,
      knownWorkspaces: WORKSPACE_IDS,
    },
    { status: 404 },
  )
}

/**
 * Issue #140 — the named 400 for an absent/empty `ws`/`workspace` param on a
 * workspace-scoped route. Same envelope family as the unknown-name 404
 * (`{ error, knownWorkspaces }`); the message names the fix (pass `?ws=<id>`)
 * instead of silently serving the registry default or a phantom `""`.
 */
export function workspaceRequiredResponse(): NextResponse {
  return NextResponse.json(
    {
      error: 'workspace param is required — pass ?ws=<workspace id> (alias: ?workspace=)',
      knownWorkspaces: WORKSPACE_IDS,
    },
    { status: 400 },
  )
}

/**
 * THE workspace-param reader (issue #129): accepts both spellings on every
 * ws-scoped route, `ws` first. If both are present, `ws` wins (documented in
 * docs/ARCHITECTURE.md — the fixture routes have always been `ws`-scoped, so
 * it is the canonical spelling; `workspace` is the accepted alias).
 *
 * Returns null when neither spelling is present (the caller applies its
 * default — empty = absent, ENG-TCA-1).
 */
export function workspaceParam(req: NextRequest): string | null {
  return req.nextUrl.searchParams.get('ws') ?? req.nextUrl.searchParams.get('workspace')
}

/**
 * Resolves the effective workspace for a request (issue #140 contract):
 *   - absent/empty `ws`/`workspace` ⇒ named 400 (`workspaceRequiredResponse`)
 *     — the param is REQUIRED; the registry default is never substituted
 *     silently and a phantom `""` id can never reach a payload;
 *   - an explicit id is validated (404 on unknown under EITHER spelling —
 *     see workspaceGuard);
 *   - a known id resolves to itself.
 *
 * Throws never; returns `{ ws, error }` where `error` is a pre-built 400/404
 * response the route must return verbatim.
 */
export function resolveWorkspace(req: NextRequest): { ws: string; error: NextResponse | null } {
  const raw = workspaceParam(req)
  if (raw === null || raw === '') return { ws: '', error: workspaceRequiredResponse() }
  const error = workspaceGuard(raw)
  if (error) return { ws: '', error }
  return { ws: raw, error: null }
}

/**
 * Issue #140 — allowlist for request params that reach ENGINE ARGV (today:
 * `?crate=` on GET /api/wanyrix/engine/impact → `wanyrix impact --crate …`).
 * Cargo crate names are `[A-Za-z0-9_-]+`, ≤64 chars (the crates.io name cap);
 * anything else is refused with a named 400 BEFORE the binary spawns, so
 * whitespace, unicode and oversized junk never produce 502 clap noise (they
 * were safe inside the execFile args array — no shell — but the error
 * contract belongs to the web layer, not to an engine exit code).
 *
 * NOTE: the charset alone admits `--version` (hyphens are legal INSIDE crate
 * names), so the #140 acceptance criterion (`?crate=--version → 400`) adds
 * the flag-guard below: a value may not START with `-` — a leading-dash
 * token is an argv flag, never a crate name. All three rules live in
 * {@link isValidCrateParam}.
 */
export const CRATE_PARAM_PATTERN = /^[A-Za-z0-9_-]+$/

/** Issue #140 — the argv-flag guard on top of the charset allowlist. */
export const CRATE_PARAM_FLAG_GUARD = /^[^-]/

/** crates.io crate-name cap — also rejects absurd 10k-char junk cheaply. */
export const CRATE_PARAM_MAX_LENGTH = 64

export function isValidCrateParam(crate: string): boolean {
  return (
    crate.length <= CRATE_PARAM_MAX_LENGTH &&
    CRATE_PARAM_PATTERN.test(crate) &&
    CRATE_PARAM_FLAG_GUARD.test(crate)
  )
}

/**
 * ENG-TCA-6a — 405 Method Not Allowed WITH the RFC 9110 §10.2.2 `Allow`
 * header, so consumers can discover the supported methods. Routes export this
 * for every method they do not implement.
 */
export function methodNotAllowed(allow: string): NextResponse {
  return NextResponse.json(
    { error: `method not allowed — allowed: ${allow}` },
    { status: 405, headers: { Allow: allow } },
  )
}

/** 405 handler factory for GET-only routes. */
export const notAllowedOnGetOnly = {
  POST: () => methodNotAllowed('GET'),
  PUT: () => methodNotAllowed('GET'),
  DELETE: () => methodNotAllowed('GET'),
  PATCH: () => methodNotAllowed('GET'),
}

/** 405 handler factory for POST-only routes. */
export const notAllowedOnPostOnly = {
  GET: () => methodNotAllowed('POST'),
  PUT: () => methodNotAllowed('POST'),
  DELETE: () => methodNotAllowed('POST'),
  PATCH: () => methodNotAllowed('POST'),
}
