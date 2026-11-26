// Pure helpers over repository data. No I/O: covered by unit tests.
import type { RepoInfo } from "./api";
import { locale, plural, t } from "./i18n";


/** Short name. A folder renamed after cloning ("… (Copy)") keeps its suffix so two copies stay distinguishable. */
export function displayName(repo: RepoInfo): string {
  const base = repo.epitech?.project ?? repo.name;
  const remote = repo.remote?.name;
  if (repo.epitech && remote && repo.name !== remote && repo.name.startsWith(remote)) return base + repo.name.slice(remote.length);
  return base;
}

export function changeCount(repo: RepoInfo): number {
  const s = repo.status;
  return s ? s.staged + s.unstaged + s.untracked + s.conflicted : 0;
}

export interface Attention {
  level: "danger" | "warn" | "info";
  label: string;
}

/** Why a repository deserves a look, most pressing first. Empty when all is in order. */
export function attention(repo: RepoInfo): Attention[] {
  const out: Attention[] = [];
  if (repo.error) return [{ level: "danger", label: "Illisible" }];
  const s = repo.status;
  if (!s) return out;
  if (s.conflicted > 0) out.push({ level: "danger", label: `${s.conflicted} conflit${s.conflicted > 1 ? "s" : ""}` });
  const changes = s.staged + s.unstaged + s.untracked;
  if (changes > 0) out.push({ level: "warn", label: `${changes} non commité${changes > 1 ? "s" : ""}` });
  if (s.ahead > 0) out.push({ level: "info", label: `${s.ahead} à envoyer` });
  if (s.behind > 0) out.push({ level: "info", label: `${s.behind} à récupérer` });
  if (repo.remoteUrl && s.branch && !s.upstream && !s.unborn) out.push({ level: "info", label: t("Branche non publiée") });
  return out;
}

export type RepoFilter = "active" | "todo" | "in_progress" | "done" | "changes" | "favorites" | "archived";

export interface FilterOptions {
  /** Hide repositories that are not part of the curriculum. */
  epitechOnly?: boolean;
  /** Keep only this module (`G-CPE-110`). */
  module?: string | null;
}

/** Module code of a repository: what MY Epitech says, else what its name says. */
export function moduleOf(repo: RepoInfo): string | null {
  return repo.my?.unitCode || repo.epitech?.module || null;
}

export function isDone(repo: RepoInfo): boolean {
  return repo.progress === "done";
}

export function matchesFilter(repo: RepoInfo, filter: RepoFilter): boolean {
  // Archived projects only show under their own filter.
  if ((filter === "archived") !== (repo.meta.visibility === "archived")) return false;
  switch (filter) {
    case "archived":
      return true;
    // Finished projects leave the working list; they stay reachable under "Done", and their status can be changed back there.
    case "active":
      return !isDone(repo);
    case "todo":
      return repo.progress === "todo";
    case "in_progress":
      return repo.progress === "in_progress";
    case "done":
      return isDone(repo);
    case "changes":
      return attention(repo).length > 0 && !isDone(repo);
    case "favorites":
      return repo.meta.favorite;
  }
}

/** Case-insensitive search: every word must appear in the name, module, group, branch or owner. */
export function matchesQuery(repo: RepoInfo, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [repo.name, repo.epitech?.module, repo.epitech?.project, repo.my?.name, repo.my?.unitCode, repo.my?.unitName, repo.group, repo.status?.branch, repo.remote?.owner]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function filterRepos(repos: RepoInfo[], query: string, filter: RepoFilter, options: FilterOptions = {}): RepoInfo[] {
  return repos.filter((r) => matchesFilter(r, filter) && matchesQuery(r, query) && (!options.epitechOnly || r.kind === "epitech") && (!options.module || moduleOf(r) === options.module));
}

/** Modules present in the list, sorted, with how many repositories each has. */
export function modulesOf(repos: RepoInfo[]): Array<{ code: string; name: string | null; count: number }> {
  const map = new Map<string, { code: string; name: string | null; count: number }>();
  for (const r of repos) {
    const code = moduleOf(r);
    if (!code) continue;
    const cur = map.get(code) ?? { code, name: null, count: 0 };
    cur.count += 1;
    cur.name = cur.name ?? r.my?.unitName ?? null;
    map.set(code, cur);
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
}

// ── Hand-in dates

/** Whole days from today to a `YYYY-MM-DD` deadline (local time). Negative when overdue, `null` when unparseable. */
export function daysLeft(deadline: string, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadline);
  if (!m) return null;
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

export function deadlineLabel(days: number): string {
  if (days < 0) return plural(-days, "{n} jour de retard", "{n} jours de retard");
  if (days === 0) return t("aujourd'hui");
  if (days === 1) return t("demain");
  return t("dans {n} jours", { n: days });
}

/** Moment the hand-in closes, in ms: the exact instant when known, else the end of the day. `null` without a usable date. */
export function dueTime(day: string | null, at: string | null): number | null {
  if (at) {
    const t = Date.parse(at);
    if (!Number.isNaN(t)) return t;
  }
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  if (!m) return null;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59).getTime();
  return Number.isNaN(end) ? null : end;
}

export type DueState = "upcoming" | "today" | "overdue" | "unknown";

export interface Due {
  state: DueState;
  /** "aujourd'hui 19:42", "dans 9 jours", "2 h de retard"… Empty when there is no date. */
  label: string;
  /** Badge colour: late, close (two days or less), or neither. */
  tone: "danger" | "warn" | "neutral";
  /** Local `HH:MM` of the hand-in, when the hour is known. */
  time: string | null;
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hour12: false });

