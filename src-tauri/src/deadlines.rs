//! Hand-in dates. One model for every screen: a local day, the exact instant when it is
//! known, where the date comes from, and its state right now. A date is either typed by
//! the user or reported by MY Epitech; nothing here ever derives one.

use crate::error::{AppError, Result};
use chrono::{DateTime, Local, NaiveDate, NaiveTime, TimeZone};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Due {
    /// `YYYY-MM-DD` in local time.
    pub day: String,
    /// RFC 3339 with the local offset, when the hour is known.
    pub at: Option<String>,
}

/// An instant as MY Epitech writes it (`2026-11-20T18:42:00.000Z`), seen from time zone `tz`.
pub fn from_instant_in<Tz: TimeZone>(iso: &str, tz: &Tz) -> Option<Due>
where
    Tz::Offset: std::fmt::Display,
{
    let at = DateTime::parse_from_rfc3339(iso.trim()).ok()?.with_timezone(tz);
    Some(Due { day: at.format("%Y-%m-%d").to_string(), at: Some(at.to_rfc3339_opts(chrono::SecondsFormat::Secs, false)) })
}

pub fn from_instant(iso: &str) -> Option<Due> {
    from_instant_in(iso, &Local)
}

/// What the user typed: a day, optionally with `HH:MM`, both in time zone `tz`.
pub fn from_input_in<Tz: TimeZone>(day: &str, time: Option<&str>, tz: &Tz) -> Result<Due>
where
    Tz::Offset: std::fmt::Display,
{
    let day = day.trim();
    let date = NaiveDate::parse_from_str(day, "%Y-%m-%d").map_err(|_| AppError::new("invalid_date", format!("« {day} » n'est pas une date valide (attendu : AAAA-MM-JJ)")))?;
    let at = match time.map(str::trim).filter(|t| !t.is_empty()) {
        None => None,
        Some(t) => {
            let time = NaiveTime::parse_from_str(t, "%H:%M").map_err(|_| AppError::new("invalid_date", format!("« {t} » n'est pas une heure valide (attendu : HH:MM)")))?;
            // A local time that does not exist (clock change) is refused rather than shifted.
            let at = tz.from_local_datetime(&date.and_time(time)).earliest().ok_or_else(|| AppError::new("invalid_date", format!("{day} {t} does not exist in your time zone")))?;
            Some(at.to_rfc3339_opts(chrono::SecondsFormat::Secs, false))
        }
    };
    Ok(Due { day: date.format("%Y-%m-%d").to_string(), at })
}

pub fn from_input(day: &str, time: Option<&str>) -> Result<Due> {
    from_input_in(day, time, &Local)
}

/// `upcoming`, `today`, `overdue`, or `unknown` when there is no usable date.
/// With an exact instant the project is overdue as soon as it has passed, even on the same day.
pub fn state_in<Tz: TimeZone>(day: Option<&str>, at: Option<&str>, now: &DateTime<Tz>) -> &'static str {
    let today = now.date_naive();
    if let Some(at) = at.and_then(|a| DateTime::parse_from_rfc3339(a).ok()) {
        if at < *now {
            return "overdue";
        }
        return if at.with_timezone(&now.timezone()).date_naive() == today { "today" } else { "upcoming" };
    }
    match day.and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()) {
        None => "unknown",
        Some(d) if d < today => "overdue",
        Some(d) if d == today => "today",
        Some(_) => "upcoming",
    }
}

pub fn state(day: Option<&str>, at: Option<&str>) -> &'static str {
    state_in(day, at, &Local::now())
}

