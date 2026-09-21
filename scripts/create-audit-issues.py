#!/usr/bin/env python3
"""Create Wanyrix audit issues on GitHub (docs/audits/issues/ holds local backups).

Body contract per audit program §34: Problem, Evidence, Current Behavior,
Expected Behavior, Affected Components, Root Cause, Implementation Requirements,
Acceptance Criteria, Tests Required, Security Considerations, Performance
Considerations, Dependencies, Definition of Done.
"""
import json, os, sys, urllib.request

REPO = "Roy-Wanyoike/wanyrix"
TOKEN = os.environ["GH_TOKEN"]

def section(**kw):
    out = []
    for k, v in kw.items():
        out.append(f"## {k}\n{v.strip()}\n")
    return "\n".join(out)

ISSUES = []

ISSUES.append(dict(title="[P1][core] Umbrella: implement the Wanyrix product core (CLI → daemon → engine → W-EIR → graph → doctor → experiments)", labels=["P1","product-core","epic"], body=section(
Problem="""The web platform (this repo) is a verified design demonstrator over fixture evidence. The deterministic Rust core that produces real evidence from real repositories does not exist in any repository. Until it exists, the final product question (“can a real Rust developer point Wanyrix at a real repository…”) is answered **not yet**.""",
Evidence="""- Full audit 2026-09-17 (docs/audits/WANYRIX_FULL_AUDIT_REPORT.md §2): CLI, daemon, engine, collectors, durable W-EIR, experiment runner = absent product-level.
- Component matrix cells for CLI/Daemon/Engine/Collectors/W-EIR persistence = ❌ with no alternate repo.""",
CurrentBehavior="""Engineering intelligence shown in the UI is hand-authored fixture data (`src/lib/wanyrix/data.ts`).""",
ExpectedBehavior="""A Rust workspace (separate repos: `wanyrix` CLI crate + `wanyrix-*` workspace members per docs/migrations/FERRIX_TO_WANYRIX.md canonical identity) implementing Phase 1–7 of the build program: core runtime → repository intelligence → engineering graph → build intelligence → findings → incremental → experiments, honoring the CLI contract (`wanyrix --version/init/status/doctor/analyze/dependencies/graph/findings/explain/experiment/verify/patch/storage`, exit codes 0/1/2/3, `--json` everywhere).""",
AffectedComponents="""New Rust workspace; this web repo later consumes real payloads behind the same /api/wanyrix contracts.""",
RootCause="""Program order: web demonstrator was built first to lock UX/evidence semantics; core implementation is the next phase.""",
ImplementationRequirements="""1) Repo scaffolding + CI; 2) core runtime (storage, config, daemon lifecycle, graceful recovery); 3) cargo/git/rustc collectors with ≥99.5% metadata agreement vs fixture corpus; 4) W-EIR snapshots (deterministic, versioned, integrity-tested); 5) graph + blast radius (100% fixture correctness); 6) doctor findings with 100% evidence traceability; 7) incremental ≥95% work reduction; 8) experiment runner with real baseline/candidate measurement.""",
AcceptanceCriteria="""- [ ] Phase 1–7 exit gates of the build program each pass their quantified targets
- [ ] `wanyrix doctor` on a fixture repo with an intentionally constructed bottleneck names it with evidence
- [ ] Full loop OBSERVE→LEARN executable end-to-end on a real repository""",
TestsRequired="""Golden snapshot tests; fixture corpus (single crate → 500+ crate synthetic); determinism (same input ⇒ equivalent snapshot ×100); CLI contract tests (exit codes, --json); crash-recovery tests (kill during write → SQLite integrity_check OK).""",
SecurityConsiderations="""Local-only mode; no source transmission; secrets never persisted into W-EIR evidence.""",
PerformanceConsiderations="""CLI start p95<150ms; incremental p95<1s; doctor p95<10s (medium repo); idle daemon<100MB.""",
Dependencies="""None (new workspace). Web repo issues #2/#3 gate any switch to live payloads.""",
DefinitionOfDone="""Phase 1–7 gates green in the core repo, documented in its own audit, linked back here; web platform unchanged.""")))

