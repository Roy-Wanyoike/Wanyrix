/**
 * Shared harness for the live API contract suites (tests/api) — AUD-4.
 *
 * Why this exists: every live suite used to guard itself with
 * `describe.skipIf(!serverUp)`, so an unreachable dev server produced a
 * SILENT skip and a vacuous green CI run (zero route coverage reported as
 * success). The harness makes the skip VISIBLE and COUNTED, and lets gate
 * runs turn it into a hard failure:
 *
 *   - `serverUp` is probed ONCE per run (with retries that absorb dev-server
 *     recompile windows) and shared by every suite file in the process
 *     (bun test keeps one module instance across files).
 *   - Registration goes through the counted `test` (or a capability-gated
 *     variant from `makeGatedTest`): identical behavior to bun:test's `test`
 *     when the server is up; when it is down the case is registered as a
 *     SKIP (still visible in the runner summary) while being COUNTED, so
 *     each file can print its exact `SKIPPED (n) — server absent` banner.
 *   - `WANYRIX_REQUIRE_LIVE=1` (CI live step, local gate runs) flips the
 *     skip into a failure via tests/api/server-present.test.ts.
 *
 * CWD-independent: the suite must pass from any invocation dir
 * (e.g. `cd tests && WANYRIX_TEST_BASE_URL=http://localhost:3000 bun test api/`).
 */
import { expect, test as bunTest } from 'bun:test'
import path from 'node:path'

export const BASE_URL = process.env.WANYRIX_TEST_BASE_URL ?? 'http://localhost:3000'

/** AUD-4: when '1', an unreachable server is a HARD FAILURE, never a skip. */
export const REQUIRE_LIVE = process.env.WANYRIX_REQUIRE_LIVE === '1'

/** CWD-independent repo root. */
export const REPO_ROOT = path.resolve(import.meta.dir, '..', '..')

/* ------------------------------------------------------------- plumbing ---- */

export interface JsonResponse {
  status: number
  contentType: string
  body: unknown
  headers: Headers
}

/** Fetch `pathName` from the server under test, parsing JSON envelopes when
 * the response declares them (broken JSON → body null, never a thrown wrap). */
export async function fetchJson(pathName: string, init?: RequestInit): Promise<JsonResponse> {
  const res = await fetch(`${BASE_URL}${pathName}`, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  })
  const contentType = res.headers.get('content-type') ?? ''
  let body: unknown = null
  if (contentType.includes('application/json')) {
    try {
      body = await res.json()
    } catch {
      body = null
    }
  }
  return { status: res.status, contentType, body, headers: res.headers }
}

/** Assert a response is a JSON envelope (non-null parsed body). */
export function expectJson(res: JsonResponse): void {
  expect(res.contentType).toContain('application/json')
  expect(res.body).not.toBeNull()
}

/** The named `error` field of an envelope, stringified. */
export function errorOf(res: JsonResponse): string {
  return String((res.body as { error?: unknown } | null)?.error)
}

/* ------------------------------------------------- server-dependent setup -- */

async function serverReachable(): Promise<boolean> {
  // A few retries absorb transient dev-server recompile windows (parallel
  // agents edit src/** while this suite runs). Connection refused / timeout
  // over all attempts → genuinely unreachable.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await fetch(`${BASE_URL}/api/wanyrix/workspaces`, {
        signal: AbortSignal.timeout(3_000),
      })
      if (res.ok) return true
    } catch {
      // not reachable this attempt — retry
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, 1_500))
  }
  return false
}

/** Probed once per run and shared across every suite file. */
export const serverUp = await serverReachable()

/* --------------------------------------------- counted test registration --- */

let liveCount = 0

/** Live-server test cases registered through the harness so far (global —
 * bun test keeps one module instance across all files of a run). */
export function liveTestCount(): number {
  return liveCount
}

function register(
  name: string,
  fn: () => void | Promise<void>,
  run: boolean,
  timeout?: number,
): void {
  liveCount += 1
  if (run) {
    if (timeout === undefined) bunTest(name, fn)
    else bunTest(name, fn, timeout)
  } else {
    bunTest.skip(name, fn)
  }
}

/** Drop-in replacement for bun:test's `test` inside live suites: identical
 * when the server is up; when it is down, the case is registered as a SKIP
 * (visible in the runner summary) and COUNTED for the skip banner. */
export function test(name: string, fn: () => void | Promise<void>, timeout?: number): void {
  register(name, fn, serverUp, timeout)
}

/** Factory for capability-gated suites (e.g. the issue #129 contract, the
 * license activate round-trip): the returned tester only RUNS its cases when
 * `run` is true — skips stay visible and counted either way. */
export function makeGatedTest(
  run: boolean,
): (name: string, fn: () => void | Promise<void>, timeout?: number) => void {
  return (name, fn, timeout) => register(name, fn, run, timeout)
}

/**
 * The AUD-4 skip banner. Called at the END of a suite file's module scope
 * (after all describes registered) when the server is absent. Prints the
 * file's exact skipped-case count in the pinned format:
 * `SKIPPED (n) — server absent at <url> …`
 */
export function skipBanner(file: string, base: number): void {
  console.warn(
    `SKIPPED (${liveCount - base}) — server absent at ${BASE_URL} — live file ${file} did not run; ` +
      'set WANYRIX_REQUIRE_LIVE=1 to fail instead of skip (AUD-4).',
  )
}
