/**
 * fixtures/organization — demo org profile fixture (AUDIT-I3).
 *
 * Part of the data.ts decomposition (GitHub issue #53): `src/lib/wanyrix/data.ts`
 * is now a pure re-export barrel; the public surface (ORGANIZATION) is unchanged.
 * Types: OrganizationProfile comes from ../types — no type is defined here.
 */
import type { OrganizationProfile } from '../types'

// ---------------------------------------------------------------------------
// Organization fixture (AUDIT-I3) — demo org, members and the commercial
// tier model from pending-task.md §36 (90-day Free Trial → Developer → Team →
// Enterprise). This is fixture data: there is no live auth/billing in this
// environment, so every surface rendering it must show the fixture label.
// ---------------------------------------------------------------------------

export const ORGANIZATION: OrganizationProfile = {
  name: 'Northwind Rust Group',
  slug: 'northwind-rust',
  plan: 'trial',
  planName: 'Free Trial — 90 days',
  trialStartedAt: '2026-08-01T09:00:00Z',
  trialEndsAt: '2026-10-30T09:00:00Z',
  seatsUsed: 4,
  seatsTotal: 5,
  members: [
    {
      id: 'm1',
      name: 'Ada Ferreira',
      handle: 'aferreira',
      role: 'owner',
      status: 'active',
      lastActive: '2m ago',
    },
    {
      id: 'm2',
      name: 'Miles Garrett',
      handle: 'mgarret',
      role: 'admin',
      status: 'active',
      lastActive: '1h ago',
    },
    {
      id: 'm3',
      name: 'Lin Zhou',
      handle: 'lzhou',
      role: 'member',
      status: 'active',
      lastActive: 'yesterday',
    },
    {
      id: 'm4',
      name: 'Sofia Anders',
      handle: 'sanders',
      role: 'member',
      status: 'active',
      lastActive: '3d ago',
    },
    {
      id: 'm5',
      name: 'Ravi Menon',
      handle: 'rmenon',
      role: 'viewer',
      status: 'invited',
      lastActive: 'invite pending',
    },
  ],
  tiers: [
    {
      tier: 'trial',
      name: 'Free Trial — 90 days',
      blurb: 'Individual developers, evaluation teams, hackathons, OSS and proofs of concept.',
      capabilities: [
        'Full local/offline analysis — core value needs no payment',
        'Limited cloud storage · history retention · team members',
        'Limited cloud AI usage · limited repositories',
      ],
      current: true,
    },
    {
      tier: 'developer',
      name: 'Developer / Individual',
      blurb: 'Individual engineers who want persistent cloud history and advanced capabilities.',
      capabilities: [
        'Unlimited local analysis · cloud history',
        'Advanced findings · experiments · repository history',
        'AI allowance · enhanced analytics',
      ],
      current: false,
    },
    {
      tier: 'team',
      name: 'Team',
      blurb: 'Engineering teams working on shared repositories.',
      capabilities: [
        'Multiple developers · shared repositories · team dashboards',
        'Organization policies · shared findings · team analytics',
        'Increased AI allowance · centralized administration · audit logs',
      ],
      current: false,
    },
    {
      tier: 'enterprise',
      name: 'Business / Enterprise',
      blurb: 'Organizations with advanced security and deployment requirements.',
      capabilities: [
        'SSO / SAML / OIDC',
        'Self-hosted deployment options',
        'Priority support · custom retention & policy controls',
      ],
      current: false,
    },
  ],
}

