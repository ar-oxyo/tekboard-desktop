// Development only: demonstration data for the browser mock (see mockIPC.ts). Plausible
// values for a second-year student mid-semester; nothing here ever reaches a real build.
import type { BoardItem, EnvStatus, PlanState, RepoInfo, Settings } from "../lib/api";

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

export const fixtures: Record<string, Fixture> = {
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
  ui_prefs_get: {},
  brain_count: captures.length,
  brain_list: captures,
  plan_state: plan,
  recent_activity: [
    { id: 1, ts: now - 3 * H, kind: "commit", repoPath: repos[0].path, detail: "fix: handle empty PATH" },
    { id: 2, ts: now - 5 * H, kind: "test", repoPath: repos[1].path, detail: "12/20" },
  ],
  focus_get: null,
  live_state: null,
  my_status: { windowOpen: false, connected: true, expiresAt: now + 5 * D, account: "camille.martin@epitech.eu", sessionStored: true, windowHidden: true, syncMinutes: 30, lastSync: now - 40 * 60, routes: 9 },
};
