/**
 * Workspace registration bridge — pure helpers (Task 2-b).
 *
 * Everything in this module is side-effect-light, deterministic and free of
 * server-only imports (no db, no next/*), so it is unit-testable directly
 * (tests/unit/register.test.ts) and reusable by both API routes and the UI.
 *
 * The deterministic id (`ws-local-<slug>-<fnv1a8(abs path)>`) makes
 * registration idempotent: re-connecting the same directory refreshes the
 * same row instead of duplicating it, and DELETE-by-id stays unambiguous.
 */

import { stat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Max length of the slug segment inside a workspace id. */
const SLUG_MAX = 40

/**
 * Every registered-workspace id starts with this prefix (QA-5-B-1): routes
 * use it as a CHEAP pre-filter before touching the registered-workspace
 * store — an id without the prefix can never be a registered row, so the
 * fixture guard answers it directly with no db round-trip.
 */
export const REGISTERED_WORKSPACE_ID_PREFIX = 'ws-local-'

/** True when an id is shaped like a registered-workspace id (prefix check). */
export function isRegisteredWorkspaceId(id: string): boolean {
  return id.startsWith(REGISTERED_WORKSPACE_ID_PREFIX)
}

/**
 * Lowercases, maps every non-[a-z0-9] run to '-', trims '-' from both ends
 * and caps at 40 chars (a cap cut may leave a trailing dash — trimmed again).
 * An empty result degrades to 'workspace' so ids are never malformed.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '')
  return slug.length > 0 ? slug : 'workspace'
}

/**
 * FNV-1a 32-bit over the UTF-8 bytes of `input`, returned as 8 lowercase
 * zero-padded hex chars. Offset basis 2166136261 (0x811c9dc5), prime
 * 16777619 (0x01000193), uint32 wraparound — `fnv1a8('') === '811c9dc5'`.
 */
export function fnv1a8(input: string): string {
  let hash = 0x811c9dc5
  const bytes = new TextEncoder().encode(input)
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * Deterministic workspace id for a registered local project: the directory
 * name (slugged) plus an 8-hex fingerprint of the CANONICAL absolute path,
 * so two checkouts of the same-named project stay distinct while one path
 * always maps to one row.
 */
export function workspaceIdFor(absPath: string, name: string): string {
  return `ws-local-${slugify(name)}-${fnv1a8(absPath)}`
}

/** Result of validating a user-supplied candidate path. */
export interface PathCheck {
  ok: boolean
  /** canonical absolute path (path.resolve of the trimmed input) — set when the path could be resolved */
  abs?: string
  /** human-named reason when ok is false */
  reason?: string
}

/**
 * Validates a raw user-supplied project path, in order:
 *   1. non-empty after trim
 *   2. absolute (relative input is rejected with a named reason — the browser
 *      cannot share a CWD with the server, so ambiguity is refused)
 *   3. exists on disk (stat)
 *   4. is a directory
 *   5. has a non-empty basename (rejects a bare filesystem root)
 *
 * Returns `abs = path.resolve(trimmed)` when the input could be resolved;
 * every failure carries a HUMAN-NAMED reason surfaced verbatim to the UI.
 */
export async function validateCandidatePath(raw: string): Promise<PathCheck> {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { ok: false, reason: 'path is empty — pass the absolute path to the project directory' }
  }
  if (!path.isAbsolute(trimmed)) {
    return {
      ok: false,
      reason: 'path is not absolute — pass the full path to the project directory (e.g. /home/you/dev/my-project)',
    }
  }

  const abs = path.resolve(trimmed)

  let st: Awaited<ReturnType<typeof stat>>
  try {
    st = await stat(abs)
  } catch {
    return { ok: false, abs, reason: 'path does not exist — nothing to scan there (check for typos)' }
  }
  if (!st.isDirectory()) {
    return { ok: false, abs, reason: 'path is not a directory — pass the project directory, not a file' }
  }
  if (path.basename(abs).length === 0) {
    return { ok: false, abs, reason: 'path has no directory name — pass the project directory itself' }
  }
  return { ok: true, abs }
}

/**
 * True when a directory listing marks the dir as a Rust project the engine
 * can scan: a `Cargo.toml` manifest, or a `.wanyrix` directory (created by
 * `wanyrix init`). Anything else is refused at registration — the engine
 * would only report zero manifests, which is data, not a connectable project.
 */
export function hasRustProjectMarker(entries: string[]): boolean {
  return entries.includes('Cargo.toml') || entries.includes('.wanyrix')
}

/* ------------------------------------------------ workspace root confinement (QA-3-B-2) --- */

/**
 * Wire-safe refusal for any candidate OUTSIDE the approved workspace roots.
 * Deliberately generic: no resolved path, no root list, and no filesystem
 * state is echoed back to an unauthenticated caller (QA-3-B-2 AC 1). It does
 * name the remedy — how to configure `WANYRIX_WORKSPACE_ROOTS`.
 */
export const ROOT_CONFINEMENT_REFUSAL =
  "path is outside the allowed workspace roots — registration is confined to approved roots (default: this repo's engine/ and fixtures/ directories plus the system temp directory); to allow another root set WANYRIX_WORKSPACE_ROOTS to a path-delimiter-separated list of absolute directories and restart the server"

/**
 * Wire-safe refusal for any candidate INSIDE the approved roots that fails
 * validation or the Rust-marker check. The three previously distinguishable
 * cases (does not exist / not a directory / no Cargo.toml or .wanyrix)
 * collapse into THIS one message so response differentials cannot enumerate
 * the filesystem (QA-3-B-2 AC 2); the specific reason moves to the server
 * log only.
 */
export const NOT_A_CONNECTABLE_PROJECT_REFUSAL =
  'no scannable Rust project directory at the submitted path — the directory must exist, be a directory, and contain Cargo.toml or .wanyrix (the specific reason is in the server log; run `wanyrix init` in the project first if it is one)'

/** Env var that overrides the default workspace roots (documented in SECURITY.md §3). */
export const WORKSPACE_ROOTS_ENV = 'WANYRIX_WORKSPACE_ROOTS'

/**
 * The approved workspace roots (QA-3-B-2).
 *
 * `WANYRIX_WORKSPACE_ROOTS` — a path-delimiter-separated list of absolute
 * directories (`:` on POSIX) — overrides the default. A set-but-unusable
 * value (only blank entries) yields an EMPTY list: a misconfiguration
 * refuses everything rather than silently falling back to the defaults.
 * When unset (or blank), the documented defaults apply: the repo's own
 * `engine/` (dogfood target) and `fixtures/` directories plus the system
 * temp dir — registration stays a no-op change for the dogfood flow.
 *
 * Pure: the env value is passed in (no `process.env` read here) so the
 * resolution is unit-testable and CWD-independent.
 */
export function configuredWorkspaceRoots(
  envValue: string | undefined,
  repoRoot: string,
): string[] {
  if (envValue === undefined || envValue.trim().length === 0) {
    return [path.join(repoRoot, 'engine'), path.join(repoRoot, 'fixtures'), tmpdir()].map((root) =>
      path.resolve(root),
    )
  }
  return envValue
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(entry))
}

