import { describe, expect, it } from "vitest";
import type { PlanEvent } from "./api";
import { DEFAULT_PREFS, type PlanProject, type Span, addDays, busySpans, calItems, durInput, fmtDur, freeSlots, fromLocalIso, layoutDay, nextUp, parseDur, projectLoad, startOfWeek, toRegister, toLocalIso, workload } from "./plan";

// Monday 16 November 2026, local time.
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
const prefs = { ...DEFAULT_PREFS, dayStart: 9 * 60, dayEnd: 19 * 60, maxMinutesPerDay: 240, sessionMinutes: 90, breakMinutes: 15 };
const project = (over: Partial<PlanProject> = {}): PlanProject => ({ key: "/p/rpg", title: "MyRPG", module: "G-MUL-200", repoPath: "/p/rpg", day: null, at: null, dueMs: at(20, 19, 42), status: "in_progress", priority: 0, estimateMin: 720, color: "#fff", ...over });
const event = (id: number, start: number, end: number, over: Partial<PlanEvent> = {}): PlanEvent => ({ id, kind: "session", title: "s", start: start / 1000, end: end / 1000, allDay: false, project: "/p/rpg", taskId: null, color: null, notes: "", origin: "me", done: false, category: null, ...over });

describe("dates", () => {
  it("writes and reads local times, and finds Monday", () => {
    expect(toLocalIso(at(16, 9, 5))).toBe("2026-11-16T09:05");
    expect(fromLocalIso("2026-11-16T09:05")).toBe(at(16, 9, 5));
    expect(startOfWeek(at(19, 15))).toBe(at(16, 0));
    expect(startOfWeek(at(22, 23))).toBe(at(16, 0)); // a Sunday belongs to the week that started on Monday
    expect([fmtDur(45), fmtDur(120), fmtDur(95)]).toEqual(["45 min", "2 h", "1 h 35"]);
    expect(["12", "1.5", "1h30", "45m", "90 min", "2 h", "soon"].map((t) => parseDur(t))).toEqual([720, 90, 90, 45, 90, 120, null]);
    // Sessions, breaks and daily ceilings: a bare number is minutes (it used to give 240 hours).
    expect(["240", "15", "1.5", "1h"].map((t) => parseDur(t, "min"))).toEqual([240, 15, 90, 60]);
    expect([720, 90, 45, null].map(durInput)).toEqual(["12h", "1h30", "45m", ""]);
  });
});

describe("freeSlots", () => {
  it("keeps working hours, removes what is taken, and starts no earlier than now", () => {
    const busy: Span[] = [{ start: at(16, 10), end: at(16, 12) }, { start: at(16, 14), end: at(16, 14, 20) }, { start: at(16, 18, 45), end: at(16, 20) }];
    const free = freeSlots(busy, prefs, at(16, 9, 7), at(17, 0));
    expect(free.map((f) => [toLocalIso(f.start).slice(11), toLocalIso(f.end).slice(11)])).toEqual([["09:15", "10:00"], ["12:00", "14:00"], ["14:20", "18:45"]]);
  });
  it("skips the days work is not planned on", () => {
    const free = freeSlots([], { ...prefs, workDays: [1, 2, 3, 4, 5] }, at(21, 0), at(24, 0)); // Saturday → Monday
    expect(free.map((f) => new Date(f.start).getDay())).toEqual([1]);
  });
});

// The automatic planner moved to the Rust engine: see src-tauri/src/schedule.rs (suggest_tests).

