/**
 * Issue #94 E1 — local subscription licensing: unit/contract tests.
 *
 * Three layers, no dev server required:
 *   1. The pure licensing lib (src/lib/wanyrix/license.ts) — tier honesty,
 *      plan/team/seats validation, trial mapping (14 days), argv mapping.
 *   2. The REAL route handler (src/app/api/wanyrix/license/issue/route.ts)
 *      invoked directly with Request objects: 405/400/503 contracts, and —
 *      when the engine binary is built on this machine — a full 200 issuance
 *      against an ephemeral keypair written to a temp dir (fixed seed, NEVER
 *      committed; the file lives under the OS temp dir only). This exercises
 *      the actual `wanyrix license issue` spawn and pins the token schema +
 *      the `estimated` honesty label end-to-end.
 *   3. The Plans view — SSR-rendered with react-dom/server to pin the three
 *      tiers, the honest labels, and the no-fake-pricing rule.
 *
 * Live HTTP contract tests (405/404/400/503/200 over the wire) live in
 * tests/api/wanyrix-license.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as cryptoModule from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

import { resolveEngineBinary } from '../../src/lib/wanyrix/engine-exec'
import {
  ACTIVATION_HINT,
  DEFAULT_SEATS,
  HONESTY_LABEL,
  ISSUE_ROUTE_SCHEMA,
  LICENSE_TIERS,
  TOKEN_SCHEMA,
  TRIAL_DAYS,
  issueArgsFor,
  issueHonestyFor,
  parseIssuePlan,
  parseSeats,
  validateTeamId,
} from '../../src/lib/wanyrix/license'
import { NAV_ITEMS, VIEW_TITLES } from '../../src/components/wanyrix/nav-registry'
import { POST, GET, PUT, DELETE, PATCH } from '../../src/app/api/wanyrix/license/issue/route'
import PlansView, {
  IssuanceFeedback,
  parseIssueResponse,
} from '../../src/components/wanyrix/views/plans-view'

/* --------------------------------------------------------------- plumbing -- */

const ROUTE = 'http://localhost/api/wanyrix/license/issue'

function post(body: unknown): Promise<Response> {
  return POST(
    new Request(ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }) as never,
  )
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  expect(res.headers.get('content-type')).toContain('application/json')
  return (await res.json()) as Record<string, unknown>
}

/**
 * Derive the raw ed25519 public key (hex) from a 32-byte seed via node:crypto
 * — the same key material the engine derives from the seed, so the activate
 * round-trip can pin the web-issued token against the engine's verifier.
 */
function publicKeyHexFromSeed(hexSeed: string): string {
  const { createPrivateKey, createPublicKey } = cryptoModule
  const seed = Buffer.from(hexSeed, 'hex')
  // RFC 8410 PKCS8 prefix for an ed25519 private key (32-byte seed payload).
  const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex')
  const priv = createPrivateKey({ key: Buffer.concat([pkcs8Prefix, seed]), format: 'der', type: 'pkcs8' })
  const spki = createPublicKey(priv).export({ format: 'der', type: 'spki' }) as Buffer
  return spki.subarray(spki.length - 32).toString('hex')
}

/* ------------------------------------------------- 1. the licensing lib ---- */

