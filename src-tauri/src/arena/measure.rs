//! Measuring a run, and reading what the profilers print.
//!
//! Wall time, CPU time and peak memory come from a tiny C helper compiled in the sandbox
//! (`fork`, `wait4`, `clock_gettime`): microsecond resolution, where GNU time only gives
//! hundredths of a second. Instruction counts per function come from Callgrind, the heap
//! peak from Massif, the number of allocations from Memcheck's heap summary.

use serde::Serialize;

/// Source of the measuring helper. Usage: `tb_measure OUT CWD STDIN|- program args…`;
/// writes `wall_us user_us sys_us maxrss_kb exit signal` to OUT. The program's output goes
/// to /dev/null: printing is part of the cost, reading it back is not.
pub const HELPER: &str = r#"#define _GNU_SOURCE
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

int main(int ac, char **av)
{
    struct timespec a, b;
    struct rusage ru;
    int st = 0;
    pid_t p;
    FILE *o;

    if (ac < 5)
        return 2;
    clock_gettime(CLOCK_MONOTONIC, &a);
    p = fork();
    if (p == 0) {
        int out = open("/dev/null", O_WRONLY);
        if (chdir(av[2]) != 0)
            _exit(126);
        if (strcmp(av[3], "-") != 0) {
            int in = open(av[3], O_RDONLY);
            if (in < 0)
                _exit(126);
            dup2(in, 0);
        }
        dup2(out, 1);
        execvp(av[4], av + 4);
        _exit(127);
    }
    if (p < 0 || wait4(p, &st, 0, &ru) < 0)
        return 3;
    clock_gettime(CLOCK_MONOTONIC, &b);
    o = fopen(av[1], "w");
    if (!o)
        return 4;
    fprintf(o, "%lld %lld %lld %ld %d %d\n",
        (long long)(b.tv_sec - a.tv_sec) * 1000000LL + (b.tv_nsec - a.tv_nsec) / 1000,
        (long long)ru.ru_utime.tv_sec * 1000000LL + ru.ru_utime.tv_usec,
        (long long)ru.ru_stime.tv_sec * 1000000LL + ru.ru_stime.tv_usec,
        ru.ru_maxrss, WIFEXITED(st) ? WEXITSTATUS(st) : -1, WIFSIGNALED(st) ? WTERMSIG(st) : 0);
    fclose(o);
    return 0;
}
"#;

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub wall_us: u64,
    pub user_us: u64,
    pub sys_us: u64,
    pub max_rss_kb: u64,
    pub exit: i32,
    pub signal: i32,
}

pub fn parse_sample(text: &str) -> Option<Sample> {
    let v: Vec<i64> = text.split_whitespace().filter_map(|w| w.parse().ok()).collect();
    if v.len() < 6 {
        return None;
    }
    Some(Sample { wall_us: v[0].max(0) as u64, user_us: v[1].max(0) as u64, sys_us: v[2].max(0) as u64, max_rss_kb: v[3].max(0) as u64, exit: v[4] as i32, signal: v[5] as i32 })
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub median: f64,
    /// Median absolute deviation (robust spread).
    pub mad: f64,
    pub min: f64,
    pub max: f64,
    /// Indexes of the values far from the others (more than 3 robust deviations).
    pub outliers: Vec<usize>,
}

pub fn median(v: &[f64]) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    let mut s = v.to_vec();
    s.sort_by(f64::total_cmp);
    let m = s.len() / 2;
    if s.len() % 2 == 0 { (s[m - 1] + s[m]) / 2.0 } else { s[m] }
}

