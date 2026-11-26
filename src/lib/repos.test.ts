import { describe, expect, it } from "vitest";
import type { MyLink, RepoInfo, RepoMeta, RepoStatus } from "./api";
import { attention, cloneTargets, currentFocus, daysLeft, deadlineLabel, deadlines, displayName, due, dueOf, dueTime, filterRepos, groupRepos, modulesOf, phaseOf, preferredCloneDir, sortRepos } from "./repos";
import { looksLikeEpitech, repoNameFromUrl, tildify, timeAgo } from "./format";

const clean: RepoStatus = { branch: "main", upstream: "origin/main", ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, unborn: false };

const noMeta: RepoMeta = { favorite: false, archived: false, lastOpenedAt: null, deadline: null, deadlineAt: null, deadlineSource: null, status: null, kindOverride: null, myProjectId: null, runBin: null, runArgs: null, visibility: null };

function repo(over: Omit<Partial<RepoInfo>, "status" | "meta"> & { status?: Partial<RepoStatus> | null; meta?: Partial<RepoMeta> }): RepoInfo {
  const { status, meta, ...rest } = over;
  const m = { ...noMeta, ...meta };
  return {
    path: "/r/Tek/x",
    name: "x",
    group: "Tek",
    remoteUrl: "git@github.com:o/x.git",
    remote: { host: "github.com", owner: "o", name: "x" },
    epitech: null,
    status: status === null ? null : { ...clean, ...status },
    lastCommit: null,
    error: null,
    meta: m,
    addedAt: null,
    // As the backend fills them: finished when archived, school when the name says so.
    progress: m.archived ? "done" : (m.status ?? "todo"),
    progressInferred: m.status === null && !m.archived,
    kind: over.epitech ? "epitech" : "personal",
    kindReason: "",
    deadlineState: "unknown",
    my: null,
    duplicateOf: null,
    ...rest,
  };
}

const school = { module: "G-CPE-110", unit: "CPE", city: "LYN", project: "settingup" };

describe("attention", () => {
  it("is empty for a clean, published repository", () => {
    expect(attention(repo({}))).toEqual([]);
  });
  it("orders conflicts before changes before sync", () => {
    const a = attention(repo({ status: { conflicted: 1, untracked: 2, staged: 1, ahead: 3, behind: 1 } }));
    expect(a.map((x) => x.label)).toEqual(["1 conflit", "3 non commités", "3 à envoyer", "1 à récupérer"]);
  });
  it("flags an unpublished branch only when a remote exists", () => {
    expect(attention(repo({ status: { upstream: null } })).map((x) => x.label)).toEqual(["Branche non publiée"]);
    expect(attention(repo({ status: { upstream: null }, remoteUrl: null }))).toEqual([]);
    expect(attention(repo({ status: { upstream: null, unborn: true } }))).toEqual([]);
  });
  it("reports an unreadable repository", () => {
    expect(attention(repo({ error: "boom", status: null }))[0].level).toBe("danger");
  });
});

describe("displayName", () => {
  const remote = { host: "github.com", owner: "o", name: "G-CPE-110-LYN-1-1-settingup-27" };
  it("uses the project name and keeps a folder suffix", () => {
    expect(displayName(repo({ name: remote.name, remote, epitech: school }))).toBe("settingup");
    expect(displayName(repo({ name: remote.name + " (Copy)", remote, epitech: school }))).toBe("settingup (Copy)");
    expect(displayName(repo({ name: "tool" }))).toBe("tool");
  });
});

