/**
 * Task 2-a (AUDIT-I4) — legacy-migration.ts unit suite.
 *
 * Also carries the **mandatory AUDIT-I1 regression tests**: the P0 bug was
 * `createJSONStorage(createMigratingStorage())` — handing zustand the
 * StateStorage *object* instead of the *thunk* made `createJSONStorage`
 * silently return `undefined` and disabled all persistence. The regression
 * assertions live in the "AUDIT-I1 regression" describe block below.
 *
 * Everything runs against a fake in-memory localStorage — never the real
 * browser storage. SSR safety is exercised by removing the fake `window`.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createJSONStorage, type StateStorage } from 'zustand/middleware'

import {
  LEGACY_PERSIST_KEYS,
  createMigratingStorage,
} from '../../src/lib/wanyrix/legacy-migration'

/* ------------------------------------------------------------------ fake -- */

/** In-memory localStorage stand-in with a controllable failure mode. */
class FakeLocalStorage {
  private map = new Map<string, string>()
  /** when true, the next setItem throws (simulates quota / privacy mode) */
  failNextSet = false

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }

  setItem(key: string, value: string): void {
    if (this.failNextSet) {
      this.failNextSet = false
      throw new Error('QuotaExceededError (simulated)')
    }
    this.map.set(key, value)
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  seed(key: string, value: string): void {
    this.map.set(key, value)
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  keys(): string[] {
    return [...this.map.keys()]
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.map)
  }
}

let storage: FakeLocalStorage

beforeEach(() => {
  storage = new FakeLocalStorage()
  // The migration layer touches `window.localStorage` lazily (per call), so
  // injecting a fake window is enough; no jsdom required.
  ;(globalThis as { window?: unknown }).window = { localStorage: storage }
})

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

/* ---------------------------------------------------------------- mapping -- */

describe('legacy persist-key mapping table', () => {
  test('maps the three documented ferrix.* keys to their wanyrix.* successors', () => {
    expect(LEGACY_PERSIST_KEYS).toEqual({
      'wanyrix.active-workspace': 'ferrix.active-workspace',
      'wanyrix.scan-store': 'ferrix.scan-store',
      'wanyrix.diff-queue': 'ferrix.diff-queue',
    })
  })

  test('every pair keeps its key suffix and prefixes (wanyrix. ↔ ferrix.)', () => {
    for (const [next, legacy] of Object.entries(LEGACY_PERSIST_KEYS)) {
      expect(next.startsWith('wanyrix.')).toBe(true)
      expect(legacy.startsWith('ferrix.')).toBe(true)
      expect(next.slice('wanyrix.'.length)).toBe(legacy.slice('ferrix.'.length))
    }
  })
})

/* -------------------------------------------------------------- read path -- */

describe('getItem read path', () => {
  test('returns null for keys with no current value and no legacy source', () => {
    const s = createMigratingStorage()
    expect(s.getItem('wanyrix.never-seen')).toBeNull()
  })

  test('prefers the new wanyrix.* key and never touches legacy data when it exists', () => {
    storage.seed('wanyrix.scan-store', '{"fresh":true}')
    storage.seed('ferrix.scan-store', '{"stale":true}')

    const s = createMigratingStorage()
    expect(s.getItem('wanyrix.scan-store')).toBe('{"fresh":true}')
    // read-only toward legacy: a new-key hit must not migrate or delete
    expect(storage.has('ferrix.scan-store')).toBe(true)
    expect(storage.keys()).toEqual(['wanyrix.scan-store', 'ferrix.scan-store'])
  })

  test('migrates legacy-only reads: value returned, new key written, legacy removed', () => {
    storage.seed('ferrix.active-workspace', '{"state":{"active":"atlas-consortium"},"version":0}')

    const s = createMigratingStorage()
    // Our storage adapter is synchronous by contract (StateStorage also allows
    // Promise returns; the narrowing keeps the typecheck honest about that).
    const value = s.getItem('wanyrix.active-workspace') as string

    expect(value).toBe('{"state":{"active":"atlas-consortium"},"version":0}')
    expect(storage.getItem('wanyrix.active-workspace')).toBe(value) // copied first…
    expect(storage.has('ferrix.active-workspace')).toBe(false) // …then deleted
  })

  test('copy-before-delete: a failed write-through keeps the legacy key intact', () => {
    storage.seed('ferrix.diff-queue', '{"state":{"entries":{}},"version":0}')
    storage.failNextSet = true

    const s = createMigratingStorage()
    // The read must still serve the legacy value (no data-loss window)…
    expect(s.getItem('wanyrix.diff-queue')).toBe('{"state":{"entries":{}},"version":0}')
    // …and because the copy failed, the legacy source must survive.
    expect(storage.has('ferrix.diff-queue')).toBe(true)
    expect(storage.has('wanyrix.diff-queue')).toBe(false)

    // Recovery: the next read retries the migration and succeeds.
    expect(s.getItem('wanyrix.diff-queue')).toBe('{"state":{"entries":{}},"version":0}')
    expect(storage.has('wanyrix.diff-queue')).toBe(true)
    expect(storage.has('ferrix.diff-queue')).toBe(false)
  })

  test('double migration is a no-op (idempotency)', () => {
    storage.seed('ferrix.scan-store', '"v1"')
    const s = createMigratingStorage()

    const first = s.getItem('wanyrix.scan-store')
    const afterFirst = storage.snapshot()

    const second = s.getItem('wanyrix.scan-store')
    expect(second).toBe(first)
    expect(storage.snapshot()).toEqual(afterFirst) // storage untouched by re-read

    const third = s.getItem('wanyrix.scan-store')
    expect(third).toBe(first)
    expect(storage.snapshot()).toEqual(afterFirst)
    expect(storage.has('ferrix.scan-store')).toBe(false)
  })
})