describe("load and next step", () => {
  it("flags a project whose work does not fit before the hand-in", () => {
    const p = project({ estimateMin: 600, dueMs: at(16, 19) });
    const load = projectLoad(p, [], [], prefs, at(16, 9));
    expect([load.risk, load.unplanned]).toEqual(["risk", 600]);
    const fine = projectLoad(project({ estimateMin: 120 }), [event(1, at(17, 9), at(17, 11))], [], prefs, at(16, 9));
    expect([fine.risk, fine.planned, fine.unplanned, fine.next?.id]).toEqual(["ok", 120, 0, 1]);
    expect(projectLoad(project({ dueMs: at(15, 12) }), [], [], prefs, at(16, 9)).risk).toBe("late");
  });
  it("points to the running session, then the next one, then the project that needs planning", () => {
    const p = project();
    const loads = new Map([[p.key, projectLoad(p, [], [], prefs, at(16, 9))]]);
    const items = calItems({ tasks: [], events: [event(1, at(16, 9), at(16, 10)), event(2, at(16, 14), at(16, 15))], projects: [], log: [] }, [], [p]);
    expect(nextUp(items, [p], loads, at(16, 9, 30))).toMatchObject({ kind: "now", item: { id: "p1" } });
    expect(nextUp(items, [p], loads, at(16, 11))).toMatchObject({ kind: "soon", item: { id: "p2" } });
    expect(nextUp([], [p], loads, at(16, 11))).toMatchObject({ kind: "plan", project: { key: "/p/rpg" } });
    expect(nextUp([], [], loads, at(16, 11))).toEqual({ kind: "free" });
  });
});

describe("calendar", () => {
  it("merges MY Epitech items read-only: hand-ins as markers, holidays as whole days", () => {
    const items = calItems(
      { tasks: [], events: [event(1, at(16, 14), at(16, 15))], projects: [], log: [] },
      [
        { kind: "deadline", title: "MyRPG", day: "2026-11-20", start: new Date(at(20, 19, 42)).toISOString(), end: null, module: "G-MUL-200", detail: null, mine: true, mandatory: true, exam: false, repoPath: "/p/rpg", until: null, status: null, eventId: null, projectKey: null, account: "student" },
        { kind: "event", title: "Kick-off", day: "2026-11-16", start: new Date(at(16, 10)).toISOString(), end: new Date(at(16, 12)).toISOString(), module: "G-MUL-200", detail: null, mine: true, mandatory: false, exam: false, repoPath: null, until: null, status: "registered", eventId: 1, projectKey: null, account: "student" },
        { kind: "event", title: "Other promo", day: "2026-11-16", start: new Date(at(16, 10)).toISOString(), end: new Date(at(16, 12)).toISOString(), module: "X", detail: null, mine: false, mandatory: false, exam: false, repoPath: null, until: null, status: null, eventId: null, projectKey: null, account: "student" },
        { kind: "activity", title: "Defense", day: "2026-11-18", start: new Date(at(18, 9)).toISOString(), end: new Date(at(18, 12)).toISOString(), module: "G-MUL-200", detail: "not registered", mine: true, mandatory: true, exam: false, repoPath: null, until: null, status: "not_registered", eventId: 2, projectKey: null, account: "student" },
        { kind: "holiday", title: "Break", day: "2026-11-21", start: null, end: null, module: null, detail: null, mine: true, mandatory: false, exam: false, repoPath: null, until: "2026-11-22", status: null, eventId: null, projectKey: null, account: "student" },
      ],
      [project()],
    );
    const by = (t: string) => items.find((i) => i.title === t)!;
    expect([by("MyRPG").kind, by("MyRPG").source, by("MyRPG").end]).toEqual(["deadline", "my", at(20, 19, 42)]);
    expect([by("Kick-off").kind, by("Other promo").kind]).toEqual(["activity", "campus"]);
    expect([by("Break").allDay, by("Break").end]).toEqual([true, addDays(at(22, 0), 1)]);
    expect([by("Defense").unregistered, toRegister(items, at(16, 0)).map((i) => i.title)]).toEqual([true, ["Defense"]]);
    // Only your own sessions and entries block time: not the campus list, not the hand-in marker, not a session you are not registered to.
    expect(busySpans(items)).toEqual([{ start: at(16, 10), end: at(16, 12) }, { start: at(16, 14), end: at(16, 15) }]);
    const week = workload(items, prefs, at(16, 0), 5);
    expect([week[0].school, week[0].work, week[4].handIns]).toEqual([120, 60, ["MyRPG"]]);
  });
  it("places overlapping entries side by side", () => {
    const placed = layoutDay([{ start: 0, end: 60 }, { start: 30, end: 90 }, { start: 100, end: 120 }, { start: 40, end: 50 }]);
    expect(placed.map((p) => [p.item.start, p.col, p.cols])).toEqual([[0, 0, 3], [30, 1, 3], [40, 2, 3], [100, 0, 1]]);
  });
});
