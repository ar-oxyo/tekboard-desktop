//! Reads what C tools print into structured findings: compiler and linker diagnostics
//! (gcc, clang, epiclang), sanitizer reports (AddressSanitizer, LeakSanitizer,
//! UndefinedBehaviorSanitizer) and Valgrind memcheck errors. Nothing is guessed: a line
//! that does not match a known shape is left to the raw output.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    /// File as the user knows it (relative to the work folder when it was inside).
    pub file: String,
    pub line: Option<u32>,
    pub col: Option<u32>,
    /// `error`, `warning`, `note`.
    pub severity: String,
    pub message: String,
    /// `-Wunused-variable` and the like.
    pub flag: Option<String>,
    /// `compiler` or `linker`.
    pub origin: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub function: String,
    pub file: Option<String>,
    pub line: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemIssue {
    /// `asan`, `lsan`, `ubsan`, `valgrind`.
    pub tool: String,
    /// `heap-buffer-overflow`, `leak`, `signed integer overflow`, `Invalid read of size 4`…
    pub kind: String,
    pub message: String,
    /// The first frame in the user's own code, where to look.
    pub at: Option<Frame>,
    pub frames: Vec<Frame>,
    /// Bytes leaked, for leaks.
    pub bytes: Option<u64>,
}

/// Turns an absolute path inside `work` into the name the user gave the file.
fn short(path: &str, work: &str) -> String {
    let p = path.trim();
    if !work.is_empty() {
        let w = work.trim_end_matches('/');
        if let Some(rest) = p.strip_prefix(w) {
            return rest.trim_start_matches('/').to_string();
        }
    }
    p.to_string()
}

fn is_user_file(file: &str, work: &str) -> bool {
    !file.starts_with('/') || (!work.is_empty() && file.starts_with(work))
}

/// `file:line:col: severity: message [-Wflag]` (and `file:line: …`, `file: …`).
fn compiler_line(l: &str, work: &str) -> Option<Diagnostic> {
    for sev in ["fatal error", "error", "warning", "note"] {
        let marker = format!(": {sev}: ");
        let Some(at) = l.find(&marker) else { continue };
        let head = &l[..at];
        let message = l[at + marker.len()..].trim();
        let mut parts = head.rsplitn(3, ':');
        let (c, ln, f) = (parts.next(), parts.next(), parts.next());
        let (file, line, col) = match (f, ln.and_then(|s| s.parse::<u32>().ok()), c.and_then(|s| s.parse::<u32>().ok())) {
            (Some(f), Some(line), Some(col)) => (f, Some(line), Some(col)),
            _ => match head.rsplit_once(':') {
                Some((f, n)) if n.parse::<u32>().is_ok() => (f, n.parse().ok(), None),
                _ => (head, None, None),
            },
        };
        if file.is_empty() || file.contains(' ') && !file.contains('/') {
            return None;
        }
        let (message, flag) = match message.rfind(" [-W") {
            Some(i) if message.ends_with(']') => (message[..i].to_string(), Some(message[i + 2..message.len() - 1].to_string())),
            _ => (message.to_string(), None),
        };
        let origin = if file.ends_with(".o") || file.contains("/ld") || file.contains("collect2") { "linker" } else { "compiler" };
        return Some(Diagnostic { file: short(file, work), line, col, severity: if sev == "fatal error" { "error".into() } else { sev.into() }, message, flag, origin: origin.into() });
    }
    None
}

/// Compiler and linker diagnostics, in the order they were printed.
pub fn compiler(output: &str, work: &str) -> Vec<Diagnostic> {
    let mut out: Vec<Diagnostic> = Vec::new();
    let mut lines = output.lines().peekable();
    while let Some(l) = lines.next() {
        if let Some(d) = compiler_line(l, work) {
            out.push(d);
            continue;
        }
        // Linker: `file.c:(.text+0x9): undefined reference to `f'` (the `in function` line before it).
        if let Some(i) = l.find(": undefined reference to ") {
            let file = l[..i].split(":(").next().unwrap_or("").trim();
            out.push(Diagnostic { file: short(file, work), line: None, col: None, severity: "error".into(), message: l[i + 2..].trim().to_string(), flag: None, origin: "linker".into() });
        } else if l.contains("multiple definition of ") {
            let file = l.split(":(").next().unwrap_or("").trim();
            let msg = l.split("multiple definition of ").nth(1).unwrap_or("");
            out.push(Diagnostic { file: short(file, work), line: None, col: None, severity: "error".into(), message: format!("multiple definition of {msg}"), flag: None, origin: "linker".into() });
        } else if l.contains("ld returned") {
            out.push(Diagnostic { file: String::new(), line: None, col: None, severity: "error".into(), message: l.trim().to_string(), flag: None, origin: "linker".into() });
        }
    }
    out
}

