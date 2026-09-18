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
use crate::pathutil::{read_to_string, rel_forward};

/// Maximum directory depth for the walk — a guard against pathological
/// trees (we never follow symlinked directories anyway).
const MAX_DEPTH: usize = 48;

/// Scan `root`, parsing every `Cargo.toml` found under it (skipping `target/`,
/// `.git`, hidden dirs and symlinked dirs — without following symlinks).
pub fn scan_workspace(root: &Path) -> Result<WorkspaceScan, EngineError> {
    let root = root
        .canonicalize()
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => EngineError::PathNotFound(root.to_path_buf()),
            _ => EngineError::Io(e),
        })?;
    if !root.is_dir() {
        return Err(EngineError::PathNotFound(root));
    }

    // (canonical manifest path, relative manifest path, parse result)
    let mut found: Vec<(PathBuf, String, Result<Manifest, String>)> = Vec::new();
    let mut skipped = 0usize;

    // Iterative walk (no recursion) with depth + symlink guards.
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.clone(), 0)];
    while let Some((dir, depth)) = stack.pop() {
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
                stack.push((path, depth + 1));
            } else if name == "Cargo.toml" {
                let rel = rel_forward(&root, &path);
                let parsed = read_to_string(&path)
                    .map_err(|e| format!("unreadable manifest: {e}"))
                    .and_then(|text| {
                        toml::from_str::<Manifest>(&text).map_err(|e| format!("TOML parse error: {e}"))
                    });
                let canon = path.canonicalize().unwrap_or(path);
                found.push((canon, rel, parsed));
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
        .map(|w| (w.package.clone().unwrap_or_default(), w.dependencies.clone()))
        .unwrap_or_default();

    // Build the crate set (parsed manifests that declare a [package]).
    let mut crates: Vec<CrateInfo> = Vec::new();
    // canonical crate dir → package name (for path-dep resolution)
    let mut dir_to_name: BTreeMap<PathBuf, String> = BTreeMap::new();
    let mut records: Vec<ManifestRecord> = Vec::new();

    for (canon, rel, parsed) in found.into_iter() {
        let declares_workspace = parsed.as_ref().is_ok_and(Manifest::has_workspace_table);
        let crate_name = parsed.as_ref().ok().and_then(Manifest::package_name).map(str::to_owned);
        if let (Ok(m), Some(name)) = (&parsed, &crate_name) {
            if let Some(dir) = canon.parent() {
                dir_to_name.insert(dir.to_path_buf(), name.clone());
            }
            let dir = canon.parent().map(Path::to_path_buf).unwrap_or_else(|| root.clone());
            let package = m.package.clone().unwrap_or(Package {
                name: Some(name.clone()),
                version: None,
                license: None,
                license_file: None,
                description: None,
                workspace: None,
            });
            crates.push(build_crate_info(m, &package, name, &rel, &dir, &root, &ws_pkg));
        }
        records.push(ManifestRecord {
            crate_name,
            rel,
            result: parsed,
            declares_workspace,
        });
    }
    crates.sort_by(|a, b| a.name.cmp(&b.name).then(a.manifest_path.cmp(&b.manifest_path)));

    // Resolve path dependencies → measured records; intra-workspace
    // resolutions become the canonical edge list.
    let mut edges: Vec<Edge> = Vec::new();
    let mut path_deps: Vec<PathDepRecord> = Vec::new();
    for record in records.iter() {
        let Some(m) = record.manifest() else { continue };
        let Some(from) = m.package_name() else { continue };
        let from = from.to_owned();
        let manifest_dir = root.join(manifest_parent_dir(&record.rel));
        for (section, table) in m.dep_sections() {
            let kind = edge_kind(section);
            for (key, spec) in table {
                let dep_name = DepSpec::dep_name(key, spec);
                let DepSpec::Detailed(detail) = spec else { continue };
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
                let Some(path_val) = eff.path.clone() else { continue };
                let has_version = eff.version.is_some();

                let target_dir = manifest_dir.join(&path_val);
                let target_canon = target_dir.canonicalize().ok();
                let target_name = target_canon
                    .as_deref()
                    .and_then(|t| dir_to_name.get(t).cloned());
                match target_name {
                    Some(to) => {
                        edges.push(Edge { from: from.clone(), to: to.clone(), kind });
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
    edges.sort_by(|a, b| a.from.cmp(&b.from).then(a.to.cmp(&b.to)).then(a.kind.cmp(&b.kind)));
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
            read_to_string(&target)
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

    let resolve = |field: &Option<MetaValue>, ws_key: fn(&WorkspacePackage) -> &Option<MetaValue>| -> Option<String> {
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
    if let Ok(text) = read_to_string(&path) {
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
    if let Ok(text) = read_to_string(&plain) {
        if let Some(channel) = text.lines().map(str::trim).find(|l| !l.is_empty()) {
            return channel.to_owned();
        }
    }
    "unspecified (no rust-toolchain.toml)".to_owned()
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
        assert!(scan.path_deps.len() == 1, "beta→alpha recorded as a measured path dep");
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
        let normal = scan.edges.iter().filter(|e| e.kind == EdgeKind::Normal).count();
        let dev = scan.edges.iter().filter(|e| e.kind == EdgeKind::Dev).count();
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
        std::fs::write(
            dir.join("Cargo.toml"),
            "[workspace]\nmembers = [\"b\"]\n",
        )
        .unwrap();
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
}
