//! Filesystem scan: walk the tree, parse every `Cargo.toml`, resolve
//! intra-workspace path dependencies into the canonical edge list.
//!
//! Honesty contract: everything produced here is MEASURED from the real
//! filesystem. There are no simulated manifests, no default fill-ins and no
//! network access. A manifest that fails to parse is never silently dropped —
//! it is retained in [`WorkspaceScan::manifests`] and reported upstream as a
//! FER-ENG-ERR finding.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::manifest::{
    DepDetail, DepSpec, LibTable, Manifest, ManifestRecord, MetaValue, Package, WorkspacePackage,
};
use crate::model::{
    Band, CrateInfo, Edge, EdgeKind, EngineError, NodeKind, PathDepRecord, WorkspaceScan,
};
use crate::pathutil::{read_regular_file, rel_forward};

/// Maximum directory depth for the walk — a guard against pathological
/// trees (we never follow symlinked directories anyway).
const MAX_DEPTH: usize = 48;

/// Scan `root`, parsing every `Cargo.toml` found under it (skipping `target/`,
/// `.git`, hidden dirs and symlinked dirs — without following symlinks).
/// No operator exclusions (the historical default; byte-identical behavior).
pub fn scan_workspace(root: &Path) -> Result<WorkspaceScan, EngineError> {
    scan_workspace_excluding(root, &[])
}

/// Normalize + validate one operator `--exclude` value.
///
/// Rules (documented in docs/CLI.md): trimmed; must be a RELATIVE directory
/// path in forward-slash form; components must be plain names — `..`, `.`,
/// absolute paths and empty values are rejected (operator input, validated
/// like every other path input). Returns `None` for an empty input so the
/// caller can name the exact problem.
fn normalize_exclude(raw: &str) -> Option<Result<String, EngineError>> {
    let v = raw.trim();
    if v.is_empty() {
        return Some(Err(EngineError::InvalidExclude(
            "value is empty or whitespace".to_owned(),
        )));
    }
    if v.starts_with('/') {
        return Some(Err(EngineError::InvalidExclude(format!(
            "{v:?} is absolute; exclusions are relative to the scan root"
        ))));
    }
    // Strip a single leading `./` and trailing slashes for convenience.
    let v = v.strip_prefix("./").unwrap_or(v);
    let v = v.trim_end_matches('/');
    if v.is_empty() {
        return Some(Err(EngineError::InvalidExclude(
            "value is empty or whitespace".to_owned(),
        )));
    }
    if v == "." || v.split('/').any(|c| c == "..") {
        return Some(Err(EngineError::InvalidExclude(format!(
            "{v:?} must not contain `.`/`..` components or escape the scan root"
        ))));
    }
    Some(Ok(v.to_owned()))
}

/// Validate + normalize the operator exclusion list: deduped, sorted,
/// deterministic. Any invalid value aborts the scan with a named error.
fn normalize_excludes(raw: &[String]) -> Result<Vec<String>, EngineError> {
    let mut out = Vec::with_capacity(raw.len());
    for value in raw {
        match normalize_exclude(value) {
            Some(Ok(v)) => {
                if !out.contains(&v) {
                    out.push(v);
                }
            }
            Some(Err(e)) => return Err(e),
            None => unreachable!("normalize_exclude always classifies"),
        }
    }
    out.sort();
    Ok(out)
}

/// Scan `root` with operator-requested directory exclusions (`--exclude`).
/// An excluded directory subtree is pruned from the walk and counted in
/// `skipped` like every other skip — never silently: the normalized
/// exclusion list is echoed on the resulting scan and in the envelopes.
pub fn scan_workspace_excluding(
    root: &Path,
    excludes: &[String],
) -> Result<WorkspaceScan, EngineError> {
    let excludes = normalize_excludes(excludes)?;
    scan_validated(root, excludes)
}

