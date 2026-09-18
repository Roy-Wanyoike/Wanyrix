/**
 * fixtures/shared — constants shared across the fixture domain modules.
 *
 * Part of the data.ts decomposition (GitHub issue #53): `src/lib/wanyrix/data.ts`
 * is now a pure re-export barrel and every existing consumer keeps importing
 * from `@/lib/wanyrix/data` unchanged. This module owns REPO_URL.
 */
export const REPO_URL = 'https://github.com/Roy-Wanyoike/wanyrix'
