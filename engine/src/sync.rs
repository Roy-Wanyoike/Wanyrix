//! `wanyrix sync push|pull` — serverless team sync over a git REGISTRY
//! BRANCH (issue #92, roadmap rung L3: below cloud, above per-machine).
//!
//! A git branch IS the shared store. There is no server, no database, no
//! network protocol beyond git itself: `--remote` is any path or git URL a
//! `git clone` accepts, `--branch` (default `wanyrix-registry`) is the
//! branch every teammate treats as the registry. Registry content reuses
//! the `wanyrix export` artifact contract VERBATIM (issue #91): one
//! workspace subtree per workspace id — `doctor.json`, `graph.json`,
//! `health.json`, `index.json` — laid out under `<workspace-id>/`, with
//! `index.json` binding every artifact to its exact bytes (sha256).
//!
//! # Push (exactly one commit — or none)
//!
//! One measured pass (the SAME pipeline `export`/`analyze` runs, zero
//! re-shaping) is committed to the registry branch as EXACTLY ONE commit.
//! The commit message is deterministic — `wanyrix-sync push <workspace-id>
//! <digest-min>..<digest-max>` (the lexicographic sha256 range over the
//! four registry files) — and carries NO wall-clock timestamp, in the
//! message or in the artifacts (`generatedAt` stays the literal
//! `not-measured`). A byte-identical re-push stages nothing and commits
//! nothing: the no-op is measured with `git diff --cached --quiet`, so
//! repeated pushes of unchanged input are byte-stable no-ops (zero new
//! commits, pinned by test).
//!
//! # Pull (merge, never overwrite)
//!
//! `pull` fetches the registry branch and merges it into the LOCAL mirror
//! (`<path>/.wanyrix/sync/registry/<workspace-id>/`), keyed by
//! (workspace id, finding id) + content hash:
//!
//! - a finding present only in the peer's registry is ADOPTED;
//! - present on both sides with the SAME content hash: identical — kept;
//! - present on both sides with DIFFERENT content: a NAMED CONFLICT
//!   FINDING in the `wanyrix.sync/v1` envelope. The local bytes are kept —
//!   nothing is ever silently overwritten, and the peer's version stays
//!   available in the registry for human reconciliation;
//! - `graph.json`/`health.json` are derived whole-file surfaces: adopted
//!   when absent locally, byte-compared otherwise, a named file-level
//!   conflict when they differ.
//!
//! # Evidence tiers never upgrade (the honesty rule of sync)
//!
//! The floor vocabulary — `measurementStatus: "measured"` /
//! `"not-measured"` — is re-measurable by any local scan, so it survives
//! import unchanged. Any tier ABOVE the floor (e.g. a `verified` claim a
//! peer recorded) asserts something only LOCAL re-verification can confer:
//! an imported finding carrying it is relabeled `peer-reported-<tier>`
//! (e.g. `peer-reported-verified`) in the merged envelope AND named in the
//! sync envelope's relabel list, until a local scan re-establishes it.
//! Tiers can never upgrade during a merge — pinned by test.
//!
//! # Transport
//!
//! Everything is shelled out to the `git` CLI over `std::process::Command`
//! with a direct argv (no shell interpolation — a remote string is
//! untrusted input), following the `git.rs` process pattern and the
//! engine's zero-new-dependencies policy. Local-path remotes are the test
//! surface; URL remotes are passed through and every transport failure is
//! a NAMED error (`SyncRemoteUnavailable`), with the git stderr preserved
//! verbatim. Registry commits carry a fixed machine identity
//! (`wanyrix sync <sync@wanyrix.invalid>`) — the surface has no author of
//! its own, and the identity is stated here rather than inherited from
//! whoever happens to be configured on the machine.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::export::{
    ExportArtifact, ExportManifest, DOCTOR_ARTIFACT, EXPORT_MEASUREMENT, EXPORT_SCHEMA,
    GRAPH_ARTIFACT, HEALTH_ARTIFACT, MANIFEST_FILE,
};
use crate::model::EngineError;

/// Envelope schema identifier for `wanyrix sync push|pull`.
pub const SYNC_SCHEMA: &str = "wanyrix.sync/v1";

/// The default registry branch (overridable with `--branch`).
pub const DEFAULT_REGISTRY_BRANCH: &str = "wanyrix-registry";

/// The measurementStatus vocabulary a LOCAL scan can establish on its own.
/// Anything outside this set is a claim from elsewhere and gets the
/// `peer-reported-` prefix on import (tiers never upgrade).
const FLOOR_STATUSES: [&str; 2] = ["measured", "not-measured"];

/// Fixed commit identity for registry commits (documented in the module
/// docs: sync has no human author of its own).
const SYNC_GIT_IDENTITY: (&str, &str) = ("wanyrix sync", "sync@wanyrix.invalid");

/// Honesty note carried by the push envelope (`measurement` field).
pub const PUSH_MEASUREMENT: &str = "the registry branch is the shared store: push commits the byte-identical wanyrix.export/v1 bundle of one measured pass (the same pipeline as wanyrix export/analyze, zero re-shaping) as EXACTLY ONE commit; the commit message carries the workspace id + sha256 digest range and NO wall-clock timestamp; repeated identical pushes are byte-stable no-ops (zero new commits); local-path remotes are the supported test surface (issue #92)";

/// Honesty note carried by the pull envelope (`measurement` field).
pub const PULL_MEASUREMENT: &str = "pull merges the registry branch into the local mirror by (workspace id, finding id) + content hash; conflicting content becomes a NAMED conflict finding in this envelope and the local bytes are kept — nothing is silently overwritten; evidence tiers never upgrade: peer claims above the floor vocabulary (measured / not-measured) are imported as peer-reported-<tier> until a local scan re-establishes them (issue #92)";

/* ------------------------------------------------------------ envelope ---- */

