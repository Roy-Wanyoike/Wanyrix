/**
 * Issue #109 — the CLI-contract dialog pins the engine command set shown to
 * users; drift between it and docs/CLI.md is the web/engine contract-drift
 * risk (docs/AUDIT.md R3). This suite pins the dialog's command-set data
 * source (the exported COMMANDS / EXIT_CODES arrays in
 * src/components/wanyrix/cli-dialog.tsx) against docs/CLI.md rows 19–23:
 *
 *   19/20  wanyrix sync push|pull      (issue #92, wanyrix.sync/v1)
 *   21     wanyrix activate            (issue #94, wanyrix.entitlement/v1)
 *   22     wanyrix entitlement         (issue #94, wanyrix.entitlement/v1)
 *   23     wanyrix license keygen|issue (issue #94, license-keygen/token)
 *
 * Command names, flags, envelope ids and honesty labels must match the docs
 * contract — no fabricated capabilities. The dialog itself is a Radix client
 * component (portal-rendered), so the contract is pinned at the same
 * data-source level the dialog renders row for row.
 */
import { describe, expect, test } from 'bun:test'

import { COMMANDS, EXIT_CODES } from '../../src/components/wanyrix/cli-dialog'

const cmdAt = (prefix: string) => COMMANDS.find((c) => c.cmd.startsWith(prefix))!

describe('cli dialog command set — docs/CLI.md rows 19–23 (issue #109)', () => {
  test('row count is pinned: 24 rows (22 pre-#109 + the sync push/pull pair)', () => {
    expect(COMMANDS).toHaveLength(24)
  })

  test('docs row order 18→23: export → sync push → sync pull → activate → entitlement → license', () => {
    const idx = (prefix: string) => COMMANDS.findIndex((c) => c.cmd.startsWith(prefix))
    const exportIdx = idx('wanyrix export')
    expect(exportIdx).toBeGreaterThan(0)
    expect(idx('wanyrix sync push')).toBe(exportIdx + 1)
    expect(idx('wanyrix sync pull')).toBe(exportIdx + 2)
    expect(idx('wanyrix activate')).toBe(exportIdx + 3)
    expect(idx('wanyrix entitlement')).toBe(exportIdx + 4)
    expect(idx('wanyrix license')).toBe(exportIdx + 5)
  })

  test('row 19 — sync push: --remote flag, sync/v1 envelope, named refusals, no-op re-push', () => {
    const push = cmdAt('wanyrix sync push')
    expect(push.cmd).toBe('wanyrix sync push --remote <path|url> --json')
    expect(push.maps).toContain('wanyrix.sync/v1')
    expect(push.maps).toContain('registry branch')
    expect(push.maps).toContain('no-op')
    expect(push.maps).toContain('named refusal')
    // docs mirrors column says "none yet" — the row must not fabricate a view
    expect(push.maps).toContain('no web mirror yet')
  })

  test('row 20 — sync pull: merge conflicts named, never a silent overwrite, no tier upgrades', () => {
    const pull = cmdAt('wanyrix sync pull')
    expect(pull.cmd).toBe('wanyrix sync pull --remote <path|url> --json')
    expect(pull.maps).toContain('wanyrix.sync/v1')
    expect(pull.maps).toContain('SYNC-CONFLICT')
    expect(pull.maps).toContain('never a silent overwrite')
    expect(pull.maps).toContain('peer-reported-verified')
    expect(pull.maps).toContain('names the missing branch')
  })

  test('row 21 — activate: --key accepts token-file|literal, offline, refusals never cached', () => {
    const activate = cmdAt('wanyrix activate')
    expect(activate.cmd).toBe('wanyrix activate --key <token-file|literal>')
    expect(activate.maps).toContain('OFFLINE')
    expect(activate.maps).toContain('zero network I/O')
    expect(activate.maps).toContain('never cached')
    expect(activate.maps).toContain('wanyrix.entitlement/v1')
  })

  test('row 22 — entitlement: honest not-activated envelope + 30-day grace', () => {
    const entitlement = cmdAt('wanyrix entitlement')
    expect(entitlement.cmd).toBe('wanyrix entitlement --json')
    expect(entitlement.maps).toContain('not-activated')
    expect(entitlement.maps).toContain('30-day grace')
    expect(entitlement.maps).toContain('wanyrix.entitlement/v1')
  })

  test('row 23 — license keygen|issue: 0600 keys, free never issued, both envelopes cited', () => {
    const license = cmdAt('wanyrix license')
    expect(license.cmd).toBe('wanyrix license keygen|issue')
    expect(license.maps).toContain('0600')
    expect(license.maps).toContain('ed25519')
    expect(license.maps).toContain('free is never issued')
    expect(license.maps).toContain('wanyrix.license-keygen/v1')
    expect(license.maps).toContain('wanyrix.entitlement.token/v1')
  })

  test('no fabricated capabilities: the five surfaces are deterministic — the only AI row is wanyrix ai', () => {
    const aiRows = COMMANDS.filter((c) => c.ai)
    expect(aiRows).toHaveLength(1)
    expect(aiRows[0]!.cmd.startsWith('wanyrix ai')).toBe(true)
    for (const prefix of [
      'wanyrix sync push',
      'wanyrix sync pull',
      'wanyrix activate',
      'wanyrix entitlement',
      'wanyrix license',
    ]) {
      expect(cmdAt(prefix).ai).toBeUndefined()
    }
  })

  test('every command is unique — the dialog keys rows by cmd', () => {
    const cmds = COMMANDS.map((c) => c.cmd)
    expect(new Set(cmds).size).toBe(cmds.length)
  })

  test('exit codes stay the documented 0/2/101 ladder; code 2 names the refusal class', () => {
    expect(EXIT_CODES.map((e) => e.code)).toEqual(['0', '2', '101'])
    expect(EXIT_CODES.find((e) => e.code === '2')!.label).toContain('named refusal')
  })
})