/* ------------------------------------------------------------ write/remove -- */

describe('setItem / removeItem', () => {
  test('writes go to the new key only — legacy keys are never (re-)written', () => {
    const s = createMigratingStorage()
    s.setItem('wanyrix.scan-store', '"next"')

    expect(storage.getItem('wanyrix.scan-store')).toBe('"next"')
    expect(storage.keys().filter((k) => k.startsWith('ferrix.'))).toEqual([])
  })

  test('a legacy-named write is canonicalized to the wanyrix.* key', () => {
    const s = createMigratingStorage()
    s.setItem('ferrix.scan-store', '"via-legacy-name"')

    expect(storage.getItem('wanyrix.scan-store')).toBe('"via-legacy-name"')
    expect(storage.has('ferrix.scan-store')).toBe(false)
  })

  test('removeItem clears both the new and the legacy variant', () => {
    storage.seed('wanyrix.active-workspace', '"a"')
    storage.seed('ferrix.active-workspace', '"b"')

    createMigratingStorage().removeItem('wanyrix.active-workspace')
    expect(storage.has('wanyrix.active-workspace')).toBe(false)
    expect(storage.has('ferrix.active-workspace')).toBe(false)
  })

  test('removing a legacy-named key clears the canonical key too', () => {
    storage.seed('wanyrix.diff-queue', '"q"')
    createMigratingStorage().removeItem('ferrix.diff-queue')
    expect(storage.has('wanyrix.diff-queue')).toBe(false)
  })
})

/* --------------------------------------------------------------- SSR-safe -- */

describe('SSR safety (no window)', () => {
  test('reads return null and writes/removes are silent no-ops on the server', () => {
    delete (globalThis as { window?: unknown }).window

    const s = createMigratingStorage()
    expect(() => s.setItem('wanyrix.scan-store', '"x"')).not.toThrow()
    expect(() => s.removeItem('wanyrix.scan-store')).not.toThrow()
    expect(s.getItem('wanyrix.scan-store')).toBeNull()
  })
})

/* ---------------------------------------------------- AUDIT-I1 regression -- */

describe('AUDIT-I1 regression — createJSONStorage must receive the thunk', () => {
  test('createMigratingStorage() returns a StateStorage-shaped object', () => {
    const s = createMigratingStorage()
    expect(typeof s.getItem).toBe('function')
    expect(typeof s.setItem).toBe('function')
    expect(typeof s.removeItem).toBe('function')
  })

  test('the FIXED wiring — createJSONStorage(createMigratingStorage) — yields a defined PersistStorage', () => {
    // This is the exact expression every persisted store now uses.
    const persisted = createJSONStorage(createMigratingStorage)
    expect(persisted).toBeDefined()
    expect(typeof (persisted as { getItem: unknown }).getItem).toBe('function')
  })

  test('the OLD BUG — createJSONStorage(createMigratingStorage()) — yields undefined (persistence dead)', () => {
    // Recreates AUDIT-I1: passing the StateStorage object where a thunk is
    // expected makes zustand's silent try/catch return `undefined`. Cast is
    // intentional — the type error at this call site is the bug itself.
    const broken = createJSONStorage(
      createMigratingStorage() as unknown as () => StateStorage,
    )
    expect(broken).toBeUndefined()
  })

  test('PersistStorage hydrates through the migration chain (JSON parse + legacy copy)', () => {
    storage.seed(
      'ferrix.active-workspace',
      JSON.stringify({ state: { active: 'atlas-consortium' }, version: 0 }),
    )

    const persisted = createJSONStorage(createMigratingStorage)
    const hydrated = persisted?.getItem('wanyrix.active-workspace')

    expect(hydrated).toEqual({ state: { active: 'atlas-consortium' }, version: 0 })
    // The hydration read migrated the legacy key (write-through + cleanup).
    expect(storage.has('wanyrix.active-workspace')).toBe(true)
    expect(storage.has('ferrix.active-workspace')).toBe(false)
  })

  test('PersistStorage.setItem JSON-stringifies through the migration layer', () => {
    const persisted = createJSONStorage(createMigratingStorage)
    persisted?.setItem('wanyrix.active-workspace', {
      state: { active: 'helios-platform' },
      version: 0,
    })

    expect(storage.getItem('wanyrix.active-workspace')).toBe(
      JSON.stringify({ state: { active: 'helios-platform' }, version: 0 }),
    )
    expect(storage.keys().filter((k) => k.startsWith('ferrix.'))).toEqual([])
  })
})