describe('license tiers — three honest tiers (issue #94)', () => {
  test('exactly Free / Team / Enterprise, mapped to the roadmap', () => {
    expect(LICENSE_TIERS.map((t) => t.id)).toEqual(['free', 'team', 'enterprise'])
    expect(LICENSE_TIERS.map((t) => t.name)).toEqual(['Free', 'Team', 'Enterprise'])
  })

  test('Free is the real permanent tier: core local surfaces, never gated', () => {
    const free = LICENSE_TIERS[0]!
    expect(free.status).toBe('free-forever')
    expect(free.price).toBe('free forever')
    const all = free.surfaces.join(' ')
    for (const core of ['doctor', 'graph', 'health', 'analyze', 'dependencies']) {
      expect(all).toContain(core)
    }
    expect(free.footnote).toContain('Never gated')
  })

  test('Team maps to export sharing + registry sync (#92) + team dashboards', () => {
    const team = LICENSE_TIERS[1]!
    expect(team.status).toBe('sandbox-estimated')
    const all = team.surfaces.join(' ')
    expect(all).toContain('Export sharing')
    expect(all).toContain('Registry sync')
    expect(all).toContain('Team dashboards')
  })

  test('Enterprise maps to SSO + audit + on-prem entitlement server', () => {
    const ent = LICENSE_TIERS[2]!
    expect(ent.status).toBe('release-server')
    const all = ent.surfaces.join(' ')
    expect(all).toContain('SSO')
    expect(all).toContain('Audit')
    expect(all).toContain('On-prem entitlement server')
  })

  test('no price numbers are invented (COMMERCIAL.md: prices deliberately unpublished)', () => {
    const rendered = renderToStaticMarkup(<PlansView />)
    expect(rendered).not.toContain('$')
    expect(rendered).not.toMatch(/\bUSD\b/)
  })
})

describe('issue request validation', () => {
  test('plan ∈ {team, trial} only — free and enterprise are never sandbox-issued', () => {
    expect(parseIssuePlan('team')).toBe('team')
    expect(parseIssuePlan('trial')).toBe('trial')
    expect(parseIssuePlan('free')).toBeNull()
    expect(parseIssuePlan('enterprise')).toBeNull()
    expect(parseIssuePlan('unlimited')).toBeNull()
    expect(parseIssuePlan(undefined)).toBeNull()
    expect(parseIssuePlan(null)).toBeNull()
    expect(parseIssuePlan(7)).toBeNull()
  })

  test('team id sanity: 1..=128 chars, sane identifier charset', () => {
    expect(validateTeamId('acme')).toBe('acme')
    expect(validateTeamId('  acme corp.2  ')).toBe('acme corp.2')
    expect(validateTeamId('a'.repeat(128))).toBe('a'.repeat(128))
    expect(validateTeamId('')).toBeNull()
    expect(validateTeamId('   ')).toBeNull()
    expect(validateTeamId('a'.repeat(129))).toBeNull()
    expect(validateTeamId('../etc/passwd')).toBeNull()
    expect(validateTeamId('acme;rm -rf')).toBeNull()
    expect(validateTeamId('team\nfoo')).toBeNull()
    expect(validateTeamId(42)).toBeNull()
    expect(validateTeamId(undefined)).toBeNull()
  })

  test('seats: optional, integer 1..=100000, engine default when absent', () => {
    expect(parseSeats(undefined)).toBe(DEFAULT_SEATS)
    expect(parseSeats(null)).toBe(DEFAULT_SEATS)
    expect(parseSeats(1)).toBe(1)
    expect(parseSeats(100_000)).toBe(100_000)
    expect(parseSeats(0)).toBeNull()
    expect(parseSeats(100_001)).toBeNull()
    expect(parseSeats(2.5)).toBeNull()
    expect(parseSeats('5')).toBeNull()
  })

  test('engine argv: trial = 14-day team token, team = 365 days; key never from request', () => {
    const trial = issueArgsFor('trial', 'acme', '/tmp/priv.hex')
    expect(trial.slice(0, 3)).toEqual(['license', 'issue', '--plan'])
    expect(trial).toContain('team')
    expect(trial.join(' ')).toContain(`--days ${TRIAL_DAYS}`)
    expect(trial.join(' ')).toContain('--seats 5')
    expect(trial.join(' ')).toContain('--key /tmp/priv.hex')
    expect(trial).toContain('--json')
    const team = issueArgsFor('team', 'acme', 'deadbeef', 25)
    expect(team.join(' ')).toContain('--days 365')
    expect(team.join(' ')).toContain('--seats 25')
  })

  test('honesty label is estimated for BOTH plans and the note names no-payment', () => {
    for (const plan of ['team', 'trial'] as const) {
      const h = issueHonestyFor(plan)
      expect(h.label).toBe('estimated')
      expect(h.note).toContain('estimated')
      expect(h.note).toContain('No payment method was collected')
      expect(h.note.toLowerCase()).toContain('no charge')
    }
    expect(issueHonestyFor('trial').kind).toBe('trial')
    expect(issueHonestyFor('trial').note).toContain('14-day trial')
  })

  test('the activation hint promises offline verification and zero sockets', () => {
    expect(ACTIVATION_HINT).toContain('wanyrix activate --key')
    expect(ACTIVATION_HINT.toLowerCase()).toContain('offline')
  })
})

