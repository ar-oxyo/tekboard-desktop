// Planning logic, computed locally: what is on the calendar, where the free time is, how to
// spread the remaining work before each hand-in. No call to Claude and no network here.
import type { AgendaItem, BoardItem, ScheduleAction, PlanCategory, PlanEvent, PlanState, PlanTask, Progress, RepoInfo } from "./api";
import { displayName, dueOf, dueTime, moduleOf } from "./repos";
import { locale, t } from "./i18n";

export const MIN = 60_000;
export const DAY = 86_400_000;

export interface PlanPrefs {
  /** Minutes from midnight between which work may be planned. */
  dayStart: number;
  dayEnd: number;
  /** Days work may be planned on (0 = Sunday). */
  workDays: number[];
  /** Planned work per day never goes above this. */
  maxMinutesPerDay: number;
  sessionMinutes: number;
  breakMinutes: number;
  /** Offer a plan for the day on the dashboard when nothing is planned yet. */
  morningPlan: boolean;
  /** `calm`, `balanced`, `intense` (they set the ceiling and the free time) or `custom`. Same meaning as `schedule.rs`. */
  mode: RhythmMode;
  longBreakMinutes: number;
  blocksBeforeLongBreak: number;
  /** Free time kept every working day. */
  flexMinutes: number;
  /** Protected spans, minutes from midnight (lunch…). */
  protected: [number, number][];
  /** Work for a project ends this many days before its hand-in. */
  bufferDays: number;
}

export type RhythmMode = "calm" | "balanced" | "intense" | "custom";
/** Ceiling and free time of each preset, as in schedule.rs. */
export const RHYTHMS: Record<Exclude<RhythmMode, "custom">, { label: string; hint: string; max: number; flex: number }> = {
  calm: { label: "Tranquille", hint: "2 h 30 de travail max, 2 h de temps libre gardées", max: 150, flex: 120 },
  balanced: { label: "Équilibré", hint: "4 h de travail max, 1 h de temps libre gardée", max: 240, flex: 60 },
  intense: { label: "Intensif", hint: "6 h de travail max, 45 min de temps libre gardées", max: 360, flex: 45 },
};

export const DEFAULT_PREFS: PlanPrefs = { dayStart: 9 * 60, dayEnd: 20 * 60, workDays: [1, 2, 3, 4, 5, 6], maxMinutesPerDay: 240, sessionMinutes: 75, breakMinutes: 15, morningPlan: true, mode: "balanced", longBreakMinutes: 45, blocksBeforeLongBreak: 2, flexMinutes: 60, protected: [[750, 810]], bufferDays: 1 };

/** The effective rhythm: a preset sets the ceiling and the free time. */
export function withMode(p: PlanPrefs): PlanPrefs {
  const r = p.mode !== "custom" ? RHYTHMS[p.mode] : null;
  return r ? { ...p, maxMinutesPerDay: r.max, flexMinutes: r.flex } : p;
}

// ── Dates

export const startOfDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
/** Midnight `n` calendar days after the day of `ms` (clock changes included). */
export const addDays = (ms: number, n: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
};
/** Monday of the week of `ms`. */
export const startOfWeek = (ms: number) => addDays(ms, -((new Date(ms).getDay() + 6) % 7));
const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const dayStartOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
};
/** `YYYY-MM-DDTHH:MM` in local time: the form plans are written in. */
export const toLocalIso = (ms: number) => {
  const d = new Date(ms);
  return `${dayKey(ms)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalIso = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime() : Date.parse(iso);
};
export const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** "45 min", "2 h", "1 h 30". */
export function fmtDur(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  return m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${pad(m % 60)}`;
}
const ceil15 = (ms: number) => Math.ceil(ms / (15 * MIN)) * 15 * MIN;

// ── Projects as the planner sees them

export interface PlanProject {
  /** Repository path, or `my:<id>` when the MY Epitech project is not cloned. */
  key: string;
  title: string;
  module: string | null;
  repoPath: string | null;
  day: string | null;
  at: string | null;
  /** Moment the hand-in closes, ms. */
  dueMs: number | null;
  status: Progress;
  priority: number;
  estimateMin: number | null;
  color: string;
}

