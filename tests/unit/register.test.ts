/**
 * Task 2-b — workspace registration bridge, pure helpers.
 *
 * Pins the deterministic-id machinery (slugify + FNV-1a fingerprint) and the
 * path validation contract against REAL filesystem fixtures under the repo
 * (plus self-cleaning temp entries). No server, no db, no next/* — the module
 * under test is pure by design (register.ts).
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  fnv1a8,
  hasRustProjectMarker,
  slugify,
  validateCandidatePath,
  workspaceIdFor,
} from '../../src/lib/wanyrix/register'

/* ------------------------------------------------- self-cleaning fixtures -- */

const tempRoots: string[] = []
afterAll(async () => {
  for (const dir of tempRoots) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function makeTempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wanyrix-register-'))
  tempRoots.push(dir)
  return dir
}

/* ------------------------------------------------------------------ slug -- */

describe('slugify', () => {
  test('maps separators/spaces to single dashes and lowercases', () => {
    expect(slugify('Helios_Platform v2')).toBe('helios-platform-v2')
    expect(slugify('My--Weird   Name')).toBe('my-weird-name')
  })

  test('empty / separator-only input degrades to workspace', () => {
    expect(slugify('')).toBe('workspace')
    expect(slugify('///')).toBe('workspace')
    expect(slugify('   ')).toBe('workspace')
  })

  test('caps at 40 chars without leaving a trailing dash', () => {
    const long = 'a'.repeat(39) + '-tail-with-more-than-forty-characters'
    const slug = slugify(long)
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('-')).toBe(false)
    expect(slug).toBe('a'.repeat(39))
    // a clean 40-char alnum name survives intact
    expect(slugify('b'.repeat(40))).toBe('b'.repeat(40))
  })

  test('keeps alphanumerics only', () => {
    expect(slugify('Cargo.toml')).toBe('cargo-toml')
    expect(slugify('wanyrix™')).toBe('wanyrix')
  })
})

/* ----------------------------------------------------------------- fnv1a -- */

describe('fnv1a8 — FNV-1a 32-bit over UTF-8 bytes', () => {
  test('known vectors (offset basis 2166136261, prime 16777619)', () => {
    expect(fnv1a8('')).toBe('811c9dc5')
    expect(fnv1a8('a')).toBe('e40c292c')
    expect(fnv1a8('foobar')).toBe('bf9cf968')
  })

  test('returns 8 lowercase zero-padded hex chars', () => {
    const out = fnv1a8('wanyrix')
    expect(out).toMatch(/^[0-9a-f]{8}$/)
  })

  test('deterministic: same input → same output; different inputs differ', () => {
    expect(fnv1a8('/home/you/dev/helios')).toBe(fnv1a8('/home/you/dev/helios'))
    expect(fnv1a8('/home/you/dev/helios')).not.toBe(fnv1a8('/home/you/dev/helios-v2'))
  })

  test('multibyte UTF-8 input is hashed over its bytes (still stable)', () => {
    expect(fnv1a8('héllo→')).toBe(fnv1a8('héllo→'))
    expect(fnv1a8('héllo→')).not.toBe(fnv1a8('hello'))
  })
})

/* ------------------------------------------------------------ id formula -- */

describe('workspaceIdFor', () => {
  test('ws-local-<slug>-<fnv1a8(abs path)> and deterministic', () => {
    const abs = '/home/you/dev/Helios_Platform v2'
    const expected = `ws-local-helios-platform-v2-${fnv1a8(abs)}`
    expect(workspaceIdFor(abs, 'Helios_Platform v2')).toBe(expected)
    expect(workspaceIdFor(abs, 'Helios_Platform v2')).toBe(workspaceIdFor(abs, 'Helios_Platform v2'))
  })

  test('same basename at different paths → different ids (path fingerprint)', () => {
    const a = workspaceIdFor('/checkout/one/engine', 'engine')
    const b = workspaceIdFor('/checkout/two/engine', 'engine')
    expect(a).toMatch(/^ws-local-engine-[0-9a-f]{8}$/)
    expect(a).not.toBe(b)
  })

  test('same path with an unnamed dir still yields a well-formed id', () => {
    expect(workspaceIdFor('/', '')).toBe(`ws-local-workspace-${fnv1a8('/')}`)
  })
})

/* -------------------------------------------------------- path validation -- */

describe('validateCandidatePath (real filesystem fixtures)', () => {
  // CWD-independent: the suite must pass no matter which directory bun is
  // invoked from (e.g. `cd tests && bun test …` when the sandbox root is unhealthy).
  const repoRoot = path.resolve(import.meta.dir, '..', '..')

  test('repo engine/ dir → ok, canonical abs path', async () => {
    const check = await validateCandidatePath(repoRoot + '/engine')
    expect(check.ok).toBe(true)
    expect(check.abs).toBeDefined()
    expect(check.abs!.endsWith('/engine')).toBe(true)
    expect(check.reason).toBeUndefined()
  })

  test('nonexistent path → named existence reason', async () => {
    const check = await validateCandidatePath('/nonexistent/definitely-missing-xyz')
    expect(check.ok).toBe(false)
    expect(check.reason).toContain('does not exist')
  })

  test('relative path → named absolute reason', async () => {
    const check = await validateCandidatePath('engine')
    expect(check.ok).toBe(false)
    expect(check.reason).toContain('absolute')
  })

  test('a FILE (not a directory) → named not-a-directory reason', async () => {
    const dir = await makeTempProject()
    const file = path.join(dir, 'not-a-dir.txt')
    await writeFile(file, 'data')
    const check = await validateCandidatePath(file)
    expect(check.ok).toBe(false)
    expect(check.reason).toContain('not a directory')
  })

  test('empty input → named reason without touching the filesystem', async () => {
    const check = await validateCandidatePath('   ')
    expect(check.ok).toBe(false)
    expect(check.reason!.length).toBeGreaterThan(0)
  })

  test('whitespace around a valid path is trimmed and resolved', async () => {
    const dir = await makeTempProject()
    const check = await validateCandidatePath(`  ${dir}  `)
    expect(check.ok).toBe(true)
    expect(check.abs).toBe(path.resolve(dir))
  })
})

/* ------------------------------------------------------------ rust marker -- */

describe('hasRustProjectMarker', () => {
  test('Cargo.toml or .wanyrix count; arbitrary entries do not', () => {
    expect(hasRustProjectMarker(['Cargo.toml'])).toBe(true)
    expect(hasRustProjectMarker(['.wanyrix'])).toBe(true)
    expect(hasRustProjectMarker(['src', 'Cargo.toml', 'README.md'])).toBe(true)
    expect(hasRustProjectMarker(['README.md'])).toBe(false)
    expect(hasRustProjectMarker([])).toBe(false)
  })

  test('a temp dir with a Cargo.toml passes end-to-end (real readdir shape)', async () => {
    const dir = await makeTempProject()
    await mkdir(path.join(dir, 'src'), { recursive: true })
    await writeFile(path.join(dir, 'Cargo.toml'), '[package]\nname = "x"\n')
    const { readdir } = await import('node:fs/promises')
    expect(hasRustProjectMarker(await readdir(dir))).toBe(true)
  })
})
