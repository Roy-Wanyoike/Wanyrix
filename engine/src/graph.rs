//! Dependency graph: nodes + edges + fan-in/out + recompute-impact closure.
//!
//! Single-source-of-truth rule (honors ENG-TCA-3): every aggregate below is
//! derived from the ONE measured edge list in [`WorkspaceScan::edges`].
//! Nodes exist only for scanned crates — unresolvable path dependencies
//! never become "ghost" nodes.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::model::{CrateInfo, Edge, WorkspaceScan};

/// A strongly connected component with a human-readable cycle path.
#[derive(Debug, Clone)]
pub struct Scc {
    /// Members sorted lexicographically.
    pub members: Vec<String>,
    /// Edges entirely inside the SCC (both endpoints are members).
    pub internal_edges: Vec<Edge>,
    /// A concrete measured cycle path, e.g. `ping → pong → ping`.
    pub path: String,
}

/// Tarjan SCC over the measured edge list. Returns only the SCCs that are
/// actual cycles (size > 1, or a self-loop), each with a deterministic
/// representative path. Terminates on any input (visited-set based), which
/// is what keeps `wanyrix graph` safe on cyclic workspaces.
pub fn strongly_connected_components(crates: &[CrateInfo], edges: &[Edge]) -> Vec<Scc> {
    let mut names: Vec<&str> = crates.iter().map(|c| c.name.as_str()).collect();
    names.sort_unstable();
    names.dedup();

    let index_of: BTreeMap<&str, usize> = names.iter().enumerate().map(|(i, n)| (*n, i)).collect();
    let n = names.len();

    // adjacency: node index -> sorted target indexes
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
    for e in edges {
        if let (Some(&a), Some(&b)) = (index_of.get(e.from.as_str()), index_of.get(e.to.as_str())) {
            if !adj[a].contains(&b) {
                adj[a].push(b);
            }
        }
    }
    for a in adj.iter_mut() {
        a.sort_unstable();
        a.dedup();
    }

    // Iterative Tarjan (explicit stack — no recursion, no stack overflow).
    let mut index = vec![usize::MAX; n];
    let mut low = vec![0usize; n];
    let mut on_stack = vec![false; n];
    let mut stack: Vec<usize> = Vec::new();
    let mut next_index = 0usize;
    let mut sccs: Vec<Vec<usize>> = Vec::new();

    // Iterative Tarjan with explicit frames (no recursion — deep graphs
    // cannot overflow the stack; cycles cannot hang the walk).
    struct Frame {
        v: usize,
        i: usize,
    }
    let mut frames: Vec<Frame> = Vec::new();
    for start in 0..n {
        if index[start] != usize::MAX {
            continue;
        }
        index[start] = next_index;
        low[start] = next_index;
        next_index += 1;
        stack.push(start);
        on_stack[start] = true;
        frames.push(Frame { v: start, i: 0 });
        while let Some(frame) = frames.last_mut() {
            let v = frame.v;
            if frame.i < adj[v].len() {
                let w = adj[v][frame.i];
                frame.i += 1;
                if index[w] == usize::MAX {
                    index[w] = next_index;
                    low[w] = next_index;
                    next_index += 1;
                    stack.push(w);
                    on_stack[w] = true;
                    frames.push(Frame { v: w, i: 0 });
                } else if on_stack[w] {
                    low[v] = low[v].min(index[w]);
                }
            } else {
                frames.pop();
                if let Some(parent) = frames.last_mut() {
                    low[parent.v] = low[parent.v].min(low[v]);
                }
                if low[v] == index[v] {
                    let mut comp = Vec::new();
                    while let Some(w) = stack.pop() {
                        on_stack[w] = false;
                        comp.push(w);
                        if w == v {
                            break;
                        }
                    }
                    comp.sort_unstable();
                    sccs.push(comp);
                }
            }
        }
    }

    let mut out = Vec::new();
    for comp in sccs {
        let is_cycle = comp.len() > 1 || comp.len() == 1 && adj[comp[0]].contains(&comp[0]);
        if !is_cycle {
            continue;
        }
        let members: Vec<String> = comp.iter().map(|&i| names[i].to_owned()).collect();
        let member_set: std::collections::BTreeSet<&str> =
            members.iter().map(String::as_str).collect();
        let internal: Vec<Edge> = edges
            .iter()
            .filter(|e| member_set.contains(e.from.as_str()) && member_set.contains(e.to.as_str()))
            .cloned()
            .collect();
        out.push(Scc {
            path: cycle_path(&members, &internal),
            members,
            internal_edges: internal,
        });
    }
    out.sort_by(|a, b| a.members.cmp(&b.members));
    out
}

