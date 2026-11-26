//! Benchmarks of small programs (Playground): repeated runs through the Arena's measuring
//! helper (wall and CPU time in µs, peak memory, inside the sandbox so the sandbox's own
//! start-up is not counted), robust statistics, and a careful verdict when two versions are
//! compared: a difference within the noise is said to be one, never called a win.

use crate::ai::sandbox::{self, Limits};
use crate::arena::measure::{self, Sample, Stats};
use crate::error::{AppError, Result};
use crate::jobs::{Job, RunOpts};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// How many timed runs after a first one of `first_ms`: many for a fast program (its noise
/// is large next to its time), few for a slow one, within about a second and a half.
pub fn repeat_count(first_ms: u64) -> usize {
    match first_ms {
        0..=49 => (1500 / first_ms.max(1)).clamp(10, 30) as usize,
        50..=499 => 5,
        _ => 3,
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Timing {
    pub runs: usize,
    /// Milliseconds.
    pub wall: Stats,
    pub cpu: Stats,
    pub max_rss_kb: u64,
    /// Relative spread (1.4826·MAD / median): above ~5 % the measure is noisy.
    pub spread: f64,
}

pub fn timing(samples: &[Sample]) -> Option<Timing> {
    if samples.is_empty() {
        return None;
    }
    let wall: Vec<f64> = samples.iter().map(|s| s.wall_us as f64 / 1000.0).collect();
    let cpu: Vec<f64> = samples.iter().map(|s| (s.user_us + s.sys_us) as f64 / 1000.0).collect();
    let rss: Vec<f64> = samples.iter().map(|s| s.max_rss_kb as f64).collect();
    let w = measure::stats(&wall);
    let spread = if w.median > 0.0 { 1.4826 * w.mad / w.median } else { 0.0 };
    Some(Timing { runs: samples.len(), wall: w, cpu: measure::stats(&cpu), max_rss_kb: measure::median(&rss) as u64, spread })
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Verdict {
    /// `a`, `b`, or `none` when the difference is within the noise.
    pub faster: String,
    /// How many times faster the faster one is (median over median).
    pub ratio: f64,
    pub significant: bool,
    pub why: String,
}

/// Compares two timings: significant only beyond 3 robust deviations of the noisier side
/// and beyond 3 % of the time.
pub fn verdict(a: &Timing, b: &Timing) -> Verdict {
    let (ma, mb) = (a.wall.median, b.wall.median);
    let noise = (1.4826 * a.wall.mad).max(1.4826 * b.wall.mad).max(ma.min(mb) * 0.01);
    let diff = (ma - mb).abs();
    let rel = if ma.min(mb) > 0.0 { diff / ma.min(mb) } else { 0.0 };
    let ratio = if ma.min(mb) > 0.0 { ma.max(mb) / ma.min(mb) } else { 1.0 };
    let significant = diff > 3.0 * noise && rel > 0.03 && a.runs >= 3 && b.runs >= 3;
    let faster = if !significant { "none" } else if ma < mb { "a" } else { "b" };
    let why = if significant {
        format!("écart de {:.1} % pour un bruit d'environ {:.1} %", rel * 100.0, noise / ma.min(mb).max(f64::EPSILON) * 100.0)
    } else if a.runs < 3 || b.runs < 3 {
        "trop peu de mesures pour conclure".into()
    } else {
        format!("écart de {:.1} %, dans le bruit de mesure", rel * 100.0)
    };
    Verdict { faster: faster.into(), ratio, significant, why }
}

/// Builds the measuring helper in `work` (inside the sandbox). Returns its path.
pub fn helper(job: &Job, work: &Path) -> Result<PathBuf> {
    let dir = work.join(".tb");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("measure.c"), measure::HELPER)?;
    let cc = if crate::toolenv::which("gcc").is_some() { "gcc" } else { "cc" };
    let limits = Limits { wall: Duration::from_secs(60), cpu_seconds: 60, file_mb: 64, output_cap: 16 * 1024, mem_mb: Some(1024), tasks: Some(32), address_space_free: false };
    let bin = dir.join("measure");
    let argv: Vec<String> = vec![cc.into(), "-O2".into(), "-o".into(), bin.to_string_lossy().into_owned(), dir.join("measure.c").to_string_lossy().into_owned()];
    let wrapped = sandbox::wrap_argv(work, &argv, &[], &limits)?;
    let o = job.run_opts(&RunOpts { argv: &wrapped, cwd: work, timeout: limits.wall, envs: &[], log_output: false, stdin: None, split_streams: true }, &mut |_| {})?;
    if !o.ok() || !bin.is_file() {
        return Err(AppError::new("bench_failed", "L'outil de mesure ne compile pas."));
    }
    Ok(bin)
}

/// One timed run of `program args` (stdin from `stdin`), through the helper.
pub fn sample(job: &Job, work: &Path, helper: &Path, program: &Path, args: &[String], stdin: Option<&Path>, limits: &Limits) -> Result<Option<Sample>> {
    let out = work.join(".tb").join("sample.txt");
    let _ = std::fs::remove_file(&out);
    // Only `work` is visible in the sandbox: the input is copied there.
    let input = match stdin {
        Some(p) if !p.starts_with(work) => {
            let inside = work.join(".tb").join("stdin.txt");
            if !inside.is_file() {
                std::fs::copy(p, &inside)?;
            }
            Some(inside)
        }
        Some(p) => Some(p.to_path_buf()),
        None => None,
    };
    let mut argv = vec![helper.to_string_lossy().into_owned(), out.to_string_lossy().into_owned(), work.to_string_lossy().into_owned(), input.map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| "-".into()), program.to_string_lossy().into_owned()];
    argv.extend(args.iter().cloned());
    let wrapped = sandbox::wrap_argv(work, &argv, &[], limits)?;
    let o = job.run_opts(&RunOpts { argv: &wrapped, cwd: work, timeout: limits.wall, envs: &[], log_output: false, stdin: None, split_streams: true }, &mut |_| {})?;
    if o.cancelled || o.timed_out {
        return Ok(None);
    }
    // 126 / 127: the helper could not start the program (input, folder or binary missing);
    // that is not a measure of the program.
    Ok(std::fs::read_to_string(&out).ok().and_then(|t| measure::parse_sample(&t)).filter(|s| s.signal == 0 && s.exit != 126 && s.exit != 127))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(values: &[f64]) -> Timing {
        let samples: Vec<Sample> = values.iter().map(|v| Sample { wall_us: (v * 1000.0) as u64, user_us: (v * 900.0) as u64, sys_us: 0, max_rss_kb: 1000, exit: 0, signal: 0 }).collect();
        timing(&samples).unwrap()
    }

    #[test]
    fn fast_programs_get_more_runs() {
        assert_eq!(repeat_count(1), 30);
        assert_eq!(repeat_count(100), 5);
        assert_eq!(repeat_count(3000), 3);
        assert!(repeat_count(20) >= 10);
    }

    #[test]
    fn a_difference_within_the_noise_is_not_a_win() {
        let a = t(&[10.0, 10.2, 9.9, 10.1, 10.0]);
        let clear = verdict(&a, &t(&[20.0, 20.3, 19.8, 20.1, 20.0]));
        assert_eq!((clear.faster.as_str(), clear.significant), ("a", true));
        assert!((clear.ratio - 2.0).abs() < 0.05);
        let same = verdict(&a, &t(&[10.1, 10.0, 10.2, 9.9, 10.1]));
        assert_eq!((same.faster.as_str(), same.significant), ("none", false));
        // Noisy on one side: a 10 % gap is not enough.
        let noisy = verdict(&a, &t(&[11.0, 8.0, 14.0, 9.0, 12.5]));
        assert!(!noisy.significant, "{noisy:?}");
        let few = verdict(&t(&[10.0, 10.0]), &t(&[30.0, 30.0]));
        assert!(!few.significant && few.why.contains("trop peu"));
    }
}