/** Riso inks, readable on every design: used as a tint over the surface, never as text.
 *  Fluorescent orange is kept out: it means a hand-in. */
export const PALETTE = ["#0078bf", "#00a95c", "#ffb511", "#5ec8e5", "#f15060", "#ff48b0", "#00838a", "#765ba7"];
export function colorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Unfinished projects: those with a hand-in first (nearest first), then the others by name. */
export function planProjects(board: BoardItem[], repos: RepoInfo[], state: PlanState | undefined): PlanProject[] {
  const meta = new Map((state?.projects ?? []).map((p) => [p.key, p]));
  const out: PlanProject[] = [];
  const seen = new Set<string>();
  const push = (key: string, title: string, module: string | null, repoPath: string | null, day: string | null, at: string | null, status: Progress) => {
    if (seen.has(key)) return;
    seen.add(key);
    const m = meta.get(key);
    out.push({ key, title, module, repoPath, day, at, dueMs: dueTime(day, at), status, priority: m?.priority ?? 0, estimateMin: m?.estimateMin ?? null, color: m?.color ?? colorFor(key) });
  };
  for (const b of board) {
    const key = b.repoPath ?? (b.myId !== null ? `my:${b.myId}` : null);
    if (key) push(key, b.title, b.module, b.repoPath, b.day, b.at, b.status);
  }
  // Closed school work (its final date has passed) is no longer something to plan.
  for (const r of repos) if (r.progress !== "done" && dueOf(r).state !== "closed") push(r.path, displayName(r), moduleOf(r), r.path, r.meta.deadline, r.meta.deadlineAt, r.progress);
  return out.sort((a, b) => (a.dueMs ?? Infinity) - (b.dueMs ?? Infinity) || b.priority - a.priority || a.title.localeCompare(b.title));
}

// ── Calendar items: personal entries and MY Epitech data on one model

export type CalKind = PlanEvent["kind"] | "deadline" | "activity" | "campus" | "holiday" | "start";

export interface CalItem {
  id: string;
  /** `plan`: yours, editable. `my`: from MY Epitech or a hand-in date, read-only here. */
  source: "plan" | "my";
  kind: CalKind;
  title: string;
  /** ms */
  start: number;
  end: number;
  allDay: boolean;
  project: string | null;
  color: string;
  detail: string | null;
  module: string | null;
  done: boolean;
  exam: boolean;
  /** A session of one of your projects you are not registered to: shown, but not busy time. */
  unregistered: boolean;
  event?: PlanEvent;
  agenda?: AgendaItem;
}

export const KIND_LABEL: Record<CalKind, string> = { session: t("Session de travail"), task: t("Tâche"), event: t("Événement"), reminder: t("Rappel"), block: t("Indisponible"), deadline: t("Rendu"), activity: t("Ta séance"), campus: t("Séance du campus"), holiday: t("Vacances"), start: t("Ouverture du projet") };
/** Neutral colours of entries that belong to no project. */
export const KIND_COLOR: Record<CalKind, string> = { session: "#0078bf", task: "#0078bf", event: "#00838a", reminder: "#ffb511", block: "#8a847a", deadline: "#ff6c2f", activity: "#7f8aa3", campus: "#8a847a", holiday: "#00a95c", start: "#00838a" };

export type Filters = Record<"work" | "personal" | "handins" | "school" | "campus" | "holidays", boolean>;
export const DEFAULT_FILTERS: Filters = { work: true, personal: true, handins: true, school: true, campus: false, holidays: true };
const FILTER_OF: Record<CalKind, keyof Filters> = { session: "work", task: "work", event: "personal", reminder: "personal", block: "personal", deadline: "handins", start: "handins", activity: "school", campus: "campus", holiday: "holidays" };
export const visible = (i: CalItem, f: Filters) => f[FILTER_OF[i.kind]];

