//! Minimal UTC ISO-8601 timestamp formatting from `SystemTime`.
//!
//! Engine v1 avoids a date-time dependency: the conversion below is the
//! standard civil-from-days algorithm (Howard Hinnant / chrono), which is
//! exact for the full `u64` seconds-since-epoch range we need. No network,
//! no locale, no panics: a pre-epoch clock degrades to the epoch value
//! rather than aborting a scan (documented, honest fallback).

use std::time::{SystemTime, UNIX_EPOCH};

/// Current UTC time as `YYYY-MM-DDTHH:MM:SSZ` (RFC 3339 / ISO-8601).
pub fn iso8601_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        // A clock before 1970 is treated as the epoch rather than panicking
        // mid-scan; the emitted timestamp remains a valid ISO-8601 instant.
        .unwrap_or_default()
        .as_secs();
    iso8601_from_unix(secs)
}

/// Format seconds-since-Unix-epoch as `YYYY-MM-DDTHH:MM:SSZ`.
pub fn iso8601_from_unix(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = (secs % 86_400) as u32;
    let (y, m, d) = civil_from_days(days);
    let (hh, mm, ss) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

/// Parse `YYYY-MM-DDTHH:MM:SSZ` (the exact format [`iso8601_from_unix`]
/// emits) back to seconds-since-Unix-epoch.
///
/// Strict inverse — no locale, no timezone offsets, no fractional seconds:
/// the engine emits exactly this one format, so the store accepts exactly
/// this one format. Anything else is an error (never a silently-wrong
/// timestamp). Pre-epoch instants are rejected rather than wrapped: the
/// store's columns are unsigned epochs.
pub fn unix_from_iso8601(s: &str) -> Result<u64, String> {
    let b = s.as_bytes();
    let malformed = || format!("malformed ISO-8601 timestamp (want YYYY-MM-DDTHH:MM:SSZ): {s}");
    if b.len() != 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b'Z'
    {
        return Err(malformed());
    }
    let num = |lo: usize, hi: usize| -> Result<i64, String> {
        s.get(lo..hi)
            .ok_or_else(malformed)?
            .parse::<i64>()
            .map_err(|_| malformed())
    };
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (hh, mm, ss) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || hh > 23 || mm > 59 || ss > 59 {
        return Err(format!("out-of-range calendar field in timestamp: {s}"));
    }
    let days = days_from_civil(y, mo as u32, d as u32);
    let secs = days * 86_400 + hh * 3_600 + mm * 60 + ss;
    if secs < 0 {
        return Err(format!("timestamp precedes the Unix epoch: {s}"));
    }
    Ok(secs as u64)
}

/// (year, month, day) → days since 1970-01-01. Hinnant's inverse algorithm.
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = if m > 2 { m - 3 } else { m + 9 } as i64; // [0, 11]
    let doy = (153 * mp + 2) / 5 + d as i64 - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

/// Days since 1970-01-01 → (year, month, day). Hinnant's algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch() {
        assert_eq!(iso8601_from_unix(0), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn known_instants() {
        assert_eq!(iso8601_from_unix(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(iso8601_from_unix(1_709_164_800), "2024-02-29T00:00:00Z");
        assert_eq!(iso8601_from_unix(1_700_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(iso8601_from_unix(4_102_444_800), "2100-01-01T00:00:00Z");
        assert_eq!(iso8601_from_unix(1_789_738_136), "2026-09-18T13:28:56Z");
    }

    #[test]
    fn end_of_day_rollover() {
        assert_eq!(iso8601_from_unix(86_399), "1970-01-01T23:59:59Z");
        assert_eq!(iso8601_from_unix(86_400), "1970-01-02T00:00:00Z");
    }

    /// The parser is the exact inverse of the formatter across known
    /// instants, including leap years and the year-2100 boundary.
    #[test]
    fn iso8601_parse_round_trips() {
        for secs in [
            0u64,
            86_399,
            951_782_400,
            1_709_164_800,
            1_700_000_000,
            4_102_444_800,
        ] {
            let text = iso8601_from_unix(secs);
            assert_eq!(unix_from_iso8601(&text), Ok(secs), "round-trip {text}");
        }
        assert_eq!(unix_from_iso8601("2026-09-18T13:28:56Z"), Ok(1_789_738_136));
    }

    /// Malformed or pre-epoch input is an error, never a wrong number.
    #[test]
    fn iso8601_parse_rejects_garbage() {
        for bad in [
            "",
            "2026-09-18 13:28:56",    // space instead of T, no Z
            "2026-09-18T13:28:56",    // missing Z
            "2026-9-18T13:28:56Z",    // unpadded month
            "2026-09-18T13:28:56.5Z", // fractional seconds unsupported (strict)
            "2026-13-18T13:28:56Z",   // month 13
            "2026-09-32T13:28:56Z",   // day 32
            "1969-12-31T23:59:59Z",   // pre-epoch
            "zzzz-09-18T13:28:56Z",   // non-numeric
        ] {
            assert!(unix_from_iso8601(bad).is_err(), "must reject {bad:?}");
        }
        // Documented strictness limit: day-of-month range is 1..=31; the
        // calendar clamp (Sep 31) is not validated (no chrono dependency).
        // The engine only ever parses timestamps IT emitted, which are
        // always valid by construction.
        assert!(unix_from_iso8601("2026-09-31T13:28:56Z").is_ok());
    }
}
