/**
 * Task 2-b — workspace registration bridge, pure helpers.
 *
 * Pins the deterministic-id machinery (slugify + FNV-1a fingerprint) and the
 * path validation contract against REAL filesystem fixtures under the repo
 * (plus self-cleaning temp entries). No server, no db, no next/* — the module
 * under test is pure by design (register.ts).
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  configuredWorkspaceRoots,
  fnv1a8,
  hasRustProjectMarker,
  isInsideApprovedRoots,
  NOT_A_CONNECTABLE_PROJECT_REFUSAL,
  ROOT_CONFINEMENT_REFUSAL,
  slugify,
  validateCandidatePath,
  validateRegistrationPath,
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

// CWD-independent repo root (the suite must pass no matter which directory
// bun is invoked from — e.g. `cd tests && bun test …`). Module scope: the
// QA-3-B-2 confinement describes below use it too.
const repoRoot = path.resolve(import.meta.dir, '..', '..')

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

/* --------------------------------------- workspace root confinement (QA-3-B-2) --- */

describe('configuredWorkspaceRoots (QA-3-B-2)', () => {
  test('env unset → documented defaults: repo engine/ + fixtures/ + system temp dir', () => {
    const roots = configuredWorkspaceRoots(undefined, repoRoot)
    expect(roots).toEqual([
      path.resolve(repoRoot, 'engine'),
      path.resolve(repoRoot, 'fixtures'),
      path.resolve(tmpdir()),
    ])
  })

  test('env blank (whitespace only) → treated as unset (defaults)', () => {
    expect(configuredWorkspaceRoots('   ', repoRoot)).toEqual(configuredWorkspaceRoots(undefined, repoRoot))
  })

  test('env set → split on the path delimiter, trimmed, resolved absolute', () => {
    const joined = [` ${repoRoot}/one `, path.join(repoRoot, 'two'), ''].join(path.delimiter)
    const roots = configuredWorkspaceRoots(joined, repoRoot)
    expect(roots).toEqual([path.resolve(repoRoot, 'one'), path.resolve(repoRoot, 'two')])
  })

  test('env set but unusable (only blank entries) → EMPTY list (refuse-everything, no silent fallback)', () => {
    expect(configuredWorkspaceRoots(`  ${path.delimiter} ${path.delimiter} `, repoRoot)).toEqual([])
  })
})

describe('isInsideApprovedRoots (QA-3-B-2)', () => {
  test('a path inside an approved root → true; the root itself → true', async () => {
    const root = await makeTempProject()
    const nested = path.join(root, 'deep', 'deeper')
    await mkdir(nested, { recursive: true })
    expect(await isInsideApprovedRoots(nested, [root])).toBe(true)
    expect(await isInsideApprovedRoots(root, [root])).toBe(true)
  })

  test('a sibling whose name merely shares the prefix → false (boundary is a path separator)', async () => {
    const root = await makeTempProject()
    const sibling = await makeTempProject()
    expect(path.basename(sibling).startsWith(path.basename(root))).toBe(false) // test sanity
    expect(await isInsideApprovedRoots(sibling, [root])).toBe(false)
  })

  test('a symlink resolving OUTSIDE the roots → false (realpath, not lexical)', async () => {
    const root = await makeTempProject()
    const outside = await makeTempProject() // exists, but not an approved root
    const link = path.join(root, 'escape')
    await symlink(outside, link)
    expect(await isInsideApprovedRoots(link, [root])).toBe(false)
    // the lexical path WOULD have passed — this is why containment is
    // decided on realpath (QA-3-B-2 symlink-escape pin)
    expect(link.startsWith(root)).toBe(true)
  })
})