ISSUES.append(dict(title="[P1][web] Add automated test suite (unit + component + E2E) for the web platform", labels=["P1","testing","web"], body=section(
Problem="""The platform's core value — evidence discipline and measurement integrity (estimated/measured/verified, Gate 21) — is enforced only by hand-authored fixture data and manual QA. There are zero automated tests; any refactor (e.g. #5) can silently break semantics.""",
Evidence="""- Audit §2: “Automated test suite: ❌ — no unit/component/E2E tests in repo (only lint + branding gate)”.
- package.json scripts: only dev/build/start/lint/db:*.""",
CurrentBehavior="""`bun run lint` and `scripts/check-branding.sh` are the entire verification surface.""",
ExpectedBehavior="""- Unit tests: data getters (getImpact validation, getDiagnostics workspace routing, report builders produce schema-valid `wanyrix.report/v1`), storage-state mutations (reclaim idempotency), legacy-migration storage (ferrix.*→wanyrix.* incl. idempotency + no-destroy invariant)
- Component/E2E: Playwright — every view renders data, doctor scan completes with 12 findings, simulator estimates update, explain dialog shows structured labels or deterministic fallback, scorecard filters, exports download
- A11y: axe smoke on each view""",
AffectedComponents="""package.json, new tests/ dir, Playwright config, vitest config.""",
RootCause="""Rounds 1–10 prioritized feature velocity; verification was agent-browser manual QA each round.""",
ImplementationRequirements="""vitest (or bun test) + Playwright; run in CI (issue #3); keep runtime deps unchanged.""",
AcceptanceCriteria="""- [ ] `bun run test` and `bun run test:e2e` green
- [ ] Coverage of all 12 API routes incl. 400/404 validation contracts
- [ ] E2E: golden path scan→finding→explain→experiment→report
- [ ] legacy-migration tests cover detect→copy→remove→idempotent→restore""",
TestsRequired="""This issue IS the tests.""",
SecurityConsiderations="""Test fixtures must not embed real credentials; e2e run against local dev only.""",
PerformanceConsiderations="""E2E budget: full suite <3min; add doctor-replay timing assertion (regression tripwire).""",
Dependencies="""#3 (CI) to enforce; #5 (data split) easier after tests land — land tests first.""",
DefinitionOfDone="""CI runs the suite on every PR; audit report §2 row flips to ✅.""")))

ISSUES.append(dict(title="[P2][ci] Add CI pipeline: lint, typecheck, branding gate, build, dependency audit", labels=["P2","ci","github-actions"], body=section(
Problem="""No GitHub Actions workflows exist. Quality gates (ESLint, tsc, branding gate, production build, dependency audit) are enforced only by local discipline.""",
Evidence="""- `.github/` absent (git ls-files).
- 25 merged PRs landed without automated checks; audit had to re-verify everything manually.""",
CurrentBehavior="""Nothing runs on PR/push.""",
ExpectedBehavior="""Workflow on PR + push to main: 1) `bun install --frozen-lockfile` 2) `bunx tsc --noEmit` 3) `bun run lint` 4) `bash scripts/check-branding.sh` 5) `bun run build` 6) secret scan (gitleaks or pattern set incl. `ghp_`, `x-access-token:`) 7) `bun audit`-equivalent dependency check (advisory, non-blocking initially)""",
AffectedComponents=""".github/workflows/ci.yml, package.json scripts.""",
RootCause="""Sandbox workflow pushed directly to main; CI was never scaffolded.""",
ImplementationRequirements="""Single ci.yml, bun setup action, node 24, concurrency-cancel, ~<5min runtime. Wire #2 tests into the same workflow when they land.""",
AcceptanceCriteria="""- [ ] ci.yml green on main
- [ ] PRs show required checks
- [ ] Branding gate blocks stale-identity PRs (demonstrate with a failing test commit on a branch)""",
TestsRequired="""Workflow itself; validate via a branch PR.""",
SecurityConsiderations="""Minimal `permissions: contents: read`; no secrets in workflow; tokenless.""",
PerformanceConsiderations="""Use bun cache; target <5min.""",
Dependencies="""None. #2 plugs into it.""",
DefinitionOfDone="""Required status checks enabled; audit §2 “CI pipeline” flips to ✅.""")))

