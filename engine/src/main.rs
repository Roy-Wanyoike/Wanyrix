//! Thin binary wrapper: parse args, run the subcommand, print, exit.
//! All logic lives in the library (`wanyrix_engine`) so tests drive the
//! exact same code paths. No unwrap/expect on user input anywhere.

use std::io::Write;
use std::process::ExitCode;

use clap::Parser;
use wanyrix_engine::cli::{self, Cli, Command, SyncCmd};
use wanyrix_engine::entitlement::REVALIDATION_GRACE_DAYS;
use wanyrix_engine::report;

/// Exit code when the consumer of our stdout closed the pipe early
/// (issue #143): the Unix broken-pipe convention `128 + SIGPIPE(13)`, as a
/// CHOSEN, documented, clean stop — never the Rust runtime's raw panic
/// (exit 101) that pipeline wrappers used to observe. Documented in
/// docs/CLI.md §"Exit codes".
const BROKEN_PIPE_EXIT: u8 = 141;

fn main() -> ExitCode {
    let cli = Cli::parse();
    let output = match run(cli.command) {
        Ok(output) => output,
        Err(err) => {
            write_stderr(&format!("wanyrix: error: {err}\n"));
            return ExitCode::from(2);
        }
    };
    // stdout is written in full and flushed BEFORE declaring success; a
    // consumer that closed early (e.g. `wanyrix doctor --json | head -c 10`)
    // gets the clean documented 141 instead of a panic backtrace.
    let mut stdout = std::io::stdout().lock();
    match stdout
        .write_all(output.as_bytes())
        .and_then(|()| stdout.write_all(b"\n"))
        .and_then(|()| stdout.flush())
    {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => ExitCode::from(BROKEN_PIPE_EXIT),
        Err(e) => {
            write_stderr(&format!("wanyrix: error: cannot write stdout: {e}\n"));
            ExitCode::from(2)
        }
    }
}

/// stderr never panics either (issue #143): if the consumer closed stderr
/// too, there is nothing meaningful left to report — exit quietly.
fn write_stderr(msg: &str) {
    let mut stderr = std::io::stderr().lock();
    let _ = stderr.write_all(msg.as_bytes());
    let _ = stderr.flush();
}

/// Premium-surface gate at dispatch (AUD-1). Consulted BEFORE a gated
/// runner executes; a refusal is the named `subscription required` error
/// (exit 2) with an actionable message, a grant in the 30-day revalidation
/// grace window prints a VISIBLE grace note on stderr (stdout stays the
/// clean envelope) and the command proceeds.
///
/// The plan matrix is the ONE registry in
/// `wanyrix_engine::entitlement::SURFACE_REGISTRY` — the machine image of
/// docs/COMMERCIAL.md §"Tiers → gated surfaces":
///
/// - **Free (never gated)**: doctor, graph, health, analyze, dependencies,
///   build, init, status, store, synth, daemon, telemetry, experiment,
///   events, ai, git, impact, what-changed, **export** (local
///   artifacts-as-code — the Free tier row lists exports; the TEAM feature
///   is export *sharing*, i.e. the sync transport), activate, entitlement,
///   license. Unregistered surfaces are granted unconditionally, so the
///   `gate_surface("export")` call below is behaviorally a no-op TODAY and
///   enforcement that would activate automatically if the matrix ever
///   moved `export` to a paid tier.
/// - **Team (minimum)**: `sync.push`, `sync.pull` — the registry-branch
///   sharing + CI-referee transport. Both directions are gated: a registry
///   one could read without a license would leak the team data the gate
///   exists to protect (AUD-1's parenthetical "pull stays free" predates
///   the ratified matrix — the table wins).
/// - **Enterprise**: everything Team has, plus future enterprise-only
///   surfaces as they register.
///
/// State root is the process CWD — exactly the `.wanyrix` root `activate`
/// caches into — and `WANYRIX_ALLOW_UNLICENSED=1` (documented in
/// docs/COMMERCIAL.md) is the CI/dev escape hatch for honest dry-runs;
/// the default is strict enforcement.
fn gate_surface(surface: &str) -> Result<(), wanyrix_engine::EngineError> {
    let grant = cli::gate_cli(surface)?;
    if grant.grace {
        eprintln!(
            "wanyrix: note: entitlement is inside the {REVALIDATION_GRACE_DAYS}-day revalidation grace window — surface '{surface}' runs with a visible grace label; renew the license to keep premium surfaces"
        );
    }
    Ok(())
}

