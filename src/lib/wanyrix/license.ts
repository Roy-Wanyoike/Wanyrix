/**
 * Local subscription licensing (issue #94 E1) — pure logic shared by the
 * Plans view and the sandbox issuer route (`POST /api/wanyrix/license/issue`).
 *
 * Honesty contract (mirrors engine/src/entitlement.rs + docs/COMMERCIAL.md):
 *   - The free tier is REAL: every core local surface stays free forever and
 *     is never gated (COMMERCIAL.md rule #1). No license is ever issued for
 *     it — a "free license" would be a dishonest artifact.
 *   - No payment integration exists in this environment. Issuance is
 *     sandbox-local and every action is labeled `estimated` — the portal
 *     never fakes a checkout, a price, or a charge, and no price numbers are
 *     published (docs/COMMERCIAL.md keeps prices deliberately unset).
 *   - The trial is 14 days and requires NO payment method.
 *   - The route mints real engine artifacts: `wanyrix license issue` signed
 *     tokens (`wanyrix.entitlement.token/v1`, ed25519) that `wanyrix
 *     activate` verifies 100% offline.
 */

/** The signed token artifact emitted by `wanyrix license issue --json`. */
export const TOKEN_SCHEMA = 'wanyrix.entitlement.token/v1'
/** The issuer route's own wrapper envelope (verbatim token + honesty label). */
export const ISSUE_ROUTE_SCHEMA = 'wanyrix.license-issue/v1'

/** Trial length in days (the engine's day-count expiry semantics). */
export const TRIAL_DAYS = 14
/** Sandbox Team-license validity (day counts — renewal replaces the cache). */
export const TEAM_DAYS = 365
/** Default seat count — matches the engine CLI default. */
export const DEFAULT_SEATS = 5

/**
 * Issuable plans. `team` mints a full Team-tier token; `trial` mints a
 * 14-day Team-tier token with no payment method. `free` is deliberately
 * absent (the free tier needs no license) and `enterprise` deliberately
 * absent from the sandbox (Enterprise issuance belongs to the on-prem
 * entitlement server — roadmap #66, out of scope for #94).
 */
export type IssuablePlan = 'team' | 'trial'

/** The honesty label carried by every sandbox issuance (badge + payload). */
export const HONESTY_LABEL = 'estimated'

/**
 * The sandbox honesty note — reused verbatim in the route payload and the
 * Plans view so UI and API can never drift apart on what actually happened.
 */
export const SANDBOX_ISSUE_NOTE =
  'Sandbox-local issuance — estimated, not a purchase. No payment method was collected and no charge was made; ' +
  'the token is a real offline-verifiable engine artifact for local activation only.'

/** How to turn an issued token into an activated entitlement (offline). */
export const ACTIVATION_HINT =
  'wanyrix activate --key <token-file> — offline ed25519 verification against the embedded release key; zero network I/O.'

/**
 * Team-id sanity (the route-side check; the engine independently enforces
 * 1..=128 chars). Sane identifiers only: alphanumerics plus `._- ` and no
 * leading/trailing separators — a token field is display-only, but it must
 * never smuggle shell/path-shaped junk into logs or terminals.
 */
export function validateTeamId(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const team = v.trim()
  if (team.length === 0 || team.length > 128) return null
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9 ._+-]*[A-Za-z0-9._+-])?$/.test(team)) return null
  return team
}

/** Parse the `plan` field of an issue request. Unknown → null (never coerced). */
export function parseIssuePlan(v: unknown): IssuablePlan | null {
  return v === 'team' || v === 'trial' ? v : null
}

/**
 * Validate the optional `seats` field: a positive integer within the engine
 * contract (1..=100000), defaulting to the CLI default of 5 when absent.
 */
export function parseSeats(v: unknown): number | null {
  if (v === undefined || v === null) return DEFAULT_SEATS
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 100_000) return null
  return v
}

/**
 * The engine argv for one sandbox issuance (`wanyrix license issue … --json`).
 * Both plans mint TEAM-tier tokens: a trial IS a 14-day team entitlement
 * (engine plans are free|team|enterprise; "trial" is a duration + honesty
 * label here, not a token plan — the engine refuses to issue `free`).
 * The signing key argument comes from the server env — never from a request.
 */
export function issueArgsFor(plan: IssuablePlan, team: string, key: string, seats = DEFAULT_SEATS): string[] {
  return [
    'license',
    'issue',
    '--plan',
    'team',
    '--team',
    team,
    '--days',
    plan === 'trial' ? String(TRIAL_DAYS) : String(TEAM_DAYS),
    '--seats',
    String(seats),
    '--key',
    key,
    '--json',
  ]
}

/** Per-plan honesty label + trial framing for the route payload / view. */
export function issueHonestyFor(plan: IssuablePlan): {
  label: typeof HONESTY_LABEL
  note: string
  kind: 'trial' | 'paid-tier-sandbox'
} {
  return {
    label: HONESTY_LABEL,
    note: plan === 'trial' ? `${SANDBOX_ISSUE_NOTE} 14-day trial — no payment method required.` : SANDBOX_ISSUE_NOTE,
    kind: plan === 'trial' ? 'trial' : 'paid-tier-sandbox',
  }
}

/* --------------------------------------------------------------- the tiers -- */

export type TierStatus = 'free-forever' | 'sandbox-estimated' | 'release-server'

export interface LicenseTier {
  id: 'free' | 'team' | 'enterprise'
  name: string
  /** Price DIRECTION only — numbers are deliberately not published (COMMERCIAL.md). */
  price: string
  status: TierStatus
  /** What the tier unlocks — mapped to roadmap #66 / issue #94. */
  surfaces: string[]
  footnote: string
}

export const LICENSE_TIERS: LicenseTier[] = [
  {
    id: 'free',
    name: 'Free',
    price: 'free forever',
    status: 'free-forever',
    surfaces: [
      'Every core local surface: doctor · graph · health · analyze · dependencies',
      'Build analysis, findings with evidence, experiments ledger, event receipts',
      'Artifacts-as-code export, local AI (Ollama-class), full offline operation',
      'Measurements never leave the machine — no license file ever required',
    ],
    footnote: 'Never gated, never a crippled trial (docs/COMMERCIAL.md rule #1). Core measured data on disk is never hidden or expired.',
  },
  {
    id: 'team',
    name: 'Team',
    price: 'per engineer / month — to be validated',
    status: 'sandbox-estimated',
    surfaces: [
      'Export sharing — sha256-bound artifacts diffed across the team',
      'Registry sync + CI referee (lands with issue #92 — the gate is live)',
      'Team dashboards over shared scan-run history',
    ],
    footnote: 'Gated surfaces are named in the engine registry (sync.push/sync.pull → team); everything else stays free. Sandbox buttons below issue a real token, labeled estimated — no payment exists yet.',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'custom annual — to be validated',
    status: 'release-server',
    surfaces: [
      'SSO / SAML / OIDC / SCIM',
      'Audit logs + compliance evidence',
      'On-prem entitlement server — your own signing key, your machines verify offline',
    ],
    footnote: 'Issuance runs on the on-prem entitlement server at release (roadmap #66) — not available in this sandbox, and the sandbox issuer deliberately does not mint Enterprise tokens.',
  },
]
