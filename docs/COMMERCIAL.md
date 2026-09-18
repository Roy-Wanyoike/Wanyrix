# Wanyrix — Commercial Model

Status: **proposal for market validation**. Nothing in this document is a final, approved
price list; prices are deliberately expressed as a configurable schema (§37 of the product
spec), not dollars. Nothing described here is billed today — commercial surfaces are
Roadmap.

## Principles

1. **Local-first stays free.** Core deterministic analysis never requires payment and is
   never crippled to force cloud adoption (spec §38).
2. **Entitlement separation.** Billing is an outer shell: subscription/plan/entitlement
   checks can gate *cloud* features only. A billing failure, expired trial, or offline
   machine can never corrupt or disable the local deterministic core — engineering data at
   rest is untouched by billing state.
3. **Price on value, not API calls** (spec §36): value comes from collaboration,
   persistence, history, analytics, governance, fleet intelligence, enterprise controls,
   advanced AI, and hosted infrastructure.
4. **Configurable pricing.** Plan/Feature/Limit/Usage/Seats/Repositories/AI
   allowance/Storage/Retention are data, so price experiments never rewrite billing
   architecture.

## Packaging

| Package | What it is | Today |
| --- | --- | --- |
| **Wanyrix Local** | free/local-first engineering intelligence | shipped (web platform demonstrates the loop) |
| **Wanyrix Cloud** | cloud history, collaboration, analytics, AI | Roadmap (Phase 13) |
| **Wanyrix Team** | team engineering intelligence | Roadmap (Phase 13–14) |
| **Wanyrix Enterprise** | enterprise security, deployment, governance | Roadmap (Phase 14) |

## 90-day free trial

- Applies to paid tiers; suitable for individual developers, evaluation teams,
  hackathons, open-source, and proofs of concept.
- Trial limits (proposal): limited cloud storage, limited historical retention, limited
  team members, limited cloud AI usage, limited repositories — the local core is
  unlimited.
- **Trial expiration behavior (proposal)**: downgrade to the free local tier; cloud data
  enters a read-only grace window (30 days proposed) before deletion notices; no surprise
  charges; conversion requires explicit action.

## Tiers (proposal — subject to market validation)

| Capability | Free Trial (90d) | Developer | Team | Enterprise |
| --- | --- | --- | --- | --- |
| Unlimited local analysis | ✓ | ✓ | ✓ | ✓ |
| Cloud history & retention | limited | ✓ | ✓ | custom |
| Repositories | limited | individual | shared | org-wide |
| Seats | 1 | 1 | multiple | org/SCIM |
| Team dashboards & analytics | — | — | ✓ | ✓ |
| Organization policies & gates | — | — | ✓ | ✓ + custom |
| Audit logs | — | — | basic | advanced |
| Cloud AI allowance | limited | standard | increased | private models/providers |
| SSO/SAML/OIDC · SCIM | — | — | — | ✓ |
| Private deployment | — | — | — | ✓ |
| SLA / support | community | standard | standard | SLA-backed |

Prices: intentionally **not stated**. The pricing schema (`Plan → Features → Limits →
Usage → Seats → Repositories → AI allowance → Storage → Retention → Organization →
Enterprise capabilities`) is designed so approved price points drop in as configuration.

## Billing architecture (spec §39 — to build, no shortcuts)

```text
Organization → Subscription → Plan → Entitlements → Usage → Limits
            → Billing → Invoices → Payment → Audit
```

Requirements when implemented: idempotent billing events, immutable billing records,
audit trail, safe retries, no double charging, timezone-safe periods, grace periods,
cancellation + renewal, entitlement enforcement. **Never allow billing logic to affect
local deterministic functionality** (principle 2 above).

### Billing state machine (trial + subscription)

```text
trial_active ──(day 90)──▶ trial_expired ──(grace 30d, proposed)──▶ trial_lapsed
     │                        │
     │ (convert)              │ (convert)
     ▼                        ▼
subscription_active ──(renew)─▶ subscription_active
     │ (payment failed ×N)      │ (cancel)
     ▼                          ▼
subscription_past_due ──▶ subscription_canceled ──▶ (data retention window) ──▶ deleted
     ▲  |
     └──┘ (payment recovered → active)
```

- Transitions are event-sourced and idempotent; every transition writes an immutable audit
  record.
- `past_due` and `canceled` affect **cloud** entitlements only; local features remain
  fully functional (entitlement separation).
- Upgrade = plan change at next boundary with proration (proposal); downgrade takes
  effect at period end to avoid mid-period surprises.

## Usage model (proposal)

- Value metrics: seats, repositories under continuous analysis, cloud history retention,
  cloud AI usage. Metering is cloud-side; local analysis is never metered.
- Overage policy: soft caps with notifications first; hard caps only where abuse or cost
  blow-up is possible (cloud AI, storage).

## Trial conversion, retention, cancellation (proposal)

- Conversion: in-product, one action, no re-onboarding; trial entitlements map 1:1 to the
  chosen tier.
- Retention/cancellation: cancel anytime → service until period end → read-only grace →
  export (report flavors) → deletion. Data export uses the same versioned flavors the
  product ships today (`wanyrix.report/v1`, `wanyrix.scan-history/v1`,
  `wanyrix.release-scorecard/v1`) so exports are not a vendor lock-in format.

## Pricing experimentation

Because plans/limits are configuration, A/B price testing and regional pricing are
operational changes, not rewrites. Any price change requires: (1) product approval, (2)
grandfathering policy, (3) migration notice — none of which exist yet; hence no prices in
this document.

## Where this lives in the product today

- `Organization` view shows the tier model (90-day trial, tier summary) as **badged
  fixture data** with a live policy summary from the gates API.
- No billing code, no payment endpoints, no entitlement enforcement exists in this repo —
  by design, until Phase 13–14.