/// `#1 0x5a41 in main /path/warn.c:7` or `#0 … in malloc ../../asan_malloc_linux.cpp:67`.
fn sanitizer_frame(l: &str, work: &str) -> Option<Frame> {
    let t = l.trim_start();
    if !t.starts_with('#') {
        return None;
    }
    let rest = t.split_once(" in ")?.1;
    let (function, loc) = rest.split_once(' ').unwrap_or((rest, ""));
    let loc = loc.trim();
    let (file, line) = if loc.starts_with('(') {
        (None, None)
    } else {
        let mut it = loc.rsplitn(3, ':');
        let a = it.next();
        let b = it.next();
        let c = it.next();
        match (c, b.and_then(|s| s.parse::<u32>().ok()), a.and_then(|s| s.parse::<u32>().ok())) {
            (Some(f), Some(line), Some(_col)) => (Some(f.to_string()), Some(line)),
            _ => match (b, a.and_then(|s| s.parse::<u32>().ok())) {
                (Some(f), Some(line)) => (Some(f.to_string()), Some(line)),
                _ => (Some(loc.to_string()).filter(|s| !s.is_empty()), None),
            },
        }
    };
    Some(Frame { function: function.to_string(), file: file.map(|f| if is_user_file(&f, work) { short(&f, work) } else { f }), line })
}

/// `at 0x4850858: malloc (vg_replace_malloc.c:447)` / `by 0x4001172: main (ub.c:6)`.
fn valgrind_frame(l: &str) -> Option<Frame> {
    let body = l.split_once("== ")?.1.trim();
    let rest = body.strip_prefix("at ").or_else(|| body.strip_prefix("by "))?;
    let after = rest.split_once(": ")?.1;
    let (function, loc) = after.rsplit_once(" (")?;
    let loc = loc.trim_end_matches(')');
    let (file, line) = match loc.rsplit_once(':') {
        Some((f, n)) if n.parse::<u32>().is_ok() => (Some(f.to_string()), n.parse().ok()),
        _ => (None, None),
    };
    Some(Frame { function: function.to_string(), file, line })
}

fn user_frame(frames: &[Frame], work: &str) -> Option<Frame> {
    frames
        .iter()
        .find(|f| f.file.as_deref().is_some_and(|file| is_user_file(file, work) && !file.starts_with("..") && !file.contains("vg_replace") && !file.contains("libsanitizer")) && f.line.is_some())
        .cloned()
}

fn number_before(s: &str, word: &str) -> Option<u64> {
    let i = s.find(word)?;
    s[..i].split_whitespace().last()?.replace(',', "").parse().ok()
}