/* ------------------------------------------- 2. the REAL route handler ----- */

const engineBinary = await resolveEngineBinary()
const describeWithEngine = describe.skipIf(engineBinary === null)

if (engineBinary === null) {
  console.warn(
    '[license-issue] engine binary not built — skipping the 200 issuance paths (the 405/400/503 contracts below still run). Build with `cd engine && cargo build`.',
  )
}

describe('license issue route — method guards (405, ENG-TCA-6a)', () => {
  for (const [name, handler] of [
    ['GET', GET],
    ['PUT', PUT],
    ['DELETE', DELETE],
    ['PATCH', PATCH],
  ] as const) {
    test(`${name} → 405 JSON with Allow: POST`, async () => {
      const res = await handler()
      expect(res.status).toBe(405)
      expect(res.headers.get('Allow')).toBe('POST')
      const body = await jsonOf(res)
      expect(String(body.error)).toContain('method not allowed')
    })
  }
})

describe('license issue route — request validation (400)', () => {
  test('non-JSON body → 400 named refusal', async () => {
    const res = await post('this is not json')
    expect(res.status).toBe(400)
    const body = await jsonOf(res)
    expect(String(body.error)).toContain('not valid JSON')
  })

  test('non-object body → 400', async () => {
    const res = await post('[1,2,3]')
    expect(res.status).toBe(400)
    const body = await jsonOf(res)
    expect(String(body.error)).toContain('JSON object')
  })

  test('unknown plan → 400 naming the valid plans and why free/enterprise are absent', async () => {
    for (const plan of ['free', 'enterprise', 'unlimited', 42, null]) {
      const res = await post({ plan, team: 'acme' })
      expect(res.status).toBe(400)
      const body = await jsonOf(res)
      const err = String(body.error)
      expect(err).toContain('unknown plan')
      expect(err).toContain("'team'")
      expect(err).toContain("'trial'")
      expect(err).toContain('never issued')
    }
  })

  test('missing/insane team → 400', async () => {
    for (const team of [undefined, '', '   ', 'a'.repeat(129), '../etc/passwd', 7]) {
      const res = await post({ plan: 'team', team })
      expect(res.status).toBe(400)
      const body = await jsonOf(res)
      expect(String(body.error)).toContain('team must be')
    }
  })

  test('invalid seats → 400', async () => {
    for (const seats of [0, -3, 2.5, '5', 100_001]) {
      const res = await post({ plan: 'team', team: 'acme', seats })
      expect(res.status).toBe(400)
      const body = await jsonOf(res)
      expect(String(body.error)).toContain('seats must be')
    }
  })
})

describe('license issue route — honest 503 without a configured issuer', () => {
  const savedEnv = process.env.WANYRIX_SIGNING_KEY

  test('env missing → 503 that names WANYRIX_SIGNING_KEY and never fakes a token', async () => {
    delete process.env.WANYRIX_SIGNING_KEY
    const res = await post({ plan: 'trial', team: 'acme' })
    expect(res.status).toBe(503)
    const body = await jsonOf(res)
    expect(String(body.error)).toContain('WANYRIX_SIGNING_KEY')
    expect(String(body.error)).toContain('never simulated')
    expect(body.env).toBe('WANYRIX_SIGNING_KEY')
    expect(String(body.hint)).toContain('wanyrix license keygen')
    expect(body.token).toBeUndefined()
  })

  test('env pointing at an unreadable file → 503, refuses to guess', async () => {
    process.env.WANYRIX_SIGNING_KEY = '/nonexistent/wanyrix-license-priv.hex'
    const res = await post({ plan: 'team', team: 'acme' })
    expect(res.status).toBe(503)
    const body = await jsonOf(res)
    expect(String(body.error)).toContain('unreadable signing key file')
  })

  // restore — the mutations above must not leak into other files
  if (savedEnv === undefined) delete process.env.WANYRIX_SIGNING_KEY
  else process.env.WANYRIX_SIGNING_KEY = savedEnv
})