describe("filterRepos", () => {
  const repos = [
    repo({ name: "G-CPE-110-LYN-1-1-settingup-27", epitech: school }),
    repo({ name: "tekcraft", group: "Perso", status: { unstaged: 1 }, meta: { favorite: true } }),
  ];
  it("filters by state", () => {
    expect(filterRepos(repos, "", "changes").map((r) => r.name)).toEqual(["tekcraft"]);
    expect(filterRepos(repos, "", "favorites").map((r) => r.name)).toEqual(["tekcraft"]);
    expect(filterRepos(repos, "", "active")).toHaveLength(2);
  });
  it("Epitech only hides what is not part of the curriculum, by classification and not by name", () => {
    expect(filterRepos(repos, "", "active", { epitechOnly: true }).map((r) => r.name)).toEqual(["G-CPE-110-LYN-1-1-settingup-27"]);
    // A school repository with a free name, and a personal one that merely looks like school work.
    const free = repo({ name: "free-project", kind: "epitech" });
    const lookalike = repo({ name: "G-CPE-110-LYN-1-1-settingup-27", epitech: school, kind: "personal" });
    expect(filterRepos([free, lookalike], "", "active", { epitechOnly: true }).map((r) => r.name)).toEqual(["free-project"]);
    expect(filterRepos([free, lookalike], "", "active", {})).toHaveLength(2);
  });
  it("filters by module, taken from MY Epitech before the name", () => {
    const my = { unitCode: "G-PSU-100", unitName: "Unix System" } as MyLink;
    const linked = repo({ name: "renamed", my });
    expect(filterRepos([...repos, linked], "", "active", { module: "G-PSU-100" }).map((r) => r.name)).toEqual(["renamed"]);
    expect(modulesOf([...repos, linked])).toEqual([
      { code: "G-CPE-110", name: null, count: 1 },
      { code: "G-PSU-100", name: "Unix System", count: 1 },
    ]);
  });
  it("matches every word, case-insensitively", () => {
    expect(filterRepos(repos, "cpe SETTING", "active")).toHaveLength(1);
    expect(filterRepos(repos, "perso tek", "active").map((r) => r.name)).toEqual(["tekcraft"]);
    expect(filterRepos(repos, "nothing", "active")).toHaveLength(0);
  });
});

describe("currentFocus", () => {
  it("prefers the last project opened in TekBoard", () => {
    const a = repo({ name: "a", lastCommit: { hash: "1", subject: "s", author: "me", date: "2026-11-09T10:00:00+01:00" } });
    const b = repo({ name: "b", meta: { lastOpenedAt: 50 } });
    const c = repo({ name: "c", meta: { lastOpenedAt: 90 } });
    expect(currentFocus([a, b, c])?.name).toBe("c");
  });
  it("falls back to the most recent commit, then to nothing", () => {
    const a = repo({ name: "a" });
    const b = repo({ name: "b", lastCommit: { hash: "1", subject: "s", author: "me", date: "2026-11-09T10:00:00+01:00" } });
    expect(currentFocus([a, b])?.name).toBe("b");
    expect(currentFocus([])).toBeNull();
  });
});

