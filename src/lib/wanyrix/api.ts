import { NextRequest, NextResponse } from 'next/server'
import { WORKSPACES, WORKSPACES_DEFAULT } from './data'

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
 */

/** The known workspace ids — same source the workspaces route serves. */
export const WORKSPACE_IDS: string[] = WORKSPACES.map((w) => w.id)

/**
 * Returns a ready-to-send 404 response when `raw` names an unknown workspace,
 * or null when the request may proceed.
 *
 * - `null`/`''` → null (param absent or empty → the caller applies the
 *   registry default; the UI always sends an explicit id, humans may omit it)
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
 * Resolves the effective workspace for a request: validates an explicit
 * `ws`/`workspace` param (404 on unknown under EITHER spelling — see
 * workspaceGuard) and falls back to the registry default when both are
 * absent/empty.
 *
 * Throws never; returns `{ ws, error }` where `error` is a pre-built 404
 * response the route must return verbatim.
 */
export function resolveWorkspace(req: NextRequest): { ws: string; error: NextResponse | null } {
  const raw = workspaceParam(req)
  const error = workspaceGuard(raw)
  if (error) return { ws: '', error }
  return { ws: raw ?? WORKSPACES_DEFAULT, error: null }
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
