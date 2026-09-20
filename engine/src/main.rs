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
        Command::Doctor { path, json, pretty } => {
            let scan = cli::scan(&path)?;
            let findings = cli::doctor(&scan);
            if json {
                let r = report::doctor_report(&scan, &findings, cli::now_iso8601());
                cli::serialize_json(&r, pretty)
            } else {
                Ok(cli::human_summary("doctor", &scan, &findings))
            }
        }
        Command::Graph { path, json, pretty } => {
            let scan = cli::scan(&path)?;
            let g = cli::graph(&scan);
            if json {
                let r = report::graph_report(&scan, &g, cli::now_iso8601());
                cli::serialize_json(&r, pretty)
            } else {
                Ok(cli::human_summary("graph", &scan, &[]))
            }
        }
        Command::Health { path, json, pretty } => {
            let scan = cli::scan(&path)?;
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
    }
}
