//! The planning engine: one source of truth for what a realistic day looks like, used by the
//! planning screen, by Tika's tools and to check any plan before it is shown.
//!
//! A realistic day is not a full day:
//! - work only inside the working hours of working days, never over protected times (meals);
//! - a break before *and* after every block, a long break after a few blocks in a row;
//! - a daily ceiling of work that depends on the chosen rhythm, school time included;
//! - some free, flexible time left every day;
//! - a margin before each hand-in.
//!
//! Instants are unix seconds; days and hours are local time.

use chrono::{Datelike, Local, NaiveDate, TimeZone, Timelike};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

pub const MIN: i64 = 60;
pub const DAY: i64 = 86_400;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Rhythm {
    /// `calm`, `balanced`, `intense` or `custom` (then `max_minutes_per_day` is the user's).
    pub mode: String,
    /// Minutes from midnight.
    pub day_start: i64,
    pub day_end: i64,
    /// 0 = Sunday.
    pub work_days: Vec<u32>,
    pub max_minutes_per_day: i64,
    pub session_minutes: i64,
    pub break_minutes: i64,
    pub long_break_minutes: i64,
    /// Blocks in a row before a long break.
    pub blocks_before_long_break: i64,
    /// Free time kept every working day, outside any plan.
    pub flex_minutes: i64,
    /// Protected spans (minutes from midnight): meals, evening.
    pub protected: Vec<[i64; 2]>,
    /// Work planned for a project ends this many days before its hand-in.
    pub buffer_days: i64,
    /// Offer a plan for the day on the dashboard when nothing is planned yet.
    pub morning_plan: bool,
}

impl Default for Rhythm {
    fn default() -> Self {
        Rhythm {
            mode: "balanced".into(),
            day_start: 9 * 60,
            day_end: 20 * 60,
            work_days: vec![1, 2, 3, 4, 5, 6],
            max_minutes_per_day: 240,
            session_minutes: 75,
            break_minutes: 15,
            long_break_minutes: 45,
            blocks_before_long_break: 2,
            flex_minutes: 60,
            protected: vec![[12 * 60 + 30, 13 * 60 + 30]],
            buffer_days: 1,
            morning_plan: true,
        }
    }
}

/// (daily ceiling, flexible time) of each preset rhythm.
pub fn preset(mode: &str) -> Option<(i64, i64)> {
    match mode {
        "calm" => Some((150, 120)),
        "balanced" => Some((240, 60)),
        "intense" => Some((360, 45)),
        _ => None,
    }
}

impl Rhythm {
    /// Bounds every value so a typo cannot make a day of 90 hours.
    pub fn sanitized(mut self) -> Self {
        let d = Rhythm::default();
        self.day_start = self.day_start.clamp(0, 23 * 60);
        self.day_end = self.day_end.clamp(self.day_start + 60, 24 * 60);
        self.work_days.retain(|d| *d < 7);
        self.work_days.sort();
        self.work_days.dedup();
        if let Some((max, flex)) = preset(&self.mode) {
            self.max_minutes_per_day = max;
            self.flex_minutes = flex;
        } else {
            self.mode = "custom".into();
        }
        self.max_minutes_per_day = self.max_minutes_per_day.clamp(30, 12 * 60);
        self.session_minutes = self.session_minutes.clamp(15, 180);
        self.break_minutes = self.break_minutes.clamp(0, 60);
        self.long_break_minutes = self.long_break_minutes.clamp(self.break_minutes, 120);
        self.blocks_before_long_break = self.blocks_before_long_break.clamp(1, 6);
        self.flex_minutes = self.flex_minutes.clamp(0, 6 * 60);
        self.buffer_days = self.buffer_days.clamp(0, 7);
        self.protected.retain(|[a, b]| (0..=24 * 60).contains(a) && *b > *a && *b <= 24 * 60);
        if self.protected.len() > 6 {
            self.protected.truncate(6);
        }
        if self.work_days.is_empty() {
            self.work_days = d.work_days;
        }
        self
    }

    /// The rhythm saved in the interface preferences (`plan.prefs`), with defaults for what is missing.
    pub fn load(conn: &Connection) -> Rhythm {
        let prefs: serde_json::Value = crate::db::get_setting(conn, "ui_prefs").ok().flatten().and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default();
        let stored = &prefs["plan.prefs"];
        let mut r: Rhythm = serde_json::from_value(stored.clone()).unwrap_or_default();
        // Preferences written before 0.5 had no mode: their ceiling was the user's choice.
        if stored.is_object() && stored.get("mode").is_none() {
            r.mode = "custom".into();
        }
        r.sanitized()
    }
}

