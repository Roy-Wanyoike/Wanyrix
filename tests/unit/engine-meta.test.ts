/**
 * R9 — engine-version drift pin.
 *
 * The web UI states the engine version in the sidebar footer and the CLI
 * contract dialog (via `ENGINE_VERSION` in engine-meta.ts). Those strings
 * were left at v0.3.0 after the engine reached v0.4.0 — this test parses
 * `engine/Cargo.toml` and fails the moment the constant and the crate
 * disagree, so the drift can never ship again.
 */
import { describe, expect, test } from 'bun:test'

import { ENGINE_VERSION } from '../../src/lib/wanyrix/engine-meta'

describe('ENGINE_VERSION — pinned to engine/Cargo.toml', () => {
  test('matches the wanyrix-engine crate version exactly', async () => {
    const toml = await Bun.file(new URL('../../engine/Cargo.toml', import.meta.url)).text()
    const m = toml.match(/^\s*version\s*=\s*"([^"]+)"/m)
    expect(m).not.toBeNull()
    expect(ENGINE_VERSION).toBe(m![1]!)
  })

  test('is a plain semver pair or triple (no v prefix — callers add it)', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+(\.\d+)?$/)
  })
})