pub fn stats(v: &[f64]) -> Stats {
    let med = median(v);
    let dev: Vec<f64> = v.iter().map(|x| (x - med).abs()).collect();
    let mad = median(&dev);
    // 1.4826·MAD estimates a standard deviation; a floor keeps identical runs from flagging noise.
    let scale = (1.4826 * mad).max(med.abs() * 0.01);
    let outliers = v.iter().enumerate().filter(|(_, x)| scale > 0.0 && (*x - med).abs() > 3.0 * scale).map(|(i, _)| i).collect();
    Stats { median: med, mad, min: v.iter().copied().fold(f64::INFINITY, f64::min), max: v.iter().copied().fold(f64::NEG_INFINITY, f64::max), outliers }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HotFunction {
    pub function: String,
    pub file: Option<String>,
    /// Instructions executed in the function itself (exclusive).
    pub ir: u64,
    pub percent: f64,
    /// In the program's own code (not the C library).
    pub own: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Callgrind {
    pub total_ir: Option<u64>,
    pub functions: Vec<HotFunction>,
}

fn num(s: &str) -> Option<u64> {
    s.replace(',', "").trim().parse().ok()
}

/// `callgrind_annotate --inclusive=no` output. `work` is stripped from paths.
pub fn parse_callgrind(text: &str, work: &str) -> Callgrind {
    let mut out = Callgrind::default();
    for l in text.lines() {
        // Annotated source may follow the table (when --auto=no is not honoured): its lines
        // also start with counts, but they are code, not functions.
        if l.starts_with("-- Auto-annotated source") || l.starts_with("-- User-annotated source") || l.starts_with("-- Annotated source") {
            break;
        }
        let t = l.trim_start();
        let Some((count, rest)) = t.split_once(" (") else { continue };
        let Some(ir) = num(count) else { continue };
        let Some((pct, what)) = rest.split_once("%)") else { continue };
        let percent: f64 = pct.trim().parse().unwrap_or(0.0);
        let what = what.trim();
        if what == "PROGRAM TOTALS" {
            out.total_ir = Some(ir);
            continue;
        }
        // `file:function [object]` — the object part is optional.
        let loc = what.split(" [").next().unwrap_or(what);
        let object = what.split(" [").nth(1).map(|o| o.trim_end_matches(']')).unwrap_or("");
        let (file, function) = match loc.rsplit_once(':') {
            Some((f, func)) => (Some(f.to_string()), func.to_string()),
            None => (None, loc.to_string()),
        };
        // The program's own code is what the binary built in the work folder contains.
        let inside = |p: &str| !work.is_empty() && p.starts_with(work);
        let own = if object.is_empty() { file.as_deref().is_some_and(inside) } else { inside(object) };
        let file = file.map(|f| f.strip_prefix(work).map(|r| r.trim_start_matches('/').to_string()).unwrap_or(f));
        if out.functions.len() < 40 {
            out.functions.push(HotFunction { function, file, ir, percent, own });
        }
    }
    out
}

/// Highest heap use (useful + allocator overhead) in a `massif.out` file, in bytes.
pub fn parse_massif_peak(text: &str) -> Option<u64> {
    let mut peak = None;
    let mut heap = 0u64;
    for l in text.lines() {
        if let Some(v) = l.strip_prefix("mem_heap_B=") {
            heap = v.trim().parse().unwrap_or(0);
        } else if let Some(v) = l.strip_prefix("mem_heap_extra_B=") {
            let total = heap + v.trim().parse::<u64>().unwrap_or(0);
            peak = Some(peak.map_or(total, |p: u64| p.max(total)));
        }
    }
    peak
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Heap {
    pub allocs: u64,
    pub frees: u64,
    pub bytes: u64,
}

/// `total heap usage: 4 allocs, 4 frees, 16,664 bytes allocated` (Memcheck).
pub fn parse_heap_usage(text: &str) -> Option<Heap> {
    let l = text.lines().find(|l| l.contains("total heap usage:"))?;
    let rest = l.split("total heap usage:").nth(1)?;
    let parts: Vec<&str> = rest.split(',').map(str::trim).collect();
    let first = |s: &str| s.split_whitespace().next().and_then(num);
    Some(Heap { allocs: first(parts.first()?)?, frees: first(parts.get(1)?)?, bytes: first(&parts[2..].join(","))? })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_and_stats() {
        let s = parse_sample("1234 1000 100 1872 0 0\n").unwrap();
        assert_eq!((s.wall_us, s.max_rss_kb, s.exit), (1234, 1872, 0));
        assert!(parse_sample("garbage").is_none());
        let st = stats(&[10.0, 11.0, 10.5, 10.2, 40.0]);
        assert_eq!(st.median, 10.5);
        assert_eq!(st.outliers, vec![4]);
        assert!(stats(&[5.0, 5.0, 5.0]).outliers.is_empty());
        assert_eq!(median(&[1.0, 3.0, 2.0, 4.0]), 2.5);
    }

    #[test]
    fn callgrind_annotate_output() {
        let text = "--------------------------------------------------------------------------------\nIr                  \n--------------------------------------------------------------------------------\n21,884,728 (100.0%)  PROGRAM TOTALS\n\n--------------------------------------------------------------------------------\nIr                   file:function\n--------------------------------------------------------------------------------\n20,033,917 (91.54%)  /tmp/ar/a/src/sort.c:bubble [/tmp/ar/a/src/sort]\n 1,052,387 ( 4.81%)  ./stdio-common/./stdio-common/vfscanf-internal.c:__vfscanf_internal [/usr/lib/x86_64-linux-gnu/libc.so.6]\n    28,014 ( 0.13%)  ???:_dl_relocate_object [/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2]\n";
        let c = parse_callgrind(text, "/tmp/ar/a/src");
        assert_eq!(c.total_ir, Some(21_884_728));
        assert_eq!(c.functions.len(), 3);
        assert_eq!(c.functions[0].function, "bubble");
        assert_eq!(c.functions[0].file.as_deref(), Some("sort.c"));
        assert!(c.functions[0].own && !c.functions[1].own && !c.functions[2].own);
        assert!((c.functions[0].percent - 91.54).abs() < 1e-9);
        let annotated = format!("{text}\n--------------------------------------------------------------------------------\n-- Auto-annotated source: sort.c\n--------------------------------------------------------------------------------\n 6,400,000 (29.4%)          for (int j = 0; j + 1 < n - i; j++)\n");
        assert_eq!(parse_callgrind(&annotated, "/tmp/ar/a/src").functions.len(), 3);
    }

    #[test]
    fn massif_and_heap_summary() {
        assert_eq!(parse_massif_peak("snapshot=0\nmem_heap_B=0\nmem_heap_extra_B=0\nsnapshot=1\nmem_heap_B=472\nmem_heap_extra_B=16\nsnapshot=2\nmem_heap_B=100\nmem_heap_extra_B=8\n"), Some(488));
        assert_eq!(parse_massif_peak("nothing"), None);
        assert_eq!(parse_heap_usage("==1==   total heap usage: 4 allocs, 4 frees, 16,664 bytes allocated\n"), Some(Heap { allocs: 4, frees: 4, bytes: 16664 }));
    }

    #[test]
    fn the_helper_compiles_and_measures() {
        if crate::toolenv::which("gcc").is_none() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("m.c"), HELPER).unwrap();
        let ok = std::process::Command::new("gcc").args(["-O2", "-Wall", "-Wextra", "-Werror", "m.c", "-o", "m"]).current_dir(dir.path()).status().unwrap();
        assert!(ok.success());
        std::fs::write(dir.path().join("in.txt"), "hello\n").unwrap();
        let st = std::process::Command::new(dir.path().join("m")).args(["out.txt", dir.path().to_str().unwrap(), "in.txt", "sh", "-c", "read x; test \"$x\" = hello && sleep 0.05"]).current_dir(dir.path()).status().unwrap();
        assert!(st.success());
        let s = parse_sample(&std::fs::read_to_string(dir.path().join("out.txt")).unwrap()).unwrap();
        assert_eq!(s.exit, 0, "{s:?}");
        assert!(s.wall_us >= 50_000 && s.wall_us < 2_000_000, "{s:?}");
        assert!(s.max_rss_kb > 0);
    }
}
