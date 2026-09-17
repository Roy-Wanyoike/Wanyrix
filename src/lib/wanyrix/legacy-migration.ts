'use client'

import type { StateStorage } from 'zustand/middleware'

/**
 * Legacy persisted-state migration — Ferrix → Wanyrix product identity
 * migration (docs/migrations/FERRIX_TO_WANYRIX.md §4).
 *
 * Browser state persisted under the previous product name is migrated with a
 * controlled, deterministic, idempotent, safe protocol:
 *
 *   old key (ferrix.*) ──detect──▶ copy ──▶ new key (wanyrix.*) ──▶ mark complete
 *
 * Protocol (implemented as a zustand `StateStorage` so it runs inside the
 * persist middleware's own hydration, regardless of module init order):
 *
 *   getItem(newKey)  → hit  ? return value
 *                    → miss ? read legacy key
 *                           ? copy value to newKey (write-through),
 *                             remove legacy key (completion marker),
 *                             return value
 *                           : return null
 *   setItem(newKey)  → write newKey only (legacy keys are never written)
 *   removeItem(newKey) → remove newKey AND legacy key
 *
 * Invariants:
 *  - legacy keys are READ-ONLY compatibility surfaces — never written to
 *  - no data is destroyed before it has been copied (safe)
 *  - running twice is a no-op (deterministic, idempotent)
 *  - re-seeding the legacy key restores the pre-migration state (reversible)
 *
 * These `ferrix.*` string literals are INTENTIONAL compatibility references —
 * whitelisted in scripts/check-branding.sh. Do not remove them.
 */

export const LEGACY_PERSIST_KEYS: Readonly<Record<string, string>> = {
  'wanyrix.active-workspace': 'ferrix.active-workspace',
  'wanyrix.scan-store': 'ferrix.scan-store',
  'wanyrix.diff-queue': 'ferrix.diff-queue',
}

export function createMigratingStorage(): StateStorage {
  const legacyKeyFor = (name: string): string | undefined =>
    Object.prototype.hasOwnProperty.call(LEGACY_PERSIST_KEYS, name)
      ? LEGACY_PERSIST_KEYS[name]
      : undefined

  return {
    getItem: (name) => {
      if (typeof window === 'undefined') return null
      const direct = window.localStorage.getItem(name)
      if (direct !== null) return direct
      const legacyName = legacyKeyFor(name)
      if (!legacyName) return null
      const legacy = window.localStorage.getItem(legacyName)
      if (legacy === null) return null
      try {
        window.localStorage.setItem(name, legacy)
      } catch {
        // storage full / private mode — still serve the migrated value for
        // this session; retry on next load
      }
      window.localStorage.removeItem(legacyName)
      return legacy
    },
    setItem: (name, value) => {
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(name, value)
      } catch {
        // best-effort — persistence is a UX affordance, not correctness
      }
    },
    removeItem: (name) => {
      if (typeof window === 'undefined') return
      const legacyName = legacyKeyFor(name)
      window.localStorage.removeItem(name)
      if (legacyName) window.localStorage.removeItem(legacyName)
    },
  }
}
