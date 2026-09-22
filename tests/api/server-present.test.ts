/**
 * AUD-4 — vacuous-green guard for the live API contract suites.
 *
 * Every live file in tests/api registers through ./harness and SKIPS (with a
 * counted `SKIPPED (n) — server absent` banner per file) when the dev server
 * is unreachable. That is ergonomic for ad-hoc runs but means a CI/gate run
 * could report green with ZERO route coverage. This gate closes that hole:
 *
 *   - server present                    → passes (live suites really run);
 *   - server absent + WANYRIX_REQUIRE_LIVE=1 → FAILS with a named error
 *     (gate mode: CI's live step and local gate runs export this flag);
 *   - server absent, flag unset         → the gate itself skips honestly and
 *     the per-file counted banners below make the skip visible.
 *
 * The gate runs FIRST (alphabetically the first file in tests/api), so it
 * can never hide behind skipped suites — it always reports the server state
 * explicitly.
 */
import { expect, test as bunTest } from 'bun:test'
import { BASE_URL, REQUIRE_LIVE, serverUp } from './harness'

if (serverUp) {
  bunTest('server presence gate — dev server reachable, live API suites WILL run', () => {
    expect(serverUp).toBe(true)
  })
} else if (REQUIRE_LIVE) {
  bunTest('server presence gate — WANYRIX_REQUIRE_LIVE=1 (server absence is a FAILURE)', () => {
    throw new Error(
      `dev server unreachable at ${BASE_URL} — every live suite in tests/api would skip, ` +
        'which is a vacuous green. WANYRIX_REQUIRE_LIVE=1 is set (gate mode), so this run FAILS. ' +
        'Start the dev server (bun run dev) or point WANYRIX_TEST_BASE_URL at a live instance.',
    )
  })
} else {
  // Ad-hoc ergonomic mode: skip honestly. Each live file prints its own
  // counted `SKIPPED (n) — server absent` banner; the runner summary shows
  // the skip total, so the state is never silent.
  bunTest.skip('server presence gate — server absent, WANYRIX_REQUIRE_LIVE unset (suites skip)', () => {
    expect(serverUp).toBe(true)
  })
  console.warn(
    `SKIPPED — server absent at ${BASE_URL}: live API suites will skip. ` +
      'Each file below prints its exact "SKIPPED (n) — server absent" count; ' +
      'set WANYRIX_REQUIRE_LIVE=1 to fail instead of skip (AUD-4).',
  )
}