/// Something that takes time on the calendar.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Busy {
    pub start: i64,
    pub end: i64,
    pub title: String,
    /// `work` (a planned session or task), `school`, `personal`, `block` (unavailable), `protected`.
    pub kind: &'static str,
    /// Plan entry id, when it is one.
    pub event_id: Option<i64>,
}

impl Busy {
    pub fn is_work(&self) -> bool {
        self.kind == "work"
    }
}

/// Busy time from the user's own entries and the MY Epitech agenda.
pub fn busy_from(events: &[crate::planner::PlanEvent], agenda: &[crate::mydata::AgendaItem]) -> Vec<Busy> {
    let mut out: Vec<Busy> = Vec::new();
    for e in events {
        if e.all_day || e.kind == "reminder" {
            continue;
        }
        let kind = match e.kind.as_str() {
            "session" | "task" => "work",
            "block" => "block",
            _ => "personal",
        };
        out.push(Busy { start: e.start, end: e.end, title: e.title.clone(), kind, event_id: Some(e.id) });
    }
    for a in agenda {
        if a.kind != "activity" && !(a.kind == "event" && a.mine) {
            continue;
        }
        if a.status.as_deref() == Some("not_registered") {
            continue;
        }
        let (Some(s), Some(e)) = (a.start.as_deref().and_then(rfc), a.end.as_deref().and_then(rfc)) else { continue };
        if e > s {
            out.push(Busy { start: s, end: e, title: a.title.clone(), kind: "school", event_id: None });
        }
    }
    out.sort_by_key(|b| (b.start, b.end));
    out
}

fn rfc(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.timestamp())
}

/// Local midnight of the day containing `t`.
pub fn day_of(t: i64) -> i64 {
    let d = Local.timestamp_opt(t, 0).single().map(|d| d.date_naive()).unwrap_or_default();
    midnight(d)
}

fn midnight(d: NaiveDate) -> i64 {
    Local.from_local_datetime(&d.and_hms_opt(0, 0, 0).unwrap_or_default()).earliest().map(|x| x.timestamp()).unwrap_or(0)
}

fn date_of(t: i64) -> NaiveDate {
    Local.timestamp_opt(t, 0).single().map(|d| d.date_naive()).unwrap_or_default()
}

/// Instant at `minutes` after local midnight of `day` (a midnight from `day_of`).
pub fn at(day: i64, minutes: i64) -> i64 {
    let d = date_of(day + 3600);
    let h = (minutes / 60).clamp(0, 23) as u32;
    let m = (minutes % 60) as u32;
    if minutes >= 24 * 60 {
        return midnight(d.succ_opt().unwrap_or(d));
    }
    Local.from_local_datetime(&d.and_hms_opt(h, m, 0).unwrap_or_default()).earliest().map(|x| x.timestamp()).unwrap_or(day + minutes * MIN)
}

pub fn next_day(day: i64) -> i64 {
    let d = date_of(day + 3600);
    midnight(d.succ_opt().unwrap_or(d))
}

pub fn weekday(day: i64) -> u32 {
    date_of(day + 3600).weekday().num_days_from_sunday()
}

pub fn minute_of_day(t: i64) -> i64 {
    Local.timestamp_opt(t, 0).single().map(|d| (d.hour() * 60 + d.minute()) as i64).unwrap_or(0)
}

pub fn local_iso(t: i64) -> String {
    Local.timestamp_opt(t, 0).single().map(|d| d.format("%Y-%m-%dT%H:%M").to_string()).unwrap_or_default()
}

pub fn day_label(day: i64) -> String {
    const DAYS: [&str; 7] = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    let d = date_of(day + 3600);
    format!("{} {}", DAYS[d.weekday().num_days_from_sunday() as usize], d.day())
}

fn hm(t: i64) -> String {
    let m = minute_of_day(t);
    format!("{:02}:{:02}", m / 60, m % 60)
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub start: i64,
    pub end: i64,
}