/**
 * True when `abs` — symlink-resolved via `realpath` — is contained in one of
 * `roots` (each root resolved best-effort the same way). Containment is
 * decided on the REAL paths, so a symlink that resolves outside the roots is
 * refused (QA-3-B-2 symlink-escape pin). A non-existent root can contain
 * nothing; its lexical form is still compared so an empty misconfigured
 * list behaves predictably.
 */
export async function isInsideApprovedRoots(abs: string, roots: string[]): Promise<boolean> {
  let real = abs
  try {
    real = await realpath(abs)
  } catch {
    // nothing to resolve (validated candidates exist; races fall back lexical)
  }
  for (const root of roots) {
    let realRoot = root
    try {
      realRoot = await realpath(root)
    } catch {
      // non-existent root: lexical compare only
    }
    const rel = path.relative(realRoot, real)
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      return true
    }
  }
  return false
}

/** Result of the composed registration gate (validation + confinement). */
export interface RegistrationCheck extends PathCheck {
  /**
   * The SPECIFIC reason for the server log only — set exactly when the wire
   * reason was collapsed (never echoed to the caller — QA-3-B-2).
   */
  logDetail?: string
  /** True when the refusal is the root-confinement policy refusal. */
  outsideRoots?: boolean
}

/**
 * Composed registration gate. The existing `validateCandidatePath` layers
 * (trim → absolute → stat → isDirectory → basename) ALL still run; the
 * root-confinement layer is then applied to the resolved path:
 *
 *   1. input-shape failures (empty / not absolute) keep their named reasons —
 *      they probe no filesystem state, so they cannot serve as an oracle;
 *   2. a resolvable candidate OUTSIDE the approved roots → the single generic
 *      `ROOT_CONFINEMENT_REFUSAL` (no path echo, no existence information —
 *      the host-wide existence/type/oracle dies here); the specific named
 *      reason moves to `logDetail` (server log only);
 *   3. a CONTAINED candidate that fails validation → the single generic
 *      `NOT_A_CONNECTABLE_PROJECT_REFUSAL` (existence/type differentials
 *      collapse; specific reason in `logDetail`);
 *   4. a contained, valid candidate → ok with the canonical absolute path.
 */
export async function validateRegistrationPath(
  raw: string,
  roots: string[],
): Promise<RegistrationCheck> {
  const base = await validateCandidatePath(raw)
  if (base.abs === undefined) {
    return base // input-shape refusal: no filesystem state was probed
  }
  if (!(await isInsideApprovedRoots(base.abs, roots))) {
    return {
      ok: false,
      abs: base.abs,
      outsideRoots: true,
      reason: ROOT_CONFINEMENT_REFUSAL,
      logDetail: base.reason,
    }
  }
  if (!base.ok) {
    return {
      ok: false,
      abs: base.abs,
      reason: NOT_A_CONNECTABLE_PROJECT_REFUSAL,
      logDetail: base.reason,
    }
  }
  return base
}