/** State and wording of a hand-in date right now. With an exact hour, "late" starts when it passes, not at midnight. */
export function due(day: string | null, at: string | null, now: Date = new Date()): Due {
  const exact = at ? Date.parse(at) : Number.NaN;
  const days = day ? daysLeft(day, now) : null;
  if (!Number.isNaN(exact)) {
    const time = hhmm(exact);
    const late = now.getTime() - exact;
    if (late > 0) {
      const min = Math.floor(late / 60_000);
      const label = min < 60 ? t("{n} min de retard", { n: Math.max(1, min) }) : min < 24 * 60 ? t("{n} h de retard", { n: Math.floor(min / 60) }) : deadlineLabel(Math.min(-1, days ?? -Math.floor(min / 1440)));
      return { state: "overdue", label, tone: "danger", time };
    }
    const d = days ?? Math.round(-late / 86_400_000);
    if (d <= 0) return { state: "today", label: t("aujourd'hui {time}", { time }), tone: "warn", time };
    return { state: "upcoming", label: d === 1 ? t("demain {time}", { time }) : deadlineLabel(d), tone: d <= 2 ? "warn" : "neutral", time };
  }
  if (days === null) return { state: "unknown", label: "", tone: "neutral", time: null };
  if (days < 0) return { state: "overdue", label: deadlineLabel(days), tone: "danger", time: null };
  return { state: days === 0 ? "today" : "upcoming", label: deadlineLabel(days), tone: days <= 2 ? "warn" : "neutral", time: null };
}

export const dueOf = (repo: RepoInfo, now: Date = new Date()): Due => due(repo.meta.deadline, repo.meta.deadlineAt, now);

/** Local `HH:MM` of a saved instant, for the time field of the project sheet. */
export function localTime(at: string | null): string {
  const t = at ? Date.parse(at) : Number.NaN;
  return Number.isNaN(t) ? "" : hhmm(t);
}

export interface Deadline {
  repo: RepoInfo;
  days: number;
}

/** Unfinished projects with a deadline, most urgent first. */
export function deadlines(repos: RepoInfo[], now: Date = new Date()): Deadline[] {
  const out: Array<Deadline & { t: number }> = [];
  for (const repo of repos) {
    if (isDone(repo) || !repo.meta.deadline) continue;
    const days = daysLeft(repo.meta.deadline, now);
    const t = dueTime(repo.meta.deadline, repo.meta.deadlineAt);
    if (days !== null && t !== null) out.push({ repo, days, t });
  }
  return out.sort((a, b) => a.t - b.t).map(({ repo, days }) => ({ repo, days }));
}

// ── Sorting

export type SortKey = "smart" | "deadline" | "added" | "activity" | "name" | "status" | "module";

export const SORTS: Array<{ id: SortKey; label: string; hint: string }> = [
  { id: "smart", label: "Intelligent", hint: t("Travail en cours, rendu le plus proche d'abord") },
  { id: "deadline", label: t("Rendu"), hint: t("Rendu le plus proche d'abord, sans date à la fin") },
  { id: "activity", label: t("Activité récente"), hint: t("Dernier commit ou dernière ouverture") },
  { id: "added", label: t("Date d'ajout"), hint: t("Le plus récent sur cet ordinateur d'abord") },
  { id: "name", label: "Nom", hint: t("De A à Z") },
  { id: "status", label: t("Statut"), hint: t("En cours, à faire, terminé") },
  { id: "module", label: "Module", hint: t("Par code de module") },
];

/** Last sign of life, in ms: the latest of the last commit and the last time it was opened here. */
export function lastActivity(repo: RepoInfo): number {
  const commit = repo.lastCommit ? Date.parse(repo.lastCommit.date) : Number.NaN;
  const opened = repo.meta.lastOpenedAt !== null ? repo.meta.lastOpenedAt * 1000 : Number.NaN;
  return Math.max(Number.isNaN(commit) ? 0 : commit, Number.isNaN(opened) ? 0 : opened);
}

