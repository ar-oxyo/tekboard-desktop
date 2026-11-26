// Development only: demonstration data for the browser mock (see mockIPC.ts). Plausible
// values for a second-year student mid-semester; nothing here ever reaches a real build.
import type { BoardItem, EnvStatus, PlanState, RepoInfo, Settings } from "../lib/api";
import { skillTree } from "./skilltreeFixture";
import { mouliReport, mouliSuite } from "./mouliFixture";
import { compareJob, drafts } from "./playgroundFixture";

type Fixture = unknown | ((args: Record<string, unknown>, params: URLSearchParams) => unknown);

const now = Math.floor(Date.now() / 1000);
const H = 3600;
const D = 24 * H;
const day = (offset: number) => {
  const d = new Date(Date.now() + offset * D * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const at = (offset: number, hour: number, min = 0) => {
  const d = new Date(Date.now() + offset * D * 1000);
  d.setHours(hour, min, 0, 0);
  return d;
};
const iso = (offset: number, hour: number, min = 0) => at(offset, hour, min).toISOString();
const unix = (offset: number, hour: number, min = 0) => Math.floor(at(offset, hour, min).getTime() / 1000);

const settings: Settings = {
  roots: ["/home/student/delivery"],
  cloneDir: "/home/student/delivery",
  ideCmd: "code",
  terminalCmd: "gnome-terminal",
  defaultTemplate: "c-minimal",
  glassEffects: false,
  theme: "aurora",
  foxSignals: true,
  onboarded: true,
  epitechDirs: ["/home/student/delivery"],
  claudePath: null,
  terminalRunCmd: "",
  mySyncMinutes: 30,
  myAutoReconnect: true,
  language: "fr",
  epitechOnly: false,
  onboardingStep: "done",
  updateCheck: true,
  captureShortcut: "",
  trayIcon: false,
};

const env: EnvStatus = {
  tools: [
    { name: "git", purpose: "Dépôts", path: "/usr/bin/git", version: "2.43.0", required: true },
    { name: "gh", purpose: "GitHub", path: "/usr/bin/gh", version: "2.45.0", required: false },
    { name: "gcc", purpose: "Compilation", path: "/usr/bin/gcc", version: "13.2.0", required: true },
    { name: "make", purpose: "Compilation", path: "/usr/bin/make", version: "4.3", required: true },
    { name: "valgrind", purpose: "Mémoire", path: "/usr/bin/valgrind", version: "3.22.0", required: false },
    { name: "bwrap", purpose: "Bac à sable", path: "/usr/bin/bwrap", version: "0.9.0", required: false },
  ],
  github: { state: "ready", login: "student-dev" },
  identity: { name: "Camille Martin", email: "camille.martin@example.org" },
  sshAgent: true,
};

function repo(name: string, code: string, opts: Partial<RepoInfo> & { deadlineIn?: number; dirty?: number; ahead?: number; tests?: [number, number]; progress?: RepoInfo["progress"]; fav?: boolean }): RepoInfo {
  const [module, unit] = code.split("/");
  const dl = opts.deadlineIn;
  return {
    path: `/home/student/delivery/${unit}/${name}`,
    name,
    group: unit,
    remoteUrl: `git@github.com:EpitechPromo2028/${module}-LYN-2-1-${name}-camille.martin.git`,
    remote: { host: "github.com", owner: "EpitechPromo2028", name: `${module}-LYN-2-1-${name}` },
    epitech: { module, unit, city: "LYN", project: name },
    status: { branch: "main", upstream: "origin/main", ahead: opts.ahead ?? 0, behind: 0, staged: 0, unstaged: opts.dirty ?? 0, untracked: 0, conflicted: 0, unborn: false },
    lastCommit: { hash: "a1b2c3d", subject: "fix: handle empty PATH", author: "Camille Martin", date: new Date((now - 3 * H) * 1000).toISOString() },
    error: null,
    meta: {
      favorite: opts.fav ?? false,
      archived: false,
      lastOpenedAt: now - 2 * H,
      deadline: dl === undefined ? null : day(dl),
      deadlineAt: dl === undefined ? null : iso(dl, 23, 42),
      deadlineSource: dl === undefined ? null : "my",
      status: null,
      kindOverride: null,
      myProjectId: null,
      runBin: null,
      runArgs: null,
      visibility: null,
    },
    addedAt: now - 20 * D,
    progress: opts.progress ?? "in_progress",
    progressInferred: true,
    kind: "epitech",
    kindReason: "nom Epitech",
    deadlineState: dl === undefined ? "unknown" : dl === 0 ? "today" : dl < 0 ? "overdue" : "upcoming",
    my:
      dl === undefined
        ? null
        : {
            id: 1000 + name.length,
            name,
            unitCode: module,
            unitName: null,
            start: day(dl - 21),
            end: day(dl),
            deadline: day(dl),
            deadlineAt: iso(dl, 23, 42),
            ongoing: true,
            url: null,
            group: ["camille.martin@epitech.eu"],
            matchedBy: "nom",
            testsPassed: opts.tests?.[0] ?? null,
            testsTotal: opts.tests?.[1] ?? null,
            quota: null,
            delivery: null,
            tooManyAbsences: false,
            nonCompliant: false,
          },
    duplicateOf: null,
    ...opts,
  };
}

const repos: RepoInfo[] = [
  repo("secured", "G-CPE-110/CPE", { deadlineIn: 2, dirty: 3, tests: [38, 42], fav: true }),
  repo("mysudo", "G-PSU-100/PSU", { deadlineIn: 3, ahead: 2, tests: [12, 20], fav: true }),
  repo("mytop", "G-SYN-100/SYN", { deadlineIn: 5, tests: [20, 20] }),
  repo("cuddle", "G-AIA-200/AIA", { deadlineIn: 12, progress: "todo" }),
  repo("myhunter", "G-MUL-100/MUL", { deadlineIn: -4, progress: "done", tests: [9, 10] }),
  repo("organized", "G-CPE-110/CPE", { progress: "done" }),
];

const plan: PlanState = {
  tasks: [
    { id: 1, title: "Corriger les tests de hash", notes: "", project: "secured", parentId: null, kind: "task", priority: 3, estimateMin: 90, dueDay: day(1), doneAt: null, createdAt: now - 2 * D },
    { id: 2, title: "Gestion des groupes (-g)", notes: "", project: "mysudo", parentId: null, kind: "task", priority: 2, estimateMin: 120, dueDay: day(2), doneAt: null, createdAt: now - 3 * D },
    { id: 3, title: "Lire le sujet de cuddle", notes: "", project: "cuddle", parentId: null, kind: "task", priority: 1, estimateMin: 30, dueDay: null, doneAt: null, createdAt: now - D },
    { id: 4, title: "Écrire le Makefile", notes: "", project: "mytop", parentId: null, kind: "task", priority: 1, estimateMin: 20, dueDay: null, doneAt: now - D, createdAt: now - 4 * D },
  ],
  events: [
    { id: 1, kind: "session", title: "secured · tests de hash", start: unix(0, 14), end: unix(0, 15, 30), allDay: false, project: "secured", taskId: 1, color: null, notes: "", origin: "auto", done: false, category: null },
    { id: 2, kind: "session", title: "mysudo · groupes", start: unix(0, 16, 30), end: unix(0, 18), allDay: false, project: "mysudo", taskId: 2, color: null, notes: "", origin: "me", done: false, category: null },
    { id: 3, kind: "event", title: "Kick-off cuddle", start: unix(1, 10), end: unix(1, 11), allDay: false, project: "cuddle", taskId: null, color: null, notes: "", origin: "me", done: false, category: null },
    { id: 4, kind: "session", title: "mytop · affichage", start: unix(-1, 9), end: unix(-1, 11), allDay: false, project: "mytop", taskId: null, color: null, notes: "", origin: "me", done: true, category: null },
  ],
  projects: [
    { key: "secured", priority: 3, estimateMin: 300, color: null, calendarHidden: false },
    { key: "mysudo", priority: 2, estimateMin: 480, color: null, calendarHidden: false },
  ],
  log: [{ id: 1, project: "mytop", taskId: null, title: "affichage", startedAt: unix(-1, 9), seconds: 6400 }],
};

const captures = [
  { id: 11, title: "Cache LRU pour mytop", text: "Cache LRU pour mytop", project: "mytop", kind: "idea", ctype: "idea", tags: ["perf"], pinned: false, archivedAt: null, doneAt: null, createdAt: now - 3 * H, updatedAt: null },
  { id: 12, title: "Segfault si PATH vide", text: "Segfault si PATH vide dans mysudo", project: "mysudo", kind: "idea", ctype: "bug", tags: [], pinned: true, archivedAt: null, doneAt: null, createdAt: now - D, updatedAt: null },
  { id: 13, title: "valgrind --leak-check=full ./secured", text: "valgrind --leak-check=full ./secured", project: null, kind: "snippet", ctype: "command", tags: [], pinned: false, archivedAt: null, doneAt: null, createdAt: now - 2 * D, updatedAt: null },
];

const board: BoardItem[] = repos
  .filter((r) => r.meta.deadline && r.progress !== "done")
  .map((r): BoardItem => ({ title: r.name, module: r.epitech?.module ?? null, repoPath: r.path, myId: r.my?.id ?? null, day: r.meta.deadline, at: r.meta.deadlineAt, source: "my" as const, state: r.deadlineState, status: r.progress, cloned: true, repoExpected: true, starts: null, myDay: null }))
  .concat([{ title: "Bootstrap 42sh", module: "G-PSU-200", repoPath: null, myId: 2001, day: day(9), at: iso(9, 23, 42), source: "my" as const, state: "upcoming" as const, status: "todo" as const, cloned: false, repoExpected: true, starts: day(1), myDay: null }]);

const agenda = {
  items: [
    { kind: "activity", title: "Follow-up CPE", day: day(1), start: iso(1, 14), end: iso(1, 15), module: "G-CPE-110", detail: "Salle 2", mine: true, mandatory: true, exam: false, repoPath: null, until: null, status: "registered", eventId: 501, projectKey: null },
    { kind: "activity", title: "Keynote PSU", day: day(0), start: iso(0, 10), end: iso(0, 11), module: "G-PSU-100", detail: "Amphi", mine: true, mandatory: true, exam: false, repoPath: null, until: null, status: "registered", eventId: 502, projectKey: null },
  ],
  syncedAt: now - 40 * 60,
  modules: ["G-CPE-110", "G-PSU-100", "G-SYN-100", "G-AIA-200", "G-MUL-100"],
  notes: [],
  peerTodo: [],
};

const weekStart = (back: number) => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - back * 7);
  return d;
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const logtime = {
  goalHours: 30,
  weeks: [0, 1, 2, 3, 4, 5].map((w) => {
    const s = weekStart(w);
    const e = new Date(s);
    e.setDate(s.getDate() + 6);
    const days = w === 0 ? [21600, 25200, 18000, 0, 0, 0, 0] : [25200, 28800, 21600, 25200, 14400, 3600, 0].map((x) => x - w * 900);
    return { start: ymd(s), end: ymd(e), seconds: days.reduce((a, b) => a + b, 0), days, promoSeconds: 26 * 3600 };
  }),
  lastDay: day(0),
  fetchedAt: now - 40 * 60,
  unavailable: null,
  today: day(0),
  weekday: (new Date().getDay() + 6) % 7,
};
const days = Array.from({ length: 120 }, (_, i) => ({ date: day(-119 + i), count: (i * 7919) % 11 > 6 ? ((i * 31) % 9) : 0 }));
const analytics = {
  myEmails: ["camille.martin@example.org"],
  totalCommits: 412,
  myCommits: 351,
  days,
  activeDays: days.filter((d) => d.count > 0).length,
  currentStreak: 4,
  longestStreak: 11,
  lastCommit: new Date((now - 3 * H) * 1000).toISOString(),
  byHour: [0, 0, 0, 0, 0, 0, 0, 1, 3, 9, 14, 18, 8, 6, 19, 24, 21, 17, 12, 9, 15, 22, 13, 4],
  byWeekday: [62, 71, 58, 66, 49, 23, 22],
  monthly: [0, 1, 2, 3, 4, 5].map((m) => ({ date: day(-30 * (5 - m)).slice(0, 7) + "-01", count: [31, 48, 66, 72, 81, 53][m] })),
  repos: repos.slice(0, 5).map((r, i) => ({ path: r.path, name: r.name, mine: [96, 71, 64, 12, 108][i], others: [14, 0, 22, 0, 31][i], contributors: [{ name: "Camille Martin", commits: [96, 71, 64, 12, 108][i], me: true }], first: day(-90 + i * 9), last: day(-i) })),
  languages: [{ name: "C", files: 214, lines: 18420 }, { name: "Makefile", files: 12, lines: 610 }, { name: "Python", files: 9, lines: 980 }, { name: "Shell", files: 5, lines: 140 }],
  soloRepos: 3,
  sharedRepos: 2,
};
const connect = {
  enabled: true,
  running: true,
  fp: "a1b2c3d4e5f60718",
  short: "a1b2-c3d4",
  profile: { nick: "Camille", avatar: "fox", status: "available" },
  ip: "192.168.1.24",
  port: 47310,
  interface: "wlp2s0",
  invite: null,
  mdns: true,
  peers: [
    { fp: "f00dbabe00112233", short: "f00d-babe", profile: { nick: "Léo", avatar: "owl", status: "available" }, online: true, discovered: true, trusted: true, blocked: false, addr: "192.168.1.31:47310", app: "0.9.0", since: now - 20 * D, lastSeen: now - 60 },
    { fp: "c0ffee0044556677", short: "c0ff-ee00", profile: { nick: "Inès", avatar: "cat", status: "coding" }, online: false, discovered: false, trusted: true, blocked: false, addr: null, app: "0.8.0", since: now - 40 * D, lastSeen: now - 2 * D },
  ],
  requests: [],
  problems: [],
  space: true,
};

const local = (offset: number, hour: number, min = 0) => {
  const d = at(offset, hour, min);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const session = (offset: number, h: number, len: number, title: string) => ({ type: "create_session" as const, project: repos[0]?.path ?? null, title, start: local(offset, h), end: local(offset, h + Math.floor(len / 60), len % 60) });
const weekProposal = {
  id: 1,
  threadId: null,
  kind: "schedule",
  title: "Planning · semaine",
  rationale: "Priorité aux rendus les plus proches.",
  payload: {
    actions: [session(1, 9, 120, "Secured : table de hachage"), session(1, 14, 90, "Secured : tests"), session(2, 10, 150, "my_sudo : parsing"), session(3, 9, 120, "Secured : collisions"), session(3, 16, 60, "Maths : 104neutrinos"), session(4, 13, 180, "my_sudo : droits"), { type: "create_task" as const, project: null, title: "Relire le sujet de my_sudo" }],
    warnings: ["Sans créneau : Wolf3D (4 h)"],
  },
  status: "pending",
  outcome: null,
  at: now - 60,
};

export const fixtures: Record<string, Fixture> = {
  my_overview: { syncedAt: now - 40 * 60, account: "camille.martin@epitech.eu", projects: [], creditsAcquired: 12, creditsTotal: 60, blocks: [], exams: [] },
  my_logtime: logtime,
  my_skill_tree: skillTree,
  // ?drafts=1: two Playground drafts; comparing them gives a finished job.
  playground_list: (_a: Record<string, unknown>, p: URLSearchParams) => (p.has("drafts") ? drafts : []),
  playground_tools: { compilers: [{ name: "gcc", path: "/usr/bin/gcc", version: "14.2" }, { name: "clang", path: "/usr/bin/clang", version: "19.1" }], valgrind: "3.24", sandbox: "bwrap 0.11", cgroupLimits: true },
  playground_save: (a: Record<string, unknown>) => ({ ...drafts[0], id: a.id, title: a.title, files: a.files, settings: a.settings }),
  playground_compare: 77,
  job_get: (a: Record<string, unknown>) => (a.id === 77 ? compareJob : null),
  // ?mouli=1: a plan and a report of the TekBoard moulinette.
  mouli_state: (_a: Record<string, unknown>, p: URLSearchParams) => (p.has("mouli") ? { suite: mouliSuite, report: mouliReport } : { suite: null, report: null }),
  testing_info: { detection: { suites: [], frameworks: ["Criterion"], testFiles: 2, notes: [] }, config: { testCmd: null, runCmd: null, image: null }, defaultBuild: "make", claude: { path: null, target: null, version: null, state: "not_found", source: null, detail: null }, banana: { repoChecker: null, version: null, epiclang: null, plugin: false }, docker: false, valgrind: true, terminal: true, defaultImage: "epitechcontent/epitest-docker", subject: "secured.pdf", hasRemote: true },
  credit_scenario_save: (a: Record<string, unknown>) => ({ id: typeof a.id === "number" ? a.id : 1, name: a.name, data: a.data, updatedAt: now }),
  // ?proposal=1 shows a week plan waiting in Artix's panel (with ?open=artix).
  ai_proposals: (_a: Record<string, unknown>, p: URLSearchParams) => (p.has("proposal") ? [weekProposal] : []),
  analytics,
  connect_state: connect,
  git_detail: (a: Record<string, unknown>) => {
    const r = repos.find((x) => x.path === a.path) ?? repos[0];
    const c = (hash: string, subject: string, h: number) => ({ hash, subject, author: "Camille Martin", date: new Date((now - h * H) * 1000).toISOString() });
    return {
      status: r.status,
      changes: [
        { path: "src/hash.c", staged: null, unstaged: "M", untracked: false, conflicted: false },
        { path: "include/secured.h", staged: "M", unstaged: null, untracked: false, conflicted: false },
        { path: "tests/test_hash.c", staged: null, unstaged: null, untracked: true, conflicted: false },
      ],
      branches: [{ name: "main", current: true, upstream: "origin/main" }, { name: "feature/resize", current: false, upstream: null }],
      log: [c("a1b2c3d", "fix: handle empty PATH", 3), c("b2c3d4e", "feat: resize table when full", 26), c("c3d4e5f", "test: collisions on small tables", 50), c("d4e5f6a", "chore: Makefile rules", 75)],
      outgoing: r.status?.ahead ? [c("e5f6a7b", "wip: groups", 1)] : [],
      incoming: [],
    };
  },
  project_get: (a: Record<string, unknown>) => {
    const r = repos.find((x) => x.path === a.path) ?? repos[0];
    return { deadline: r.meta.deadline, deadlineAt: r.meta.deadlineAt, deadlineSource: r.meta.deadlineSource, buildCmd: "make re", notes: "Tests de hash à corriger avant jeudi.\n- vérifier les collisions\n- valgrind propre", runBin: null, runArgs: null };
  },
  project_run_info: { configured: null, detected: "secured", detectedFrom: "Makefile", effective: "secured", exists: true, args: null, terminal: false },
  deadline_board: board,
  my_agenda: agenda,
  startup: (_a: Record<string, unknown>, p: URLSearchParams) => ({ page: p.get("page"), sheet: p.get("sheet"), theme: p.get("theme"), repo: p.get("repo"), pick: null, tool: null, run: null, report: null, anchor: null }),
  get_settings: (_a: Record<string, unknown>, p: URLSearchParams) => ({ ...settings, onboarded: !p.has("onboarding"), theme: p.get("theme") ?? settings.theme }),
  save_settings: (a: Record<string, unknown>) => a.settings ?? settings,
  env_status: env,
  scan_repos: repos,
  // ?night=1: working hours 09:00 → 02:00 the next day.
  ui_prefs_get: (_a: Record<string, unknown>, p: URLSearchParams) => (p.has("night") ? { "plan.prefs": { dayStart: 540, dayEnd: 1560, workDays: [1, 2, 3, 4, 5], maxMinutesPerDay: 300, sessionMinutes: 75, breakMinutes: 15, mode: "custom", protected: [[750, 810]] } } : {}),
  brain_count: captures.length,
  brain_list: captures,
  plan_state: plan,
  recent_activity: [
    { id: 1, ts: now - 3 * H, kind: "commit", repoPath: repos[0].path, detail: "fix: handle empty PATH" },
    { id: 2, ts: now - 5 * H, kind: "test", repoPath: repos[1].path, detail: "12/20" },
  ],
  focus_get: null,
  // ?live=1: a TekLive session running (the usual port was taken).
  live_state: (_a: Record<string, unknown>, p: URLSearchParams) =>
    p.has("live") ? { project: repos[0]?.path ?? "/p", name: "secured", state: "live", server: "ws://192.168.1.42:41873", link: "p2p-live-share://ws.k3f9.192.168.1.42:41873/", room: "k3f9", peers: ["host", "g1"], guests: ["192.168.1.57"], refused: 0, startedAt: now - 754, contactsOnly: true, showProject: true, invited: [], interface: "wlp2s0", note: "Le port 8765 est déjà utilisé sur cette machine : TekLive écoute sur le port 41873." } : null,
  live_setup: { code: "/usr/bin/code", codeVersion: "1.106.2", extension: "0.1.4", bridge: "1.0.0", missing: [] },
  live_interfaces: [{ name: "wlp2s0", ip: "192.168.1.42", kind: "wifi", default: true }, { name: "enp3s0", ip: "10.0.0.12", kind: "ethernet", default: false }],
  my_status: { windowOpen: false, connected: true, expiresAt: now + 5 * D, account: "camille.martin@epitech.eu", sessionStored: true, windowHidden: true, syncMinutes: 30, lastSync: now - 40 * 60, routes: 9 },
};