/// Seconds since the epoch of the moment the hand-in closes: the instant, or the end of the day.
pub fn sort_key(day: Option<&str>, at: Option<&str>) -> Option<i64> {
    if let Some(at) = at.and_then(|a| DateTime::parse_from_rfc3339(a).ok()) {
        return Some(at.timestamp());
    }
    let d = day.and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())?;
    Local.from_local_datetime(&d.and_hms_opt(23, 59, 59)?).earliest().map(|t| t.timestamp())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;

    fn lyon() -> FixedOffset {
        FixedOffset::east_opt(3600).unwrap()
    }

    fn at(s: &str) -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&lyon())
    }

    #[test]
    fn a_utc_hand_in_is_shown_in_local_time() {
        let due = from_instant_in("2026-11-20T18:42:00.000Z", &lyon()).unwrap();
        assert_eq!((due.day.as_str(), due.at.as_deref()), ("2026-11-20", Some("2026-11-20T19:42:00+01:00")));
        // Late in the evening UTC is already the next day further east.
        let tokyo = FixedOffset::east_opt(9 * 3600).unwrap();
        assert_eq!(from_instant_in("2026-11-20T18:42:00.000Z", &tokyo).unwrap().day, "2026-11-21");
        // …and still the previous day in the west.
        let ny = FixedOffset::west_opt(5 * 3600).unwrap();
        assert_eq!(from_instant_in("2026-11-21T03:00:00Z", &ny).unwrap().day, "2026-11-20");
        assert!(from_instant_in("soon", &lyon()).is_none());
        assert!(from_instant_in("", &lyon()).is_none());
    }

    #[test]
    fn typed_dates_keep_what_was_typed_and_refuse_nonsense() {
        assert_eq!(from_input_in("2026-11-22", None, &lyon()).unwrap(), Due { day: "2026-11-22".into(), at: None });
        assert_eq!(from_input_in(" 2026-11-22 ", Some(""), &lyon()).unwrap().at, None);
        assert_eq!(from_input_in("2026-11-22", Some("19:42"), &lyon()).unwrap().at.as_deref(), Some("2026-11-22T19:42:00+01:00"));
        for (d, t) in [("22/11/2026", None), ("2026-02-30", None), ("2026-11-22", Some("25:00")), ("", None)] {
            assert_eq!(from_input_in(d, t, &lyon()).unwrap_err().code(), "invalid_date", "{d} {t:?}");
        }
    }

    #[test]
    fn state_follows_the_exact_instant_when_there_is_one() {
        let hand_in = Some("2026-11-20T19:42:00+01:00");
        let day = Some("2026-11-20");
        assert_eq!(state_in(day, hand_in, &at("2026-11-19T23:59:00+01:00")), "upcoming");
        assert_eq!(state_in(day, hand_in, &at("2026-11-20T08:00:00+01:00")), "today");
        assert_eq!(state_in(day, hand_in, &at("2026-11-20T19:41:59+01:00")), "today");
        assert_eq!(state_in(day, hand_in, &at("2026-11-20T19:42:01+01:00")), "overdue", "past the hour on the same day");
        assert_eq!(state_in(day, hand_in, &at("2026-11-21T00:00:01+01:00")), "overdue");
    }

    #[test]
    fn a_day_without_hour_lasts_until_midnight_and_no_date_is_unknown() {
        let day = Some("2026-11-20");
        assert_eq!(state_in(day, None, &at("2026-11-20T23:59:59+01:00")), "today");
        assert_eq!(state_in(day, None, &at("2026-11-21T00:00:00+01:00")), "overdue");
        assert_eq!(state_in(day, None, &at("2026-11-12T10:00:00+01:00")), "upcoming");
        assert_eq!(state_in(None, None, &at("2026-11-12T10:00:00+01:00")), "unknown");
        assert_eq!(state_in(Some("garbage"), None, &at("2026-11-12T10:00:00+01:00")), "unknown");
        // An unreadable instant falls back to the day instead of inventing a state.
        assert_eq!(state_in(day, Some("garbage"), &at("2026-11-12T10:00:00+01:00")), "upcoming");
    }

    #[test]
    fn sort_key_orders_same_day_hand_ins_by_hour() {
        let a = sort_key(Some("2026-11-20"), Some("2026-11-20T09:00:00+01:00")).unwrap();
        let b = sort_key(Some("2026-11-20"), Some("2026-11-20T19:42:00+01:00")).unwrap();
        let c = sort_key(Some("2026-11-20"), None).unwrap();
        assert!(a < b && b < c, "a day without hour closes at its end");
        assert_eq!(sort_key(None, None), None);
    }
}
