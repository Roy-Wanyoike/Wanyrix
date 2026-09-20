/**
 * Shared real-exec plumbing for the engine routes (Task 2-b).
 *
 * Extracted verbatim from src/app/api/wanyrix/engine/doctor/route.ts (and
 * its build-route twin) so every surface that spawns the REAL `wanyrix`
 * binary shares ONE candidate list, ONE timeout/buffer discipline and ONE
 * exec path. Security invariants (mandatory):
 *   - user input NEVER passes through a shell — `execFile` with an args
 *     array only (no string commands, no shell interpolation);
 *   - output buffers are capped (4 MB default — 16 MB for the build route
 *     which streams per-artifact events);
 *   - every spawn carries a timeout so a hung engine cannot pin the route.
 */

import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Repo-root-relative engine crate dir — also the default scan target (dogfood). */
export const ENGINE_DIR = path.join(process.cwd(), 'engine')

/** Default exec discipline for doctor/graph-style spawns (doctor-route constants). */
export const EXEC_TIMEOUT_MS = 20_000
export const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024

/** Binary candidates in preference order (profile label → path). */
export const ENGINE_BINARY_CANDIDATES: { profile: 'debug' | 'release'; file: string }[] = [
  { profile: 'release', file: path.join(ENGINE_DIR, 'target', 'release', 'wanyrix') },
  { profile: 'debug', file: path.join(ENGINE_DIR, 'target', 'debug', 'wanyrix') },
]

/** The checked paths in the 503 payload — repo-root-relative, same as before. */
export function checkedBinaryPaths(): string[] {
  return ENGINE_BINARY_CANDIDATES.map((c) => path.relative(process.cwd(), c.file))
}

export type EngineBinary = { profile: 'debug' | 'release'; file: string }

/**
 * First executable binary among the candidates (release, then debug), or
 * null when the engine has not been built on this machine — callers map
 * null to the honest 503 with `checked` + build hint.
 */
export async function resolveEngineBinary(): Promise<EngineBinary | null> {
  for (const candidate of ENGINE_BINARY_CANDIDATES) {
    try {
      await access(candidate.file, constants.X_OK)
      return candidate
    } catch {
      // try the next profile
    }
  }
  return null
}

/** Result of one engine spawn. On failure stdout is empty and code/killed explain why. */
export interface EngineExecResult {
  stdout: string
  stderr: string
  /** exit code when the binary ran and exited non-zero (or a spawn error code like ENOENT) */
  code?: number | string
  /** true when the process was killed by the timeout */
  killed?: boolean
}

/**
 * One REAL engine spawn — `execFile(binary, args)` with a hard timeout and a
 * capped output buffer. Never throws for process failure: a non-zero exit or
 * a timeout is returned as `{ stdout: '', stderr, code?, killed? }` so every
 * route keeps its own named error mapping. Only a missing binary throws
 * ({@link EngineBinaryMissingError}) — resolve it up front for the 503 path.
 */
export async function execEngine(
  args: string[],
  timeoutMs: number = EXEC_TIMEOUT_MS,
  maxBuffer: number = DEFAULT_MAX_BUFFER,
): Promise<EngineExecResult> {
  const binary = await resolveEngineBinary()
  if (!binary) throw new EngineBinaryMissingError()
  try {
    const run = await execFileAsync(binary.file, args, { timeout: timeoutMs, maxBuffer })
    return { stdout: run.stdout, stderr: run.stderr ?? '' }
  } catch (err) {
    const e = err as { code?: number | string; killed?: boolean; message?: string; stderr?: string }
    return {
      stdout: '',
      stderr: e.stderr ?? e.message ?? '',
      code: e.code ?? undefined,
      killed: e.killed === true ? true : undefined,
    }
  }
}

/**
 * Thrown by {@link execEngine} only when no engine binary exists. Routes
 * normally pre-resolve (for the 503 `checked` list); this guards the
 * resolve→exec race so a binary vanishing mid-request is still honest.
 */
export class EngineBinaryMissingError extends Error {
  readonly checked: string[]
  constructor() {
    super('engine binary not found on this machine — the real execution surface is unavailable')
    this.name = 'EngineBinaryMissingError'
    this.checked = checkedBinaryPaths()
  }
}
