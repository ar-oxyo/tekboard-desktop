// Pure helpers over repository data. No I/O: covered by unit tests.
import type { RepoInfo } from "./api";

export type RepoFilter = "all" | "school" | "personal" | "changes" | "favorites" | "done";

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
  if (repo.error) return [{ level: "danger", label: "Unreadable" }];
  const s = repo.status;
  if (!s) return out;
  if (s.conflicted > 0) out.push({ level: "danger", label: `${s.conflicted} conflict${s.conflicted > 1 ? "s" : ""}` });
  const changes = s.staged + s.unstaged + s.untracked;
  if (changes > 0) out.push({ level: "warn", label: `${changes} uncommitted` });
  if (s.ahead > 0) out.push({ level: "info", label: `${s.ahead} to push` });
  if (s.behind > 0) out.push({ level: "info", label: `${s.behind} to pull` });
  if (repo.remoteUrl && s.branch && !s.upstream && !s.unborn) out.push({ level: "info", label: "Branch not published" });
  return out;
}

export function matchesFilter(repo: RepoInfo, filter: RepoFilter): boolean {
  switch (filter) {
    // Finished projects leave the working lists; they stay reachable under "Done".
    case "all":
      return !repo.meta.archived;
    case "school":
      return repo.epitech !== null && !repo.meta.archived;
    case "personal":
      return repo.epitech === null && !repo.meta.archived;
    case "changes":
      return attention(repo).length > 0 && !repo.meta.archived;
    case "favorites":
      return repo.meta.favorite;
    case "done":
      return repo.meta.archived;
  }
}

/** Case-insensitive search: every word must appear in the name, module, group, branch or owner. */
export function matchesQuery(repo: RepoInfo, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [repo.name, repo.epitech?.module, repo.epitech?.project, repo.group, repo.status?.branch, repo.remote?.owner]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function filterRepos(repos: RepoInfo[], query: string, filter: RepoFilter): RepoInfo[] {
  return repos.filter((r) => matchesFilter(r, filter) && matchesQuery(r, query));
}

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
  if (days < -1) return `${-days} days late`;
  if (days === -1) return "1 day late";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export interface Deadline {
  repo: RepoInfo;
  days: number;
}

/** Unfinished projects with a deadline, most urgent first. */
export function deadlines(repos: RepoInfo[], now: Date = new Date()): Deadline[] {
  const out: Deadline[] = [];
  for (const repo of repos) {
    if (repo.meta.archived || !repo.meta.deadline) continue;
    const days = daysLeft(repo.meta.deadline, now);
    if (days !== null) out.push({ repo, days });
  }
  return out.sort((a, b) => a.days - b.days);
}

/** The project to resume: last opened in TekBoard, otherwise the most recent commit. Finished projects are skipped. */
export function currentFocus(all: RepoInfo[]): RepoInfo | null {
  const repos = all.filter((r) => !r.meta.archived);
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
    if ((r.epitech !== null) !== school) continue;
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
