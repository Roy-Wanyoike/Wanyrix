# [P3][docs] Add the standard documentation set (ARCHITECTURE, SECURITY, THREAT_MODEL, DEVELOPMENT, CONTRIBUTING, CLI, W-EIR, PERFORMANCE)

Labels: P3, documentation

## Problem
Only README + migration/audit docs exist. The audit program’s required docs (ARCHITECTURE, DEVELOPMENT, CONTRIBUTING, SECURITY, THREAT_MODEL, CLI, PERFORMANCE, W-EIR spec, PLUGIN_API) are missing.

## Evidence
git ls-files: README.md, docs/migrations/*, docs/audits/* only.

## CurrentBehavior
Architecture/contracts live in code comments and the audit report.

## ExpectedBehavior
Docs that match implementation exactly (every documented command/endpoint runtime-verified):
- ARCHITECTURE.md — web platform layering, data flow, /api/wanyrix contracts, fixture honesty statement
- SECURITY.md + THREAT_MODEL.md — local-only mode, AI data flow (context text only), secret hygiene, reporting path
- DEVELOPMENT.md + CONTRIBUTING.md — bun workflow, gates (lint/branding/tests #2), PR policy (1 issue ⇄ 1 PR)
- CLI.md — the contract the UI documents (commands, exit codes, --json), marked *planned until product core #1*
- W-EIR.md — TS payload model as the demonstrator’s IR sketch, entity list + status vs product spec
- PERFORMANCE.md — measured baselines from this audit + budgets

## AffectedComponents
docs/, README links.

## RootCause
Docs debt accumulated while features shipped.

## ImplementationRequirements
Author from audit evidence; add doc-link checker to CI (#3).

## AcceptanceCriteria
- [ ] All 9 docs exist, each claim verified
- [ ] README links them
- [ ] Doc examples execute (where runnable)

## TestsRequired
Link checker; quoted-command smoke where applicable.

## SecurityConsiderations
SECURITY/THREAT_MODEL must describe AI provider data flow honestly.

## PerformanceConsiderations
n/a

## Dependencies
#2 gives verifiable examples.

## DefinitionOfDone
Audit §6 rows flip to ✅.


---
_Source: Wanyrix full product audit 2026-09-17 (docs/audits/WANYRIX_FULL_AUDIT_REPORT.md · docs/audits/issues/). Labels: P3, documentation_