fn scan_validated(root: &Path, excludes: Vec<String>) -> Result<WorkspaceScan, EngineError> {
    let root = root.canonicalize().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => EngineError::PathNotFound(root.to_path_buf()),
        _ => EngineError::Io(e),
    })?;
    if !root.is_dir() {
        return Err(EngineError::PathNotFound(root));
    }

    // (canonical manifest path, relative manifest path, parse result)
    let mut found: Vec<(PathBuf, String, Result<Manifest, String>)> = Vec::new();
    let mut skipped = 0usize;

    // Iterative walk (no recursion) with depth + symlink guards. Each stack
    // entry carries its forward-slash path relative to the root ("" at the
    // root) so exclusion pruning is a plain string-prefix check.
    let mut stack: Vec<(PathBuf, usize, String)> = vec![(root.clone(), 0, String::new())];
    while let Some((dir, depth, rel)) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(ft) = entry.file_type() else {
                skipped += 1;
                continue;
            };
            if ft.is_symlink() {
                skipped += 1;
                continue;
            }
            if ft.is_dir() {
                if is_skipped_dir(&name) {
                    skipped += 1;
                    continue;
                }
                if depth >= MAX_DEPTH {
                    skipped += 1;
                    continue;
                }
                let child_rel = if rel.is_empty() {
                    name.clone()
                } else {
                    format!("{rel}/{name}")
                };
                // Operator exclusion: prune the whole subtree, counted.
                if excludes.iter().any(|x| x == &child_rel) {
                    skipped += 1;
                    continue;
                }
                stack.push((path, depth + 1, child_rel));
            } else if name == "Cargo.toml" {
                let rel_manifest = if rel.is_empty() {
                    name.clone()
                } else {
                    format!("{rel}/{name}")
                };
                // read_regular_file: symlinks/FIFOs/devices/oversized files
                // can never hang or OOM the scan — they degrade to the same
                // named "unreadable manifest" finding a parse failure does.
                let parsed = read_regular_file(&path)
                    .map_err(|e| format!("unreadable manifest: {e}"))
                    .and_then(|text| {
                        toml::from_str::<Manifest>(&text)
                            .map_err(|e| format!("TOML parse error: {e}"))
                    });
                let canon = path.canonicalize().unwrap_or(path);
                found.push((canon, rel_manifest, parsed));
            }
        }
    }
    // Deterministic manifest order regardless of readdir order.
    found.sort_by(|a, b| a.1.cmp(&b.1));

    if found.is_empty() {
        return Err(EngineError::NoManifests(root));
    }
    let manifests_found = found.len();
    let parse_failures = found.iter().filter(|(_, _, r)| r.is_err()).count();

    // Root manifest: the one at the scan root if present, else the shallowest
    // (then lexicographically smallest) relative path — deterministic.
    let root_idx = found
        .iter()
        .position(|(_, rel, _)| rel == "Cargo.toml")
        .unwrap_or_else(|| {
            let mut best = 0usize;
            let mut best_key = (usize::MAX, String::new());
            for (i, (_, rel, _)) in found.iter().enumerate() {
                let key = (rel.matches('/').count(), rel.clone());
                if key < best_key {
                    best = i;
                    best_key = key;
                }
            }
            best
        });

    // Workspace inheritance table: `[workspace.package]` + shared
    // `[workspace.dependencies]` from a root manifest declaring [workspace].
    let root_manifest = found[root_idx].2.clone().ok();
    let (ws_pkg, ws_deps): (WorkspacePackage, BTreeMap<String, DepSpec>) = root_manifest
        .as_ref()
        .filter(|m| m.has_workspace_table())
        .and_then(|m| m.workspace.as_ref())
        .map(|w| {
            (
                w.package.clone().unwrap_or_default(),
                w.dependencies.clone(),
            )
        })
        .unwrap_or_default();

    // Build the crate set (parsed manifests that declare a [package]).
    let mut crates: Vec<CrateInfo> = Vec::new();
    // canonical crate dir → package name (for path-dep resolution)
    let mut dir_to_name: BTreeMap<PathBuf, String> = BTreeMap::new();
    let mut records: Vec<ManifestRecord> = Vec::new();

    for (canon, rel, parsed) in found.into_iter() {
        let declares_workspace = parsed.as_ref().is_ok_and(Manifest::has_workspace_table);
        let crate_name = parsed
            .as_ref()
            .ok()
            .and_then(Manifest::package_name)
            .map(str::to_owned);
        if let (Ok(m), Some(name)) = (&parsed, &crate_name) {
            if let Some(dir) = canon.parent() {
                dir_to_name.insert(dir.to_path_buf(), name.clone());
            }
            let dir = canon
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| root.clone());
            let package = m.package.clone().unwrap_or(Package {
                name: Some(name.clone()),
                version: None,
                license: None,
                license_file: None,
                description: None,
                workspace: None,
            });
            crates.push(build_crate_info(
                m, &package, name, &rel, &dir, &root, &ws_pkg,
            ));
        }
        records.push(ManifestRecord {
            crate_name,
            rel,
            result: parsed,
            declares_workspace,
        });
    }
    crates.sort_by(|a, b| {
        a.name
            .cmp(&b.name)
            .then(a.manifest_path.cmp(&b.manifest_path))
    });

    // Resolve path dependencies → measured records; intra-workspace
    // resolutions become the canonical edge list.
    let mut edges: Vec<Edge> = Vec::new();
    let mut path_deps: Vec<PathDepRecord> = Vec::new();
    for record in records.iter() {
        let Some(m) = record.manifest() else { continue };
        let Some(from) = m.package_name() else {
            continue;
        };
        let from = from.to_owned();
        let manifest_dir = root.join(manifest_parent_dir(&record.rel));
        for (section, table) in m.dep_sections() {
            let kind = edge_kind(section);
            for (key, spec) in table {
                let dep_name = DepSpec::dep_name(key, spec);
                let DepSpec::Detailed(detail) = spec else {
                    continue;
                };
                if detail.git.is_some() {
                    continue; // git deps are never intra-workspace edges
                }
                // `foo = { workspace = true }` → resolve the shared
                // definition in the root `[workspace.dependencies]` table.
                let effective: Option<DepDetail> = if detail.workspace.unwrap_or(false) {
                    ws_deps.get(key).and_then(|s| match s {
                        DepSpec::Simple(_) => None,
                        DepSpec::Detailed(d) => Some(d.clone()),
                    })
                } else {
                    Some(detail.clone())
                };
                let Some(eff) = effective else { continue };
                let Some(path_val) = eff.path.clone() else {
                    continue;
                };
                let has_version = eff.version.is_some();

                let target_dir = manifest_dir.join(&path_val);
                let target_canon = target_dir.canonicalize().ok();
                let target_name = target_canon
                    .as_deref()
                    .and_then(|t| dir_to_name.get(t).cloned());
                match target_name {
                    Some(to) => {
                        edges.push(Edge {
                            from: from.clone(),
                            to: to.clone(),
                            kind,
                        });
                        path_deps.push(PathDepRecord {
                            from: from.clone(),
                            dep: dep_name.to_owned(),
                            kind,
                            rel_path: path_val,
                            resolved_to: Some(to),
                            has_version,
                            escaped: false,
                        });
                    }
                    None => {
                        // Measured fact: target manifest missing, or exists
                        // outside the analyzed crate set. Never a ghost node.
                        let escaped = target_canon
                            .map(|t| t.join("Cargo.toml").is_file())
                            .unwrap_or(false);
                        path_deps.push(PathDepRecord {
                            from: from.clone(),
                            dep: dep_name.to_owned(),
                            kind,
                            rel_path: path_val,
                            resolved_to: None,
                            has_version,
                            escaped,
                        });
                    }
                }
            }
        }
    }
    edges.sort_by(|a, b| {
        a.from
            .cmp(&b.from)
            .then(a.to.cmp(&b.to))
            .then(a.kind.cmp(&b.kind))
    });
    edges.dedup();
    path_deps.sort_by(|a, b| {
        a.from
            .cmp(&b.from)
            .then(a.dep.cmp(&b.dep))
            .then(a.rel_path.cmp(&b.rel_path))
    });

    let workspace_name = root_manifest
        .as_ref()
        .and_then(Manifest::package_name)
        .map(str::to_owned)
        .unwrap_or_else(|| {
            root.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "workspace".to_owned())
        });

    let toolchain = read_toolchain(&root);

    Ok(WorkspaceScan {
        root,
        workspace_name,
        toolchain,
        crates,
        edges,
        manifests: records,
        path_deps,
        manifests_found,
        parse_failures,
        skipped,
        excludes,
    })
}

