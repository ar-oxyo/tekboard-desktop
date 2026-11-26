import { describe, expect, it } from "vitest";
import { parseTime, formatTime } from "../components/TimeField";
import { DEFAULT_PREFS, endFromClock, freeSlots, hhmmOf, hoursLabel, MIN, nightOf, offRanges, workRanges } from "./plan";

// Monday 16 November 2026 and the days after, local time.
const mon = new Date(2026, 10, 16).getTime();
const day = (n: number) => new Date(2026, 10, 16 + n).getTime();
const at = (n: number, h: number, m = 0) => new Date(2026, 10, 16 + n, h, m).getTime();

describe("working hours past midnight", () => {
  const late = { ...DEFAULT_PREFS, dayStart: 9 * 60, dayEnd: 26 * 60, workDays: [1, 2, 3, 4, 5], protected: [] as Array<[number, number]> };

  it("reads and writes 24-hour times, the end on the next day included", () => {
    expect(nightOf(late)).toBe(120);
    expect(hhmmOf(26 * 60)).toBe("02:00");
    expect(hoursLabel(late)).toBe("09:00–02:00 (+1 j)");
    expect(hoursLabel(DEFAULT_PREFS)).toBe("09:00–20:00");
    expect(endFromClock(9 * 60, 2 * 60)).toBe(26 * 60);
    expect(endFromClock(9 * 60, 20 * 60)).toBe(20 * 60);
  });

  it("gives the night to the day before, on the calendar", () => {
    // Monday: its own hours only. Tuesday: Monday's night, then its own hours.
    expect(workRanges(late, mon)).toEqual([[540, 1440]]);
    expect(workRanges(late, day(1))).toEqual([[0, 120], [540, 1440]]);
    expect(offRanges(late, day(1))).toEqual([[120, 540]]);
    // Saturday: Friday's night, then nothing (not a working day).
    expect(workRanges(late, day(5))).toEqual([[0, 120]]);
    expect(offRanges(late, day(5))).toEqual([[120, 1440]]);
    // Without a night, the bands are before and after the hours.
    expect(offRanges(DEFAULT_PREFS, mon)).toEqual([[0, 540], [1200, 1440]]);
  });

  it("finds free time until 02:00, including from just after midnight", () => {
    const slots = freeSlots([], late, at(0, 8), at(1, 12));
    expect(slots[0]).toEqual({ start: at(0, 9), end: at(1, 2) });
    // Asked at 00:30 on Tuesday: what is left of Monday's day comes first.
    const night = freeSlots([], late, at(1, 0, 30), at(1, 12));
    expect(night[0]).toEqual({ start: at(1, 0, 30), end: at(1, 2) });
    expect(night[1].start).toBe(at(1, 9));
    expect((night[0].end - night[0].start) / MIN).toBe(90);
  });
});

describe("24-hour time field", () => {
  it("understands the usual ways of typing a time, never AM/PM", () => {
    expect(["9", "9h", "09:00", "0900", "9:00"].map(parseTime)).toEqual([540, 540, 540, 540, 540]);
    expect(parseTime("21h15")).toBe(21 * 60 + 15);
    expect(parseTime("23:59")).toBe(1439);
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("9pm")).toBeNull();
    expect(parseTime("")).toBeNull();
    expect(formatTime(26 * 60)).toBe("02:00");
    expect(formatTime(870)).toBe("14:30");
  });
});