ISSUES.append(dict(title="[P2][ui] Mobile: horizontal overflow on every view (1022px layout at 390px viewport)", labels=["P2","bug","responsive","ui"], body=section(
Problem="""At mobile widths the whole page is horizontally scrollable (~632px of hidden overflow) because the topbar action row never wraps and forces the layout wider than the viewport.""",
Evidence="""- agent-browser, viewport 390×844: `document.documentElement.scrollWidth = 1022` on ALL 9 views (Overview, Doctor, Graph, Simulator, Issues, Scorecard…).
- Offenders: `div.flex.min-h-screen.flex-1.flex-col.lg:pl-60 → 1022px`; `header … → 1022px`; header inner row `flex items-center gap-3 … → 1022px`; `ml-auto` cluster → 1006px; workspace combobox → 794px.""",
CurrentBehavior="""Topbar (search trigger + workspace select + Run scan + Pending diffs + Report + Notifications + theme) is a single non-wrapping flex row; its min-content width (~1022px) stretches the page.""",
ExpectedBehavior="""`scrollWidth ≤ viewport` on ≤390px: secondary topbar actions collapse into the existing mobile nav / overflow menu (or wrap), search trigger condenses to icon, workspace select shrinks with `min-w-0`.""",
AffectedComponents="""`src/components/wanyrix/app-shell.tsx` (topbar), possibly shared button cluster.""",
RootCause="""`flex` defaults to nowrap; the round-1 topbar was designed desktop-first and gained buttons over rounds 2–10 without a mobile collapse.""",
ImplementationRequirements="""1) `flex-wrap` or `hidden sm:flex` gating for secondary actions; 2) `min-w-0` + truncation on workspace select; 3) keep 44px touch targets; 4) add a Playwright assertion `scrollWidth <= 390` per view (needs #2).""",
AcceptanceCriteria="""- [ ] All 9 views `scrollWidth ≤ 390` at 390×844 and ≤ 768 at 768×1024
- [ ] No topbar function removed on mobile (accessible via collapse)
- [ ] Sticky-footer behavior unchanged""",
TestsRequired="""Playwright per-view overflow assertions; manual 390px screenshots.""",
SecurityConsiderations="""n/a""",
PerformanceConsiderations="""No JS added; CSS-only preferred.""",
Dependencies="""#2 for the automated regression test.""",
DefinitionOfDone="""Audit §5 mobile row flips to PASS; screenshots attached in PR.""")))