describe('validateRegistrationPath — composed validation + confinement (QA-3-B-2)', () => {
  test('path inside an approved root → allowed with canonical abs', async () => {
    const root = await makeTempProject()
    const project = await mkdir(path.join(root, 'project'), { recursive: true }).then(() =>
      path.join(root, 'project'),
    )
    const check = await validateRegistrationPath(`  ${project} `, [root])
    expect(check.ok).toBe(true)
    expect(check.abs).toBe(path.resolve(project))
    expect(check.reason).toBeUndefined()
    expect(check.logDetail).toBeUndefined()
  })

  test('`..` inside the roots resolves to a contained path → accepted', async () => {
    const root = await makeTempProject()
    const project = path.join(root, 'project')
    await mkdir(project, { recursive: true })
    const check = await validateRegistrationPath(path.join(root, 'sub', '..', 'project'), [root])
    expect(check.ok).toBe(true)
    expect(check.abs).toBe(project)
  })

  test('path outside the roots → ONE generic refusal, no path echo, no existence info', async () => {
    const root = await makeTempProject()
    const outside = await makeTempProject() // exists — but not approved
    const check = await validateRegistrationPath(outside, [root])
    expect(check.ok).toBe(false)
    expect(check.outsideRoots).toBe(true)
    expect(check.reason).toBe(ROOT_CONFINEMENT_REFUSAL)
    // no resolved-path echo in the wire refusal (QA-3-B-2 AC 1)
    expect(check.reason).not.toContain(outside)
    // no filesystem state leak: the existing validator's 'does not exist' /
    // 'not a directory' knowledge must not surface either
    expect(check.reason).not.toContain('does not exist')
    expect(check.reason).not.toContain('directory — pass')
    // the candidate itself was perfectly valid — the refusal is pure policy,
    // so there is no specific reason to log either
    expect(check.logDetail).toBeUndefined()
    // the existing validation still ran underneath: a nonexistent outside
    // path carries the same generic refusal, with its specific reason logged
    const missing = await validateRegistrationPath(path.join(outside, 'no-such-dir-xyz'), [root])
    expect(missing.ok).toBe(false)
    expect(missing.reason).toBe(ROOT_CONFINEMENT_REFUSAL)
    expect(missing.reason).toBe(check.reason) // one message for ALL outside paths
    expect(missing.logDetail).toContain('does not exist')
  })

  test('env unset → out-of-default-root path refused WITH named guidance (how to set the env)', async () => {
    // repoRoot itself is outside the documented defaults (engine/, fixtures/,
    // system temp dir), exists, and is a directory — the pure env-unset case.
    const check = await validateRegistrationPath(repoRoot, configuredWorkspaceRoots(undefined, repoRoot))
    expect(check.ok).toBe(false)
    expect(check.outsideRoots).toBe(true)
    expect(check.reason).toBe(ROOT_CONFINEMENT_REFUSAL)
    expect(check.reason).toContain('WANYRIX_WORKSPACE_ROOTS')
    expect(check.reason).toContain('path-delimiter-separated')
  })

  test('symlink escaping the root → refused via the resolved path, generic wire message', async () => {
    const root = await makeTempProject()
    const outside = await makeTempProject()
    await mkdir(path.join(root, 'project'), { recursive: true })
    await symlink(outside, path.join(root, 'project', 'escape'))
    const check = await validateRegistrationPath(path.join(root, 'project', 'escape'), [root])
    expect(check.ok).toBe(false)
    expect(check.outsideRoots).toBe(true)
    expect(check.reason).toBe(ROOT_CONFINEMENT_REFUSAL)
    expect(check.reason).not.toContain(outside) // no echo of the resolved target
  })

  test('contained-but-invalid: nonexistent and file-not-dir share ONE 404-class message; specifics go to logDetail', async () => {
    const root = await makeTempProject()
    const missing = await validateRegistrationPath(path.join(root, 'no-such-dir-xyz'), [root])
    expect(missing.ok).toBe(false)
    expect(missing.outsideRoots).toBeUndefined()
    expect(missing.reason).toBe(NOT_A_CONNECTABLE_PROJECT_REFUSAL)
    expect(missing.reason).not.toContain('does not exist')
    expect(missing.logDetail).toContain('does not exist')

    const file = path.join(root, 'a-file.txt')
    await writeFile(file, 'data')
    const notDir = await validateRegistrationPath(file, [root])
    expect(notDir.ok).toBe(false)
    expect(notDir.reason).toBe(NOT_A_CONNECTABLE_PROJECT_REFUSAL)
    expect(notDir.reason).toBe(missing.reason) // collapsed — no enumeration
    expect(notDir.logDetail).toContain('not a directory')
  })

  test('input-shape refusals keep their named reasons (no fs state probed, no oracle value)', async () => {
    const root = await makeTempProject()
    const relative = await validateRegistrationPath('engine', [root])
    expect(relative.ok).toBe(false)
    expect(relative.reason).toContain('absolute')
    expect(relative.logDetail).toBeUndefined()

    const empty = await validateRegistrationPath('   ', [root])
    expect(empty.ok).toBe(false)
    expect(empty.reason).toContain('empty')
  })
})