/// Protected spans (meals…) of a day, as busy time.
fn protected_of(r: &Rhythm, day: i64) -> Vec<Busy> {
    r.protected.iter().map(|[a, b]| Busy { start: at(day, *a), end: at(day, *b), title: "Pause protégée".into(), kind: "protected", event_id: None }).collect()
}

/// Free time of at least `min_minutes` between `from` and `to`, inside working hours, with a
/// break kept before and after every block (school, work, personal) and protected times left out.
pub fn free_slots(busy: &[Busy], r: &Rhythm, from: i64, to: i64, min_minutes: i64) -> Vec<Span> {
    let mut out = Vec::new();
    let pad = r.break_minutes * MIN;
    let mut day = day_of(from);
    while day < to {
        if r.work_days.contains(&weekday(day)) {
            let mut blocks: Vec<(i64, i64)> = busy.iter().filter(|b| b.end > day && b.start < next_day(day)).map(|b| if b.kind == "protected" { (b.start, b.end) } else { (b.start - pad, b.end + pad) }).collect();
            blocks.extend(protected_of(r, day).iter().map(|b| (b.start, b.end)));
            blocks.sort();
            let mut cursor = at(day, r.day_start).max(ceil_quarter(from));
            let end = at(day, r.day_end).min(to);
            for (s, e) in blocks {
                if e <= cursor {
                    continue;
                }
                if s >= end {
                    break;
                }
                if s - cursor >= min_minutes * MIN {
                    out.push(Span { start: cursor, end: s });
                }
                cursor = cursor.max(e);
            }
            if end - cursor >= min_minutes * MIN {
                out.push(Span { start: cursor, end });
            }
        }
        day = next_day(day);
    }
    out
}