describe("deadlines", () => {
  const now = new Date(2026, 10, 10, 23, 30);
  const meta = (deadline: string | null, archived = false) => ({ archived, deadline });
  it("counts whole local days", () => {
    expect(daysLeft("2026-11-10", now)).toBe(0);
    expect(daysLeft("2026-11-11", now)).toBe(1);
    expect(daysLeft("2026-11-08", now)).toBe(-2);
    expect(daysLeft("2026-12-01", now)).toBe(21);
    expect(daysLeft("soon", now)).toBeNull();
  });
  it("labels", () => {
    expect([-3, -1, 0, 1, 5].map(deadlineLabel)).toEqual(["3 jours de retard", "1 jour de retard", "aujourd'hui", "demain", "dans 5 jours"]);
  });
  it("lists unfinished projects by urgency", () => {
    const list = deadlines([repo({ name: "later", meta: meta("2026-11-20") }), repo({ name: "late", meta: meta("2026-11-09") }), repo({ name: "done", meta: meta("2026-11-11", true) }), repo({ name: "none" })], now);
    expect(list.map((d) => d.repo.name)).toEqual(["late", "later"]);
  });
  it("finished projects leave the working lists and the focus", () => {
    const done = repo({ name: "done", meta: { archived: true, lastOpenedAt: 99 } });
    const live = repo({ name: "live" });
    expect(filterRepos([done, live], "", "active").map((r) => r.name)).toEqual(["live"]);
    expect(filterRepos([done, live], "", "done").map((r) => r.name)).toEqual(["done"]);
    expect(currentFocus([done, live])?.name).toBe("live");
  });
  it("the three statuses each have their list, and a project moves freely between them", () => {
    const p = (status: "todo" | "in_progress" | "done") => repo({ name: status, progress: status });
    const all = [p("todo"), p("in_progress"), p("done")];
    expect(filterRepos(all, "", "todo").map((r) => r.name)).toEqual(["todo"]);
    expect(filterRepos(all, "", "in_progress").map((r) => r.name)).toEqual(["in_progress"]);
    expect(filterRepos(all, "", "done").map((r) => r.name)).toEqual(["done"]);
    expect(filterRepos(all, "", "active").map((r) => r.name)).toEqual(["todo", "in_progress"]);
    // Marked done by mistake, then set back: it returns to the working list with its deadline.
    const back = { ...all[2], progress: "in_progress" as const, meta: { ...all[2].meta, deadline: "2026-11-13" } };
    expect(filterRepos([back], "", "active")).toHaveLength(1);
    expect(deadlines([back], now).map((d) => d.days)).toEqual([3]);
  });
});

describe("hand-in state", () => {
  // A hand-in at 19:42 local time on the 20th.
  const at = new Date(2026, 10, 20, 19, 42).toISOString();
  const on = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
  it("follows the exact hour, not midnight", () => {
    expect(due("2026-11-20", at, on(11, 12))).toMatchObject({ state: "upcoming", label: "dans 9 jours", tone: "neutral" });
    expect(due("2026-11-20", at, on(19, 23))).toMatchObject({ state: "upcoming", label: "demain 19:42", tone: "warn" });
    expect(due("2026-11-20", at, on(20, 8))).toMatchObject({ state: "today", label: "aujourd'hui 19:42", tone: "warn" });
    expect(due("2026-11-20", at, on(20, 19, 41))).toMatchObject({ state: "today" });
    expect(due("2026-11-20", at, on(20, 19, 50))).toMatchObject({ state: "overdue", label: "8 min de retard", tone: "danger" });
    expect(due("2026-11-20", at, on(20, 23))).toMatchObject({ state: "overdue", label: "3 h de retard" });
    expect(due("2026-11-20", at, on(22, 9))).toMatchObject({ state: "overdue", label: "2 jours de retard" });
  });
  it("a day without hour lasts until midnight, and no date is unknown, never invented", () => {
    expect(due("2026-11-20", null, on(20, 23, 59))).toMatchObject({ state: "today", label: "aujourd'hui", time: null });
    expect(due("2026-11-20", null, on(21, 0, 1))).toMatchObject({ state: "overdue", label: "1 jour de retard" });
    expect(due(null, null, on(20, 12))).toEqual({ state: "unknown", label: "", tone: "neutral", time: null });
    expect(due("soon", null, on(20, 12)).state).toBe("unknown");
    expect(due("2026-11-20", "garbage", on(19, 12))).toMatchObject({ state: "upcoming", label: "demain" });
  });
  it("orders by the moment the hand-in closes", () => {
    expect(dueTime("2026-11-20", at)).toBe(Date.parse(at));
    expect(dueTime("2026-11-20", null)! > dueTime("2026-11-20", at)!).toBe(true);
    expect(dueTime(null, null)).toBeNull();
  });
});