/// `wanyrix.sync/v1` — push flavor.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPushReport {
    pub schema: String,
    pub action: &'static str,
    /// The remote exactly as the operator passed it.
    pub remote: String,
    pub branch: String,
    /// Measured workspace name (the scan's, never invented).
    pub workspace: String,
    /// Registry key: the sanitized workspace id the subtree lives under.
    pub workspace_id: String,
    /// false = byte-identical no-op (zero new commits — see noopReason).
    pub committed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub noop_reason: Option<String>,
    /// The bundle rows (the `wanyrix.export/v1` artifact shape, reused
    /// verbatim). index.json carries the digest binding for all of them.
    pub artifacts: Vec<ExportArtifact>,
    /// Lexicographic sha256 range over the FOUR registry files (doctor,
    /// graph, health, index) — the commit message's digest range.
    pub digest_min: String,
    pub digest_max: String,
    /// The deterministic commit message (verbatim — no timestamp inside).
    pub commit_message: String,
    pub measurement: String,
    /// LAST field (honesty rule: timestamps last).
    pub generated_at: String,
}

/// A named conflict finding: the same merge key on both sides with
/// different content. Resolution is always local-kept — the peer's version
/// stays in the registry for human reconciliation, never silently dropped.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    /// Stable per-report name: `SYNC-CONFLICT-1`, `SYNC-CONFLICT-2`, …
    pub id: String,
    /// What conflicted: a finding id (e.g. `FER-ENG-001-alpha`) or a
    /// derived-surface file name (`graph.json`).
    pub finding_id: String,
    /// `finding-content` | `derived-file`.
    pub kind: &'static str,
    pub resolution: &'static str,
    pub local_sha256: String,
    pub peer_sha256: String,
    pub note: String,
}

/// An evidence-tier relabel applied on import (tiers never upgrade).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRelabel {
    pub finding_id: String,
    /// What the peer's registry claimed (e.g. `verified`).
    pub peer_claimed: String,
    /// What is stored locally until re-verified locally.
    pub imported_as: String,
}

/// Per-workspace merge outcome inside the pull envelope.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMerge {
    pub workspace_id: String,
    /// `adopted` (no local mirror state yet) | `merged` (local state
    /// combined with peer changes) | `unchanged` (byte-identical pull).
    pub outcome: &'static str,
    pub adopted_findings: usize,
    pub identical_findings: usize,
    pub conflicted_findings: usize,
    pub local_only_findings: usize,
    pub relabeled_findings: usize,
    /// ALL named conflicts of this workspace: finding-content conflicts
    /// first, then derived-file conflicts, numbered in that order.
    pub conflicts: Vec<SyncConflict>,
    pub relabels: Vec<SyncRelabel>,
}

/// `wanyrix.sync/v1` — pull flavor.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPullReport {
    pub schema: String,
    pub action: &'static str,
    pub remote: String,
    pub branch: String,
    /// The local mirror root, RELATIVE (the export relative-paths-only
    /// contract — no absolute path leaks into the envelope).
    pub registry_root: String,
    pub workspaces: Vec<WorkspaceMerge>,
    pub workspace_count: usize,
    pub adopted_findings: usize,
    pub conflict_count: usize,
    pub relabel_count: usize,
    /// Registry entries that are not workspace subtrees (no index.json):
    /// counted and named here — never silently ignored.
    pub foreign_entries: Vec<String>,
    pub measurement: String,
    /// LAST field (honesty rule: timestamps last).
    pub generated_at: String,
}

/* ------------------------------------------------------------- helpers ---- */

/// The registry key for a workspace: the measured workspace name with every
/// character outside `[A-Za-z0-9._-]` replaced by `-`, so the id is a safe
/// single path segment on every filesystem git supports. Names that
/// sanitize to the same id share a registry subtree (last writer wins) —
/// the envelope echoes BOTH the raw name and the id so a collision is
/// visible, never silent.
pub fn workspace_id(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_') {
                c
            } else {
                '-'
            }
        })
        .collect();
    if s.is_empty() {
        "workspace".to_string()
    } else {
        s
    }
}

/// Tier rule: `Some(imported_as)` when the peer's measurementStatus is
/// above the locally-establishable floor vocabulary — the import label is
/// `peer-reported-<tier>` until a local scan re-establishes the claim.
fn peer_tier_relabel(status: &str) -> Option<String> {
    if FLOOR_STATUSES.contains(&status) {
        None
    } else {
        Some(format!("peer-reported-{status}"))
    }
}

/// The lexicographic sha256 range over the registry files: (min, max).
fn digest_range(digests: &[String]) -> (String, String) {
    let mut sorted: Vec<&String> = digests.iter().collect();
    sorted.sort();
    let min = sorted.first().map(|s| (*s).clone()).unwrap_or_default();
    let max = sorted.last().map(|s| (*s).clone()).unwrap_or_default();
    (min, max)
}

/// The deterministic registry commit message: workspace id + digest range.
/// No wall-clock anywhere — repeated identical pushes never reach a commit
/// at all, and the same content always produces the same message.
fn commit_message(workspace_id: &str, digests: &[String]) -> String {
    let (min, max) = digest_range(digests);
    format!("wanyrix-sync push {workspace_id} {min}..{max}")
}

/// Run git with a direct argv (no shell — the remote string is untrusted
/// input) and return the raw Output. Every caller turns non-success into a
/// NAMED sync error with the stderr preserved verbatim.
fn git_out(cwd: &Path, args: &[&str]) -> Result<std::process::Output, EngineError> {
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                EngineError::SyncRemoteUnavailable(
                    "git executable not found (install git — the registry branch IS the shared store)"
                        .to_string(),
                )
            } else {
                EngineError::SyncRemoteUnavailable(format!("failed to invoke git: {e}"))
            }
        })
}

fn stderr_of(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stderr).trim().to_string()
}

/// Best-effort tempdir guard: the clone workdir is removed on drop, on
/// error paths and panics alike (sync must not litter the machine).
struct TempClone(PathBuf);

impl TempClone {
    fn create() -> Result<(Self, PathBuf), EngineError> {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("wanyrix-sync-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| {
            EngineError::Sync(format!(
                "cannot create sync scratch directory {}: {e}",
                dir.display()
            ))
        })?;
        Ok((TempClone(dir.clone()), dir))
    }
}

