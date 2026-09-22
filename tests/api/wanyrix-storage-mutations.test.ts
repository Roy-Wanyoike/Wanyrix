/**
 * AUD-3 — behavioral contract tests for the mutating POST routes that had
 * ZERO coverage (only GET→405 was pinned):
 *
 *   - POST /api/wanyrix/storage/rebuild  (simulated repopulation)
 *   - POST /api/wanyrix/storage/reclaim  (the dialog CTA mutation)
 *   - GET  /api/wanyrix/engine/build     (the one MEASURED cacheHitRate —
 *     spawns a real `wanyrix build` on this machine; 120s server timeout)
 *
 * These are in-process simulated state routes by design (local-first,
 * nothing leaves the machine) — the pins are about ENVELOPE SHAPE,
 * idempotency of shape, and method discipline, not about which exact
 * megabyte figure a simulation reports. The engine/build case is
 * capability-gated on the engine binary being present (its 503 branch is
 * the documented honest answer when it is not) and carries a long timeout
 * because a cold build genuinely recompiles.
 */
import { describe, expect } from 'bun:test'

import { errorOf, expectJson, fetchJson, test } from './harness'

/* ------------------------------------------------- storage/rebuild ------ */

describe('POST /api/wanyrix/storage/rebuild (AUD-3)', () => {
  test('POST → 200 envelope {rebuiltMB, detail[], storage{}} with sane numbers', async () => {
    const res = await fetchJson('/api/wanyrix/storage/rebuild', { method: 'POST' })
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as { rebuiltMB?: number; detail?: unknown; storage?: Record<string, unknown> }
    expect(typeof body.rebuiltMB).toBe('number')
    expect(body.rebuiltMB).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(body.detail)).toBe(true)
    expect(typeof body.storage).toBe('object')
    expect(body.storage).not.toBeNull()
  })

  test('idempotent shape: a second POST → same envelope shape, still ≥ 0', async () => {
    const a = await fetchJson('/api/wanyrix/storage/rebuild', { method: 'POST' })
    const b = await fetchJson('/api/wanyrix/storage/rebuild', { method: 'POST' })
    expect(b.status).toBe(a.status)
    const bb = b.body as { rebuiltMB?: number; detail?: unknown[]; storage?: object } | null
    expect(typeof bb?.rebuiltMB).toBe('number')
    expect(Array.isArray(bb?.detail)).toBe(true)
    expect(typeof bb?.storage).toBe('object')
  })

  test('GET → 405 with Allow: POST', async () => {
    const res = await fetchJson('/api/wanyrix/storage/rebuild', { method: 'GET' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })

  test('PUT/DELETE/PATCH → 405 (post-only discipline)', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const res = await fetchJson('/api/wanyrix/storage/rebuild', { method })
      expect(res.status).toBe(405)
    }
  })
})

/* ------------------------------------------------- storage/reclaim ------ */

describe('POST /api/wanyrix/storage/reclaim (AUD-3)', () => {
  test('POST → 200 envelope {reclaimedMB, detail[], storage{}}', async () => {
    const res = await fetchJson('/api/wanyrix/storage/reclaim', { method: 'POST' })
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as { reclaimedMB?: number; detail?: unknown; storage?: object }
    expect(typeof body.reclaimedMB).toBe('number')
    expect(body.reclaimedMB).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(body.detail)).toBe(true)
    expect(typeof body.storage).toBe('object')
  })

  test('reclaim-after-rebuild: shape stays valid (fold-then-zero contract)', async () => {
    await fetchJson('/api/wanyrix/storage/rebuild', { method: 'POST' })
    const res = await fetchJson('/api/wanyrix/storage/reclaim', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = res.body as { reclaimedMB?: number }
    expect(body.reclaimedMB).toBeGreaterThanOrEqual(0)
  })

  test('GET → 405 with Allow: POST', async () => {
    const res = await fetchJson('/api/wanyrix/storage/reclaim', { method: 'GET' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })

  test('PUT/DELETE/PATCH → 405', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const res = await fetchJson('/api/wanyrix/storage/reclaim', { method })
      expect(res.status).toBe(405)
    }
  })
})

/* ------------------------------------------------- engine/build --------- */

describe('GET /api/wanyrix/engine/build (AUD-3 — the only route with zero coverage)', () => {
  test('is workspace-independent: builds the engine dogfood dir; a ws param cannot redirect it', async () => {
    // Deliberate contract pin: this route spawns `wanyrix build --path engine`
    // — there is NO workspace selection. A foreign ws param must NOT make it
    // spawn for some other directory (no param-driven exec-target here).
    // (Ledger note: the param being silently IGNORED is a minor honesty wart
    // — filed as AUD-3 follow-up — but it must certainly not change the target.)
    const withParam = await fetchJson('/api/wanyrix/engine/build?ws=definitely-not-registered')
    expect([200, 503, 502, 504]).toContain(withParam.status)
    if (withParam.status === 200) {
      const body = withParam.body as { scanTarget?: string }
      expect(body.scanTarget?.startsWith('engine')).toBe(true)
    }
  })

  test('POST → 405 with Allow: GET (the real-cargo surface is GET-only)', async () => {
    const res = await fetchJson('/api/wanyrix/engine/build', { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET')
  })

  test(
    'engine present: 200 wanyrix.engine-build/v1 envelope wrapping a REAL measured build',
    async () => {
      const res = await fetchJson('/api/wanyrix/engine/build?ws=helios-platform', {
        signal: undefined,
      })
      // The engine binary exists in this sandbox (engine gates ran). If a
      // future run has no binary, the route's documented answer is 503 —
      // accept EITHER but pin the envelope when 200.
      expect([200, 503]).toContain(res.status)
      if (res.status === 503) {
        expect(errorOf(res)).toContain('engine binary not found')
        return
      }
      expectJson(res)
      const body = res.body as {
        schema?: string
        executedAt?: string
        durationMs?: number
        binary?: { version?: string; profile?: string }
        scanTarget?: string
        report?: {
          schema?: string
          wallClockMs?: unknown
          buildSuccess?: unknown
          summary?: { cacheHitRate?: unknown; cacheHitRateStatus?: unknown; artifactsTotal?: unknown }
        }
      }
      expect(body.schema).toBe('wanyrix.engine-build/v1')
      expect(typeof body.executedAt).toBe('string')
      expect(typeof body.durationMs).toBe('number')
      expect(body.binary?.version).toContain('wanyrix 0.9.0')
      expect(body.report?.schema).toBe('wanyrix.build/v1')
      // Gate-21: this is THE surface where cacheHitRate is measured —
      // report.summary.cacheHitRate is a number 0..=100 computed from the
      // stream's fresh flags (null/absent would be dishonest here: a real
      // cargo run always reports the share). It must NEVER be the string
      // "not-measured" at this surface.
      const rate = body.report?.summary?.cacheHitRate
      expect(typeof rate).toBe('number')
      expect(rate as number).toBeGreaterThanOrEqual(0)
      expect(rate as number).toBeLessThanOrEqual(100)
      expect(typeof body.report?.wallClockMs).toBe('number')
      expect(body.report?.buildSuccess).toBe(true)
    },
    150_000,
  )
})