/// Directory part of a relative manifest path ("" for a root-level one).
fn manifest_parent_dir(rel_manifest: &str) -> String {
    match rel_manifest.rfind('/') {
        Some(i) => rel_manifest[..i].to_owned(),
        None => String::new(),
    }
}

/// Derive measured [`CrateInfo`] from a parsed package manifest.
fn build_crate_info(
    m: &Manifest,
    package: &Package,
    name: &str,
    rel_manifest: &str,
    canon_dir: &Path,
    root: &Path,
    ws_pkg: &WorkspacePackage,
) -> CrateInfo {
    let pointer = &package.workspace;

    // Workspace inheritance resolution: follow `package.workspace = "…"`
    // when present; otherwise inherit from the scan-root [workspace.package]
    // for member crates (the measured cargo convention).
    let ws_target: Option<WorkspacePackage> = match pointer {
        Some(rel) => {
            let target = canon_dir.join(rel).join("Cargo.toml");
            read_regular_file(&target)
                .ok()
                .and_then(|t| toml::from_str::<Manifest>(&t).ok())
                .filter(|m| m.has_workspace_table())
                .and_then(|m| m.workspace)
                .and_then(|w| w.package)
        }
        None => {
            if rel_manifest != "Cargo.toml" {
                Some(ws_pkg.clone())
            } else {
                None
            }
        }
    };

    let resolve = |field: &Option<MetaValue>,
                   ws_key: fn(&WorkspacePackage) -> &Option<MetaValue>|
     -> Option<String> {
        match field {
            Some(MetaValue::Text(s)) => Some(s.clone()),
            Some(v) if v.is_inherited() => ws_target
                .as_ref()
                .and_then(|w| ws_key(w).as_ref().and_then(MetaValue::text))
                .map(str::to_owned),
            _ => None,
        }
    };

    let version = resolve(&package.version, |w| &w.version).unwrap_or_else(|| "unknown".to_owned());
    let license = resolve(&package.license, |w| &w.license)
        .or_else(|| resolve(&package.license_file, |w| &w.license));
    let description = resolve(&package.description, |w| &w.description);

    let band = if m.bin.is_some() || has_main_rs(canon_dir) {
        Band::Bin
    } else {
        Band::Lib
    };
    let kind = if m.lib.as_ref().is_some_and(LibTable::is_proc_macro) {
        NodeKind::ProcMacro
    } else {
        NodeKind::Workspace
    };

    CrateInfo {
        name: name.to_owned(),
        version,
        manifest_path: rel_manifest.to_owned(),
        crate_root: rel_forward(root, canon_dir),
        band,
        kind,
        license,
        description,
    }
}