const byName = (a: RepoInfo, b: RepoInfo) => displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base", numeric: true }) || a.path.localeCompare(b.path);
const byActivity = (a: RepoInfo, b: RepoInfo) => lastActivity(b) - lastActivity(a) || byName(a, b);
/** Dated before undated; nearest (or longest overdue) first. */
function byDeadline(a: RepoInfo, b: RepoInfo): number {
  const ta = dueTime(a.meta.deadline, a.meta.deadlineAt);
  const tb = dueTime(b.meta.deadline, b.meta.deadlineAt);
  if (ta === null || tb === null) return ta === tb ? byActivity(a, b) : ta === null ? 1 : -1;
  return ta - tb || byName(a, b);
}

/**
 * Default order. What needs you first:
 * 0. active with a hand-in that is late or today; 1. active with a hand-in to come (nearest first);
 * 2. in progress without a date; 3. to do without a date; 4. finished (most recent first).
 */
function smartRank(repo: RepoInfo, now: Date): number {
  if (isDone(repo)) return 4;
  const state = dueOf(repo, now).state;
  if (state === "overdue" || state === "today") return 0;
  if (state === "upcoming") return 1;
  return repo.progress === "in_progress" ? 2 : 3;
}

const STATUS_ORDER = { in_progress: 0, todo: 1, done: 2 } as const;

/** A new array in the requested order. Every order is total: equal rows fall back to the name, then the path. */
export function sortRepos(repos: RepoInfo[], key: SortKey, now: Date = new Date()): RepoInfo[] {
  const smart = (a: RepoInfo, b: RepoInfo) => {
    const ra = smartRank(a, now);
    const rb = smartRank(b, now);
    if (ra !== rb) return ra - rb;
    if (ra <= 1) return byDeadline(a, b);
    if (ra === 4) return (dueTime(b.meta.deadline, b.meta.deadlineAt) ?? lastActivity(b)) - (dueTime(a.meta.deadline, a.meta.deadlineAt) ?? lastActivity(a)) || byName(a, b);
    return byActivity(a, b);
  };
  const cmp: Record<SortKey, (a: RepoInfo, b: RepoInfo) => number> = {
    smart,
    deadline: byDeadline,
    activity: byActivity,
    added: (a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0) || byName(a, b),
    name: byName,
    status: (a, b) => STATUS_ORDER[a.progress] - STATUS_ORDER[b.progress] || smart(a, b),
    module: (a, b) => {
      const ma = moduleOf(a);
      const mb = moduleOf(b);
      if (ma === null || mb === null) return ma === mb ? byName(a, b) : ma === null ? 1 : -1;
      return ma.localeCompare(mb) || byName(a, b);
    },
  };
  return [...repos].sort(cmp[key]);
}

/** The project to resume: last opened in TekBoard, otherwise the most recent commit. Finished projects are skipped. */
export function currentFocus(all: RepoInfo[]): RepoInfo | null {
  const repos = all.filter((r) => !isDone(r));
  let best: RepoInfo | null = null;
  for (const r of repos) {
    if (r.meta.lastOpenedAt !== null && (best === null || r.meta.lastOpenedAt > (best.meta.lastOpenedAt ?? 0))) best = r;
  }
  if (best) return best;
  // `repos` arrives sorted by last commit, newest first.
  return repos.find((r) => r.lastCommit !== null) ?? repos[0] ?? null;
}

/** Folders a new project can be cloned into: the roots and every folder that already holds a repository. */
export function cloneTargets(repos: RepoInfo[], roots: string[]): string[] {
  const set = new Set<string>(roots);
  for (const r of repos) {
    const idx = r.path.lastIndexOf("/");
    if (idx > 0) set.add(r.path.slice(0, idx));
  }
  return [...set].sort();
}

/** Where school repositories usually live: the folder holding the most of them. */
export function preferredCloneDir(repos: RepoInfo[], school: boolean): string | null {
  const counts = new Map<string, number>();
  for (const r of repos) {
    if ((r.kind === "epitech") !== school) continue;
    const dir = r.path.slice(0, r.path.lastIndexOf("/"));
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  let best: string | null = null;
  let max = 0;
  for (const [dir, n] of counts) {
    if (n > max) {
      best = dir;
      max = n;
    }
  }
  return best;
}

/** Rows for a project picker: short name, with the module (or the folder) as a hint. */
export function repoOptions(repos: RepoInfo[]): Array<{ value: string; label: string; hint?: string }> {
  return repos.map((r) => ({ value: r.path, label: displayName(r), hint: moduleOf(r) ?? (r.group || undefined) }));
}