/** Colour of one of your entries: its own, its category's, its project's, then its kind's. */
export function entryColor(e: PlanEvent, project: PlanProject | undefined, categories: PlanCategory[]): string {
  const own = e.category ? categories.find((c) => c.id === e.category) : undefined;
  const base = categories.find((c) => c.id === e.kind);
  return e.color ?? own?.color ?? project?.color ?? base?.color ?? KIND_COLOR[e.kind];
}

/** Planning keys of the projects left out of the calendar. */
export const calendarHidden = (state: PlanState | undefined): Set<string> => new Set((state?.projects ?? []).filter((p) => p.calendarHidden).map((p) => p.key));

/** `hideProjects`: leave out the school items of projects hidden from the calendar (display only:
 *  free time is computed with them, they are still real constraints). */
export function calItems(state: PlanState | undefined, agenda: AgendaItem[], projects: PlanProject[], categories: PlanCategory[] = [], hideProjects = true): CalItem[] {
  const byKey = new Map(projects.map((p) => [p.key, p]));
  const hidden = hideProjects ? calendarHidden(state) : new Set<string>();
  const out: CalItem[] = [];
  for (const e of state?.events ?? []) {
    const p = e.project ? byKey.get(e.project) : undefined;
    out.push({ id: `p${e.id}`, source: "plan", kind: e.kind, title: e.title, start: e.start * 1000, end: e.end * 1000, allDay: e.allDay, project: e.project, color: entryColor(e, p, categories), detail: e.notes || null, module: p?.module ?? null, done: e.done, exam: false, unregistered: false, event: e });
  }
  agenda.forEach((a, n) => {
    // A project left out of the calendar (a year-long one, say): its school items are not drawn.
    // Its data and the sessions you planned for it stay.
    if (a.projectKey && hidden.has(a.projectKey)) return;
    const kind: CalKind = a.kind === "event" ? (a.mine ? "activity" : "campus") : a.kind;
    const day = dayStartOf(a.day);
    const at = a.start ? Date.parse(a.start) : Number.NaN;
    let start = day;
    let end = addDays(day, 1);
    let allDay = true;
    if (a.kind === "holiday") end = addDays(a.until ? dayStartOf(a.until) : day, 1);
    else if (!Number.isNaN(at)) {
      allDay = false;
      start = at;
      const stop = a.end ? Date.parse(a.end) : Number.NaN;
      // A hand-in is an instant: it is drawn as a short marker ending at the hour it closes.
      if (a.kind === "deadline" || a.kind === "start") {
        start = at - (a.kind === "deadline" ? 30 * MIN : 0);
        end = start + 30 * MIN;
      } else end = Number.isNaN(stop) || stop <= at ? at + 60 * MIN : stop;
    }
    const p = a.repoPath ? byKey.get(a.repoPath) : undefined;
    out.push({ id: `m${n}-${a.kind}-${a.start ?? a.day}`, source: "my", kind, title: a.title, start, end, allDay, project: a.repoPath, color: a.kind === "deadline" ? KIND_COLOR.deadline : (p?.color ?? KIND_COLOR[kind]), detail: a.detail, module: a.module, done: false, exam: a.exam, unregistered: a.status === "not_registered", agenda: a });
  });
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

// ── Free time

export interface Span {
  start: number;
  end: number;
}

/** Time that cannot hold a work session: personal entries and the school sessions that are yours. */
export function busySpans(items: CalItem[]): Span[] {
  return items.filter((i) => !i.allDay && !i.unregistered && i.kind !== "deadline" && i.kind !== "start" && i.kind !== "campus" && i.kind !== "reminder").map((i) => ({ start: i.start, end: i.end }));
}

/** Free spans of at least `minMinutes` inside working hours, between `from` and `to`. */
export function freeSlots(busy: Span[], prefs: PlanPrefs, from: number, to: number, minMinutes = 30): Span[] {
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  // The working day before `from` may still run past midnight into it.
  for (let day = addDays(startOfDay(from), nightOf(prefs) > 0 ? -1 : 0); day < to; day = addDays(day, 1)) {
    if (!prefs.workDays.includes(new Date(day).getDay())) continue;
    let cursor = Math.max(day + prefs.dayStart * MIN, ceil15(from));
    const end = Math.min(day + prefs.dayEnd * MIN, to);
    for (const b of sorted) {
      if (b.end <= cursor) continue;
      if (b.start >= end) break;
      if (b.start - cursor >= minMinutes * MIN) out.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
    }
    if (end - cursor >= minMinutes * MIN) out.push({ start: cursor, end });
  }
  return out;
}

// ── Work per project

const isWork = (e: PlanEvent) => e.kind === "session" || e.kind === "task";

/** Minutes of work still ahead in the calendar for a project. */
export function plannedMinutes(events: PlanEvent[], key: string, now: number): number {
  let total = 0;
  for (const e of events) if (isWork(e) && e.project === key && !e.done && e.end * 1000 > now) total += (e.end * 1000 - Math.max(now, e.start * 1000)) / MIN;
  return Math.round(total);
}

export interface Load {
  /** Work left according to the user's estimate; `null` when none was given. */
  remaining: number | null;
  planned: number;
  /** Part of the estimate that is not in the calendar yet. */
  unplanned: number;
  next: PlanEvent | null;
  /** `late`: hand-in passed. `risk`: the unplanned work does not fit before the hand-in, or
   *  the hand-in is close and nothing is planned. `ok`, or `unknown` without estimate or date. */
  risk: "late" | "risk" | "ok" | "unknown";
  /** Why, in a few words. */
  why: string;
}

export function projectLoad(p: PlanProject, events: PlanEvent[], busy: Span[], prefs: PlanPrefs, now: number): Load {
  const planned = plannedMinutes(events, p.key, now);
  const unplanned = p.estimateMin === null ? 0 : Math.max(0, p.estimateMin - planned);
  const next = events.filter((e) => isWork(e) && e.project === p.key && !e.done && e.end * 1000 > now).sort((a, b) => a.start - b.start)[0] ?? null;
  let risk: Load["risk"] = "unknown";
  let why = "";
  if (p.dueMs !== null && p.dueMs < now) {
    risk = "late";
    why = t("rendu dépassé");
  } else if (p.dueMs !== null) {
    const left = p.dueMs - now;
    if (p.estimateMin !== null) {
      const room = freeSlots(busy, prefs, now, p.dueMs).reduce((s, f) => s + (f.end - f.start) / MIN, 0);
      if (unplanned > room) {
        risk = "risk";
        why = `${fmtDur(unplanned)} à planifier, ${fmtDur(room)} de libre avant le rendu`;
      } else if (unplanned > 0 && left < 3 * DAY) {
        risk = "risk";
        why = `${fmtDur(unplanned)} non planifiées, rendu proche`;
      } else {
        risk = "ok";
        why = unplanned > 0 ? `${fmtDur(unplanned)} encore à planifier` : p.estimateMin === 0 ? t("plus rien à faire") : t("tout le travail est planifié");
      }
    } else if (left < 3 * DAY && planned === 0) {
      risk = "risk";
      why = t("rendu proche, sans estimation ni session");
    }
  }
  return { remaining: p.estimateMin, planned, unplanned, next, risk, why };
}

/** Work sessions that ended without being marked done, in the last `days` days. */
export function missed(events: PlanEvent[], now: number, days = 7): PlanEvent[] {
  return events.filter((e) => isWork(e) && !e.done && e.end * 1000 <= now && e.end * 1000 > now - days * DAY);
}

// ── Workload

export interface DayLoad {
  day: number;
  /** Minutes of school sessions that are yours. */
  school: number;
  /** Minutes of planned work. */
  work: number;
  /** Minutes of other personal entries. */
  other: number;
  handIns: string[];
  /** `over` when planned work exceeds the daily maximum, or when the day holds more than fits in its hours. */
  level: "light" | "busy" | "over";
}

const overlap = (i: Span, day: number) => Math.max(0, Math.min(i.end, addDays(day, 1)) - Math.max(i.start, day)) / MIN;

export function workload(items: CalItem[], prefs: PlanPrefs, from: number, days: number): DayLoad[] {
  const out: DayLoad[] = [];
  for (let n = 0; n < days; n++) {
    const day = addDays(from, n);
    const load: DayLoad = { day, school: 0, work: 0, other: 0, handIns: [], level: "light" };
    for (const i of items) {
      if (i.end <= day || i.start >= addDays(day, 1)) continue;
      if (i.kind === "deadline") load.handIns.push(i.title);
      else if (i.allDay || i.unregistered || i.kind === "campus" || i.kind === "start" || i.kind === "reminder") continue;
      else if (i.kind === "activity") load.school += overlap(i, day);
      else if (i.kind === "session" || i.kind === "task") load.work += overlap(i, day);
      else load.other += overlap(i, day);
    }
    const total = load.school + load.work + load.other;
    load.level = load.work > prefs.maxMinutesPerDay || total > prefs.dayEnd - prefs.dayStart ? "over" : total >= 0.6 * (prefs.dayEnd - prefs.dayStart) || load.handIns.length > 0 ? "busy" : "light";
    out.push(load);
  }
  return out;
}

// ── What to do now

export type Next =
  | { kind: "now"; item: CalItem }
  | { kind: "soon"; item: CalItem }
  | { kind: "plan"; project: PlanProject; load: Load }
  | { kind: "start"; project: PlanProject; load: Load }
  | { kind: "free" };

/** The one thing to look at: the session running, the next one today, else the project that most needs time. */
export function nextUp(items: CalItem[], projects: PlanProject[], loads: Map<string, Load>, now: number): Next {
  const work = items.filter((i) => (i.kind === "session" || i.kind === "task") && !i.done);
  const running = work.find((i) => i.start <= now && i.end > now);
  if (running) return { kind: "now", item: running };
  const soon = work.find((i) => i.start > now && i.start < addDays(now, 1));
  if (soon) return { kind: "soon", item: soon };
  const open = projects.filter((p) => p.dueMs !== null && p.dueMs > now && p.status !== "done");
  const risky = open.find((p) => loads.get(p.key)?.risk === "risk") ?? open.find((p) => (loads.get(p.key)?.unplanned ?? 0) > 0);
  if (risky) return { kind: "plan", project: risky, load: loads.get(risky.key)! };
  if (open[0]) return { kind: "start", project: open[0], load: loads.get(open[0].key)! };
  return { kind: "free" };
}

// ── Layout of one day column

export interface Placed<T> {
  item: T;
  col: number;
  cols: number;
}

/** Overlapping entries share the width of the column, side by side. */
export function layoutDay<T extends Span>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let groupEnd = -Infinity;
  let ends: number[] = [];
  const flush = () => {
    for (const g of group) g.cols = ends.length;
    group = [];
    ends = [];
  };
  for (const item of sorted) {
    if (item.start >= groupEnd) flush();
    let col = ends.findIndex((e) => e <= item.start);
    if (col === -1) col = ends.length;
    ends[col] = item.end;
    groupEnd = Math.max(groupEnd, item.end);
    const placed = { item, col, cols: 1 };
    group.push(placed);
    out.push(placed);
  }
  flush();
  return out;
}