impl Drop for TempClone {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Validate the `--remote` and return the URL git should clone.
///
/// Local paths (the supported test surface) are canonicalized to absolute
/// BEFORE cloning: a relative remote would otherwise resolve against the
/// clone's working directory, not the caller's. Missing and
/// existing-but-not-git remotes are NAMED refusals; anything that looks
/// like a git URL (`scheme://`, `git@host:…`) is passed through for git to
/// dial, and its transport failure is a named `SyncRemoteUnavailable` with
/// the git stderr verbatim.
fn resolve_remote(remote: &str) -> Result<String, EngineError> {
    if remote.trim().is_empty() {
        return Err(EngineError::Sync(
            "--remote is empty — pass a local path or a git URL (the registry branch lives there)"
                .to_string(),
        ));
    }
    let looks_like_url =
        remote.contains("://") || remote.starts_with("git@") || remote.starts_with("ssh://");
    let as_path = Path::new(remote);
    if as_path.exists() {
        let abs = std::fs::canonicalize(as_path).map_err(|e| {
            EngineError::SyncRemoteUnavailable(format!("cannot resolve remote path {remote}: {e}"))
        })?;
        // Named refusal: a directory that is not a repository cannot host
        // the registry branch — say so, never fall through to a confusing
        // clone error.
        let probe = git_out(&abs, &["rev-parse", "--git-dir"])?;
        if !probe.status.success() {
            return Err(EngineError::SyncRemoteUnavailable(format!(
                "remote path {} is not a git repository (no .git found) — init one with `git init` or pass a git URL",
                abs.display()
            )));
        }
        Ok(abs.display().to_string())
    } else if looks_like_url {
        Ok(remote.to_string())
    } else {
        Err(EngineError::SyncRemoteUnavailable(format!(
            "remote path does not exist: {remote} — pass an existing git repository path or a git URL"
        )))
    }
}

/// Clone the remote into a fresh tempdir and return (guard, clone path).
fn clone_remote(resolved_remote: &str) -> Result<(TempClone, PathBuf), EngineError> {
    let (guard, scratch) = TempClone::create()?;
    let clone_dir = scratch.join("clone");
    let out = git_out(&scratch, &["clone", "--quiet", resolved_remote, "clone"])?;
    if !out.status.success() {
        return Err(EngineError::SyncRemoteUnavailable(format!(
            "cannot clone remote {resolved_remote}: {}",
            stderr_of(&out)
        )));
    }
    Ok((guard, clone_dir))
}

/// Read a file from the checked-out registry clone.
fn peer_bytes(clone: &Path, rel: &str) -> Result<Vec<u8>, EngineError> {
    std::fs::read(clone.join(rel))
        .map_err(|e| EngineError::Sync(format!("cannot read {rel} from the registry clone: {e}")))
}

/* ----------------------------------------------------------------- push ---- */

/// `wanyrix sync push` — measure once, commit the bundle to the registry
/// branch as EXACTLY ONE commit (none when the registry already holds
/// byte-identical content), push the branch back to the remote.
pub fn sync_push(path: &Path, remote: &str, branch: &str) -> Result<SyncPushReport, EngineError> {
    // Relative-paths-only (the export contract): the envelopes' `root`
    // field and the workspace id must be machine-independent — an absolute
    // --path would bake one machine's directory layout into the shared
    // registry.
    if path.is_absolute() {
        return Err(EngineError::Sync(format!(
            "--path {} is absolute; sync uses RELATIVE paths only (run from the workspace root and pass e.g. --path fixture-ws) so no artifact can embed an absolute path",
            path.display()
        )));
    }

    // One measured pass — the same bundle `wanyrix export` writes (zero
    // re-shaping drift between export and sync).
    let bundle = crate::export::export_bundle(path, &[], false)?;
    let ws_name = bundle.manifest.workspace.clone();
    let ws_id = workspace_id(&ws_name);

    let resolved = resolve_remote(remote)?;
    let (_guard, clone) = clone_remote(&resolved)?;

    // Does the remote already carry the registry branch? (ls-remote sees
    // the REMOTE state — a fresh clone only materializes the HEAD branch
    // locally, so a local rev-parse alone would misreport existing
    // registries.)
    let heads = git_out(&clone, &["ls-remote", "--heads", "origin", branch])?;
    if !heads.status.success() {
        return Err(EngineError::SyncRemoteUnavailable(format!(
            "git ls-remote failed: {}",
            stderr_of(&heads)
        )));
    }
    let registry_exists = !String::from_utf8_lossy(&heads.stdout).trim().is_empty();

    if registry_exists {
        let out = git_out(&clone, &["checkout", "--quiet", branch])?;
        if !out.status.success() {
            return Err(EngineError::SyncRemoteUnavailable(format!(
                "git checkout {branch} failed: {}",
                stderr_of(&out)
            )));
        }
    } else {
        // Fresh registry: an ORPHAN branch keeps the registry namespace
        // clean (no default-branch content bleeds into it).
        let out = git_out(&clone, &["checkout", "--quiet", "--orphan", branch])?;
        if !out.status.success() {
            return Err(EngineError::SyncRemoteUnavailable(format!(
                "git checkout --orphan {branch} failed: {}",
                stderr_of(&out)
            )));
        }
        let out = git_out(&clone, &["read-tree", "--empty"])?;
        if !out.status.success() {
            return Err(EngineError::SyncRemoteUnavailable(format!(
                "git read-tree --empty failed: {}",
                stderr_of(&out)
            )));
        }
    }

    // Lay out the workspace subtree and stage it. Only `<ws-id>/` is
    // touched — other teams' subtrees are never rewritten by this push.
    let subtree = clone.join(&ws_id);
    std::fs::create_dir_all(&subtree)
        .map_err(|e| EngineError::Sync(format!("cannot stage registry subtree: {e}")))?;
    let mut digests = Vec::with_capacity(bundle.files.len());
    for (file, bytes) in &bundle.files {
        std::fs::write(subtree.join(file), bytes)
            .map_err(|e| EngineError::Sync(format!("cannot write {file} into the clone: {e}")))?;
        digests.push(crate::export::sha256_hex(bytes));
    }
    let out = git_out(&clone, &["add", "--", &ws_id])?;
    if !out.status.success() {
        return Err(EngineError::SyncRemoteUnavailable(format!(
            "git add failed: {}",
            stderr_of(&out)
        )));
    }

    // The no-op gate: staged index vs HEAD. Byte-identical content stages
    // to nothing, so repeated identical pushes create ZERO commits (the
    // branch sha stays stable; pinned by test).
    let diff = git_out(&clone, &["diff", "--cached", "--quiet"])?;
    let message = commit_message(&ws_id, &digests);

    let (committed, commit, noop_reason) = if diff.status.success() {
        (
            false,
            None,
            Some(format!(
                "registry branch {branch} already holds byte-identical content for workspace {ws_id} — nothing to commit (zero new commits)"
            )),
        )
    } else {
        let mut cmd = Command::new("git");
        cmd.args(["commit", "--quiet", "-m", &message])
            .current_dir(&clone)
            .env("GIT_AUTHOR_NAME", SYNC_GIT_IDENTITY.0)
            .env("GIT_AUTHOR_EMAIL", SYNC_GIT_IDENTITY.1)
            .env("GIT_COMMITTER_NAME", SYNC_GIT_IDENTITY.0)
            .env("GIT_COMMITTER_EMAIL", SYNC_GIT_IDENTITY.1);
        let out = cmd.output().map_err(|e| {
            EngineError::SyncRemoteUnavailable(format!("failed to invoke git commit: {e}"))
        })?;
        if !out.status.success() {
            return Err(EngineError::SyncRemoteUnavailable(format!(
                "git commit failed: {}",
                stderr_of(&out)
            )));
        }
        let sha_out = git_out(&clone, &["rev-parse", "HEAD"])?;
        if !sha_out.status.success() {
            return Err(EngineError::SyncRemoteUnavailable(format!(
                "git rev-parse HEAD failed: {}",
                stderr_of(&sha_out)
            )));
        }
        (
            true,
            Some(String::from_utf8_lossy(&sha_out.stdout).trim().to_string()),
            None,
        )
    };

    if committed {
        // Push the branch back. The remote keeps its checked-out branch
        // (if any) untouched — sync only writes the registry ref.
        let out = git_out(
            &clone,
            &[
                "push",
                "--quiet",
                "origin",
                &format!("HEAD:refs/heads/{branch}"),
            ],
        )?;
        if !out.status.success() {
            return Err(EngineError::SyncRemoteUnavailable(format!(
                "remote refused the registry push: {}",
                stderr_of(&out)
            )));
        }
    }

    let (digest_min, digest_max) = digest_range(&digests);
    Ok(SyncPushReport {
        schema: SYNC_SCHEMA.to_owned(),
        action: "push",
        remote: remote.to_owned(),
        branch: branch.to_owned(),
        workspace: ws_name,
        workspace_id: ws_id,
        committed,
        commit,
        noop_reason,
        artifacts: bundle.manifest.artifacts,
        digest_min,
        digest_max,
        commit_message: message,
        measurement: PUSH_MEASUREMENT.to_owned(),
        generated_at: crate::timestamp::iso8601_now(),
    })
}

/* ----------------------------------------------------------------- pull ---- */

/// Parse + verify the peer's `index.json` digest binding: every listed
/// artifact must hash to exactly its registered sha256, and the three
/// envelope artifacts must be listed. Registry content that violates its
/// own manifest is tampered/corrupt — merging it would silently accept
/// doctored evidence, so it is a NAMED refusal (SyncConflict), never a
/// warn-and-continue.
fn verify_peer_binding(ws_id: &str, clone: &Path) -> Result<serde_json::Value, EngineError> {
    let index_bytes = peer_bytes(clone, &format!("{ws_id}/{MANIFEST_FILE}"))?;
    let index: serde_json::Value = serde_json::from_slice(&index_bytes).map_err(|e| {
        EngineError::SyncConflict(format!(
            "registry content for {ws_id} carries a malformed {MANIFEST_FILE} ({e}) — refusing to merge self-inconsistent evidence"
        ))
    })?;
    let artifacts = index
        .get("artifacts")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| {
            EngineError::SyncConflict(format!(
                "registry content for {ws_id} carries a {MANIFEST_FILE} without an artifacts array — refusing to merge self-inconsistent evidence"
            ))
        })?;
    let mut listed = Vec::new();
    for a in artifacts {
        let file = a
            .get("file")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                EngineError::SyncConflict(format!(
                    "registry manifest for {ws_id} has an artifact row without a file name — refusing to merge self-inconsistent evidence"
                ))
            })?;
        let claimed = a
            .get("sha256")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                EngineError::SyncConflict(format!(
                    "registry manifest for {ws_id} has no sha256 for {file} — refusing to merge self-inconsistent evidence"
                ))
            })?;
        let bytes = peer_bytes(clone, &format!("{ws_id}/{file}"))?;
        let actual = crate::export::sha256_hex(&bytes);
        if !actual.eq_ignore_ascii_case(claimed) {
            return Err(EngineError::SyncConflict(format!(
                "registry content for {ws_id} violates its own {MANIFEST_FILE} digest binding: {file} hashes to {actual}, manifest claims {claimed} — tampered or corrupt evidence, refusing to merge"
            )));
        }
        listed.push(file.to_owned());
    }
    for required in [DOCTOR_ARTIFACT, GRAPH_ARTIFACT, HEALTH_ARTIFACT] {
        if !listed.iter().any(|f| f == required) {
            return Err(EngineError::SyncConflict(format!(
                "registry manifest for {ws_id} does not list {required} — not a wanyrix registry subtree, refusing to merge"
            )));
        }
    }
    Ok(index)
}