fn ceil_quarter(t: i64) -> i64 {
    let q = 15 * MIN;
    (t + q - 1).div_euclid(q) * q
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DayLoad {
    pub day: i64,
    pub label: String,
    pub working_day: bool,
    /// Work planned (sessions and tasks), done or not.
    pub work_min: i64,
    pub school_min: i64,
    /// Ceiling of the rhythm.
    pub max_min: i64,
    /// Free time left in the working hours once everything (with breaks) is counted.
    pub free_min: i64,
    /// `light`, `ok`, `full` (at the ceiling), `over`.
    pub state: &'static str,
}

pub fn day_load(busy: &[Busy], r: &Rhythm, day: i64) -> DayLoad {
    let end_day = next_day(day);
    let clip = |b: &Busy| (b.end.min(end_day) - b.start.max(day)).max(0) / MIN;
    let work_min: i64 = busy.iter().filter(|b| b.is_work()).map(clip).sum();
    let school_min: i64 = busy.iter().filter(|b| b.kind == "school").map(clip).sum();
    let working_day = r.work_days.contains(&weekday(day));
    let free_min: i64 = if working_day { free_slots(busy, r, day, end_day, 15).iter().map(|s| (s.end - s.start) / MIN).sum() } else { 0 };
    // School counts toward the day: a day of classes is not a day for four more hours of work.
    let total = work_min + school_min / 2;
    let state = if total > r.max_minutes_per_day { "over" } else if total >= r.max_minutes_per_day - 15 { "full" } else if total < r.max_minutes_per_day / 3 { "light" } else { "ok" };
    DayLoad { day, label: day_label(day), working_day, work_min, school_min, max_min: r.max_minutes_per_day, free_min, state }
}

/// A planned entry to check: new (`event_id: None`) or moved.
#[derive(Debug, Clone)]
pub struct Placement {
    pub index: usize,
    pub event_id: Option<i64>,
    pub start: i64,
    pub end: i64,
    pub work: bool,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Violation {
    /// Index of the action in the plan, `None` for a whole day.
    pub index: Option<usize>,
    /// `error`: not applied as is. `warning`: allowed, but said.
    pub severity: &'static str,
    pub message: String,
}

/// Everything wrong with a set of placements, against the calendar as it is.
pub fn validate(placements: &[Placement], busy: &[Busy], r: &Rhythm, now: i64) -> Vec<Violation> {
    let mut v = Vec::new();
    let moved: Vec<i64> = placements.iter().filter_map(|p| p.event_id).collect();
    let mut cal: Vec<Busy> = busy.iter().filter(|b| b.event_id.is_none_or(|id| !moved.contains(&id))).cloned().collect();
    let mut err = |i: usize, m: String| v.push(Violation { index: Some(i), severity: "error", message: m });
    for p in placements {
        let label = format!("« {} » ({} {}–{})", p.title, day_label(day_of(p.start)), hm(p.start), hm(p.end));
        if p.end <= p.start {
            err(p.index, format!("{label} : la fin est avant le début."));
            continue;
        }
        if p.start < now - 5 * MIN {
            err(p.index, format!("{label} est dans le passé."));
        }
        if !p.work {
            continue;
        }
        let day = day_of(p.start);
        let len = (p.end - p.start) / MIN;
        if len > r.session_minutes + r.session_minutes / 2 {
            err(p.index, format!("{label} dure {len} min : au-delà de {} min, coupe en plusieurs blocs avec une pause.", r.session_minutes + r.session_minutes / 2));
        }
        if !r.work_days.contains(&weekday(day)) {
            err(p.index, format!("{label} tombe un jour non travaillé."));
        }
        if minute_of_day(p.start) < r.day_start || p.end > at(day, r.day_end) {
            err(p.index, format!("{label} sort des horaires de travail ({:02}:{:02}–{:02}:{:02}).", r.day_start / 60, r.day_start % 60, r.day_end / 60, r.day_end % 60));
        }
        for pr in protected_of(r, day) {
            if p.start < pr.end && p.end > pr.start {
                err(p.index, format!("{label} empiète sur une pause protégée ({}–{}).", hm(pr.start), hm(pr.end)));
            }
        }
        for b in &cal {
            if p.start < b.end && p.end > b.start {
                err(p.index, format!("{label} chevauche « {} » ({}–{}).", b.title, hm(b.start), hm(b.end)));
            } else if b.kind != "protected" {
                let gap = if b.end <= p.start { p.start - b.end } else { b.start - p.end };
                if gap < r.break_minutes * MIN {
                    err(p.index, format!("{label} colle à « {} » : garde au moins {} min de pause.", b.title, r.break_minutes));
                }
            }
        }
        cal.push(Busy { start: p.start, end: p.end, title: p.title.clone(), kind: "work", event_id: None });
    }
    // Per day: ceiling, long breaks, flexible time.
    let mut days: Vec<i64> = placements.iter().filter(|p| p.work).map(|p| day_of(p.start)).collect();
    days.sort();
    days.dedup();
    for day in days {
        let load = day_load(&cal, r, day);
        let total = load.work_min + load.school_min / 2;
        if total > r.max_minutes_per_day {
            v.push(Violation { index: None, severity: "error", message: format!("{} : {} de travail{} pour un plafond de {} (rythme {}). Allège ou déplace sur un autre jour.", load.label, dur(load.work_min), if load.school_min > 0 { format!(" + {} d'école", dur(load.school_min)) } else { String::new() }, dur(r.max_minutes_per_day), mode_label(&r.mode)) });
        }
        if load.working_day && load.free_min < r.flex_minutes {
            v.push(Violation { index: None, severity: "warning", message: format!("{} : il ne reste que {} de temps libre (objectif : {} gardés pour l'imprévu).", load.label, dur(load.free_min), dur(r.flex_minutes)) });
        }
        // Several blocks in a row need a longer break.
        let mut work: Vec<&Busy> = cal.iter().filter(|b| b.is_work() && day_of(b.start) == day).collect();
        work.sort_by_key(|b| b.start);
        let mut run = 1;
        for w in work.windows(2) {
            if w[1].start - w[0].end < r.long_break_minutes * MIN {
                run += 1;
                if run > r.blocks_before_long_break {
                    v.push(Violation { index: None, severity: "warning", message: format!("{} : {} blocs presque d'affilée avant « {} » ; prévois une vraie pause de {} min.", load.label, run, w[1].title, r.long_break_minutes) });
                    run = 1;
                }
            } else {
                run = 1;
            }
        }
    }
    v
}

pub fn mode_label(mode: &str) -> &'static str {
    match mode {
        "calm" => "tranquille",
        "intense" => "intensif",
        "custom" => "personnalisé",
        _ => "équilibré",
    }
}

pub fn dur(min: i64) -> String {
    match (min / 60, min % 60) {
        (0, m) => format!("{m} min"),
        (h, 0) => format!("{h} h"),
        (h, m) => format!("{h} h {m:02}"),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A Monday at local midnight, far from clock changes.
    pub fn monday() -> i64 {
        midnight(NaiveDate::from_ymd_opt(2026, 3, 2).unwrap())
    }

    fn b(start: i64, end: i64, kind: &'static str) -> Busy {
        Busy { start, end, title: kind.into(), kind, event_id: None }
    }

    #[test]
    fn rhythms_are_bounded() {
        let r = Rhythm { mode: "custom".into(), max_minutes_per_day: 240 * 60, session_minutes: 90 * 60, day_end: 0, work_days: vec![9], ..Rhythm::default() }.sanitized();
        assert_eq!((r.max_minutes_per_day, r.session_minutes), (720, 180));
        assert!(r.day_end > r.day_start && !r.work_days.is_empty());
        let calm = Rhythm { mode: "calm".into(), ..Rhythm::default() }.sanitized();
        assert_eq!((calm.max_minutes_per_day, calm.flex_minutes), (150, 120));
    }

    #[test]
    fn free_time_keeps_breaks_before_and_after_and_skips_lunch() {
        let r = Rhythm::default();
        let d = monday();
        // A class 10:00–12:00.
        let busy = vec![b(at(d, 600), at(d, 720), "school")];
        let free = free_slots(&busy, &r, d, next_day(d), 30);
        // 09:00–09:45 (break before the class), 12:15–12:30 is too short, lunch 12:30–13:30,
        // then 13:30–20:00.
        assert_eq!(free[0], Span { start: at(d, 540), end: at(d, 585) });
        assert_eq!(free[1], Span { start: at(d, 810), end: at(d, 1200) });
        assert_eq!(free.len(), 2);
    }

    #[test]
    fn plans_are_checked_like_a_human_would() {
        let r = Rhythm::default();
        let d = monday();
        let busy = vec![b(at(d, 600), at(d, 720), "school")];
        let mk = |i, s, e| Placement { index: i, event_id: None, start: at(d, s), end: at(d, e), work: true, title: format!("s{i}") };
        // Right after the class: no break. Over lunch. Way too long.
        let v = validate(&[mk(0, 720, 780), mk(1, 760, 820), mk(2, 840, 1140)], &busy, &r, d);
        assert!(v.iter().any(|x| x.index == Some(0) && x.message.contains("pause")), "{v:?}");
        assert!(v.iter().any(|x| x.index == Some(1) && x.message.contains("protégée")), "{v:?}");
        assert!(v.iter().any(|x| x.index == Some(2) && x.message.contains("dure")), "{v:?}");
        // A sensible day passes.
        let ok = validate(&[mk(0, 840, 915), mk(1, 990, 1065)], &busy, &r, d);
        assert!(ok.iter().all(|x| x.severity != "error"), "{ok:?}");
    }

    #[test]
    fn the_daily_ceiling_counts_school_and_flexible_time_is_kept() {
        let r = Rhythm { mode: "calm".into(), ..Rhythm::default() }.sanitized();
        let d = monday();
        let mk = |i, s, e| Placement { index: i, event_id: None, start: at(d, s), end: at(d, e), work: true, title: format!("s{i}") };
        let v = validate(&[mk(0, 540, 615), mk(1, 840, 915), mk(2, 990, 1065)], &[], &r, d);
        assert!(v.iter().any(|x| x.index.is_none() && x.severity == "error" && x.message.contains("plafond")), "225 min > 150: {v:?}");
        let load = day_load(&[b(at(d, 540), at(d, 1140), "work")], &r, d);
        assert_eq!(load.state, "over");
    }

    #[test]
    fn moving_an_entry_does_not_clash_with_itself() {
        let r = Rhythm::default();
        let d = monday();
        let mut existing = b(at(d, 840), at(d, 915), "work");
        existing.event_id = Some(7);
        let p = Placement { index: 0, event_id: Some(7), start: at(d, 870), end: at(d, 945), work: true, title: "x".into() };
        assert!(validate(&[p], &[existing], &r, d).iter().all(|x| x.severity != "error"));
    }

    #[test]
    fn non_working_days_and_the_past() {
        let r = Rhythm::default();
        let sunday = monday() - DAY;
        let p = Placement { index: 0, event_id: None, start: at(sunday, 600), end: at(sunday, 660), work: true, title: "x".into() };
        let v = validate(&[p], &[], &r, monday());
        assert!(v.iter().any(|x| x.message.contains("non travaillé")) && v.iter().any(|x| x.message.contains("passé")), "{v:?}");
    }
}