describeWithEngine('license issue route — real issuance (engine binary present)', () => {
  const seed = 'aa'.repeat(32) // fixed seed — ephemeral, temp-dir only, never committed
  let keyDir: string
  let savedEnv: string | undefined

  // The engine CLI accepts the literal hex seed or a file path; we use a
  // file under the OS temp dir to pin the documented file-path contract.
  const setup = () => {
    keyDir = mkdtempSync(join(tmpdir(), 'wanyrix-license-test-'))
    writeFileSync(join(keyDir, 'priv.hex'), seed, { mode: 0o600 })
    savedEnv = process.env.WANYRIX_SIGNING_KEY
    process.env.WANYRIX_SIGNING_KEY = join(keyDir, 'priv.hex')
  }
  const teardown = () => {
    if (savedEnv === undefined) delete process.env.WANYRIX_SIGNING_KEY
    else process.env.WANYRIX_SIGNING_KEY = savedEnv
    rmSync(keyDir, { recursive: true, force: true })
  }

  test('trial → 200 envelope with a VERBATIM 14-day team token, labeled estimated', async () => {
    setup()
    try {
      const res = await post({ plan: 'trial', team: 'acme' })
      expect(res.status).toBe(200)
      const body = await jsonOf(res)

      expect(body.schema).toBe(ISSUE_ROUTE_SCHEMA)
      expect(body.surface).toBe('license.issue')
      expect(typeof body.executedAt).toBe('string')
      expect(typeof body.durationMs).toBe('number')

      const binary = body.binary as { version?: string; profile?: string }
      expect(binary.version).toMatch(/^wanyrix/)
      expect(['debug', 'release']).toContain(binary.profile)

      // The honesty label — the WHOLE point of the sandbox issuer.
      const honesty = body.honesty as { label?: string; note?: string; kind?: string }
      expect(honesty.label).toBe('estimated')
      expect(honesty.kind).toBe('trial')
      expect(String(honesty.note)).toContain('no payment method')

      const activation = body.activation as { hint?: string; network?: string }
      expect(String(activation.hint)).toContain('wanyrix activate --key')
      expect(String(activation.network)).toContain('offline')

      // The token itself — engine artifact, verbatim schema/fields.
      const token = body.token as Record<string, unknown>
      expect(token.schema).toBe(TOKEN_SCHEMA)
      expect(token.version).toBe(1)
      expect(token.plan).toBe('team')
      expect(token.team).toBe('acme')
      expect(token.seats).toBe(DEFAULT_SEATS)
      expect(token.nonce).toMatch(/^[0-9a-f]{32}$/)
      expect(token.signature).toMatch(/^[0-9a-f]{128}$/)
      expect(
        (token.expiryDay as number) - (token.issuedAtDay as number),
      ).toBe(TRIAL_DAYS)
    } finally {
      teardown()
    }
  })

  test('team → 200 envelope, 365-day token; seats pass through', async () => {
    setup()
    try {
      const res = await post({ plan: 'team', team: 'acme inc', seats: 25 })
      expect(res.status).toBe(200)
      const body = await jsonOf(res)
      const token = body.token as Record<string, unknown>
      expect(token.plan).toBe('team')
      expect(token.team).toBe('acme inc')
      expect(token.seats).toBe(25)
      expect((token.expiryDay as number) - (token.issuedAtDay as number)).toBe(365)
      expect((body.honesty as { kind?: string }).kind).toBe('paid-tier-sandbox')
    } finally {
      teardown()
    }
  })

  test('the issued token is a REAL offline-verifiable artifact — engine round-trip', async () => {
    setup()
    try {
      const res = await post({ plan: 'trial', team: 'acme' })
      expect(res.status).toBe(200)
      const body = await jsonOf(res)
      const token = body.token as Record<string, unknown>

      // The full E1→E2 round trip through the REAL CLI binary:
      // derive the public half from the fixed seed (node:crypto, PKCS8 wrap),
      // then `wanyrix activate --key <token>` must verify the signature
      // OFFLINE and report an active team entitlement.
      const pubHex = publicKeyHexFromSeed(seed)
      const workDir = mkdtempSync(join(tmpdir(), 'wanyrix-activate-test-'))
      const tokenFile = join(workDir, 'token.json')
      writeFileSync(tokenFile, JSON.stringify(token), { mode: 0o600 })
      try {
        const proc = Bun.spawnSync([engineBinary!.file, 'activate', '--key', tokenFile], {
          cwd: workDir, // the engine caches .wanyrix/entitlement.json HERE, never in the repo
          env: { ...process.env, WANYRIX_ACTIVATION_PUBKEY: pubHex },
        })
        const stdout = proc.stdout.toString()
        expect(proc.exitCode).toBe(0)
        expect(stdout).toContain('status: active')
        expect(stdout).toContain('plan: team')
        expect(stdout).toContain('team: acme')
        expect(stdout).toContain('zero network I/O')
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }
    } finally {
      teardown()
    }
  })
})