// ── Tasks

export const openTasks = (tasks: PlanTask[]) => tasks.filter((t) => t.doneAt === null);
/** Open tasks with no calendar entry ahead: the inbox. Ideas are listed apart. */
export function unplanned(tasks: PlanTask[], events: PlanEvent[], now: number): PlanTask[] {
  const held = new Set(events.filter((e) => e.taskId !== null && e.end * 1000 > now && !e.done).map((e) => e.taskId));
  return openTasks(tasks).filter((t) => !held.has(t.id) && t.kind === "task");
}
export const PRIORITY = [t("Aucune priorité"), "Basse", "Moyenne", "Haute"];

/** Done / total of a project's tasks (sub-tasks count), or `null` when it has none. */
export function taskProgress(tasks: PlanTask[], key: string): { done: number; total: number } | null {
  const mine = tasks.filter((t) => t.project === key && t.kind === "task");
  return mine.length === 0 ? null : { done: mine.filter((t) => t.doneAt !== null).length, total: mine.length };
}

// ── What Claude is told

/** The planning as JSON for the assistant: the next two weeks, compact, with ids and keys to act on. */
export function buildContext(projects: PlanProject[], state: PlanState, items: CalItem[], busy: Span[], prefs: PlanPrefs, now: number): string {
  const until = addDays(now, 14);
  const loads = projects.map((p) => ({ p, l: projectLoad(p, state.events, busy, prefs, now) }));
  const relevant = loads.filter(({ p, l }) => p.dueMs !== null || p.estimateMin !== null || l.planned > 0 || state.tasks.some((t) => t.project === p.key && t.doneAt === null)).slice(0, 25);
  const ctx = {
    now: toLocalIso(now),
    weekday: new Date(now).toLocaleDateString("en", { weekday: "long" }),
    prefs: { hours: hoursLabel(prefs), workFrom: hhmmOf(prefs.dayStart), workUntil: hhmmOf(prefs.dayEnd), workUntilNextDay: prefs.dayEnd > 1440, workDays: prefs.workDays, maxMinutesPerDay: prefs.maxMinutesPerDay, sessionMinutes: prefs.sessionMinutes, breakMinutes: prefs.breakMinutes },
    projects: relevant.map(({ p, l }) => ({ key: p.key, title: p.title, module: p.module, handIn: p.dueMs ? toLocalIso(p.dueMs) : null, status: p.status, priority: p.priority, estimateMin: p.estimateMin, plannedMin: l.planned, risk: l.risk })),
    tasks: openTasks(state.tasks).slice(0, 60).map((t) => ({ id: t.id, title: t.title, project: t.project, priority: t.priority, estimateMin: t.estimateMin, dueDay: t.dueDay, parent: t.parentId })),
    entries: items
      .filter((i) => i.end > now - DAY && i.start < until && i.kind !== "campus")
      .slice(0, 150)
      .map((i) => (i.source === "plan" ? { id: i.event!.id, source: "me", kind: i.kind, title: i.title, project: i.project, start: toLocalIso(i.start), end: toLocalIso(i.end), done: i.done || undefined } : { source: "my", kind: i.kind, title: i.title, start: i.allDay ? dayKey(i.start) : toLocalIso(i.kind === "deadline" ? i.end : i.start), end: i.allDay || i.kind === "deadline" ? undefined : toLocalIso(i.end) })),
    missed: missed(state.events, now).map((e) => ({ id: e.id, title: e.title, project: e.project, minutes: Math.round((e.end - e.start) / 60) })),
    free: freeSlots(busy, prefs, now, until).slice(0, 80).map((f) => ({ start: toLocalIso(f.start), end: toLocalIso(f.end) })),
  };
  return JSON.stringify(ctx);
}