ISSUES.append(dict(title="[P2][data] Fixture generator + decompose 2.7k-line data.ts into per-domain modules", labels=["P2","refactor","data","architecture"], body=section(
Problem="""All payloads come from one hand-authored monolith (`src/lib/wanyrix/data.ts`, ~2,770 lines). Fixture numbers can silently drift between views (doctor totals vs overview KPIs vs gates), and the file is the highest-risk edit surface in the repo.""",
Evidence="""- `wc -l src/lib/wanyrix/data.ts` ≈ 2,770; exports consumed by 12 API routes + components.
- Audit §2 rows “Engineering Graph (real): fixture-only”, “Build Intelligence: fixture-only”.""",
CurrentBehavior="""Static objects edited by hand; cross-view consistency is manual; no generator to regenerate the fixture workspace.""",
ExpectedBehavior="""1) A deterministic **fixture generator** (script) that derives helios-platform/atlas-consortium datasets from a declarative workspace spec (47 crates, 212 edges) — regeneration is reproducible and diffable; 2) `data.ts` split into `lib/wanyrix/data/{workspaces,health,doctor,graph,impact,diagnostics,experiments,pr,gates,issues,storage,report}.ts` with the same public getters; 3) cross-view invariant tests (finding counts, duplicate groups, gate evidence numbers agree) — enabled by #2.""",
AffectedComponents="""src/lib/wanyrix/data.ts → src/lib/wanyrix/data/*; scripts/generate-fixtures.ts.""",
RootCause="""Organic growth over 10 rounds; single-file was pragmatic early, now a merge hazard.""",
ImplementationRequirements="""Pure refactor — zero payload changes (byte-identical API responses verified in tests) — then generator on top. Keep REPO_URL/version semantics untouched.""",
AcceptanceCriteria="""- [ ] API responses byte-identical before/after (snapshot tests)
- [ ] `bun run fixtures:generate` reproducible (clean diff on re-run)
- [ ] data.ts ≤ 300 lines (barrel + shared helpers only)""",
TestsRequired="""Golden API snapshots; invariants (per issue #2).""",
SecurityConsiderations="""Fixture content stays synthetic; generator must not read real repos.""",
PerformanceConsiderations="""Route handlers unchanged; cold-start unchanged.""",
Dependencies="""#2 (tests first), #3 (CI).""",
DefinitionOfDone="""Audit §2 “fixture” rows upgraded to “generated fixture + invariants tested”.""")))

ISSUES.append(dict(title="[P3][docs] Traceability board overstates mirror fidelity (19 issues claimed; upstream has 0)", labels=["P3","documentation","honesty"], body=section(
Problem="""The in-app “Issues & PRs” board states it mirrors “the live repo” with 19 issues and PRs #10–#47, and renders `WAN-101…` rows referencing GitHub issues #1–#44. The live repository has **0 real issues** and 25 PRs (#10–#48). The board is a curated fixture presented with live-repo authority — a traceability honesty gap in a product whose brand is evidence integrity.""",
Evidence="""- GitHub API `GET /repos/Roy-Wanyoike/wanyrix/issues?state=all` → 25 items, all `pull_request` objects; 0 issues.
- App board footer: “19 issues · 19 PRs · 0 open · issues #1–#44 · PRs #10–#47 mirror the live repo” (browser-verified 2026-09-17).""",
CurrentBehavior="""Board rows link WAN-* ids to GitHub numbers that 404.""",
ExpectedBehavior="""Either (a) relabel the board as a *curated governance fixture* and drop live-mirror wording, or (b) make it actually live: fetch real issues/PRs via API at build/runtime (public repo data only) and mark fixture rows clearly when upstream objects are absent.""",
AffectedComponents="""src/components/wanyrix/views/issues-view.tsx, src/lib/wanyrix/data.ts (issues payload).""",
RootCause="""Board predates the audit that counted upstream objects; mirror-note ranges were computed from data (#32) but the underlying numbers were never reconciled with GitHub.""",
ImplementationRequirements="""Copy fix for (a); read-only sync + graceful fallback for (b). Do not invent issue numbers.""",
AcceptanceCriteria="""- [ ] No claim in the UI contradicts verifiable repo metadata
- [ ] Every GitHub number rendered resolves to a real upstream object (or is explicitly labeled fixture)""",
TestsRequired="""E2E: every `github.com/Roy-Wanyoike/wanyrix/(issues|pull)/N` link rendered by the board returns 200 (needs #2/#3).""",
SecurityConsiderations="""If live-sync: unauthenticated public API only, cached, no tokens client-side.""",
PerformanceConsiderations="""Cache sync result (ISR/SWR) to keep TTFB budget.""",
Dependencies="""None blocking; #2 for the link-check test.""",
DefinitionOfDone="""Board copy and data source agree; audit §7 finding closed.""")))