/* ------------------------------------------------------- 3. Plans view ----- */

describe('Plans view — renders the three tiers with honest labels', () => {
  const html = renderToStaticMarkup(<PlansView />)

  test('all three tier names render', () => {
    expect(html).toContain('Free')
    expect(html).toContain('Team')
    expect(html).toContain('Enterprise')
  })

  test('the trial button carries the honest 14-day / no-payment-method label', () => {
    expect(html).toContain('14-day trial — no payment method')
  })

  test('every sandbox issuance action carries the estimated label', () => {
    expect(html).toContain('estimated')
    expect(html).toContain('sandbox')
    expect(html).toContain('no payments')
  })

  test('free tier states its permanence and the no-charge rule', () => {
    expect(html).toContain('free forever')
    expect(html).toContain('nothing to buy, nothing to activate')
  })

  test('enterprise has NO sandbox issuance button (on-prem server only)', () => {
    expect(html).toContain('does not mint Enterprise')
  })

  test('before any action the view shows neither a token nor a faked purchase', () => {
    expect(html).not.toContain('wanyrix.entitlement.token/v1')
    expect(html).not.toContain('Issued license token')
  })
})

/* --------------------------------------------- 3b. Plans view — QA-5-B-2 --- */

/**
 * QA-5-B-2 — the honest 503 must reach the user. The walkthrough found the
 * issuance buttons produced ZERO visible outcome (no toast, no inline error,
 * no state change) when the route answered its documented 503. These pins
 * cover both branches of the pure outcome mapping and the inline feedback.
 */