/** "HH:MM" of minutes from midnight; past 1440 (next morning), the time of that morning. */
export const hhmmOf = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

/** Minutes of the next morning that still belong to the working day (hours past midnight). */
export const nightOf = (p: Pick<PlanPrefs, "dayEnd">) => Math.max(0, p.dayEnd - 1440);

/** Working hours in 24-hour time: "09:00–20:00", "09:00–02:00 (+1 j)". */
export function hoursLabel(p: Pick<PlanPrefs, "dayStart" | "dayEnd">): string {
  return `${hhmmOf(p.dayStart)}–${hhmmOf(p.dayEnd)}${p.dayEnd > 1440 ? ` ${t("(+1 j)")}` : ""}`;
}

/** An end time typed as a clock (0–1439): before or at the start, it is the next morning. */
export const endFromClock = (start: number, clock: number) => (clock <= start ? clock + 1440 : clock);

/**
 * Working minutes of the calendar day `day` (local midnight), as [from, to) minute ranges:
 * the night carried over from the day before when that was a working day, then its own hours.
 */
export function workRanges(p: Pick<PlanPrefs, "dayStart" | "dayEnd" | "workDays">, day: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const night = nightOf(p);
  if (night > 0 && p.workDays.includes(new Date(addDays(day, -1)).getDay())) out.push([0, night]);
  if (p.workDays.includes(new Date(day).getDay())) out.push([p.dayStart, Math.min(p.dayEnd, 1440)]);
  return out;
}