/// Apply the evidence-tier rule to a list of peer findings (parsed JSON):
/// every finding must carry a `measurementStatus`; tiers above the floor
/// vocabulary are relabeled `peer-reported-<tier>`. Returns the relabels.
fn relabel_peer_findings(
    findings: &mut [serde_json::Value],
    ws_id: &str,
) -> Result<Vec<SyncRelabel>, EngineError> {
    let mut relabels = Vec::new();
    for f in findings.iter_mut() {
        let obj = f.as_object_mut().ok_or_else(|| {
            EngineError::SyncConflict(format!(
                "registry doctor content for {ws_id} has a non-object finding — refusing to merge malformed evidence"
            ))
        })?;
        let id = obj
            .get("id")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                EngineError::SyncConflict(format!(
                    "registry doctor content for {ws_id} has a finding without an id — refusing to merge malformed evidence"
                ))
            })?
            .to_owned();
        let status = obj
            .get("measurementStatus")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                EngineError::SyncConflict(format!(
                    "registry doctor content for {ws_id} finding {id} carries no measurementStatus — refusing to merge evidence with unlabeled tiers"
                ))
            })?
            .to_owned();
        if let Some(imported_as) = peer_tier_relabel(&status) {
            obj.insert(
                "measurementStatus".to_owned(),
                serde_json::Value::String(imported_as.clone()),
            );
            relabels.push(SyncRelabel {
                finding_id: id,
                peer_claimed: status,
                imported_as,
            });
        }
    }
    Ok(relabels)
}

