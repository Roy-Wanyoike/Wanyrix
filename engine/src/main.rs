//! Thin binary wrapper: parse args, run the subcommand, print, exit.
//! All logic lives in the library (`wanyrix_engine`) so tests drive the
//! exact same code paths. No unwrap/expect on user input anywhere.

use std::process::ExitCode;

use clap::Parser;
use wanyrix_engine::cli::{self, Cli, Command};
use wanyrix_engine::report;

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli.command) {
        Ok(output) => {
            println!("{output}");
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("wanyrix: error: {err}");
            ExitCode::from(2)
        }
    }
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
    }
}
