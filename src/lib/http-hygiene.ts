/**
 * Response hygiene for MUTATING endpoints (issue #141a).
 *
 * Every POST/PUT/DELETE handler that can change state (SQLite writes, engine
 * runs that write `.wanyrix/exports`, in-process sim mutations) serves
 * responses that MUST never be cached: a cache serving a stale response for a
 * mutating call would let a client believe an action happened (or read data
 * that a subsequent mutation has already invalidated).
 *
 * This module is deliberately SEPARATE from `src/lib/wanyrix/api.ts` (the
 * workspace-param contract helpers) so the two concerns can evolve
 * independently; route handlers opt in with a one-line wrap:
 *
 * ```ts
 * export const POST = withNoStore(async function POST(req: NextRequest) {
 *   ...unchanged handler body...
 * })
 * ```
 *
 * Scope note (honest boundary): only the REAL mutating handlers are wrapped.
 * The 405 method-discipline responses (shared `notAllowedOn*Only` factories
 * and the inline per-route 405 stubs) are not wrapped — they carry no
 * representation and no `Cache-Control` contract of their own.
 */

/** Header name/value applied to every wrapped response. */
export const NO_STORE_HEADER = 'Cache-Control'
export const NO_STORE_VALUE = 'no-store'

/**
 * Sets `Cache-Control: no-store` on a response in place and returns it.
 *
 * Works on `NextResponse` (guard "response" allows setting Cache-Control) —
 * every route handler in this app returns a `NextResponse.json(...)`.
 */
export function noStore<T extends Response>(res: T): T {
  res.headers.set(NO_STORE_HEADER, NO_STORE_VALUE)
  return res
}

/**
 * Wraps a route handler so EVERY response it returns (200/400/404/413/503…)
 * carries `Cache-Control: no-store`. The handler signature is preserved
 * verbatim, so the wrapped export still satisfies Next.js route typing.
 */
export function withNoStore<A extends unknown[]>(
  handler: (...args: A) => Response | Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const res = await handler(...args)
    // Defensive: a handler that ever returned a response with an immutable
    // header guard would throw here — none do (all construct NextResponse),
    // but the error would surface loudly rather than silently skipping the
    // header, which is the behavior we want.
    return noStore(res)
  }
}