/// Content hash of one finding object (its exact JSON serialization —
/// serde_json's canonical map ordering is deterministic, which is all the
/// hash needs to be).
fn finding_hash(f: &serde_json::Value) -> Result<String, EngineError> {
    let bytes = serde_json::to_vec(f).map_err(|e| EngineError::Json(e.to_string()))?;
    Ok(crate::export::sha256_hex(&bytes))
}

fn findings_array(
    envelope: &serde_json::Value,
    ws_id: &str,
    side: &str,
) -> Result<Vec<serde_json::Value>, EngineError> {
    envelope
        .get("findings")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .ok_or_else(|| {
            EngineError::SyncConflict(format!(
                "{side} doctor content for {ws_id} carries no findings array — refusing to merge malformed evidence"
            ))
        })
}

fn finding_id(f: &serde_json::Value, ws_id: &str, side: &str) -> Result<String, EngineError> {
    f.get("id")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            EngineError::SyncConflict(format!(
                "{side} doctor content for {ws_id} has a finding without an id — refusing to merge malformed evidence"
            ))
        })
}

/// Recompute the doctor envelope's severity summary from the merged
/// findings (the summary must always describe the findings it ships with).
fn recompute_summary(
    doctor: &mut serde_json::Value,
    findings: &[serde_json::Value],
) -> Result<(), EngineError> {
    let (mut crit, mut warn, mut info) = (0usize, 0usize, 0usize);
    for f in findings {
        match f.get("severity").and_then(serde_json::Value::as_str) {
            Some("critical") => crit += 1,
            Some("warning") => warn += 1,
            _ => info += 1,
        }
    }
    let summary = doctor
        .get_mut("summary")
        .and_then(serde_json::Value::as_object_mut)
        .ok_or_else(|| {
            EngineError::SyncConflict(
                "doctor envelope carries no summary object — refusing to merge malformed evidence"
                    .to_string(),
            )
        })?;
    summary.insert("critical".into(), serde_json::json!(crit));
    summary.insert("warning".into(), serde_json::json!(warn));
    summary.insert("info".into(), serde_json::json!(info));
    summary.insert("total".into(), serde_json::json!(findings.len()));
    Ok(())
}

/// Serialize a typed envelope to artifact bytes (compact + trailing
/// newline — the same flavor the export artifacts use). Typed on purpose:
/// struct declaration order IS the wire contract (schema first,
/// `generatedAt` last) — a serde_json::Value round-trip would alphabetize
/// the keys and change the bytes.
fn envelope_bytes<T: serde::Serialize>(value: &T) -> Result<Vec<u8>, EngineError> {
    let mut b = serde_json::to_string(value)
        .map_err(|e| EngineError::Json(e.to_string()))?
        .into_bytes();
    b.push(b'\n');
    Ok(b)
}