describe('Plans view — issuer outcomes are never silent (QA-5-B-2)', () => {
  const FIFTY3_BODY = {
    error:
      'no signing key configured on this host — set WANYRIX_SIGNING_KEY to enable sandbox issuance (never simulated)',
    env: 'WANYRIX_SIGNING_KEY',
    hint: 'wanyrix license keygen --out ./priv.hex',
  }

  test('503 response → named error carrying the status, the cause and the fix hint', () => {
    const outcome = parseIssueResponse({ ok: false, status: 503 }, FIFTY3_BODY)
    expect(outcome.kind).toBe('error')
    if (outcome.kind !== 'error') return
    expect(outcome.title).toBe('Issuer refused (503)')
    expect(outcome.detail).toContain('WANYRIX_SIGNING_KEY')
    expect(outcome.detail).toContain('wanyrix license keygen')
  })

  test('every error branch states that NOTHING WAS ISSUED', () => {
    const fifty3 = parseIssueResponse({ ok: false, status: 503 }, FIFTY3_BODY)
    const nonJson = parseIssueResponse({ ok: false, status: 503 }, null)
    const wrongSchema = parseIssueResponse({ ok: true, status: 200 }, { token: { schema: 'other/v1' } })
    for (const outcome of [fifty3, nonJson, wrongSchema]) {
      expect(outcome.kind).toBe('error')
      if (outcome.kind === 'error') expect(outcome.detail).toContain('Nothing was issued.')
    }
  })

  test('non-JSON issuer body → named error, not a crash', () => {
    const outcome = parseIssueResponse({ ok: false, status: 503 }, null)
    expect(outcome.kind).toBe('error')
    if (outcome.kind === 'error') expect(outcome.detail).toContain('not JSON')
  })

  test('success response → token outcome with the honesty note and engine version', () => {
    const token = {
      schema: 'wanyrix.entitlement.token/v1',
      version: 1,
      plan: 'team',
      team: 'local-sandbox',
      seats: 5,
      issuedAtDay: 20714,
      expiryDay: 21079,
      nonce: 'a'.repeat(32),
      signature: 'b'.repeat(128),
    }
    const outcome = parseIssueResponse(
      { ok: true, status: 200 },
      { token, honesty: { note: 'Sandbox issuance — estimated. No payment method was collected.' }, binary: { version: 'wanyrix 0.9.0' } },
    )
    expect(outcome.kind).toBe('token')
    if (outcome.kind !== 'token') return
    expect(outcome.token.team).toBe('local-sandbox')
    expect(outcome.token.seats).toBe(5)
    expect(outcome.honestyNote).toContain('estimated')
    expect(outcome.binaryVersion).toBe('wanyrix 0.9.0')
  })

  test('the inline feedback renders role=alert with the verbatim reason, adjacent to the buttons', () => {
    const outcome = parseIssueResponse({ ok: false, status: 503 }, FIFTY3_BODY)
    expect(outcome.kind).toBe('error')
    if (outcome.kind !== 'error') return
    const html = renderToStaticMarkup(<IssuanceFeedback error={{ title: outcome.title, detail: outcome.detail }} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('Issuer refused (503)')
    expect(html).toContain('WANYRIX_SIGNING_KEY')
    expect(html).toContain('Nothing was issued.')
  })

  test('no error → no feedback rendered', () => {
    expect(renderToStaticMarkup(<IssuanceFeedback error={null} />)).toBe('')
  })

  test('source pins — the view toasts BOTH branches and keeps the buttons disabled while pending', async () => {
    const view = await Bun.file(
      new URL('../../src/components/wanyrix/views/plans-view.tsx', import.meta.url),
    ).text()
    expect(view).toContain("variant: 'destructive'")
    expect(view).toContain("title: 'License token issued (estimated)'")
    expect(view).toContain('IssuanceFeedback error={error}')
    expect(view).toContain('disabled={pending !== null}')
  })
})

/* ------------------------------------------------ 4. navigation registration -- */

describe('Plans view — registered in the app shell navigation', () => {
  test('nav registry exposes plans (sidebar + palette + mobile share one source)', () => {
    const plans = NAV_ITEMS.find((i) => i.id === 'plans')
    expect(plans).toBeDefined()
    expect(plans!.label).toBe('Plans')
  })

  test('topbar title/subtitle exist for the plans view', () => {
    expect(VIEW_TITLES.plans!.title).toBe('Plans')
    expect(VIEW_TITLES.plans!.sub).toContain('sandbox license issuance')
  })

  test('page.tsx maps the plans ViewId to PlansView (source pin)', async () => {
    const page = await Bun.file(new URL('../../src/app/page.tsx', import.meta.url)).text()
    expect(page).toContain("plans: PlansView")
  })
})
