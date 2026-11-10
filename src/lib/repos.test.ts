import { describe, expect, it } from "vitest";
import type { RepoInfo, RepoStatus } from "./api";
import { attention, cloneTargets, currentFocus, daysLeft, deadlineLabel, deadlines, displayName, filterRepos, preferredCloneDir } from "./repos";
import { looksLikeEpitech, repoNameFromUrl, tildify, timeAgo } from "./format";

const clean: RepoStatus = { branch: "main", upstream: "origin/main", ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, unborn: false };

function repo(over: Omit<Partial<RepoInfo>, "status"> & { status?: Partial<RepoStatus> | null }): RepoInfo {
  const { status, ...rest } = over;
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
    meta: { favorite: false, archived: false, lastOpenedAt: null, deadline: null },
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
    expect(a.map((x) => x.label)).toEqual(["1 conflict", "3 uncommitted", "3 to push", "1 to pull"]);
  });
  it("flags an unpublished branch only when a remote exists", () => {
    expect(attention(repo({ status: { upstream: null } })).map((x) => x.label)).toEqual(["Branch not published"]);
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
    repo({ name: "tekcraft", group: "Perso", status: { unstaged: 1 }, meta: { favorite: true, archived: false, lastOpenedAt: null, deadline: null } }),
  ];
  it("filters by kind", () => {
    expect(filterRepos(repos, "", "school").map((r) => r.name)).toEqual(["G-CPE-110-LYN-1-1-settingup-27"]);
    expect(filterRepos(repos, "", "personal").map((r) => r.name)).toEqual(["tekcraft"]);
    expect(filterRepos(repos, "", "changes").map((r) => r.name)).toEqual(["tekcraft"]);
    expect(filterRepos(repos, "", "favorites").map((r) => r.name)).toEqual(["tekcraft"]);
  });
  it("matches every word, case-insensitively", () => {
    expect(filterRepos(repos, "cpe SETTING", "all")).toHaveLength(1);
    expect(filterRepos(repos, "perso tek", "all").map((r) => r.name)).toEqual(["tekcraft"]);
    expect(filterRepos(repos, "nothing", "all")).toHaveLength(0);
  });
});

describe("currentFocus", () => {
  it("prefers the last project opened in TekBoard", () => {
    const a = repo({ name: "a", lastCommit: { hash: "1", subject: "s", author: "me", date: "2026-11-09T10:00:00+01:00" } });
    const b = repo({ name: "b", meta: { favorite: false, archived: false, lastOpenedAt: 50, deadline: null } });
    const c = repo({ name: "c", meta: { favorite: false, archived: false, lastOpenedAt: 90, deadline: null } });
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
  const meta = (deadline: string | null, archived = false) => ({ favorite: false, archived, lastOpenedAt: null, deadline });
  it("counts whole local days", () => {
    expect(daysLeft("2026-11-10", now)).toBe(0);
    expect(daysLeft("2026-11-11", now)).toBe(1);
    expect(daysLeft("2026-11-08", now)).toBe(-2);
    expect(daysLeft("2026-12-01", now)).toBe(21);
    expect(daysLeft("soon", now)).toBeNull();
  });
  it("labels", () => {
    expect([-3, -1, 0, 1, 5].map(deadlineLabel)).toEqual(["3 days late", "1 day late", "today", "tomorrow", "in 5 days"]);
  });
  it("lists unfinished projects by urgency", () => {
    const list = deadlines([repo({ name: "later", meta: meta("2026-11-20") }), repo({ name: "late", meta: meta("2026-11-09") }), repo({ name: "done", meta: meta("2026-11-11", true) }), repo({ name: "none" })], now);
    expect(list.map((d) => d.repo.name)).toEqual(["late", "later"]);
  });
  it("finished projects leave the working lists and the focus", () => {
    const done = repo({ name: "done", meta: { favorite: false, archived: true, lastOpenedAt: 99, deadline: null } });
    const live = repo({ name: "live" });
    expect(filterRepos([done, live], "", "all").map((r) => r.name)).toEqual(["live"]);
    expect(filterRepos([done, live], "", "done").map((r) => r.name)).toEqual(["done"]);
    expect(currentFocus([done, live])?.name).toBe("live");
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
    expect(timeAgo("2026-11-10T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-11-10T11:15:00Z", now)).toBe("45 min ago");
    expect(timeAgo("2026-11-10T07:00:00Z", now)).toBe("5 h ago");
    expect(timeAgo("2026-11-09T07:00:00Z", now)).toBe("yesterday");
    expect(timeAgo("2026-11-03T12:00:00Z", now)).toBe("7 days ago");
    expect(timeAgo("2026-08-01T12:00:00Z", now)).toBe("3 months ago");
    expect(timeAgo(Math.floor(now.getTime() / 1000) - 7200, now)).toBe("2 h ago");
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