fn edge_kind(section: &str) -> EdgeKind {
    match section {
        "dev-dependencies" => EdgeKind::Dev,
        "build-dependencies" => EdgeKind::Build,
        _ => EdgeKind::Normal,
    }
}

/// File names the engine MEASURES (scan + fingerprint must agree on this
/// set — see [`manifest_fingerprint`]).
fn is_measured_file_name(name: &str) -> bool {
    name == "Cargo.toml" || name == "rust-toolchain.toml" || name == "rust-toolchain"
}

fn is_skipped_dir(name: &str) -> bool {
    name == "target"
        || name == "node_modules"
        || name == ".git"
        || name == ".hg"
        || name == ".svn"
        || name.starts_with('.')
}

fn has_main_rs(canon_dir: &Path) -> bool {
    canon_dir.join("src").join("main.rs").is_file()
}

/// Measured toolchain channel from `rust-toolchain.toml` at the scan root.
fn read_toolchain(root: &Path) -> String {
    let path = root.join("rust-toolchain.toml");
    // read_regular_file: a symlinked/FIFO/oversized toolchain file is
    // treated as ABSENT (measured honestly as "unspecified") — opening a
    // hostile one (e.g. a symlink to /dev/zero) must never hang the scan.
    if let Ok(text) = read_regular_file(&path) {
        if let Ok(v) = toml::from_str::<toml::Table>(&text) {
            if let Some(channel) = v
                .get("toolchain")
                .and_then(|t| t.get("channel"))
                .and_then(toml::Value::as_str)
            {
                return channel.to_owned();
            }
        }
    }
    // Fallback: plain `rust-toolchain` file containing just the channel.
    let plain = root.join("rust-toolchain");
    if let Ok(text) = read_regular_file(&plain) {
        if let Some(channel) = text.lines().map(str::trim).find(|l| !l.is_empty()) {
            return channel.to_owned();
        }
    }
    "unspecified (no rust-toolchain.toml)".to_owned()
}