ISSUES.append(dict(title="[P3][docs] Add the standard documentation set (ARCHITECTURE, SECURITY, THREAT_MODEL, DEVELOPMENT, CONTRIBUTING, CLI, W-EIR, PERFORMANCE)", labels=["P3","documentation"], body=section(
Problem="""Only README + migration/audit docs exist. The audit program’s required docs (ARCHITECTURE, DEVELOPMENT, CONTRIBUTING, SECURITY, THREAT_MODEL, CLI, PERFORMANCE, W-EIR spec, PLUGIN_API) are missing.""",
Evidence="""git ls-files: README.md, docs/migrations/*, docs/audits/* only.""",
CurrentBehavior="""Architecture/contracts live in code comments and the audit report.""",
ExpectedBehavior="""Docs that match implementation exactly (every documented command/endpoint runtime-verified):
- ARCHITECTURE.md — web platform layering, data flow, /api/wanyrix contracts, fixture honesty statement
- SECURITY.md + THREAT_MODEL.md — local-only mode, AI data flow (context text only), secret hygiene, reporting path
- DEVELOPMENT.md + CONTRIBUTING.md — bun workflow, gates (lint/branding/tests #2), PR policy (1 issue ⇄ 1 PR)
- CLI.md — the contract the UI documents (commands, exit codes, --json), marked *planned until product core #1*
- W-EIR.md — TS payload model as the demonstrator’s IR sketch, entity list + status vs product spec
- PERFORMANCE.md — measured baselines from this audit + budgets""",
AffectedComponents="""docs/, README links.""",
RootCause="""Docs debt accumulated while features shipped.""",
ImplementationRequirements="""Author from audit evidence; add doc-link checker to CI (#3).""",
AcceptanceCriteria="""- [ ] All 9 docs exist, each claim verified
- [ ] README links them
- [ ] Doc examples execute (where runnable)""",
TestsRequired="""Link checker; quoted-command smoke where applicable.""",
SecurityConsiderations="""SECURITY/THREAT_MODEL must describe AI provider data flow honestly.""",
PerformanceConsiderations="""n/a""",
Dependencies="""#2 gives verifiable examples.""",
DefinitionOfDone="""Audit §6 rows flip to ✅.""")))

ISSUES.append(dict(title="[P3][ai] Automated adversarial harness for the AI reasoning layer (0-contradiction target)", labels=["P3","ai","testing"], body=section(
Problem="""The explain route enforces grounding by prompt rules + fallback, but there is no automated adversarial suite proving “0 authoritative-evidence contradictions” (audit program Phase 15 target). Today the property is verified manually.""",
Evidence="""- Audit §3: AI spot-check PASS manually (PR #184 numbers traced to evidence); §2 “AI: no automated harness”.
- src/app/api/wanyrix/explain/route.ts: SYSTEM_BASE rules + FALLBACKS.""",
CurrentBehavior="""One-off manual probes (invented dependency / invented measurement / false verification / contradiction requests).""",
ExpectedBehavior="""Scripted harness: fixed evidence contexts + adversarial question set (invent a crate, invent a file, inflate a measurement, claim verified-from-estimated, contradict build data, ask to re-label); asserts every response: contains all four structural labels, never upgrades a label (no `measured`/`verified` where evidence says `estimated`), cites only context entities. Runs against the real provider nightly + against FALLBACKS deterministically in CI.""",
AffectedComponents="""src/app/api/wanyrix/explain/route.ts (testability), tests/ai-harness.""",
RootCause="""AI layer added in round 4 with manual QA only.""",
ImplementationRequirements="""Extract label-validator as pure function (shared by route + harness); record harness report as CI artifact.""",
AcceptanceCriteria="""- [ ] Deterministic fallback passes 100% of adversarial set in CI
- [ ] Live-provider run ≥ target with violations reported, not silently swallowed
- [ ] AI failure keeps deterministic UI functional (already E2E-verified; add regression test)""",
TestsRequired="""The harness itself.""",
SecurityConsiderations="""Harness must not send real repo content; synthetic contexts only.""",
PerformanceConsiderations="""Nightly live run, not per-PR.""",
Dependencies="""#2, #3.""",
DefinitionOfDone="""Audit Phase 15 row gains automated evidence.""")))

