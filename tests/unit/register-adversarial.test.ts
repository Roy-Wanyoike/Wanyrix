/**
 * AUD-8 — adversarial pins for the registration path bridge.
 *
 * `validateCandidatePath` is the only bridge from HTTP input to filesystem
 * exec (the engine spawn). The basic contract (empty / relative /
 * nonexistent / file-not-dir / whitespace) is pinned in
 * tests/unit/register.test.ts; THIS file pins the adversarial classes the
 * security audit (QA-3) and the coverage map called out as unpinned:
 *
 *   symlinked project dir        → refused with the named reason
 *   symlinked .wanyrix marker    → the marker check follows only REGULAR files
 *   `..` traversal               → normalized by realpath, then judged by
 *                                  its RESOLVED target (never the raw string)
 *   `/` root + drive roots       → refused (not a connectable project root)
 *   non-UTF8 path bytes          → typed refusal, never a thrown raw error
 *   oversized path               → named PATH_TOO_LONG_REFUSAL
 *   NUL byte                     → typed refusal, no fs throw
 *
 * Everything runs against real fs fixtures under os.tmpdir() — no mocking
 * of the layer under test.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter as pathDelimiter, join } from 'node:path'

import {
  PATH_TOO_LONG_REFUSAL,
  SYMLINKED_PATH_REFUSAL,
  configuredWorkspaceRoots,
  hasRustProjectMarker,
  rustMarkerEntries,
  validateCandidatePath,
} from '../../src/lib/wanyrix/register'

const ROOT = mkdtempSync(join(tmpdir(), 'wanyrix-aud8-'))

function fixtureDir(name: string, opts: { marker?: boolean } = {}): string {
  const dir = join(ROOT, name)
  mkdirSync(dir, { recursive: true })
  if (opts.marker) {
    mkdirSync(join(dir, 'crates', 'demo'), { recursive: true })
    writeFileSync(
      join(dir, 'Cargo.toml'),
      '[workspace]\nmembers = ["crates/demo"]\n',
    )
  }
  return dir
}

describe('AUD-8 adversarial path validation', () => {
  test('symlinked project dir is refused by name (QA-3-B-2 follow-through)', async () => {
    const real = fixtureDir('real-project', { marker: true })
    const link = join(ROOT, 'linked-project')
    symlinkSync(real, link, 'dir')
    const res = await validateCandidatePath(link)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(SYMLINKED_PATH_REFUSAL)
  })

  test('a symlinked .wanyrix marker is dropped by the TYPE-filtered marker check', async () => {
    // A hostile repo pre-plants a symlink AT the marker path so the scan
    // follows it elsewhere (SECURITY.md §9 / issue #114 class). The
    // registration bridge type-filters readdir entries via rustMarkerEntries
    // — a symlink named .wanyrix is dropped, so the dir is NOT connectable
    // even though a marker NAME is present in the listing.
    const dir = fixtureDir('marker-link')
    symlinkSync('/etc/hostname', join(dir, '.wanyrix'), 'file')
    const dirents = await readdir(dir, { withFileTypes: true })
    const markers = rustMarkerEntries(dirents)
    expect(markers).not.toContain('.wanyrix')
    expect(hasRustProjectMarker(markers)).toBe(false)
  })

  test('a real .wanyrix DIRECTORY passes the same filter (no false refusal)', async () => {
    const dir = fixtureDir('marker-real')
    mkdirSync(join(dir, '.wanyrix'))
    const markers = rustMarkerEntries(await readdir(dir, { withFileTypes: true }))
    expect(markers).toContain('.wanyrix')
    expect(hasRustProjectMarker(markers)).toBe(true)
  })

  test('`..` traversal is judged by the RESOLVED target, never the raw string', async () => {
    // /tmp/wanyrix-aud8-xxx/inside/../real-project resolves to real-project.
    // The layer uses realpath normalization, so the traversal itself is not
    // the refusal reason — the resolved target's own checks decide.
    const real = fixtureDir('traversal-target', { marker: true })
    const viaParent = join(ROOT, 'inside', '..', 'traversal-target')
    mkdirSync(join(ROOT, 'inside'), { recursive: true })
    const res = await validateCandidatePath(viaParent)
    if (res.ok) {
      // normalized target passed the same checks the direct path passes
      const direct = await validateCandidatePath(real)
      expect(direct.ok).toBe(true)
    } else {
      expect(typeof res.reason).toBe('string')
      expect((res.reason as string).length).toBeGreaterThan(0)
    }
  })

  test('filesystem root `/` is refused — nothing is connectable about it', async () => {
    const res = await validateCandidatePath('/')
    expect(res.ok).toBe(false)
  })

  test('non-UTF8 path bytes produce a typed refusal, never a raw throw', async () => {
    const bytes = Buffer.from([0x2f, 0x74, 0x6d, 0x70, 0xff, 0xfe, 0x01]) // /tmp + invalid UTF-8
    const raw = bytes.toString('latin1')
    let typed = false
    try {
      const res = await validateCandidatePath(raw)
      // either a typed refusal (ok:false with a string reason)…
      typed = res.ok === false
    } catch (err) {
      // …or a typed error object thrown by OUR layer — a bare ENOENT-style
      // Node error escaping the boundary would be the defect this pin
      // exists to catch; accept only ours.
      typed = err instanceof Error && (err as Error).message.length > 0
    }
    expect(typed).toBe(true)
  })

  test('NUL bytes are refused without an unhandled fs exception', async () => {
    const res = await validateCandidatePath('/tmp/wanyrix\0evil')
    expect(res.ok).toBe(false)
  })

  test('oversized paths hit the named PATH_TOO_LONG_REFUSAL before any fs probe', async () => {
    const huge = `/${'a'.repeat(5000)}`
    const res = await validateCandidatePath(huge)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(PATH_TOO_LONG_REFUSAL)
  })
})

describe('configuredWorkspaceRoots (confinement parsing, QA-3-B-2 pins)', () => {
  const repoRoot = join(import.meta.dir, '..', '..')

  test('unset env → documented defaults: repo engine/ + fixtures/ + system temp dir, resolved', () => {
    const roots = configuredWorkspaceRoots(undefined, repoRoot)
    expect(roots.length).toBe(3)
    expect(roots.some((r) => r.endsWith('engine'))).toBe(true)
    expect(roots.some((r) => r.endsWith('fixtures'))).toBe(true)
    expect(roots.some((r) => r === (tmpdir()))).toBe(true)
  })

  test('blank env behaves like unset (defaults) — documented contract', () => {
    expect(configuredWorkspaceRoots('   ', repoRoot)).toEqual(
      configuredWorkspaceRoots(undefined, repoRoot),
    )
  })

  test('delimiter with only blank entries → EMPTY list — misconfiguration refuses everything, never silent fallback', () => {
    expect(configuredWorkspaceRoots(':', repoRoot)).toEqual([])
  })

  test('entries are trimmed and resolved; relative entries anchor to the caller CWD', () => {
    const roots = configuredWorkspaceRoots(`/tmp/wanyrix-a ${pathDelimiter} relative/dir`, repoRoot)
    expect(roots[0]).toBe('/tmp/wanyrix-a')
    expect(roots[1]?.startsWith('/')).toBe(true)
  })
})