/// Fingerprint of every input the engine MEASURES, for incremental
/// re-analysis (daemon cache, GitHub issue #58 tranche 2).
///
/// Walks `root` with the exact same skip rules as [`scan_workspace`] (same
/// `is_skipped_dir`, same depth guard, no symlinked dirs), collects every
/// `Cargo.toml` / `rust-toolchain.toml` / plain `rust-toolchain`, sorts the
/// root-relative paths (so readdir order cannot leak into the value), and
/// hashes each file's CONTENT together with its path (FNV-1a 64-bit,
/// dependency-free).
///
/// Why content, not mtime: mtime granularity is filesystem-dependent (some
/// overlay/CIFS filesystems have second-level granularity), so a
/// same-length rewrite inside one timestamp tick could evade an
/// mtime-based key and serve a STALE cache hit — unacceptable under the
/// honesty contract. A content hash makes the invalidation key complete
/// and filesystem-independent: identical contents ⇒ identical fingerprint
/// (a no-op rewrite may legitimately hit the cache — the measured inputs
/// did not change), ANY content change ⇒ different fingerprint ⇒ full
/// re-scan. The check cost is one read per measured file; parsing, finding
/// analysis, graph construction and report assembly are all skipped on a
/// hit. A file that vanishes between walk and read is skipped — its
/// fingerprint simply differs, and the caller re-scans from the filesystem.
pub fn manifest_fingerprint(root: &Path) -> Result<u64, EngineError> {
    let root = root.canonicalize().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => EngineError::PathNotFound(root.to_path_buf()),
        _ => EngineError::Io(e),
    })?;
    if !root.is_dir() {
        return Err(EngineError::PathNotFound(root));
    }

    let mut paths: Vec<String> = Vec::new();
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.clone(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                if is_skipped_dir(&name) || depth >= MAX_DEPTH {
                    continue;
                }
                stack.push((path, depth + 1));
            } else if is_measured_file_name(&name) {
                // Non-regular measured-name entries (a hostile FIFO or
                // device wearing the name) still PARTICIPATE in the
                // fingerprint — their presence changes what a scan reports —
                // but the read below never OPENS them.
                paths.push(rel_forward(&root, &path));
            }
        }
    }
    if paths.is_empty() {
        return Err(EngineError::NoManifests(root));
    }
    paths.sort();

    // Read + hash in parallel (the fingerprint check must stay cheap or the
    // daemon's incremental win evaporates); the MERGE below is strictly
    // path-ordered, so readdir/scheduling order can never leak into the
    // value — identical contents always yield the identical fingerprint.
    let chunks: Vec<Vec<String>> = {
        let workers = std::thread::available_parallelism()
            .map(|n| n.get().clamp(1, 16))
            .unwrap_or(4);
        let target = paths.len().div_ceil(workers).max(1);
        paths.chunks(target).map(<[String]>::to_vec).collect()
    };
    let per_path: Vec<(String, u64)> = std::thread::scope(|scope| {
        let handles: Vec<_> = chunks
            .into_iter()
            .map(|chunk| {
                let root = &root;
                scope.spawn(move || {
                    chunk
                        .into_iter()
                        .map(|rel| {
                            let path = root.join(&rel);
                            // Never open a non-regular file (a FIFO wearing a
                            // measured name would hang this read forever).
                            let h = match std::fs::symlink_metadata(&path) {
                                Ok(meta) if meta.is_file() => match std::fs::read(&path) {
                                    Ok(bytes) => fnv1a(&bytes),
                                    Err(_) => fnv1a(b"<vanished>"),
                                },
                                Ok(_) => fnv1a(b"<not-a-regular-file>"),
                                Err(_) => fnv1a(b"<vanished>"),
                            };
                            (rel, h)
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        let mut all: Vec<(String, u64)> = Vec::new();
        for h in handles {
            all.extend(h.join().unwrap_or_default());
        }
        all.sort_by(|a, b| a.0.cmp(&b.0));
        all
    });

    let mut hash: u64 = 0xcbf2_9ce4_8422_2325; // FNV-1a offset basis
    let mix = |bytes: &[u8], hash: &mut u64| {
        for b in bytes {
            *hash ^= u64::from(*b);
            *hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        // field separator so ("ab","c") can never collide with ("a","bc")
        *hash ^= 0xff;
        *hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    };
    for (rel, content_hash) in &per_path {
        mix(rel.as_bytes(), &mut hash);
        mix(&content_hash.to_le_bytes(), &mut hash);
    }
    Ok(hash)
}

/// FNV-1a 64-bit over raw bytes.
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    #[test]
    fn tiny_ws_scan_measures_three_crates_and_one_edge() {
        let scan = scan_workspace(&fixture("tiny-ws")).expect("scan ok");
        let names: Vec<&str> = scan.crate_names().collect();
        assert_eq!(names, vec!["alpha", "beta", "gamma"]);
        assert_eq!(scan.workspace_name, "tiny-ws");
        assert_eq!(scan.parse_failures, 0);
        assert_eq!(scan.manifests_found, 4); // root + 3 members
                                             // beta → alpha path dep is the single measured edge
        assert_eq!(scan.edges.len(), 1);
        assert_eq!(scan.edges[0].from, "beta");
        assert_eq!(scan.edges[0].to, "alpha");
        assert_eq!(scan.edges[0].kind, EdgeKind::Normal);
        assert!(
            scan.path_deps.len() == 1,
            "beta→alpha recorded as a measured path dep"
        );
        assert_eq!(scan.path_deps[0].resolved_to.as_deref(), Some("alpha"));
        assert!(!scan.path_deps[0].has_version);
        // measured metadata
        let alpha = scan.crates.iter().find(|c| c.name == "alpha").unwrap();
        assert_eq!(alpha.license.as_deref(), Some("MIT"));
        assert_eq!(alpha.band, Band::Lib);
        let gamma = scan.crates.iter().find(|c| c.name == "gamma").unwrap();
        assert!(gamma.license.is_none(), "gamma intentionally omits license");
        assert!(gamma.description.is_none());
        assert_eq!(gamma.band, Band::Bin, "gamma has src/main.rs");
        assert_eq!(gamma.version, "0.1.0");
    }

    #[test]
    fn cycle_ws_scan_measures_cycles_with_kinds() {
        let scan = scan_workspace(&fixture("cycle-ws")).expect("scan ok");
        let names: Vec<&str> = scan.crate_names().collect();
        assert_eq!(names, vec!["deva", "devb", "ping", "pong"]);
        // ping→pong (normal), pong→ping (normal), deva↔devb (dev-only)
        assert_eq!(scan.edges.len(), 4);
        let normal = scan
            .edges
            .iter()
            .filter(|e| e.kind == EdgeKind::Normal)
            .count();
        let dev = scan
            .edges
            .iter()
            .filter(|e| e.kind == EdgeKind::Dev)
            .count();
        assert_eq!(normal, 2);
        assert_eq!(dev, 2);
    }

    #[test]
    fn missing_path_is_a_hard_error_not_a_panic() {
        let err = scan_workspace(&PathBuf::from("/nonexistent/wanyrix/definitely-missing"));
        assert!(matches!(err, Err(EngineError::PathNotFound(_))));
    }

    #[test]
    fn empty_dir_reports_no_manifests() {
        let dir = std::env::temp_dir().join(format!("wanyrix-empty-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let err = scan_workspace(&dir);
        assert!(matches!(err, Err(EngineError::NoManifests(_))));
        std::fs::remove_dir(&dir).ok();
    }

    #[test]
    fn toolchain_defaults_honestly() {
        let scan = scan_workspace(&fixture("tiny-ws")).unwrap();
        assert_eq!(scan.toolchain, "unspecified (no rust-toolchain.toml)");
    }

    #[test]
    fn broken_path_dep_is_measured_not_crashed() {
        // synthetic workspace: dep path points nowhere
        let dir = std::env::temp_dir().join(format!("wanyrix-broken-{}", std::process::id()));
        let crate_dir = dir.join("b");
        std::fs::create_dir_all(&crate_dir).unwrap();
        std::fs::write(dir.join("Cargo.toml"), "[workspace]\nmembers = [\"b\"]\n").unwrap();
        std::fs::write(
            crate_dir.join("Cargo.toml"),
            "[package]\nname = \"b\"\nversion = \"0.1.0\"\nlicense = \"MIT\"\ndescription = \"x\"\n\n[dependencies]\nghost = { path = \"../missing\" }\n",
        )
        .unwrap();
        let scan = scan_workspace(&dir).unwrap();
        assert_eq!(scan.edges.len(), 0, "no ghost nodes");
        assert_eq!(scan.path_deps.len(), 1);
        assert!(!scan.path_deps[0].escaped);
        assert!(!scan.path_deps[0].has_version);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn fingerprint_is_stable_for_an_unchanged_workspace() {
        let fp1 = manifest_fingerprint(&fixture("tiny-ws")).unwrap();
        let fp2 = manifest_fingerprint(&fixture("tiny-ws")).unwrap();
        assert_eq!(fp1, fp2);
        assert_ne!(fp1, 0);
    }

    #[test]
    fn fingerprint_covers_every_file_the_engine_measures() {
        let dir = std::env::temp_dir().join(format!("wanyrix-fp-surface-{}", std::process::id()));
        let crate_dir = dir.join("a");
        std::fs::create_dir_all(&crate_dir).unwrap();
        std::fs::write(dir.join("Cargo.toml"), "[workspace]\nmembers = [\"a\"]\n").unwrap();
        std::fs::write(
            crate_dir.join("Cargo.toml"),
            "[package]\nname = \"a\"\nversion = \"0.1.0\"\nlicense = \"MIT\"\ndescription = \"x\"\n",
        )
        .unwrap();
        let base = manifest_fingerprint(&dir).unwrap();

        // Manifest content change (same length, different byte) ⇒ different.
        let manifest = crate_dir.join("Cargo.toml");
        std::fs::write(&manifest, "[package]\nname = \"a\"\nversion = \"0.1.1\"\nlicense = \"MIT\"\ndescription = \"x\"\n").unwrap();
        assert_ne!(
            manifest_fingerprint(&dir).unwrap(),
            base,
            "manifest content is measured"
        );
        std::fs::write(&manifest, "[package]\nname = \"a\"\nversion = \"0.1.0\"\nlicense = \"MIT\"\ndescription = \"x\"\n").unwrap();
        assert_eq!(
            manifest_fingerprint(&dir).unwrap(),
            base,
            "content hash: restoring the bytes restores the fingerprint"
        );

        // New manifest ⇒ different.
        let b = dir.join("b");
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(
            b.join("Cargo.toml"),
            "[package]\nname = \"b\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        let with_b = manifest_fingerprint(&dir).unwrap();
        assert_ne!(with_b, base);

        // rust-toolchain.toml ⇒ measured (it feeds the toolchain field).
        std::fs::write(
            dir.join("rust-toolchain.toml"),
            "[toolchain]\nchannel = \"stable\"\n",
        )
        .unwrap();
        assert_ne!(
            manifest_fingerprint(&dir).unwrap(),
            with_b,
            "toolchain file is measured"
        );

        // Source files and target/ artifacts are NOT part of the surface.
        let base_now = manifest_fingerprint(&dir).unwrap();
        std::fs::create_dir_all(crate_dir.join("src")).unwrap();
        std::fs::write(crate_dir.join("src/lib.rs"), "pub fn changed() {}").unwrap();
        std::fs::create_dir_all(dir.join("target/debug")).unwrap();
        std::fs::write(dir.join("target/debug/junk"), "build artifact").unwrap();
        assert_eq!(
            manifest_fingerprint(&dir).unwrap(),
            base_now,
            "engine reads no .rs source and no target/"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn fingerprint_errors_track_scan_errors() {
        assert!(matches!(
            manifest_fingerprint(&std::path::PathBuf::from("/wanyrix/no/such/dir")),
            Err(EngineError::PathNotFound(_))
        ));
        let dir = std::env::temp_dir().join(format!("wanyrix-fp-empty-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(matches!(
            manifest_fingerprint(&dir),
            Err(EngineError::NoManifests(_))
        ));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Temp workspace: root package `top`, member `kept`, a nested member at
    /// `a/b`, a sibling at `a/c`, and a `vendor/junk` manifest that fails to
    /// parse (so exclusion vs. inclusion is measurable via parse failures).
    fn exclusion_fixture(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wanyrix-excl-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for sub in ["kept/src", "a/b/src", "a/c/src", "vendor/junk"] {
            std::fs::create_dir_all(dir.join(sub)).unwrap();
        }
        std::fs::write(
            dir.join("Cargo.toml"),
            "[workspace]\nmembers = [\"kept\", \"a/b\", \"a/c\"]\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("kept/Cargo.toml"),
            "[package]\nname = \"kept\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        std::fs::write(dir.join("kept/src/lib.rs"), "pub fn k() {}\n").unwrap();
        std::fs::write(
            dir.join("a/b/Cargo.toml"),
            "[package]\nname = \"deep-b\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        std::fs::write(dir.join("a/b/src/lib.rs"), "pub fn b() {}\n").unwrap();
        std::fs::write(
            dir.join("a/c/Cargo.toml"),
            "[package]\nname = \"deep-c\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        std::fs::write(dir.join("a/c/src/lib.rs"), "pub fn c() {}\n").unwrap();
        std::fs::write(dir.join("vendor/junk/Cargo.toml"), "not toml {{{").unwrap();
        dir
    }

    #[test]
    fn exclude_prunes_subtree_counts_the_skip_and_echoes() {
        let dir = exclusion_fixture("prune");
        let plain = scan_workspace(&dir).expect("plain scan ok");
        assert_eq!(plain.excludes, Vec::<String>::new());
        assert_eq!(plain.manifests_found, 5); // root + kept + a/b + a/c + vendor/junk
        assert_eq!(plain.parse_failures, 1); // vendor/junk measured, never hidden
        let names: Vec<&str> = plain.crate_names().collect();
        assert_eq!(names, vec!["deep-b", "deep-c", "kept"]);

        let excluded =
            scan_workspace_excluding(&dir, &["vendor".to_owned()]).expect("excluded scan ok");
        assert_eq!(excluded.excludes, vec!["vendor".to_owned()]);
        assert_eq!(excluded.manifests_found, 4, "vendor/junk is pruned");
        assert_eq!(excluded.parse_failures, 0, "pruned = not measured");
        assert!(
            excluded.skipped > plain.skipped,
            "the pruned subtree is counted, not silent ({} → {})",
            plain.skipped,
            excluded.skipped
        );
        let names: Vec<&str> = excluded.crate_names().collect();
        assert_eq!(names, vec!["deep-b", "deep-c", "kept"], "siblings survive");

        // A deeper exclusion removes only that subtree: a/b out, a/c in.
        let deep = scan_workspace_excluding(&dir, &["a/b".to_owned()]).expect("deep exclude ok");
        assert_eq!(deep.manifests_found, 4);
        let names: Vec<&str> = deep.crate_names().collect();
        assert_eq!(names, vec!["deep-c", "kept"]);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn exclude_values_are_normalized_deduped_and_sorted() {
        let dir = exclusion_fixture("norm");
        let scan = scan_workspace_excluding(
            &dir,
            &[
                "vendor/".to_owned(),
                "./vendor".to_owned(),
                " a/c ".to_owned(),
            ],
        )
        .expect("normalized scan ok");
        assert_eq!(scan.excludes, vec!["a/c".to_owned(), "vendor".to_owned()]);
        assert_eq!(scan.manifests_found, 3); // root + kept + a/b (vendor + a/c pruned)

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn exclude_rejects_escaping_absolute_and_empty_values() {
        let dir = exclusion_fixture("reject");
        for bad in [
            "/etc".to_owned(),
            "..".to_owned(),
            "../escape".to_owned(),
            "kept/../kept".to_owned(),
            ".".to_owned(),
            "".to_owned(),
            "   ".to_owned(),
        ] {
            let err = scan_workspace_excluding(&dir, std::slice::from_ref(&bad))
                .expect_err("must be rejected");
            assert!(
                matches!(err, EngineError::InvalidExclude(_)),
                "{bad:?} → InvalidExclude, got {err:?}"
            );
        }
        // The scan root itself was never touched by the rejections.
        assert!(scan_workspace(&dir).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn doctor_envelope_echoes_excludes_and_default_stays_absent() {
        use crate::cli;
        use crate::report;

        let dir = exclusion_fixture("echo");
        let excluded = scan_workspace_excluding(&dir, &["vendor".to_owned()]).unwrap();
        let f = crate::analysis::analyze(&excluded);
        let report_value =
            serde_json::to_value(report::doctor_report(&excluded, &f, cli::now_iso8601())).unwrap();
        assert_eq!(
            report_value["scan"]["excludes"],
            serde_json::json!(["vendor"]),
            "exclusions are named in the envelope"
        );

        // Default wire contract: no flag → no excludes key anywhere.
        let plain = scan_workspace(&dir).unwrap();
        let f = crate::analysis::analyze(&plain);
        let plain_value =
            serde_json::to_value(report::doctor_report(&plain, &f, cli::now_iso8601())).unwrap();
        assert!(
            plain_value["scan"].get("excludes").is_none(),
            "default envelope must stay byte-identical: {plain_value:?}"
        );

        std::fs::remove_dir_all(&dir).ok();
    }
}