ISSUES.append(dict(title="[P4][hygiene] Untrack session-artifact dirs (tool-results/) from git", labels=["P4","hygiene","security"], body=section(
Problem="""`tool-results/` (session notes, pasted command output) is tracked in git. It is production noise, triggers false positives in secret scans (literal `x-access-token:$TOKEN` placeholders), and shipped during the recent push.""",
Evidence="""- git grep for secret patterns hits tool-results/read_*.txt (verified placeholders, not real secrets — audit §4).
- Files have no build/runtime role (not imported anywhere).""",
CurrentBehavior="""17+ artifact files tracked; bloat history and scan results.""",
ExpectedBehavior="""`git rm -r --cached tool-results`, add to .gitignore; optionally `docs/` retains any content of value. Do NOT rewrite history (program rule).""",
AffectedComponents=""".gitignore, git index.""",
RootCause="""Sandbox tooling wrote artifacts inside the repo root and were committed by catch-all `git add -A`.""",
ImplementationRequirements="""Untrack + ignore; consider `.gitignore` guard for `tool-results/`, `upload/`, `*.local`.""",
AcceptanceCriteria="""- [ ] `git ls-files | rg tool-results` empty
- [ ] Secret scan false-positive surface reduced""",
TestsRequired="""CI secret scan (#3) green with fewer suppressions.""",
SecurityConsiderations="""Reduces accidental-leak surface for future sessions.""",
PerformanceConsiderations="""Slightly smaller clone.""",
Dependencies="""None.""",
DefinitionOfDone="""Audit §4 hygiene note closed.""")))

def main():
    created = []
    for iss in ISSUES:
        body = iss["body"] + "\n\n---\n_Source: Wanyrix full product audit 2026-09-17 (docs/audits/WANYRIX_FULL_AUDIT_REPORT.md · docs/audits/issues/). Labels: " + ", ".join(iss["labels"]) + "_"
        payload = dict(title=iss["title"], body=body, labels=iss["labels"])
        # local backup
        os.makedirs("docs/audits/issues", exist_ok=True)
        safe = iss["title"].split("]")[0].strip("[").replace("/", "") + "-" + iss["title"].split("] ", 1)[1][:48].lower().replace(" ", "-").replace("/", "-").replace("(", "").replace(")", "").replace(",", "").replace(":", "").replace("—", "-")[:60] + ".md"
        with open(os.path.join("docs/audits/issues", safe), "w") as f:
            f.write(f"# {iss['title']}\n\nLabels: {', '.join(iss['labels'])}\n\n{body}")
        req = urllib.request.Request(
            f"https://api.github.com/repos/{REPO}/issues",
            data=json.dumps(payload).encode(),
            headers={"Authorization": f"token {TOKEN}", "Accept": "application/vnd.github+json", "User-Agent": "wanyrix-audit"},
            method="POST")
        try:
            with urllib.request.urlopen(req) as r:
                d = json.loads(r.read())
                created.append((d["number"], d["title"], d["html_url"]))
                print(f"created #{d['number']}: {d['title'][:70]}")
        except urllib.error.HTTPError as e:
            print(f"FAILED [{e.code}] {iss['title'][:60]}: {e.read().decode()[:300]}")
    print(f"\n{len(created)} issues created")
    for n, t, u in created:
        print(f"#{n} {u}")

if __name__ == "__main__":
    main()
