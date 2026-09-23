# Wanyrix — Release Runbook

Status: **release engineering runbook shipped with the governance bundle (#119,
2026-09-22). Honest evidence note:** the repository's hosted Actions runners are
billing-locked (honesty labels in every workflow), so **no release has ever been
executed on hosted runners**; everything below is validated as local commands and
YAML, not by an executed hosted release. The v0.9.0 tag / GitHub Release work itself
is tracked in #146 (CHANGELOG first, then tag + Release). This runbook is the
checklist the first real release executes; update it with what actually happens.

## 1. Preconditions (all gates, run locally)

- Engine: `cargo fmt --all -- --check` · `cargo clippy --locked --all-targets -- -D
  warnings` · `cargo test --workspace --locked` (recorded counts per the
  measured-count convention — no stale numbers in docs).
- Web: `bun run lint` · `bunx tsc --noEmit` · `bun run test`.
- Brand gate: `bash scripts/check-branding.sh` → exit 0.
- Docs honesty: no roadmap item presented as shipped; threat model review triggers
  checked ([`THREAT_MODEL.md`](THREAT_MODEL.md) §7).

## 2. Version and tag

- The engine version in `engine/Cargo.toml` is the product version (v0.9.0 today).
  The version-source policy note (package.json vs engine) is part of #146's release
  documentation — do not improvise a new policy here.
- Tags follow `v*` and are the release trigger: `.github/workflows/release.yml` runs
  on `v*` tags and on demand.

## 3. What `release.yml` does (when hosting unlocks)

Per the workflow (issue #65 lineage), on a `v*` tag: multi-target release binaries
(x86_64-linux-gnu, aarch64-darwin, x86_64-windows-msvc, `--locked`), staged archives
with `SHA256SUMS.txt`, a CycloneDX **SBOM** job, a **cargo-audit** advisory-audit job,
and artifact attachment to the GitHub Release. All workflows carry the billing-locked
honesty label; until the first hosted run succeeds, treat this section as *prepared
machinery*, not proven machinery.

## 4. Local dry-run (works today, no hosted runners needed)

```bash
# Advisory audit (same command the release workflow runs)
cd engine && cargo install --locked cargo-audit && cargo audit --file Cargo.lock

# SBOM generation (same command the release workflow runs)
cd engine && cargo install --locked cargo-cyclonedx && cargo cyclonedx --locked --all --format json

# Workflow syntax sanity before pushing a tag
# (any YAML parser; the honesty label requires a local parse + step dry-run on every edit)
```

Record the outputs (digest or file) in the release evidence comment — the
evidence-first rule applies to releases like everything else.

## 5. Artifact signing checklist (release-gated, maintainer secrets)

Staged deliberately as the *only* remaining step in `release.yml` (see the SIGNING
CHECKLIST comment in the workflow; roadmap row in [`SECURITY.md`](SECURITY.md) §8):

1. Import the release artifact-signing key (cosign or minisign-class) from repository
   secrets — never commit it, never echo it in logs.
2. Sign every archive **and** `SHA256SUMS.txt` (`cosign sign-blob` / `gpg
   --detach-sign`).
3. Document verification steps for users before any `curl | sh` install story exists.
4. First signed tag demonstrated, or the deferral recorded with a trigger — unsigned
   releases must not be presented as signed.

## 6. Release ed25519 keypair activation checklist (issue #119 row)

**Trigger condition:** the first tagged release that ships the entitlement surfaces
(`activate` / `entitlement` / `license`) to users — execute **before** binaries reach
anyone. Until then the embedded `RELEASE_PUBLIC_KEY_HEX` (`engine/src/entitlement.rs`)
intentionally holds the `PENDING_RELEASE_KEY` placeholder; key resolution is lazy, so
the free tier stays honest on dev builds (see the placeholder-key dev-journey defect
tracked in #142 — that fix is about the dev journey, this checklist is about the
release swap).

1. Generate a fresh ed25519 keypair **in the release signing environment** (offline
   machine preferred). The private half never leaves that environment — never
   committed, never in CI logs, never in an issue.
2. Embed the **public** half as hex into `RELEASE_PUBLIC_KEY_HEX`, replacing the
   placeholder, in one reviewed release commit (the swap is part of the release, per
   `COMMERCIAL.md` §ed25519-at-release-signing).
3. Configure the operator issuer environment: `WANYRIX_SIGNING_KEY` (the web sandbox
   issuer uses it; the honest-503-without-key behavior must flip to real issuance
   only with the release private key) and, for Enterprise/on-prem or test overrides,
   document the `WANYRIX_ACTIVATION_PUBKEY` use — the override never substitutes for
   the embedded release key on shipped binaries.
4. Verify end-to-end: `license keygen` / `license issue` → `activate --key` →
   `entitlement` shows `active/team` → `sync push` gate passes → tamper the token and
   confirm a named signature refusal (never a silent pass; a refused token is never
   cached). Record the transcript as release evidence.
5. Rotation policy: generate a new pair, swap the embedded public key in a release,
   and re-issue + re-activate entitlements — offline verification means there is no
   remote revocation point; document the rotation in the release notes.
6. Re-walk [`THREAT_MODEL.md`](THREAT_MODEL.md) TB4 (its review trigger fires on any
   key-material change) and update `SECURITY.md` §8 roadmap wording if the
   placeholder note there becomes stale.

## 7. Post-release

- Publish the GitHub Release with notes (from #146's release-notes file once it
  exists) + SBOM + checksums (+ signatures when §5 lands).
- Evidence comment on the release issue: gates, counts, audit/SBOM digests.
- If this was the first **hosted** run: retire the billing-locked honesty labels per
  their own retire conditions, and re-check [`THREAT_MODEL.md`](THREAT_MODEL.md) §4.5.
- File/refresh any advisory for security fixes per the coordinated-disclosure policy
  in [`SECURITY.md`](SECURITY.md) (Reporting section).
