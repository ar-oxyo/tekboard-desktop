//! Weekly log time: Epitech asks for 30 hours a week on campus. The days come from MY Epitech
//! (`/students/logtime`, read at each sync); nothing is estimated or filled in here. A day the
//! site does not list counts as zero, except after the last day it reported, which is said.

use crate::mydata::{duration_secs, LogDay};
use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::Connection;
use serde::Serialize;

/// Weekly goal, in hours.
pub const GOAL_HOURS: f64 = 30.0;
const ROUTE: &str = "/students/logtime";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Week {
    /// Monday and Sunday of the week (`YYYY-MM-DD`).
    pub start: String,
    pub end: String,
    pub seconds: f64,
    /// Seconds per day, Monday first (7 values).
    pub days: Vec<f64>,
    /// Average of the promotion over the days it is known.
    pub promo_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Logtime {
    pub goal_hours: f64,
    /// The week being lived, then the previous ones, most recent first.
    pub weeks: Vec<Week>,
    /// Last day the site reported (`YYYY-MM-DD`): later days of this week may still come.
    pub last_day: Option<String>,
    /// When the answer was read from MY Epitech (unix seconds).
    pub fetched_at: Option<i64>,
    /// Why nothing can be shown, when that is the case.
    pub unavailable: Option<String>,
    /// Today (`YYYY-MM-DD`) and its index in the week (0 = Monday), as computed here.
    pub today: String,
    pub weekday: u32,
}

fn monday(d: NaiveDate) -> NaiveDate {
    d - Duration::days(d.weekday().num_days_from_monday() as i64)
}

/// Groups days by week (Monday to Sunday), from the first week with data to the week of
/// `today`, empty weeks included so the history has no hole.
pub fn weeks(days: &[LogDay], today: NaiveDate) -> Vec<Week> {
    let parsed: Vec<(NaiveDate, &LogDay)> = days.iter().filter_map(|d| NaiveDate::parse_from_str(&d.date, "%Y-%m-%d").ok().map(|n| (n, d))).filter(|(n, _)| *n <= today).collect();
    let current = monday(today);
    let first = parsed.iter().map(|(n, _)| monday(*n)).min().unwrap_or(current);
    let mut out = Vec::new();
    let mut w = current;
    while w >= first {
        let mut per_day = vec![0.0; 7];
        let mut promo = Vec::new();
        for (n, d) in parsed.iter().filter(|(n, _)| monday(*n) == w) {
            per_day[n.weekday().num_days_from_monday() as usize] += d.mine.max(0.0);
            if let Some(p) = d.promo {
                promo.push(p);
            }
        }
        out.push(Week {
            start: w.format("%Y-%m-%d").to_string(),
            end: (w + Duration::days(6)).format("%Y-%m-%d").to_string(),
            seconds: per_day.iter().sum(),
            days: per_day,
            // The promotion's figure is a daily average: over a week, its sum on known days.
            promo_seconds: (!promo.is_empty()).then(|| promo.iter().sum()),
        });
        w -= Duration::days(7);
    }
    out
}

pub fn read(conn: &Connection, today: NaiveDate) -> Logtime {
    let mut l = Logtime { goal_hours: GOAL_HOURS, today: today.format("%Y-%m-%d").to_string(), weekday: today.weekday().num_days_from_monday(), ..Default::default() };
    let row: Option<(i64, i64, String)> = conn.query_row("SELECT status, fetched_at, body FROM my_cache WHERE route = ?1", [ROUTE], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).ok();
    let Some((status, fetched_at, body)) = row else {
        l.unavailable = Some("never_synced".into());
        return l;
    };
    l.fetched_at = Some(fetched_at);
    if !(200..300).contains(&status) {
        l.unavailable = Some(if status == 0 { "no_answer".into() } else { format!("http_{status}") });
        return l;
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) else {
        l.unavailable = Some("unreadable".into());
        return l;
    };
    let days: Vec<LogDay> = v.as_array().into_iter().flatten().filter_map(|d| Some(LogDay { date: d["date"].as_str()?.to_string(), mine: d["log_time"].as_str().and_then(duration_secs)?, promo: d["promo_log_time"].as_str().and_then(duration_secs) })).collect();
    l.last_day = days.iter().map(|d| d.date.clone()).max();
    l.weeks = weeks(&days, today);
    l
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(date: &str, hours: f64) -> LogDay {
        LogDay { date: date.into(), mine: hours * 3600.0, promo: None }
    }

    #[test]
    fn days_are_grouped_monday_to_sunday_with_no_hole() {
        // 2026-11-23 is a Monday.
        let today = NaiveDate::from_ymd_opt(2026, 11, 25).unwrap();
        let days = vec![day("2026-11-10", 6.0), day("2026-11-13", 4.5), day("2026-11-15", 1.0), day("2026-11-23", 7.0), day("2026-11-24", 8.0), day("2026-12-01", 9.0), day("bad", 3.0)];
        let w = weeks(&days, today);
        assert_eq!(w.iter().map(|x| x.start.as_str()).collect::<Vec<_>>(), vec!["2026-11-23", "2026-11-16", "2026-11-09"]);
        assert_eq!(w[0].seconds, 15.0 * 3600.0, "a day after today is ignored");
        assert_eq!(w[0].days[0], 7.0 * 3600.0);
        assert_eq!(w[1].seconds, 0.0, "an empty week is kept");
        assert_eq!(w[2].seconds, 11.5 * 3600.0, "Sunday belongs to the week that started on Monday");
        assert_eq!(w[2].end, "2026-11-15");
    }

    #[test]
    fn nothing_synced_is_said_not_shown_as_zero() {
        let conn = crate::db::open_in_memory().unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 11, 23).unwrap();
        assert_eq!(read(&conn, today).unavailable.as_deref(), Some("never_synced"));
        conn.execute("INSERT INTO my_cache (route, fetched_at, status, body) VALUES (?1, 5, 200, ?2)", [ROUTE, r#"[{"date":"2026-11-23","log_time":"PT3H","promo_log_time":"PT1H"}]"#]).unwrap();
        let l = read(&conn, today);
        assert_eq!((l.unavailable, l.last_day.as_deref(), l.weeks[0].seconds, l.weekday), (None, Some("2026-11-23"), 3.0 * 3600.0, 0));
    }
}