/// Deterministic cycle path: start at the lexicographically smallest member
/// and follow the smallest available intra-SCC edges back to it.
fn cycle_path(members: &[String], internal: &[Edge]) -> String {
    if members.is_empty() {
        return String::new();
    }
    let start = members.first().cloned().unwrap_or_default();
    let mut path = vec![start.clone()];
    let mut current = start.clone();
    for _ in 0..members.len() {
        let next = internal
            .iter()
            .filter(|e| e.from == current && members.contains(&e.to))
            .map(|e| e.to.clone())
            .min()
            .unwrap_or_else(|| start.clone());
        path.push(next.clone());
        current = next;
        if current == start {
            break;
        }
    }
    path.join(" → ")
}

/// Serialized graph node — web-contract keys plus engine extras.
///
/// Contract notes:
/// - `buildTime` / `changeFreq` are REQUIRED by the web `GraphNode` type but
///   CANNOT be measured by engine v1 (it never compiles anything and has no
///   VCS/telemetry access). They are emitted as 0 with the explicit
///   `buildTimeStatus` / `changeFreqStatus` = "not-measured" — a visible
///   zero plus a status, never a simulated number (Gate 21).
/// - `recompileImpact` is the engine-side downstream closure (the crates
///   that would recompute when this one changes); `downstream` is its length
///   and matches the web contract's reverse-reachability count.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub band: &'static str,
    pub kind: &'static str,
    pub build_time: u64,
    pub build_time_status: &'static str,
    pub fan_in: usize,
    pub fan_out: usize,
    pub downstream: usize,
    pub recompile_impact: Vec<String>,
    pub change_freq: u64,
    pub change_freq_status: &'static str,
    pub versions: Vec<String>,
    pub duplicate: bool,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
}

/// The full derived graph (nodes already sorted by id; edges by from,to).
#[derive(Debug, Clone)]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

/// Build the graph from the scan. Node/edge order is deterministic.
///
/// Node identity is the package NAME (the web contract's edge endpoints).
/// When the same package name appears in several scanned manifests (e.g. two
/// workspaces under one scan root), they merge into ONE node: `versions`
/// carries the distinct measured versions and `duplicate` is true — a
/// measured name collision, never silently dropped.
pub fn build_graph(scan: &WorkspaceScan) -> Graph {
    // Deduped edge list (from,to) over all dependency kinds — the served
    // edge list. fanIn/fanOut are degrees over exactly this list.
    let mut served: Vec<GraphEdge> = Vec::new();
    for e in scan.edges.iter() {
        let candidate = GraphEdge {
            from: e.from.clone(),
            to: e.to.clone(),
        };
        if !served.contains(&candidate) {
            served.push(candidate);
        }
    }
    served.sort_by(|a, b| a.from.cmp(&b.from).then(a.to.cmp(&b.to)));

    // dependents adjacency (reverse edges) for the recompute-impact closure
    let mut dependents: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for e in served.iter() {
        dependents
            .entry(e.to.as_str())
            .or_default()
            .push(e.from.as_str());
    }

    // Group crate manifests by package name (deterministic input order).
    let mut by_name: BTreeMap<&str, Vec<&CrateInfo>> = BTreeMap::new();
    for c in scan.crates.iter() {
        by_name.entry(c.name.as_str()).or_default().push(c);
    }

    let mut nodes = Vec::new();
    for (name, infos) in by_name.into_iter() {
        let primary = infos[0]; // smallest manifest_path (crates are pre-sorted)
        let fan_out = served.iter().filter(|e| e.from == name).count();
        let fan_in = served.iter().filter(|e| e.to == name).count();
        let recompile = downstream_closure(name, &dependents);
        let mut versions: Vec<String> = infos.iter().map(|c| c.version.clone()).collect();
        versions.sort();
        versions.dedup();
        nodes.push(GraphNode {
            id: name.to_owned(),
            band: primary.band.as_str(),
            kind: primary.kind.as_str(),
            build_time: 0,
            build_time_status: "not-measured",
            fan_in,
            fan_out,
            downstream: recompile.len(),
            recompile_impact: recompile,
            change_freq: 0,
            change_freq_status: "not-measured",
            versions,
            duplicate: infos.len() > 1,
            path: primary.crate_root.clone(),
        });
    }
    nodes.sort_by(|a, b| a.id.cmp(&b.id));

    Graph {
        nodes,
        edges: served,
    }
}