/** The rest of the day: what is outside `workRanges`, to shade on the calendar. */
export function offRanges(p: Pick<PlanPrefs, "dayStart" | "dayEnd" | "workDays">, day: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let cursor = 0;
  for (const [a, b] of workRanges(p, day)) {
    if (a > cursor) out.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < 1440) out.push([cursor, 1440]);
  return out;
}
export const minutesOf = (text: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** One line describing a proposed change, for the preview before "Apply plan". */
export function describeAction(a: ScheduleAction, projects: PlanProject[], events: PlanEvent[]): { verb: string; text: string; when: string | null } {
  const name = (key: string | null) => (key ? (projects.find((p) => p.key === key)?.title ?? key.split("/").pop() ?? key) : null);
  const span = (start: string, end: string) => {
    const [s, e] = [fromLocalIso(start), fromLocalIso(end)];
    return `${new Date(s).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" })} · ${hhmm(s)} – ${hhmm(e)}`;
  };
  switch (a.type) {
    case "create_session":
      return { verb: t("Ajouter"), text: a.title || name(a.project) || t("Session de travail"), when: span(a.start, a.end) };
    case "move_event":
      return { verb: "Déplacer", text: events.find((e) => e.id === a.id)?.title ?? `entrée ${a.id}`, when: span(a.start, a.end) };
    case "delete_event":
      return { verb: "Retirer", text: events.find((e) => e.id === a.id)?.title ?? `entrée ${a.id}`, when: null };
    case "create_task":
      return { verb: t("Tâche"), text: `${a.title}${a.subtasks?.length ? ` (+${a.subtasks.length} sous-tâches)` : ""}`, when: [name(a.project), a.estimateMin ? fmtDur(a.estimateMin) : null].filter(Boolean).join(" · ") || null };
    case "set_priority":
      return { verb: t("Priorité"), text: name(a.project) ?? "", when: PRIORITY[a.priority] ?? String(a.priority) };
    case "set_estimate":
      return { verb: "Estimation", text: name(a.project) ?? "", when: `reste ${fmtDur(a.estimateMin)}` };
  }
}

/**
 * Minutes of a typed duration. `1h30`, `45m` and `90 min` are what they say; a bare number is
 * read in `bare` units: hours for the work left on a project (`12`), minutes for a session,
 * a break or a daily ceiling (`240`), so "240" never becomes 240 hours.
 */
export function parseDur(text: string, bare: "h" | "min" = "h"): number | null {
  const t = text.trim().toLowerCase().replace(",", ".");
  let m = /^(\d+(?:\.\d+)?)\s*h(?:\s*(\d{1,2})\s*(?:m|min)?)?$/.exec(t);
  if (m) return Math.round(Number(m[1]) * 60 + Number(m[2] ?? 0));
  m = /^(\d+)\s*(?:m|min)$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  return bare === "min" && !m[1].includes(".") ? Number(m[1]) : Math.round(Number(m[1]) * 60);
}
/** A duration as it can be typed back: `1h30`, `45m`, `12h`. */
export const durInput = (minutes: number | null) => (minutes === null ? "" : minutes < 60 ? `${minutes}m` : minutes % 60 === 0 ? `${minutes / 60}h` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`);

/** Mandatory sessions of your projects, still ahead, that you are not registered to. */
export const toRegister = (items: CalItem[], now: number, days = 21) => items.filter((i) => i.unregistered && i.agenda?.mandatory && i.start > now && i.start < addDays(now, days));