describe("sortRepos", () => {
  const now = new Date(2026, 10, 11, 12, 0);
  const commit = (date: string) => ({ hash: "1", subject: "s", author: "me", date });
  const repos = [
    repo({ name: "zeta-old", path: "/r/zeta", progress: "todo", addedAt: 100, lastCommit: commit("2026-06-01T10:00:00+02:00") }),
    repo({ name: "hunter", path: "/r/hunter", progress: "in_progress", addedAt: 400, meta: { deadline: "2026-11-20" }, epitech: { ...school, module: "G-MUL-100", project: "myhunter" } }),
    repo({ name: "setting", path: "/r/setting", progress: "in_progress", addedAt: 300, meta: { deadline: "2026-11-13" }, epitech: school }),
    repo({ name: "late", path: "/r/late", progress: "todo", addedAt: 200, meta: { deadline: "2026-11-09" } }),
    repo({ name: "alpha-wip", path: "/r/alpha", progress: "in_progress", addedAt: 500, lastCommit: commit("2026-11-10T10:00:00+01:00") }),
    repo({ name: "ls-done", path: "/r/ls", progress: "done", addedAt: 50, meta: { deadline: "2026-11-06" }, epitech: { ...school, module: "G-PSU-100", project: "myls" } }),
    repo({ name: "pool-done", path: "/r/pool", progress: "done", addedAt: 10, meta: { deadline: "2026-10-08" } }),
  ];
  const names = (key: Parameters<typeof sortRepos>[1]) => sortRepos(repos, key, now).map((r) => r.name);
  it("smart: late or due first, then nearest hand-in, then active, then to do, finished last", () => {
    expect(names("smart")).toEqual(["late", "setting", "hunter", "alpha-wip", "zeta-old", "ls-done", "pool-done"]);
  });
  it("deadline: nearest first, undated last by activity", () => {
    expect(names("deadline")).toEqual(["pool-done", "ls-done", "late", "setting", "hunter", "alpha-wip", "zeta-old"]);
  });
  it("activity, date added, name, status, module", () => {
    expect(names("activity").slice(0, 2)).toEqual(["alpha-wip", "zeta-old"]);
    expect(names("added")).toEqual(["alpha-wip", "hunter", "setting", "late", "zeta-old", "ls-done", "pool-done"]);
    expect(names("name")).toEqual(["alpha-wip", "late", "myhunter", "myls", "pool-done", "settingup", "zeta-old"].map((n) => ({ myhunter: "hunter", myls: "ls-done", settingup: "setting" })[n] ?? n));
    expect(names("status")).toEqual(["setting", "hunter", "alpha-wip", "late", "zeta-old", "ls-done", "pool-done"]);
    expect(names("module").slice(0, 3)).toEqual(["setting", "hunter", "ls-done"]);
  });
  it("is stable and never mutates its input", () => {
    const before = repos.map((r) => r.name);
    const twins = [repo({ name: "same", path: "/r/b" }), repo({ name: "same", path: "/r/a" })];
    expect(sortRepos(twins, "name", now).map((r) => r.path)).toEqual(["/r/a", "/r/b"]);
    expect(sortRepos(twins.reverse(), "smart", now).map((r) => r.path)).toEqual(["/r/a", "/r/b"]);
    expect(repos.map((r) => r.name)).toEqual(before);
  });
});

describe("clone targets", () => {
  const repos = [
    repo({ path: "/r/Tek/a", epitech: school }),
    repo({ path: "/r/Tek/b", epitech: school }),
    repo({ path: "/r/Misc/c", epitech: school }),
    repo({ path: "/r/Perso/d" }),
  ];
  it("lists roots and folders holding repositories", () => {
    expect(cloneTargets(repos, ["/r"])).toEqual(["/r", "/r/Misc", "/r/Perso", "/r/Tek"]);
  });
  it("picks the folder where most repositories of that kind live", () => {
    expect(preferredCloneDir(repos, true)).toBe("/r/Tek");
    expect(preferredCloneDir(repos, false)).toBe("/r/Perso");
    expect(preferredCloneDir([], true)).toBeNull();
  });
});

