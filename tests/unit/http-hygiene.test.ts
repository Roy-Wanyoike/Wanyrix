/**
 * Issue #141 — response & runtime hygiene (unit suite, server-free).
 *
 * Pins, without needing a running server:
 *   1. the `noStore`/`withNoStore` helper contract (every response a wrapped
 *      mutating handler returns carries `Cache-Control: no-store`, whatever
 *      the status code);
 *   2. that every REAL mutating route handler opts in (`withNoStore` present
 *      in the route source — structural pin, same spirit as the adversarial
 *      registration pins);
 *   3. the next.config.ts header posture (`poweredByHeader: false` + the
 *      three global security headers, evaluated through the real `headers()`);
 *   4. the package.json runtime pins: `dev` binds `-H 127.0.0.1`, `start`
 *      pins `HOSTNAME=127.0.0.1` (the standalone server binds all interfaces
 *      by default), both guarded by the SECURITY GUARD key.
 *
 * The live (over-the-wire) counterparts of these pins live in
 * tests/api/wanyrix-response-hygiene.test.ts, capability-probed so a server
 * predating the #141 merge skips with a stated reason instead of failing.
 */
import { describe, expect, test } from 'bun:test'
import { NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  NO_STORE_HEADER,
  NO_STORE_VALUE,
  noStore,
  withNoStore,
} from '../../src/lib/http-hygiene'
import nextConfig from '../../next.config'

// CWD-independent repo root (the suite must pass from any invocation dir).
const REPO_ROOT = path.resolve(import.meta.dir, '..', '..')

/* ------------------------------------------------- 1. helper contract ----- */

describe('http-hygiene noStore', () => {
  test('sets Cache-Control: no-store on a NextResponse and returns it', () => {
    const res = NextResponse.json({ ok: true })
    const out = noStore(res)
    expect(out).toBe(res)
    expect(out.headers.get(NO_STORE_HEADER)).toBe(NO_STORE_VALUE)
  })

  test('overwrites any pre-existing Cache-Control value', () => {
    const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'public, max-age=60' } })
    const out = noStore(res)
    expect(out.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('http-hygiene withNoStore', () => {
  test('wrapped handler responses carry no-store on the happy path', async () => {
    const handler = withNoStore(async (req: Request) =>
      NextResponse.json({ ok: true, path: new URL(req.url).pathname }),
    )
    const res = await handler(new Request('http://localhost/api/wanyrix/storage/rebuild'))
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  test('wrapped handler responses carry no-store on error paths too (400/404/503)', async () => {
    for (const status of [400, 404, 503]) {
      const handler = withNoStore(async () => NextResponse.json({ error: 'x' }, { status }))
      const res = await handler()
      expect(res.status).toBe(status)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    }
  })

  test('wrapper forwards every handler argument verbatim and stamps the response', async () => {
    // Arity preservation is the TYPE-level contract: `withNoStore` returns
    // `(...args: A) => Promise<Response>`, so tsc rejects any handler/wrapper
    // signature mismatch. (The JS `length` of the rest-args wrapper is 0 —
    // asserting on it would pin an implementation artifact, not a contract.)
    // The RUNTIME contract pinned here: every argument is forwarded verbatim.
    const seen: unknown[] = []
    const inner = async (...args: unknown[]) => {
      seen.push(...args)
      return NextResponse.json({ ok: true })
    }
    const wrapped = withNoStore(inner)
    const req = new Request('http://localhost/api/x')
    const ctx = { params: Promise.resolve({ id: 'x' }) }
    const res = await wrapped(req, ctx)
    expect(seen.length).toBe(2)
    expect(seen[0]).toBe(req)
    expect(seen[1]).toBe(ctx)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

/* --------------------------------- 2. structural pin on the route files --- */

// Every route file that ships a REAL mutating handler (not a 405 stub) must
// wrap it with withNoStore. workspaces carries two (POST + DELETE).
const MUTATING_ROUTES: Array<{ file: string; minOccurrences: number }> = [
  { file: 'src/app/api/wanyrix/workspaces/route.ts', minOccurrences: 2 },
  { file: 'src/app/api/wanyrix/scan-runs/route.ts', minOccurrences: 1 },
  { file: 'src/app/api/wanyrix/export/route.ts', minOccurrences: 1 },
  { file: 'src/app/api/wanyrix/license/issue/route.ts', minOccurrences: 1 },
  { file: 'src/app/api/wanyrix/storage/rebuild/route.ts', minOccurrences: 1 },
  { file: 'src/app/api/wanyrix/storage/reclaim/route.ts', minOccurrences: 1 },
  { file: 'src/app/api/wanyrix/explain/route.ts', minOccurrences: 1 },
]

describe('mutating routes opt into withNoStore (#141a)', () => {
  for (const { file, minOccurrences } of MUTATING_ROUTES) {
    test(`${file} wraps its mutating handler(s) with withNoStore (>= ${minOccurrences})`, () => {
      const source = readFileSync(path.join(REPO_ROOT, file), 'utf8')
      const occurrences = source.split('withNoStore(').length - 1
      expect(occurrences).toBeGreaterThanOrEqual(minOccurrences)
    })
  }
})

/* ------------------------------------- 3. next.config.ts header posture --- */

describe('next.config header posture (#141b)', () => {
  test('poweredByHeader is false (X-Powered-By removed)', () => {
    expect(nextConfig.poweredByHeader).toBe(false)
  })

  test('headers() applies the three security headers to every path', async () => {
    const headersFn = nextConfig.headers
    expect(typeof headersFn).toBe('function')
    const rules = await headersFn!()
    expect(rules.length).toBeGreaterThan(0)
    const allPaths = rules.find((r) => r.source === '/:path*')
    expect(allPaths).toBeDefined()
    const headers = new Map(allPaths!.headers.map((h) => [h.key, h.value]))
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
  })
})

/* --------------------------------------- 4. package.json runtime pins ----- */

describe('package.json loopback pins (#141c / QA-3-B-1 / SEC-2)', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }

  test('start script pins HOSTNAME=127.0.0.1 (standalone server wildcard-bind guard)', () => {
    expect(pkg.scripts.start).toContain('HOSTNAME=127.0.0.1')
  })

  test('dev script pins -H 127.0.0.1', () => {
    expect(pkg.scripts.dev).toContain('-H 127.0.0.1')
  })

  test('the SECURITY GUARD key states the constraint next to the scripts', () => {
    const guard = (pkg as Record<string, unknown>)['//']
    expect(typeof guard).toBe('string')
    expect(guard as string).toContain('SECURITY GUARD')
    expect(guard as string).toContain('loopback')
  })
})
