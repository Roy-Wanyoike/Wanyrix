'use client'

import type { StateStorage } from 'zustand/middleware'

/**
 * Legacy persist-key migration layer (Ferrix → Wanyrix product rename).
 *
 * Existing users carry persisted zustand state under the old `ferrix.*`
 * localStorage keys. Losing that state would silently discard scan history,
 * the reviewable-diff queue and the active workspace selection, so instead of
 * a hard cutover this storage adapter is wired into every persisted store:
 *
 *  - reads prefer the new `wanyrix.*` key;
 *  - on first read, if only the legacy `ferrix.*` key exists, the value is
 *    copied (write-through) to the new key and ONLY THEN the legacy key is
 *    removed — read-only toward legacy until the copy has succeeded;
 *  - writes always target the new key; legacy keys are never (re-)written;
 *  - removes clear both variants so a store reset cannot resurrect stale data.
 *
 * The layer is deterministic, idempotent and SSR-safe (no-op `null` reads on
 * the server), so it behaves identically during prerendering and in the
 * browser.
 */

/**
 * New persist key → legacy (pre-rename) persist key.
 * Kept as data so the protocol is auditable and testable.
 */
export const LEGACY_PERSIST_KEYS: Record<string, string> = {
  'wanyrix.active-workspace': 'ferrix.active-workspace',
  'wanyrix.scan-store': 'ferrix.scan-store',
  'wanyrix.diff-queue': 'ferrix.diff-queue',
}

const NEW_PREFIX = 'wanyrix.'
const LEGACY_PREFIX = 'ferrix.'

/** Legacy key → new key (inverse of {@link LEGACY_PERSIST_KEYS}, derived once). */
const NEW_KEY_BY_LEGACY: Record<string, string> = Object.fromEntries(
  Object.entries(LEGACY_PERSIST_KEYS).map(([next, legacy]) => [legacy, next]),
)

/**
 * Translate any key to its canonical (post-rename) form.
 * Accepts legacy keys and any `ferrix.*`-prefixed straggler so a write can
 * never recreate a legacy entry.
 */
function toCanonicalKey(name: string): string {
  if (name.startsWith(LEGACY_PREFIX)) {
    return NEW_KEY_BY_LEGACY[name] ?? `${NEW_PREFIX}${name.slice(LEGACY_PREFIX.length)}`
  }
  return name
}

/** The legacy key that must be migrated into `name`, if one exists. */
function legacySourceFor(name: string): string | undefined {
  return LEGACY_PERSIST_KEYS[name]
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage unavailable (quota / privacy mode) — leave legacy data intact.
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Ignore — nothing else we can do without a storage backend.
  }
}

/**
 * A zustand-compatible {@link StateStorage} that transparently migrates
 * legacy `ferrix.*` persist data to the `wanyrix.*` keys.
 * Pass to `createJSONStorage` in every persisted store.
 */
export function createMigratingStorage(): StateStorage {
  return {
    getItem(name): string | null {
      if (typeof window === 'undefined') return null

      const canonical = toCanonicalKey(name)
      const current = safeGet(canonical)
      if (current !== null) return current

      // New key absent — attempt one-shot migration from the legacy key.
      const legacyKey = legacySourceFor(canonical)
      if (!legacyKey) return null

      const legacyValue = safeGet(legacyKey)
      if (legacyValue === null) return null

      // Write-through first; delete the legacy key only after a successful
      // copy so a failed write never loses user data.
      safeSet(canonical, legacyValue)
      if (safeGet(canonical) === legacyValue) {
        safeRemove(legacyKey)
      }
      return legacyValue
    },

    setItem(name, value): void {
      if (typeof window === 'undefined') return
      // Never write legacy keys: canonicalize before persisting.
      safeSet(toCanonicalKey(name), value)
    },

    removeItem(name): void {
      if (typeof window === 'undefined') return
      const canonical = toCanonicalKey(name)
      safeRemove(canonical)
      const legacyKey = legacySourceFor(canonical)
      if (legacyKey) safeRemove(legacyKey)
    },
  }
}
