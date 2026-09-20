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

import { stat } from 'node:fs/promises'
import path from 'node:path'

/** Max length of the slug segment inside a workspace id. */
const SLUG_MAX = 40

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