/// Reverse-reachability closure over `dependents` (who transitively depends
/// on `name`), excluding `name` itself. Visited-set based → terminates on
/// cyclic workspaces.
fn downstream_closure(name: &str, dependents: &BTreeMap<&str, Vec<&str>>) -> Vec<String> {
    let mut seen: std::collections::BTreeSet<&str> = std::collections::BTreeSet::new();
    seen.insert(name);
    let mut queue: Vec<&str> = Vec::new();
    if let Some(direct) = dependents.get(name) {
        for d in direct {
            if seen.insert(d) {
                queue.push(d);
            }
        }
    }
    let mut i = 0;
    while i < queue.len() {
        let cur = queue[i];
        i += 1;
        if let Some(next) = dependents.get(cur) {
            for d in next {
                if seen.insert(d) {
                    queue.push(d);
                }
            }
        }
    }
    seen.remove(name);
    seen.into_iter().map(str::to_owned).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::analyze;
    use crate::scan::scan_workspace;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    #[test]
    fn tiny_ws_graph_derives_aggregates_from_edges_only() {
        let scan = scan_workspace(&fixture("tiny-ws")).unwrap();
        let g = build_graph(&scan);
        assert_eq!(g.nodes.len(), 3);
        assert_eq!(g.edges.len(), 1);
        assert_eq!(g.edges[0].from, "beta");
        assert_eq!(g.edges[0].to, "alpha");
        let alpha = g.nodes.iter().find(|n| n.id == "alpha").unwrap();
        assert_eq!((alpha.fan_in, alpha.fan_out), (1, 0));
        assert_eq!(alpha.recompile_impact, vec!["beta"]);
        assert_eq!(alpha.downstream, 1);
        let gamma = g.nodes.iter().find(|n| n.id == "gamma").unwrap();
        assert_eq!((gamma.fan_in, gamma.fan_out), (0, 0));
        assert_eq!(gamma.recompile_impact, Vec::<String>::new());
        assert_eq!(gamma.band, "bin");
        assert_eq!(alpha.build_time_status, "not-measured");
    }

    #[test]
    fn cycle_ws_graph_terminates_and_reports_sccs() {
        let scan = scan_workspace(&fixture("cycle-ws")).unwrap();
        let g = build_graph(&scan); // must not hang
        assert_eq!(g.nodes.len(), 4);
        assert_eq!(g.edges.len(), 4);
        // downstream closure terminates at 1 (the other cycle member)
        let ping = g.nodes.iter().find(|n| n.id == "ping").unwrap();
        assert_eq!(ping.recompile_impact, vec!["pong"]);
        assert_eq!(ping.downstream, 1);
        // SCCs found with deterministic paths
        let sccs = strongly_connected_components(&scan.crates, &scan.edges);
        assert_eq!(sccs.len(), 2);
        assert_eq!(sccs[0].path, "deva → devb → deva");
        assert_eq!(sccs[1].path, "ping → pong → ping");
        // cycle findings + graph stay consistent (cycles + path-only normal deps)
        let findings = analyze(&scan);
        assert_eq!(findings.len(), 4);
    }

    #[test]
    fn chain_closure_multi_hop() {
        // alpha <- beta <- delta chain in a synthetic workspace
        let dir = std::env::temp_dir().join(format!("wanyrix-chain-{}", std::process::id()));
        for (name, deps) in [
            ("alpha", ""),
            ("beta", "alpha = { path = \"../alpha\" }"),
            ("delta", "beta = { path = \"../beta\" }"),
        ] {
            let d = dir.join(name);
            std::fs::create_dir_all(d.join("src")).unwrap();
            let mut manifest = format!(
                "[package]\nname = \"{name}\"\nversion = \"0.1.0\"\nlicense = \"MIT\"\ndescription = \"x\"\n"
            );
            if !deps.is_empty() {
                manifest.push_str(&format!("\n[dependencies]\n{deps}\n"));
            }
            std::fs::write(d.join("Cargo.toml"), manifest).unwrap();
            std::fs::write(d.join("src").join("lib.rs"), "//\n").unwrap();
        }
        std::fs::write(
            dir.join("Cargo.toml"),
            "[workspace]\nmembers = [\"alpha\", \"beta\", \"delta\"]\n",
        )
        .unwrap();
        let scan = scan_workspace(&dir).unwrap();
        let g = build_graph(&scan);
        let alpha = g.nodes.iter().find(|n| n.id == "alpha").unwrap();
        assert_eq!(alpha.recompile_impact, vec!["beta", "delta"]);
        assert_eq!(alpha.downstream, 2);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn duplicate_crate_names_merge_into_one_node() {
        // two manifests, same package name — one merged node, flagged duplicate
        let dir = std::env::temp_dir().join(format!("wanyrix-dup-{}", std::process::id()));
        for sub in ["x", "y"] {
            let d = dir.join(sub);
            std::fs::create_dir_all(d.join("src")).unwrap();
            std::fs::write(
                d.join("Cargo.toml"),
                format!("[package]\nname = \"twin\"\nversion = \"0.1.0\"\nlicense = \"MIT\"\ndescription = \"{sub}\"\n"),
            )
            .unwrap();
            std::fs::write(d.join("src").join("lib.rs"), "//\n").unwrap();
        }
        std::fs::write(
            dir.join("Cargo.toml"),
            "[workspace]\nmembers = [\"x\", \"y\"]\n",
        )
        .unwrap();
        let scan = scan_workspace(&dir).unwrap();
        let g = build_graph(&scan);
        assert_eq!(g.nodes.len(), 1);
        assert_eq!(g.nodes[0].id, "twin");
        assert!(g.nodes[0].duplicate, "merged name collision is flagged");
        assert_eq!(g.nodes[0].versions, vec!["0.1.0"]);
        std::fs::remove_dir_all(&dir).ok();
    }
}