/// Sanitizer and Valgrind reports found in a program's output.
pub fn memory(output: &str, work: &str) -> Vec<MemIssue> {
    let lines: Vec<&str> = output.lines().collect();
    let mut out: Vec<MemIssue> = Vec::new();
    // The first block of stack frames after a report header (header lines such as
    // `READ of size 4` are skipped; the block ends at the first line that is not a frame).
    let frames_from = |start: usize, parse: &dyn Fn(&str) -> Option<Frame>| -> Vec<Frame> {
        let mut fr = Vec::new();
        for l in lines.iter().skip(start).take(40) {
            match parse(l) {
                Some(f) if fr.len() < 24 => fr.push(f),
                Some(_) => break,
                None if !fr.is_empty() => break,
                None => {}
            }
        }
        fr
    };
    for (i, l) in lines.iter().enumerate() {
        // UndefinedBehaviorSanitizer: `ub.c:5:9: runtime error: signed integer overflow: …`
        if let Some(at) = l.find(": runtime error: ") {
            let loc = &l[..at];
            let message = l[at + 17..].trim().to_string();
            let kind = message.split(':').next().unwrap_or(&message).trim().to_string();
            let mut parts = loc.rsplitn(3, ':');
            let (_c, ln, f) = (parts.next(), parts.next(), parts.next());
            let frame = f.map(|f| Frame { function: String::new(), file: Some(short(f, work)), line: ln.and_then(|n| n.parse().ok()) });
            out.push(MemIssue { tool: "ubsan".into(), kind, message, at: frame.clone(), frames: frame.into_iter().collect(), bytes: None });
            continue;
        }
        if let Some(rest) = l.split_once("ERROR: AddressSanitizer: ").map(|x| x.1) {
            let kind = rest.split_whitespace().next().unwrap_or("error").to_string();
            let access = lines.get(i + 1).filter(|n| n.contains(" of size ")).map(|n| n.split(" at ").next().unwrap_or(n).trim().to_string());
            let message = match &access {
                Some(a) => format!("{kind} ({a})"),
                None => rest.split(" on address").next().unwrap_or(rest).trim().to_string(),
            };
            let frames = frames_from(i + 1, &|l| sanitizer_frame(l, work));
            out.push(MemIssue { tool: "asan".into(), kind, message, at: user_frame(&frames, work), frames, bytes: None });
            continue;
        }
        if l.starts_with("Direct leak of ") || l.starts_with("Indirect leak of ") {
            let bytes = number_before(l, "byte");
            let frames = frames_from(i + 1, &|l| sanitizer_frame(l, work));
            let kind = if l.starts_with("Direct") { "fuite directe" } else { "fuite indirecte" };
            out.push(MemIssue { tool: "lsan".into(), kind: kind.into(), message: l.trim().trim_end_matches(':').to_string(), at: user_frame(&frames, work), frames, bytes });
            continue;
        }
        // Valgrind memcheck: `==123== Invalid read of size 4`, `Conditional jump …`, leaks.
        if let Some((_, body)) = l.split_once("== ") {
            let b = body.trim();
            let error = ["Invalid read of size", "Invalid write of size", "Invalid free", "Mismatched free", "Conditional jump or move depends on uninitialised value", "Use of uninitialised value", "Syscall param", "Source and destination overlap", "Process terminating with default action"].iter().find(|k| b.starts_with(**k));
            let leak = b.contains("are definitely lost in loss record") || b.contains("are indirectly lost in loss record") || b.contains("are possibly lost in loss record");
            if error.is_some() || leak {
                let frames = frames_from(i + 1, &|l| valgrind_frame(l));
                let kind = if leak { if b.contains("definitely") { "fuite (definitely lost)".to_string() } else if b.contains("indirectly") { "fuite (indirectly lost)".to_string() } else { "fuite (possibly lost)".to_string() } } else { error.map(|e| e.to_string()).unwrap_or_default() };
                let bytes = if leak { number_before(b, "bytes") } else { None };
                out.push(MemIssue { tool: "valgrind".into(), kind, message: b.to_string(), at: user_frame(&frames, work), frames, bytes });
            }
        }
    }
    out
}