fn run(command: Command) -> Result<String, wanyrix_engine::EngineError> {
    match command {
        Command::Doctor {
            path,
            excludes,
            json,
            pretty,
        } => {
            let scan = cli::scan_excluding(&path, &excludes)?;
            let findings = cli::doctor(&scan);
            if json {
                let r = report::doctor_report(&scan, &findings, cli::now_iso8601());
                cli::serialize_json(&r, pretty)
            } else {
                Ok(cli::human_summary("doctor", &scan, &findings))
            }
        }
        Command::Graph {
            path,
            excludes,
            json,
            pretty,
        } => {
            let scan = cli::scan_excluding(&path, &excludes)?;
            let g = cli::graph(&scan);
            if json {
                let r = report::graph_report(&scan, &g, cli::now_iso8601());
                cli::serialize_json(&r, pretty)
            } else {
                Ok(cli::human_summary("graph", &scan, &[]))
            }
        }
        Command::Health {
            path,
            excludes,
            json,
            pretty,
        } => {
            let scan = cli::scan_excluding(&path, &excludes)?;
            let findings = cli::doctor(&scan);
            let g = cli::graph(&scan);
            if json {
                let (kpis, slowest, counts, insight) = cli::health(&scan, &findings, &g);
                let r = report::health_report(
                    &scan,
                    &findings,
                    &g,
                    kpis,
                    slowest,
                    counts,
                    insight,
                    cli::now_iso8601(),
                );
                cli::serialize_json(&r, pretty)
            } else {
                Ok(cli::human_summary("health", &scan, &findings))
            }
        }
        Command::Store { cmd } => cli::store_run(cmd),
        Command::Synth { crates, out, seed } => cli::synth_run(crates, &out, seed),
        Command::Daemon { cmd } => cli::daemon_run(cmd),
        Command::Telemetry { cmd } => cli::telemetry_run(cmd),
        Command::Build { path, json, pretty } => cli::build_run(&path, json, pretty),
        Command::Init {
            path,
            db,
            json,
            pretty,
        } => cli::product_init_run(&path, db.as_deref(), json, pretty),
        Command::Status {
            path,
            db,
            socket,
            json,
            pretty,
        } => cli::product_status_run(&path, db.as_deref(), socket.as_deref(), json, pretty),
        Command::Analyze {
            path,
            excludes,
            json,
            pretty,
        } => cli::product_analyze_run(&path, &excludes, json, pretty),
        Command::Dependencies {
            path,
            excludes,
            json,
            pretty,
        } => cli::product_dependencies_run(&path, &excludes, json, pretty),
        Command::Experiment { cmd } => cli::product_experiment_run(cmd),
        Command::Events { path, json, pretty } => cli::events_run(&path, json, pretty),
        Command::Ai {
            path,
            question,
            endpoint,
            model,
            timeout_secs,
            json,
            pretty,
        } => cli::ai_run(
            &path,
            &question,
            endpoint,
            model,
            timeout_secs,
            json,
            pretty,
        ),
        Command::Git {
            path,
            excludes,
            json,
            pretty,
        } => cli::git_run(&path, &excludes, json, pretty),
        Command::Impact {
            crate_name,
            path,
            excludes,
            json,
            pretty,
        } => cli::impact_run(&crate_name, &path, &excludes, json, pretty),
        Command::WhatChanged {
            path,
            db,
            excludes,
            json,
            pretty,
        } => cli::what_changed_run(&path, &db, &excludes, json, pretty),
        Command::Compare {
            db,
            from,
            to,
            json,
            pretty,
        } => cli::compare_run(&db, from, to, json, pretty),
        Command::Chain {
            path,
            db,
            finding,
            scan,
            json,
            pretty,
        } => cli::chain_run(&path, &db, finding.as_deref(), scan, json, pretty),
        Command::Export {
            path,
            out,
            excludes,
            json,
            pretty,
        } => {
            // Gated THROUGH the same matrix: `export` is unregistered today
            // (free per docs/COMMERCIAL.md), so this grants unconditionally
            // — the enforcement point already exists if the matrix ever
            // moves it. One measured pass follows only on a grant.
            gate_surface("export")?;
            cli::product_export_run(&path, out.as_deref(), &excludes, json, pretty)
        }
        Command::Activate { key, json, pretty } => cli::activate_run(&key, json, pretty),
        Command::Entitlement { json, pretty } => cli::entitlement_run(json, pretty),
        Command::License { cmd } => cli::license_run(cmd),
        Command::Sync { cmd } => {
            // The registry-branch sharing surface — TEAM-gated per the
            // single mapping (see `gate_surface`'s matrix comment). The
            // gate fires BEFORE any remote resolution, so an unlicensed
            // caller gets the subscription refusal, never a transport
            // error from work they may not do.
            match &cmd {
                SyncCmd::Push { .. } => gate_surface("sync.push")?,
                SyncCmd::Pull { .. } => gate_surface("sync.pull")?,
            }
            cli::sync_run(cmd)
        }
    }
}