describe("format", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  it("timeAgo", () => {
    expect(timeAgo("2026-11-10T11:59:40Z", now)).toBe("à l'instant");
    expect(timeAgo("2026-11-10T11:15:00Z", now)).toBe("il y a 45 min");
    expect(timeAgo("2026-11-10T07:00:00Z", now)).toBe("il y a 5 h");
    expect(timeAgo("2026-11-09T07:00:00Z", now)).toBe("hier");
    expect(timeAgo("2026-11-03T12:00:00Z", now)).toBe("il y a 7 jours");
    expect(timeAgo("2026-08-01T12:00:00Z", now)).toBe("il y a 3 mois");
    expect(timeAgo(Math.floor(now.getTime() / 1000) - 7200, now)).toBe("il y a 2 h");
    expect(timeAgo("not a date", now)).toBe("");
  });
  it("tildify", () => {
    expect(tildify("/home/me/Documents/x", "/home/me")).toBe("~/Documents/x");
    expect(tildify("/home/meow/x", "/home/me")).toBe("/home/meow/x");
    expect(tildify("/opt/x", null)).toBe("/opt/x");
  });
  it("repo name helpers", () => {
    expect(repoNameFromUrl("git@github.com:Org/G-CPE-110-LYN-1-1-settingup-27.git")).toBe("G-CPE-110-LYN-1-1-settingup-27");
    expect(repoNameFromUrl("https://github.com/me/tool/")).toBe("tool");
    expect(repoNameFromUrl("")).toBe("");
    expect(looksLikeEpitech("G-CPE-110-LYN-1-1-settingup-27")).toBe(true);
    expect(looksLikeEpitech("B-PSU-200-PAR-2-1-my-top-3")).toBe(true);
    expect(looksLikeEpitech("tekcraft")).toBe(false);
  });
});

describe("closing hand-ins", () => {
  const now = new Date(2026, 10, 26, 12, 0);
  it("closes school work at its final date instead of counting days of lateness", () => {
    const r = repo({ epitech: school, meta: { deadline: "2026-10-02" } });
    const d = dueOf(r, now);
    expect(d.state).toBe("closed");
    expect(d.label).not.toMatch(/retard/);
    expect(d.tone).toBe("neutral");
  });

  it("keeps a personal date late for two weeks, then past", () => {
    expect(due("2026-11-20", null, now).state).toBe("overdue");
    expect(due("2026-11-01", null, now).state).toBe("closed");
    expect(due("2026-11-01", null, now).label).toMatch(/dépassé/);
  });

  it("tells closed from finished, recent from old, and results from none", () => {
    const recent = repo({ epitech: school, meta: { deadline: "2026-11-20", status: "in_progress" } });
    const old = repo({ epitech: school, meta: { deadline: "2026-06-20", status: "in_progress" } });
    const marked = repo({ epitech: school, meta: { deadline: "2026-11-20", status: "done" } });
    expect([phaseOf(recent, now), phaseOf(old, now), phaseOf(marked, now)]).toEqual(["awaiting", "closed", "done"]);
    const graded = repo({ epitech: school, meta: { deadline: "2026-11-20" }, my: { testsTotal: 12, testsPassed: 10 } as never });
    expect(phaseOf(graded, now)).toBe("evaluated");
  });

  it("puts what is due soon first and folds old work away", () => {
    const soon = repo({ path: "/a", epitech: school, meta: { deadline: "2026-11-27", status: "in_progress" } });
    const later = repo({ path: "/b", epitech: school, meta: { deadline: "2026-12-20", status: "in_progress" } });
    const old = repo({ path: "/c", epitech: school, meta: { deadline: "2026-03-01", status: "in_progress" } });
    const groups = groupRepos(sortRepos([old, later, soon], "smart", now), now);
    expect(groups.map((g) => g.id)).toEqual(["soon", "active", "past"]);
    expect(groups.find((g) => g.id === "past")!.folded).toBe(true);
    expect(deadlines([old, later, soon], now).map((d) => d.repo.path)).toEqual(["/a", "/b"]);
  });
});