/// Whether the compiler output says the build failed (as opposed to warnings only).
pub fn has_errors(d: &[Diagnostic]) -> bool {
    d.iter().any(|x| x.severity == "error")
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: &str = "/tmp/pg/42";

    #[test]
    fn gcc_errors_warnings_notes_and_flags() {
        let out = "bad.c: In function ‘main’:\nbad.c:6:5: error: expected ‘=’, ‘,’, ‘;’, ‘asm’ or ‘__attribute__’ before ‘printf’\n    6 |     printf(\"%d\\n\", y);\n      |     ^~~~~~\nbad.c:6:20: error: ‘y’ undeclared (first use in this function)\nbad.c:6:20: note: each undeclared identifier is reported only once for each function it appears in\nwarn.c:5:9: warning: unused variable ‘unused’ [-Wunused-variable]\n";
        let d = compiler(out, W);
        assert_eq!(d.len(), 4, "{d:?}");
        assert_eq!((d[0].file.as_str(), d[0].line, d[0].col, d[0].severity.as_str()), ("bad.c", Some(6), Some(5), "error"));
        assert_eq!(d[2].severity, "note");
        assert_eq!(d[3].flag.as_deref(), Some("-Wunused-variable"));
        assert_eq!(d[3].message, "unused variable ‘unused’");
        assert!(has_errors(&d));
    }

    #[test]
    fn clang_and_absolute_paths_inside_the_work_folder() {
        let d = compiler("/tmp/pg/42/src/bad.c:5:10: error: expected ';' at end of declaration\n    5 |     int x\n1 error generated.\n", W);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].file, "src/bad.c");
        let f = compiler("main.c:1:10: fatal error: util.h: No such file or directory\n", W);
        assert_eq!(f[0].severity, "error");
        assert_eq!(f[0].message, "util.h: No such file or directory");
    }

    #[test]
    fn linker_errors() {
        let out = "/usr/bin/x86_64-linux-gnu-ld.bfd: /tmp/ccLyMYno.o: in function `main':\nl.c:(.text+0x9): undefined reference to `f'\ncollect2: error: ld returned 1 exit status\n";
        let d = compiler(out, W);
        assert!(d.iter().any(|x| x.origin == "linker" && x.file == "l.c" && x.message.contains("undefined reference to `f'")), "{d:?}");
        assert!(has_errors(&d));
    }

    #[test]
    fn address_sanitizer_points_at_the_user_line() {
        let out = "=================================================================\n==256243==ERROR: AddressSanitizer: heap-buffer-overflow on address 0x72751ade0020 at pc 0x5a4163c6c352 bp 0x7ffd sp 0x7ffd\nWRITE of size 4 at 0x72751ade0020 thread T0\n    #0 0x5a4163c6c351 in main /tmp/pg/42/warn.c:7\n    #1 0x76551be2a600 in __libc_start_call_main ../sysdeps/nptl/libc_start_call_main.h:59\n    #3 0x5a4163c6c1e4 in _start (/tmp/pg/42/w+0x11e4) (BuildId: 2c81)\n\n0x72751ade0020 is located 0 bytes after 16-byte region\nallocated by thread T0 here:\n    #0 0x76551cb2b60f in malloc ../../../../src/libsanitizer/asan/asan_malloc_linux.cpp:67\n    #1 0x5a4163c6c2c6 in main /tmp/pg/42/warn.c:6\n\nSUMMARY: AddressSanitizer: heap-buffer-overflow /tmp/pg/42/warn.c:7 in main\n";
        let m = memory(out, W);
        assert_eq!(m.len(), 1, "{m:?}");
        assert_eq!(m[0].tool, "asan");
        assert_eq!(m[0].kind, "heap-buffer-overflow");
        assert!(m[0].message.contains("WRITE of size 4"));
        let at = m[0].at.as_ref().unwrap();
        assert_eq!((at.function.as_str(), at.file.as_deref(), at.line), ("main", Some("warn.c"), Some(7)));
    }

    #[test]
    fn ubsan_and_leaks() {
        let out = "ub.c:5:9: runtime error: signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'\n\n=================================================================\n==256340==ERROR: LeakSanitizer: detected memory leaks\n\nDirect leak of 32 byte(s) in 1 object(s) allocated from:\n    #0 0x7c3bd532b60f in malloc ../../../../src/libsanitizer/asan/asan_malloc_linux.cpp:67\n    #1 0x5f3d467f8279 in main /tmp/pg/42/ub.c:6\n\nSUMMARY: AddressSanitizer: 32 byte(s) leaked in 1 allocation(s).\n";
        let m = memory(out, W);
        assert_eq!(m.len(), 2, "{m:?}");
        assert_eq!(m[0].tool, "ubsan");
        assert_eq!(m[0].kind, "signed integer overflow");
        assert_eq!(m[0].at.as_ref().unwrap().line, Some(5));
        assert_eq!(m[1].tool, "lsan");
        assert_eq!(m[1].bytes, Some(32));
        assert_eq!(m[1].at.as_ref().unwrap().line, Some(6));
    }

    #[test]
    fn valgrind_memcheck() {
        let out = "==9== Invalid read of size 4\n==9==    at 0x109189: main (warn.c:12)\n==9==  Address 0x4a8e044 is 4 bytes inside a block of size 16 free'd\n==9==    at 0x484B27F: free (vg_replace_malloc.c:872)\n==9== \n==9== 32 bytes in 1 blocks are definitely lost in loss record 1 of 1\n==9==    at 0x4850858: malloc (vg_replace_malloc.c:447)\n==9==    by 0x4001172: main (ub.c:6)\n==9== \n";
        let m = memory(out, W);
        assert_eq!(m.len(), 2, "{m:?}");
        assert_eq!(m[0].kind, "Invalid read of size");
        assert_eq!(m[0].at.as_ref().unwrap().line, Some(12));
        assert_eq!(m[1].bytes, Some(32));
        assert_eq!(m[1].at.as_ref().unwrap().file.as_deref(), Some("ub.c"));
    }

    #[test]
    fn plain_output_gives_nothing() {
        assert!(compiler("Hello: world\nnothing here\n", W).is_empty());
        assert!(memory("hello\nruntime is fine\n", W).is_empty());
    }
}