/// Rebuild `index.json` over the FINAL merged bytes (the digest binding
/// must describe what is actually stored, not what the peer sent). Same
/// `wanyrix.export/v1` shape and measurement note; digests recomputed; the
/// engine version is the one doing the merge (echoed honestly).
fn rebuild_index(
    ws_dir: &Path,
    peer_index: &serde_json::Value,
    files: &[(String, Vec<u8>)],
) -> Result<(), EngineError> {
    let artifacts: Vec<ExportArtifact> = files
        .iter()
        .filter(|(f, _)| f.as_str() != MANIFEST_FILE)
        .map(|(f, b)| ExportArtifact {
            file: f.clone(),
            schema: match f.as_str() {
                DOCTOR_ARTIFACT => crate::report::DOCTOR_SCHEMA.to_owned(),
                GRAPH_ARTIFACT => crate::report::GRAPH_SCHEMA.to_owned(),
                _ => crate::report::HEALTH_SCHEMA.to_owned(),
            },
            bytes: b.len(),
            sha256: crate::export::sha256_hex(b),
        })
        .collect();
    let manifest = ExportManifest {
        schema: EXPORT_SCHEMA.to_owned(),
        engine: env!("CARGO_PKG_VERSION").to_owned(),
        workspace: peer_index
            .get("workspace")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        excludes: peer_index
            .get("excludes")
            .and_then(serde_json::Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
        artifacts,
        measurement: EXPORT_MEASUREMENT.to_owned(),
    };
    write_mirror(ws_dir, MANIFEST_FILE, &envelope_bytes(&manifest)?)
}

fn write_mirror(ws_dir: &Path, file: &str, bytes: &[u8]) -> Result<(), EngineError> {
    std::fs::write(ws_dir.join(file), bytes).map_err(|e| {
        EngineError::Sync(format!(
            "cannot write {file} into the local registry mirror {}: {e}",
            ws_dir.display()
        ))
    })
}

fn ensure_mirror(ws_dir: &Path) -> Result<(), EngineError> {
    std::fs::create_dir_all(ws_dir).map_err(|e| {
        EngineError::Sync(format!(
            "cannot create local registry mirror {}: {e}",
            ws_dir.display()
        ))
    })
}

/// ADOPTION: no local mirror state for this workspace — store the peer's
/// bundle. Byte-verbatim when the tier rule changes nothing (the roundtrip
/// contract: artifacts byte-identical to the peer's export); rewritten
/// (doctor + rebuilt index.json) when a tier had to be downgraded.
fn adopt_workspace(
    ws_id: &str,
    clone: &Path,
    ws_dir: &Path,
    peer_index: &serde_json::Value,
) -> Result<WorkspaceMerge, EngineError> {
    let peer_doctor = peer_bytes(clone, &format!("{ws_id}/{DOCTOR_ARTIFACT}"))?;
    let mut doctor: serde_json::Value = serde_json::from_slice(&peer_doctor).map_err(|e| {
        EngineError::SyncConflict(format!(
            "peer {DOCTOR_ARTIFACT} for {ws_id} is not valid JSON: {e}"
        ))
    })?;
    let mut findings = findings_array(&doctor, ws_id, "peer")?;
    let relabels = relabel_peer_findings(&mut findings, ws_id)?;
    let adopted = findings.len();

    ensure_mirror(ws_dir)?;
    if relabels.is_empty() {
        // Nothing to relabel: store the peer's files VERBATIM.
        write_mirror(ws_dir, DOCTOR_ARTIFACT, &peer_doctor)?;
        write_mirror(
            ws_dir,
            GRAPH_ARTIFACT,
            &peer_bytes(clone, &format!("{ws_id}/{GRAPH_ARTIFACT}"))?,
        )?;
        write_mirror(
            ws_dir,
            HEALTH_ARTIFACT,
            &peer_bytes(clone, &format!("{ws_id}/{HEALTH_ARTIFACT}"))?,
        )?;
        write_mirror(
            ws_dir,
            MANIFEST_FILE,
            &peer_bytes(clone, &format!("{ws_id}/{MANIFEST_FILE}"))?,
        )?;
    } else {
        if let Some(arr) = doctor
            .get_mut("findings")
            .and_then(serde_json::Value::as_array_mut)
        {
            // Severity never changes on a relabel — the summary stays.
            *arr = findings;
        }
        let doctor_bytes = envelope_bytes(&doctor)?;
        write_mirror(ws_dir, DOCTOR_ARTIFACT, &doctor_bytes)?;
        let graph = peer_bytes(clone, &format!("{ws_id}/{GRAPH_ARTIFACT}"))?;
        let health = peer_bytes(clone, &format!("{ws_id}/{HEALTH_ARTIFACT}"))?;
        write_mirror(ws_dir, GRAPH_ARTIFACT, &graph)?;
        write_mirror(ws_dir, HEALTH_ARTIFACT, &health)?;
        rebuild_index(
            ws_dir,
            peer_index,
            &[
                (DOCTOR_ARTIFACT.to_owned(), doctor_bytes),
                (GRAPH_ARTIFACT.to_owned(), graph),
                (HEALTH_ARTIFACT.to_owned(), health),
            ],
        )?;
    }

    Ok(WorkspaceMerge {
        workspace_id: ws_id.to_owned(),
        outcome: "adopted",
        adopted_findings: adopted,
        identical_findings: 0,
        conflicted_findings: 0,
        local_only_findings: 0,
        relabeled_findings: relabels.len(),
        conflicts: Vec::new(),
        relabels,
    })
}

/// MERGE: local mirror state exists. Finding-level merge (by finding id +
/// content hash) on the doctor surface; whole-file compare on the derived
/// surfaces. Conflicts keep the LOCAL bytes and are named — never a silent
/// overwrite; the peer's version stays in the registry for reconciliation.
fn merge_workspace(
    ws_id: &str,
    clone: &Path,
    ws_dir: &Path,
    peer_index: &serde_json::Value,
) -> Result<WorkspaceMerge, EngineError> {
    let local_doctor_bytes = std::fs::read(ws_dir.join(DOCTOR_ARTIFACT)).ok();
    let local_graph = std::fs::read(ws_dir.join(GRAPH_ARTIFACT)).ok();
    let local_health = std::fs::read(ws_dir.join(HEALTH_ARTIFACT)).ok();

    let Some(local_doctor_bytes) = local_doctor_bytes else {
        // A mirror without doctor.json is not mergeable local state —
        // treat it as an adoption (pull owns the mirror; partial states
        // come from operators, and adoption is the honest recovery).
        return adopt_workspace(ws_id, clone, ws_dir, peer_index);
    };

    let peer_doctor = peer_bytes(clone, &format!("{ws_id}/{DOCTOR_ARTIFACT}"))?;
    let peer_graph = peer_bytes(clone, &format!("{ws_id}/{GRAPH_ARTIFACT}"))?;
    let peer_health = peer_bytes(clone, &format!("{ws_id}/{HEALTH_ARTIFACT}"))?;

    let mut local_doc: serde_json::Value =
        serde_json::from_slice(&local_doctor_bytes).map_err(|e| {
            EngineError::SyncConflict(format!(
                "local mirror {DOCTOR_ARTIFACT} for {ws_id} is not valid JSON: {e}"
            ))
        })?;
    let peer_doc: serde_json::Value = serde_json::from_slice(&peer_doctor).map_err(|e| {
        EngineError::SyncConflict(format!(
            "peer {DOCTOR_ARTIFACT} for {ws_id} is not valid JSON: {e}"
        ))
    })?;
    let local_findings = findings_array(&local_doc, ws_id, "local mirror")?;
    let peer_findings = findings_array(&peer_doc, ws_id, "peer")?;

    let mut local_hashes: BTreeMap<String, String> = BTreeMap::new();
    for f in &local_findings {
        let id = finding_id(f, ws_id, "local mirror")?;
        local_hashes.insert(id, finding_hash(f)?);
    }

    let mut adoptions: Vec<serde_json::Value> = Vec::new();
    let mut conflicts: Vec<SyncConflict> = Vec::new();
    let mut relabels: Vec<SyncRelabel> = Vec::new();
    let (mut identical, mut conflicted) = (0usize, 0usize);

    for f in &peer_findings {
        let id = finding_id(f, ws_id, "peer")?;
        let peer_hash = finding_hash(f)?;
        match local_hashes.get(&id) {
            None => {
                // Peer-only finding: adopt it, applying the tier rule.
                let mut one = vec![f.clone()];
                relabels.extend(relabel_peer_findings(&mut one, ws_id)?);
                adoptions.push(one.remove(0));
            }
            Some(local_hash) if *local_hash == peer_hash => identical += 1,
            Some(local_hash) => {
                conflicted += 1;
                conflicts.push(SyncConflict {
                    id: String::new(), // numbered below, in final order
                    finding_id: id,
                    kind: "finding-content",
                    resolution: "local-kept",
                    local_sha256: local_hash.clone(),
                    peer_sha256: peer_hash,
                    note: "local and peer registry content differ for this finding id; local content kept and the peer version remains in the registry for reconciliation — never silently overwritten".to_owned(),
                });
            }
        }
    }

    let local_only = local_findings
        .iter()
        .filter(|f| match f.get("id").and_then(serde_json::Value::as_str) {
            Some(i) => !peer_findings
                .iter()
                .any(|p| p.get("id").and_then(serde_json::Value::as_str) == Some(i)),
            None => false,
        })
        .count();

    // Derived surfaces: byte-compare. Absent locally → adopt; differing →
    // a named file-level conflict (local bytes kept).
    let mut graph_out: Option<Vec<u8>> = None;
    let mut health_out: Option<Vec<u8>> = None;
    if local_graph.is_none() {
        graph_out = Some(peer_graph.clone());
    } else if local_graph.as_deref() != Some(peer_graph.as_slice()) {
        conflicted += 1;
        conflicts.push(SyncConflict {
            id: String::new(),
            finding_id: GRAPH_ARTIFACT.to_owned(),
            kind: "derived-file",
            resolution: "local-kept",
            local_sha256: crate::export::sha256_hex(local_graph.as_deref().unwrap_or_default()),
            peer_sha256: crate::export::sha256_hex(&peer_graph),
            note: "the derived graph envelope differs between local mirror and registry; the local bytes are kept — never silently overwritten".to_owned(),
        });
    }
    if local_health.is_none() {
        health_out = Some(peer_health.clone());
    } else if local_health.as_deref() != Some(peer_health.as_slice()) {
        conflicted += 1;
        conflicts.push(SyncConflict {
            id: String::new(),
            finding_id: HEALTH_ARTIFACT.to_owned(),
            kind: "derived-file",
            resolution: "local-kept",
            local_sha256: crate::export::sha256_hex(local_health.as_deref().unwrap_or_default()),
            peer_sha256: crate::export::sha256_hex(&peer_health),
            note: "the derived health envelope differs between local mirror and registry; the local bytes are kept — never silently overwritten".to_owned(),
        });
    }

    // Number the named conflicts in final order: finding-content first,
    // then derived-file.
    let mut n = 0;
    for c in &mut conflicts {
        n += 1;
        c.id = format!("SYNC-CONFLICT-{n}");
    }

    // Doctor rewrite only when the merged finding set actually changed.
    let adopted_count = adoptions.len();
    let doctor_out: Option<Vec<u8>> = if adoptions.is_empty() {
        None
    } else {
        let mut merged = local_findings.clone();
        adoptions.sort_by(|a, b| {
            let ka = a
                .get("id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let kb = b
                .get("id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            ka.cmp(kb)
        });
        merged.extend(adoptions);
        recompute_summary(&mut local_doc, &merged)?;
        if let Some(arr) = local_doc
            .get_mut("findings")
            .and_then(serde_json::Value::as_array_mut)
        {
            *arr = merged;
        }
        Some(envelope_bytes(&local_doc)?)
    };

    let changed = doctor_out.is_some() || graph_out.is_some() || health_out.is_some();
    if changed {
        ensure_mirror(ws_dir)?;
        if let Some(d) = &doctor_out {
            write_mirror(ws_dir, DOCTOR_ARTIFACT, d)?;
        }
        if let Some(g) = &graph_out {
            write_mirror(ws_dir, GRAPH_ARTIFACT, g)?;
        }
        if let Some(h) = &health_out {
            write_mirror(ws_dir, HEALTH_ARTIFACT, h)?;
        }
        // Rebuild index.json over the FINAL bytes (any old binding is
        // stale once a file changed).
        let final_doctor = doctor_out.clone().unwrap_or(local_doctor_bytes);
        let final_graph = graph_out
            .clone()
            .or(local_graph)
            .unwrap_or_else(|| peer_graph.clone());
        let final_health = health_out
            .clone()
            .or(local_health)
            .unwrap_or_else(|| peer_health.clone());
        rebuild_index(
            ws_dir,
            peer_index,
            &[
                (DOCTOR_ARTIFACT.to_owned(), final_doctor),
                (GRAPH_ARTIFACT.to_owned(), final_graph),
                (HEALTH_ARTIFACT.to_owned(), final_health),
            ],
        )?;
    }

    let outcome = if changed || !conflicts.is_empty() {
        "merged"
    } else {
        "unchanged"
    };
    Ok(WorkspaceMerge {
        workspace_id: ws_id.to_owned(),
        outcome,
        adopted_findings: adopted_count,
        identical_findings: identical,
        conflicted_findings: conflicted,
        local_only_findings: local_only,
        relabeled_findings: relabels.len(),
        conflicts,
        relabels,
    })
}

/// `wanyrix sync pull` — fetch the registry branch and merge every
/// workspace subtree into the local mirror
/// (`<path>/.wanyrix/sync/registry/<workspace-id>/`).
pub fn sync_pull(path: &Path, remote: &str, branch: &str) -> Result<SyncPullReport, EngineError> {
    // Same relative-paths-only rule as push (one rule for the surface).
    if path.is_absolute() {
        return Err(EngineError::Sync(format!(
            "--path {} is absolute; sync uses RELATIVE paths only (run from the workspace root) so no absolute path can leak into the registry mirror or envelope",
            path.display()
        )));
    }

    let resolved = resolve_remote(remote)?;
    let (_guard, clone) = clone_remote(&resolved)?;

    // The registry branch must EXIST: pulling before any push is a named
    // refusal with the remediation stated — never an empty success.
    let checkout = git_out(&clone, &["checkout", "--quiet", branch])?;
    if !checkout.status.success() {
        return Err(EngineError::SyncBranch(format!(
            "registry branch {branch} not found on remote {remote} — run `wanyrix sync push` first (git: {})",
            stderr_of(&checkout)
        )));
    }

    // Enumerate the registry: directories carrying an index.json are
    // workspace subtrees; everything else is a foreign entry — counted and
    // named, never silently ignored.
    let mut subtree_ids: Vec<String> = Vec::new();
    let mut foreign_entries: Vec<String> = Vec::new();
    let entries = std::fs::read_dir(&clone)
        .map_err(|e| EngineError::Sync(format!("cannot enumerate the registry clone: {e}")))?;
    for entry in entries {
        let entry =
            entry.map_err(|e| EngineError::Sync(format!("registry enumeration failed: {e}")))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".git" {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir && clone.join(&name).join(MANIFEST_FILE).is_file() {
            subtree_ids.push(name);
        } else {
            foreign_entries.push(name);
        }
    }
    subtree_ids.sort();

    let registry_root = path.join(".wanyrix").join("sync").join("registry");
    let mut workspaces = Vec::new();
    for ws_id in &subtree_ids {
        let peer_index = verify_peer_binding(ws_id, &clone)?;
        let ws_dir = registry_root.join(ws_id);
        if ws_dir.join(DOCTOR_ARTIFACT).is_file() {
            workspaces.push(merge_workspace(ws_id, &clone, &ws_dir, &peer_index)?);
        } else {
            workspaces.push(adopt_workspace(ws_id, &clone, &ws_dir, &peer_index)?);
        }
    }

    let adopted: usize = workspaces.iter().map(|w| w.adopted_findings).sum();
    let conflicts: usize = workspaces.iter().map(|w| w.conflicts.len()).sum();
    let relabels: usize = workspaces.iter().map(|w| w.relabels.len()).sum();

    Ok(SyncPullReport {
        schema: SYNC_SCHEMA.to_owned(),
        action: "pull",
        remote: remote.to_owned(),
        branch: branch.to_owned(),
        registry_root: registry_root.display().to_string(),
        workspace_count: workspaces.len(),
        workspaces,
        adopted_findings: adopted,
        conflict_count: conflicts,
        relabel_count: relabels,
        foreign_entries,
        measurement: PULL_MEASUREMENT.to_owned(),
        generated_at: crate::timestamp::iso8601_now(),
    })
}

/* --------------------------------------------------------------- human ---- */

fn short_sha(sha: &str) -> &str {
    &sha[..12.min(sha.len())]
}

/// Human-readable push summary. Deterministic given the report.
pub fn push_human(r: &SyncPushReport) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "wanyrix sync push — {} ({}) → {} [{}]\n",
        r.workspace, r.workspace_id, r.remote, r.branch
    ));
    let artifacts = r
        .artifacts
        .iter()
        .map(|a| format!("{} {}", a.file, short_sha(&a.sha256)))
        .collect::<Vec<_>>()
        .join(" · ");
    out.push_str(&format!(
        "  artifacts ({}): {artifacts}\n",
        r.artifacts.len()
    ));
    match (&r.commit, &r.noop_reason) {
        (Some(sha), _) => {
            out.push_str("  registry commit: ");
            out.push_str(sha);
            out.push_str(" (exactly one)\n");
            out.push_str(&format!("  message: {}\n", r.commit_message));
        }
        (None, Some(reason)) => out.push_str(&format!("  registry commit: none — {reason}\n")),
        (None, None) => out.push_str("  registry commit: none\n"),
    }
    out.push_str(&format!(
        "  digest range: {}..{}\n",
        short_sha(&r.digest_min),
        short_sha(&r.digest_max)
    ));
    out.push_str(&format!("  measurement: {}\n", r.measurement));
    out
}

/// Human-readable pull summary. Deterministic given the report.
pub fn pull_human(r: &SyncPullReport) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "wanyrix sync pull — {} [{}] → {}\n",
        r.remote, r.branch, r.registry_root
    ));
    let outcomes = |o: &str| r.workspaces.iter().filter(|w| w.outcome == o).count();
    out.push_str(&format!(
        "  workspaces: {} (adopted: {}, merged: {}, unchanged: {})\n",
        r.workspace_count,
        outcomes("adopted"),
        outcomes("merged"),
        outcomes("unchanged")
    ));
    for w in &r.workspaces {
        out.push_str(&format!(
            "  {} — {}: findings adopted {} · identical {} · conflicted {} · local-only {} · relabeled {}\n",
            w.workspace_id,
            w.outcome,
            w.adopted_findings,
            w.identical_findings,
            w.conflicted_findings,
            w.local_only_findings,
            w.relabeled_findings
        ));
        for c in &w.conflicts {
            out.push_str(&format!(
                "    [{}] {} ({}) — {} (local {}, peer {})\n",
                c.id,
                c.finding_id,
                c.kind,
                c.resolution,
                short_sha(&c.local_sha256),
                short_sha(&c.peer_sha256)
            ));
        }
        for l in &w.relabels {
            out.push_str(&format!(
                "    tier: {} — peer claimed {}, stored locally as {} until locally re-verified\n",
                l.finding_id, l.peer_claimed, l.imported_as
            ));
        }
    }
    if !r.foreign_entries.is_empty() {
        out.push_str(&format!(
            "  foreign entries (not workspace subtrees): {}\n",
            r.foreign_entries.join(", ")
        ));
    }
    out.push_str(&format!("  measurement: {}\n", r.measurement));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_id_is_a_safe_single_path_segment() {
        assert_eq!(workspace_id("fixture-ws"), "fixture-ws");
        assert_eq!(workspace_id("my ws"), "my-ws");
        assert_eq!(workspace_id("a/b\\c"), "a-b-c");
        assert_eq!(workspace_id(""), "workspace");
        assert_eq!(workspace_id("Ünicode"), "-nicode");
    }

    #[test]
    fn tiers_above_floor_get_the_peer_reported_prefix() {
        assert_eq!(
            peer_tier_relabel("verified"),
            Some("peer-reported-verified".into())
        );
        assert_eq!(peer_tier_relabel("measured"), None);
        assert_eq!(peer_tier_relabel("not-measured"), None);
        // Any unknown/exotic tier is DOWNgraded to a peer-reported label,
        // never adopted as-is — tiers can never upgrade.
        assert_eq!(
            peer_tier_relabel("benchmarked"),
            Some("peer-reported-benchmarked".into())
        );
    }

    #[test]
    fn commit_message_is_deterministic_and_timestamp_free() {
        let digests = vec!["aa".repeat(32), "ff".repeat(32), "33".repeat(32)];
        let m1 = commit_message("ws", &digests);
        let m2 = commit_message("ws", &digests);
        assert_eq!(m1, m2);
        assert!(m1.starts_with("wanyrix-sync push ws 33"));
        // The range end is the FULL 64-hex-char max digest.
        assert!(m1.ends_with(&format!("..{}", "ff".repeat(32))));
        // Order-independence: the range is over the sorted set.
        let mut shuffled = digests.clone();
        shuffled.reverse();
        assert_eq!(commit_message("ws", &shuffled), m1);
    }

    #[test]
    fn digest_range_spans_the_sorted_set() {
        // sha256 hex digests are exactly 64 chars.
        let zeros = "0".repeat(64);
        let fs = "f".repeat(64);
        let (min, max) = digest_range(&[fs.clone(), zeros.clone()]);
        assert_eq!(min, zeros);
        assert_eq!(max, fs);
        assert_eq!(digest_range(&[]), (String::new(), String::new()));
    }
}
