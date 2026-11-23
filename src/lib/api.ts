// Typed access to the Rust backend. This file is the only place that calls `invoke`.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { afterCommand } from "./sync";

/** Every call goes through here: a write that succeeded refreshes what depends on it. */
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const r = await tauriInvoke<T>(command, args);
  afterCommand(command);
  return r;
}

export interface AppError {
  code: string;
  message: string;
}

export function asAppError(e: unknown): AppError {
  if (e && typeof e === "object" && "message" in e) {
    const o = e as { code?: unknown; message: unknown };
    return { code: typeof o.code === "string" ? o.code : "unknown", message: String(o.message) };
  }
  return { code: "unknown", message: String(e) };
}

export interface Settings {
  roots: string[];
  cloneDir: string | null;
  ideCmd: string;
  terminalCmd: string;
  defaultTemplate: string | null;
  glassEffects: boolean;
  theme: string;
  foxSignals: boolean;
  onboarded: boolean;
  epitechDirs: string[];
  claudePath: string | null;
  terminalRunCmd: string;
  mySyncMinutes: number;
  myAutoReconnect: boolean;
}

export interface RootSuggestion {
  path: string;
  repoCount: number;
  recommended: boolean;
}

export interface EpitechName {
  module: string;
  unit: string;
  city: string;
  project: string;
}

export interface RemoteRef {
  host: string;
  owner: string;
  name: string;
}

export interface RepoStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  unborn: boolean;
}

export interface Commit {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export type Progress = "todo" | "in_progress" | "done";
export type DeadlineState = "upcoming" | "today" | "overdue" | "unknown";
export type RepoKind = "epitech" | "personal";
export interface RepoMeta {
  favorite: boolean;
  archived: boolean;
  lastOpenedAt: number | null;
  /** Hand-in day, local time (`YYYY-MM-DD`). */
  deadline: string | null;
  /** Hand-in instant (RFC 3339) when the hour is known. */
  deadlineAt: string | null;
  deadlineSource: "manual" | "my" | null;
  status: Progress | null;
  kindOverride: RepoKind | null;
  myProjectId: number | null;
  runBin: string | null;
  runArgs: string | null;
}
/** What MY Epitech says about the project behind a repository. */
export interface MyLink {
  id: number;
  name: string;
  unitCode: string;
  unitName: string | null;
  start: string | null;
  end: string | null;
  deadline: string | null;
  deadlineAt: string | null;
  ongoing: boolean;
  url: string | null;
  group: string[];
  matchedBy: string;
  testsPassed: number | null;
  testsTotal: number | null;
  /** Moulinette runs of the group: [total, remaining], when the project has a quota. */
  quota: [number, number] | null;
  /** Last revision the group pushed: what a moulinette run would test. */
  delivery: { commit: string; branch: string | null; pushedAt: string | null } | null;
  tooManyAbsences: boolean;
  nonCompliant: boolean;
}

export interface RepoInfo {
  path: string;
  name: string;
  group: string;
  remoteUrl: string | null;
  remote: RemoteRef | null;
  epitech: EpitechName | null;
  status: RepoStatus | null;
  lastCommit: Commit | null;
  error: string | null;
  meta: RepoMeta;
  /** When the folder appeared on this computer (unix seconds). */
  addedAt: number | null;
  /** Where the project stands (`status` is git's). */
  progress: Progress;
  /** Not chosen by the user: follows the hand-in date and recent activity. */
  progressInferred: boolean;
  kind: RepoKind;
  kindReason: string;
  deadlineState: DeadlineState;
  my: MyLink | null;
}
/** One line of the dashboard's deadlines: a repository, or a MY Epitech project not cloned yet. */
export interface BoardItem {
  title: string;
  module: string | null;
  repoPath: string | null;
  myId: number | null;
  day: string | null;
  at: string | null;
  source: "manual" | "my" | null;
  state: DeadlineState;
  status: Progress;
  cloned: boolean;
  repoExpected: boolean;
  starts: string | null;
  myDay: string | null;
}
export interface BinaryInfo {
  configured: string | null;
  detected: string | null;
  detectedFrom: string | null;
  effective: string | null;
  exists: boolean;
  args: string | null;
  terminal: boolean;
}
export interface ClaudeInfo {
  path: string | null;
  target: string | null;
  version: string | null;
  state: "ready" | "not_found" | "not_executable" | "version_failed";
  source: "settings" | "path" | "user" | "shell" | null;
  detail: string | null;
}
export interface ClaudeReport extends ClaudeInfo {
  configured: string | null;
  appPath: string[];
  shellPath: string[];
  shell: string | null;
}
export interface ClaudeCheck {
  ok: boolean;
  answer: string | null;
  error: string | null;
  costUsd: number | null;
  durationMs: number;
}

export type GhStatus =
  | { state: "missing" }
  | { state: "loggedOut" }
  | { state: "ready"; login: string | null }
  | { state: "error"; message: string };

export interface Tool {
  name: string;
  purpose: string;
  path: string | null;
  version: string | null;
  required: boolean;
}

export interface EnvStatus {
  tools: Tool[];
  github: GhStatus;
  identity: { name: string | null; email: string | null };
  sshAgent: boolean;
}

export interface RemoteRepo {
  name: string;
  fullName: string;
  owner: string;
  sshUrl: string;
  createdAt: string;
  pushedAt: string | null;
  private: boolean;
  archived: boolean;
  fork: boolean;
}

export type Confidence = "high" | "medium" | "low";

export interface Candidate {
  repo: RemoteRepo;
  epitech: EpitechName | null;
  score: number;
  confidence: Confidence;
  reasons: string[];
}

export interface CloneOutcome {
  path: string;
  alreadyPresent: boolean;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  kind: string;
  builtin: boolean;
  created: string;
  fileCount: number;
  variables: string[];
  path: string;
}

export interface TemplateFile {
  rel: string;
  size: number;
  text: boolean;
}

export interface FilePreview {
  text: string | null;
  size: number;
  truncated: boolean;
}

export type PlanAction = "add" | "identical" | "conflict" | "blocked";

export interface PlanEntry {
  source: string;
  dest: string;
  action: PlanAction;
  size: number;
}

export interface ApplyReport {
  written: string[];
  overwritten: string[];
  skipped: string[];
  backupDir: string | null;
}

export interface Activity {
  id: number;
  ts: number;
  kind: string;
  repoPath: string | null;
  detail: string | null;
}

export type Vars = Record<string, string>;

export interface ProjectSheet {
  deadline: string | null;
  deadlineAt: string | null;
  deadlineSource: "manual" | "my" | null;
  buildCmd: string | null;
  notes: string;
  runBin: string | null;
  runArgs: string | null;
}
/** What the sheet sends back: a local day, optionally with a local `HH:MM`. */
export interface SheetInput {
  deadline: string | null;
  deadlineTime: string | null;
  buildCmd: string | null;
  notes: string;
  runBin: string | null;
  runArgs: string | null;
}

export interface RunReport {
  code: number | null;
  output: string;
  timedOut: boolean;
  durationMs: number;
}

export interface Subject {
  id: number;
  name: string;
  file: string;
  hash: string;
  size: number;
  repoPath: string | null;
  addedAt: number;
}

export interface SubjectCandidate {
  path: string;
  name: string;
  size: number;
  modified: number;
  suggestedRepo: string | null;
  inLibrary: boolean;
}

export interface Change {
  path: string;
  staged: string | null;
  unstaged: string | null;
  untracked: boolean;
  conflicted: boolean;
}

export interface Branch {
  name: string;
  current: boolean;
  upstream: string | null;
}

export interface GitDetail {
  status: RepoStatus;
  changes: Change[];
  branches: Branch[];
  log: Commit[];
  outgoing: Commit[];
  incoming: Commit[];
}

export interface DayCount {
  date: string;
  count: number;
}

export interface RepoStat {
  path: string;
  name: string;
  mine: number;
  others: number;
  contributors: Array<{ name: string; commits: number; me: boolean }>;
  first: string | null;
  last: string | null;
}

export interface Analytics {
  myEmails: string[];
  totalCommits: number;
  myCommits: number;
  days: DayCount[];
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  lastCommit: string | null;
  byHour: number[];
  byWeekday: number[];
  monthly: DayCount[];
  repos: RepoStat[];
  languages: Array<{ name: string; files: number; lines: number }>;
  soloRepos: number;
  sharedRepos: number;
}

export interface Companion {
  enabled?: boolean | null;
  outfits?: boolean | null;
  weatherOutfits?: boolean | null;
  season?: string | null;
  scale?: number | null;
  speed?: number | null;
  water?: number | null;
  birdEvery?: number | null;
}

export interface CozyStatus {
  installed: boolean;
  widgetsPath: string;
  companion: Companion;
  backups: string[];
}

export interface SubjectImportResult {
  path: string;
  subject: Subject | null;
  duplicate: boolean;
  error: string | null;
}

// ── Library manager
export interface Library {
  id: number;
  name: string;
  path: string;
  createdAt: number;
}
export type DepKind = "detected" | "ambiguous" | "declared";
export interface LibDep {
  rel: string;
  via: string[];
  kind: DepKind;
}
export interface CatalogFunction {
  name: string;
  signature: string;
  line: number;
  doc: string | null;
  header: string | null;
}
export interface CatalogFile {
  rel: string;
  category: string;
  isHeader: boolean;
  functions: CatalogFunction[];
  staticFunctions: string[];
  headers: string[];
  deps: LibDep[];
  description: string | null;
  tags: string[];
  autoTags: string[];
  declaredDeps: string[];
  lines: number;
  hash: string;
  parseErrors: boolean;
}
export interface Catalog {
  library: Library;
  files: CatalogFile[];
  hasMakefile: boolean;
  duplicates: Array<{ name: string; files: string[] }>;
  cycles: string[][];
}
export interface LibMeta {
  description: string | null;
  tags: string[];
  deps: string[];
}
export interface LibPreset {
  id: number;
  name: string;
  files: string[];
}
export type LibFileState = "absent" | "installed" | "update" | "modified" | "modified_update" | "differs" | "managed" | "custom";
export interface LibProjectStatus {
  libDir: string;
  exists: boolean;
  hasMakefile: boolean;
  files: Array<{ rel: string; state: LibFileState }>;
  extra: string[];
}
export interface LibPlanRequest {
  libDir: string;
  add: string[];
  remove: string[];
  replace: string[];
  exclude: string[];
  init: boolean;
}
export interface LibPlanAction {
  path: string;
  rel: string;
  op: "create" | "overwrite" | "edit" | "delete" | "keep";
  what: "source" | "header" | "makefile";
  reason: string;
  diff: string | null;
  risky: boolean;
}
export interface LibRequired {
  rel: string;
  neededBy: string;
  via: string[];
  kind: DepKind;
}
export interface LibPlan {
  libDir: string;
  actions: LibPlanAction[];
  required: LibRequired[];
  warnings: string[];
}
export interface LibApplyReport {
  written: string[];
  deleted: string[];
  skipped: string[];
  backupDir: string | null;
}
export interface ImportCandidate {
  source: string;
  name: string;
  isHeader: boolean;
  functions: string[];
  staticFunctions: string[];
  suggestedDir: string;
  suggestionReason: string;
  alreadyDefined: Array<{ name: string; files: string[] }>;
  undeclared: string[];
  parseErrors: boolean;
}
export interface ImportAnalysis {
  candidates: ImportCandidate[];
  dirs: string[];
  headers: string[];
  existing: string[];
  ignored: string[];
}
export interface LibImportReport {
  imported: string[];
  unchanged: string[];
  conflicts: string[];
  prototypesAdded: string[];
  header: string | null;
}

// ── Jobs, tests, checks
export type StepStatus = "pending" | "running" | "success" | "warning" | "failed" | "skipped" | "cancelled";
export type JobStatus = "running" | "success" | "warning" | "failed" | "cancelled" | "interrupted";
export interface JobStep {
  id: string;
  label: string;
  status: StepStatus;
  detail: string | null;
  durationMs: number | null;
}
export type RunKind = "tests" | "testrepo" | "banana" | "moulinette" | "gen_tests" | "readme" | "build" | "command" | "analysis" | "assistant";
/** Kind-specific facts; see the Rust module that produces each kind. */
export type RunSummary = Record<string, unknown> & { steps?: JobStep[] };
export interface JobView {
  id: number;
  kind: RunKind;
  repo: string | null;
  title: string;
  status: JobStatus;
  steps: JobStep[];
  log: string;
  startedAt: number;
  durationMs: number;
  summary: RunSummary;
  runId: number | null;
  /** Structured activity: tool calls of an agent, checks, phases. */
  events: JobEvent[];
  /** Bytes ever written to the log (for delta reads). */
  logTotal: number;
  /** In a delta read: the log was trimmed, `log` is the whole log. */
  logReset: boolean;
  /** In a delta read: index of the first entry of `events`. */
  eventsFrom: number;
}
/** One entry of a job's activity feed. `kind: "tool"` entries come from real tool calls. */
export interface JobEvent {
  kind: "tool" | "text" | "check" | "phase" | string;
  id?: string;
  tool?: string;
  label?: string;
  detail?: string;
  status?: "running" | "ok" | "error" | string;
  result?: string;
  text?: string;
  at?: number;
  [k: string]: unknown;
}
export interface Run {
  id: number;
  kind: RunKind;
  repoPath: string | null;
  startedAt: number;
  durationMs: number;
  status: JobStatus;
  title: string;
  summary: RunSummary;
  log: string | null;
}
export interface TestSuite {
  id: string;
  kind: "make" | "ctest" | "script";
  label: string;
  command: string;
  note: string | null;
  trusted: boolean;
}
export interface ProjectConfig {
  testCmd: string | null;
  runCmd: string | null;
  image: string | null;
}
export interface TestingInfo {
  detection: { suites: TestSuite[]; frameworks: string[]; testFiles: number; notes: string[] };
  config: ProjectConfig;
  defaultBuild: string;
  claude: ClaudeInfo;
  banana: { repoChecker: string | null; version: string | null; epiclang: string | null; plugin: boolean };
  docker: boolean;
  valgrind: boolean;
  terminal: boolean;
  defaultImage: string;
  subject: string | null;
  hasRemote: boolean;
}
export interface TestRepoParams {
  mode: "snapshot" | "remote";
  rev: string | null;
  build: string;
  tests: string | null;
  isolation: "none" | "docker";
  image: string | null;
}
export interface MoulinetteParams {
  build: string;
  tests: string | null;
  memoryRun: string | null;
  subjectAi: boolean;
}
export interface TestEnv {
  name: string;
  path: string;
  createdAt: number;
  size: number;
}
export interface ClaudeBrief {
  plan: { available: boolean; version: string | null; argv: string[]; canRead: string; canWrite: string; cannot: string; account: string };
  prompt: string;
}
export interface PackOptions {
  mode: "source" | "full" | "context";
  exclude: string[];
  include: string[];
}
export interface PackEntry {
  path: string;
  size: number;
  included: boolean;
  reason: string;
  sensitive: boolean;
}
export interface PackPreview {
  mode: string;
  entries: PackEntry[];
  included: number;
  includedSize: number;
  sensitive: number;
  skippedDirs: string[];
  truncated: boolean;
}
export interface ReadmeDraft {
  proposed: string;
  current: string | null;
  currentHash: string | null;
  diff: string;
  missing: string[];
}

// ── Prompts
export interface PromptVar {
  name: string;
  description: string;
  sample: string;
  required: boolean;
}
export interface PromptPreset {
  name: string;
  body: string;
  updatedAt: number;
  problem: string | null;
}
export interface PromptDef {
  id: string;
  title: string;
  description: string;
  access: string;
  expects: string;
  default: string;
  vars: PromptVar[];
  presets: PromptPreset[];
  /** Variant in use; `null` = the default. */
  active: string | null;
}
export interface PromptPreview {
  text: string;
  variables: Array<[string, "project" | "sample", number]>;
  error: string | null;
  warnings: string[];
}
// ── MY Epitech
export interface MyStatus {
  windowOpen: boolean;
  connected: boolean;
  expiresAt: number | null;
  account: string | null;
  sessionStored: boolean;
  windowHidden: boolean;
  syncMinutes: number;
  lastSync: number | null;
  routes: number;
}
export interface MyEntry {
  route: string;
  label: string;
  fetchedAt: number;
  status: number;
  size: number;
  body: unknown;
}
export interface MyProject {
  id: number;
  name: string;
  unitCode: string;
  unitName: string | null;
  start: string | null;
  end: string | null;
  deadline: string | null;
  deadlineAt: string | null;
  ongoing: boolean;
  upcoming: boolean;
  groupMax: number | null;
  group: string[];
  groupName: string | null;
  repoEnabled: boolean | null;
  url: string | null;
  repoPath: string | null;
  matchedBy: string | null;
  repoDeadline: string | null;
  repoDeadlineSource: "manual" | "my" | null;
  activities: Array<{ name: string; start: string | null; end: string | null; mandatory: boolean; status: string | null }>;
  lastTest: {
    date: string | null;
    commit: string | null;
    passed: number | null;
    total: number | null;
    flags: string[];
    styleFatal: number;
    styleMajor: number;
    styleMinor: number;
    styleInfo: number;
    failingSkills: Array<[string, number, number]>;
    repoLink: string | null;
    runs: number;
  } | null;
}
export interface MyOverview {
  syncedAt: number | null;
  account: string | null;
  projects: MyProject[];
  creditsAcquired: number | null;
  creditsTotal: number | null;
  blocks: Array<{ title: string; grade: string | null; credits: number | null; validated: number; total: number }>;
  exams: Array<{ label: string; best: number | null; required: number | null; max: number | null }>;
}
export interface AgendaItem {
  kind: "deadline" | "start" | "activity" | "event" | "holiday";
  title: string;
  day: string;
  start: string | null;
  end: string | null;
  module: string | null;
  detail: string | null;
  mine: boolean;
  mandatory: boolean;
  exam: boolean;
  repoPath: string | null;
  until: string | null;
  /** Your attendance: `registered`, `not_registered`, `absent`, `present`… */
  status: string | null;
  /** MY Epitech session id. */
  eventId: number | null;
}
export interface Agenda {
  items: AgendaItem[];
  syncedAt: number | null;
  modules: string[];
  notes: string[];
  /** Peer evaluations assigned to you, not submitted yet. */
  peerTodo: string[];
}
export interface Academic {
  syncedAt: number | null;
  creditsAcquired: number | null;
  creditsTotal: number | null;
  semester: number | null;
  units: Array<{ title: string; grade: string | null; credits: number | null; validated: number; total: number; countsInGpa: boolean | null; alert: string | null; outcomes: Array<{ title: string; validated: boolean; mandatory: boolean; points: number | null; total: number | null }> }>;
  competencies: Array<{ name: string; available: number | null; secure: number | null; reachable: number | null; alert: string | null }>;
  exams: Array<{ label: string; best: number | null; required: number | null; max: number | null }>;
  marks: Array<{ date: string | null; title: string; mark: number | null; evaluator: string | null; comment: string | null }>;
  logtime: Array<{ date: string; mine: number; promo: number | null }>;
  tests: Array<{ project: string; module: string; date: string | null; passed: number; total: number; runs: number; styleMajor: number; styleMinor: number }>;
  graph: Array<[string, string, number]>;
  globalAlert: string | null;
  creditsAlert: string | null;
  creditsLost: Array<[string, number]>;
  creditsAtRisk: Array<[string, number]>;
  level: number | null;
  xp: number | null;
  xpToNext: number | null;
  projectsTotal: number;
  projectsDone: number;
  notes: string[];
}
export interface MySyncReport {
  ok: number;
  failed: number;
  unauthorized: boolean;
  detail: string;
  subjectsImported: number;
}

// ───────────────────────────── planning ─────────────────────────────

/** A task of the user. `project` is a repository path, or `my:<id>` for a MY Epitech project not cloned yet. */
export interface PlanTask {
  id: number;
  title: string;
  notes: string;
  project: string | null;
  parentId: number | null;
  kind: "task" | "idea";
  /** 0 none, 1 low, 2 medium, 3 high. */
  priority: number;
  estimateMin: number | null;
  dueDay: string | null;
  doneAt: number | null;
  createdAt: number;
}
/** `block`: time you are not available; nothing is planned over it. */
export type PlanEventKind = "session" | "task" | "event" | "reminder" | "block";
/** A personal calendar entry. Instants are unix seconds. */
export interface PlanEvent {
  id: number;
  kind: PlanEventKind;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  project: string | null;
  taskId: number | null;
  color: string | null;
  notes: string;
  origin: "me" | "auto" | "claude";
  done: boolean;
}
export interface ProjectPlan {
  key: string;
  priority: number;
  /** Work still to do, in minutes. */
  estimateMin: number | null;
  color: string | null;
}
export interface WorkLog {
  id: number;
  project: string | null;
  taskId: number | null;
  title: string;
  startedAt: number;
  seconds: number;
}
export interface PlanState {
  tasks: PlanTask[];
  events: PlanEvent[];
  projects: ProjectPlan[];
  log: WorkLog[];
}
/** One change of a proposed plan; local times `YYYY-MM-DDTHH:MM`. Applied only after review. */
export type ScheduleAction =
  | { type: "create_session"; project: string | null; title: string; start: string; end: string; taskId?: number | null; kind?: PlanEventKind | null }
  | { type: "move_event"; id: number; start: string; end: string }
  | { type: "delete_event"; id: number }
  | { type: "create_task"; project: string | null; title: string; estimateMin?: number | null; priority?: number | null; dueDay?: string | null; subtasks?: string[] }
  | { type: "set_priority"; project: string; priority: number }
  | { type: "set_estimate"; project: string; estimateMin: number };
export interface PlanApplied {
  created: number;
  moved: number;
  deleted: number;
  tasks: number;
  projects: number;
}

// ── Tika (assistant), memory, work sessions
export interface Screen {
  page: string;
  project?: string | null;
  tab?: string | null;
  detail?: string | null;
}
export interface AiThread {
  id: number;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: number;
}
export interface AiStep {
  label: string;
  detail: string;
  status: string;
  tool: string;
}
export interface AiMessage {
  id: number;
  role: "user" | "assistant" | "system";
  text: string;
  meta: { steps?: AiStep[]; proposals?: number[]; actions?: number[]; costUsd?: number | null; error?: boolean; screen?: Screen };
  createdAt: number;
}
export interface AiSettings {
  chatModel: string;
  agentModel: string;
  agentBudgetUsd: number;
  agentMinutes: number;
  autoAnalyze: boolean;
}
export interface AiProposal {
  id: number;
  threadId: number | null;
  kind: string;
  title: string;
  rationale: string;
  payload: { actions: ScheduleAction[]; warnings?: string[] };
  status: "pending" | "accepted" | "rejected";
  outcome: { accepted: boolean; kept?: number; of?: number } | null;
  at: number;
}
export interface AiAction {
  id: number;
  threadId: number | null;
  tool: string;
  summary: string;
  status: "done" | "undone";
  at: number;
}
export type MemoryKind = "preference" | "goal" | "constraint" | "decision" | "difficulty" | "next_step" | "fact" | "test_report";
export interface Memory {
  id: number;
  scope: string;
  kind: MemoryKind;
  content: string;
  source: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  archived: boolean;
}
export interface FocusSession {
  id: number;
  title: string;
  project: string | null;
  taskId: number | null;
  eventId: number | null;
  startedAt: number;
  plannedMin: number;
  pausedAt: number | null;
  pausedTotalS: number;
  lastSeenAt: number;
  dueNotified: boolean;
  thenTitle: string | null;
  thenMin: number | null;
  endedAt: number | null;
  endReason: string | null;
  seconds: number | null;
}
export interface FocusStart {
  title: string;
  project?: string | null;
  taskId?: number | null;
  eventId?: number | null;
  minutes: number;
  thenTitle?: string | null;
  thenMin?: number | null;
}
export type FocusNotice =
  | { kind: "due"; id: number; title: string; thenTitle: string | null }
  | { kind: "closed"; id: number; title: string; reason: string; minutes: number }
  | { kind: "paused"; id: number; title: string }
  | { kind: "break"; id: number; minutes: number };
export interface FocusStats {
  totalMin: number;
  sessions: number;
  autoClosed: number;
  byProject: [string | null, number][];
  byDay: [string, number][];
  longestMin: number;
}

export interface InsightAction {
  label: string;
  tool?: string;
  args?: Record<string, unknown>;
  ask?: string;
}
export interface Insight {
  id: number;
  key: string;
  kind: "deadline" | "stalled" | "overload" | "missed" | "tests" | "subject" | string;
  title: string;
  body: string;
  actions: InsightAction[];
  createdAt: number;
}

export const api = {
  planState: () => invoke<PlanState>("plan_state"),
  myFreeSlots: (eventId: number) => invoke<Array<{ start: string; end: string }>>("my_free_slots", { eventId }),
  planTaskSave: (task: Partial<PlanTask> & { title: string }) => invoke<PlanTask>("plan_task_save", { task }),
  planTaskDelete: (id: number) => invoke<void>("plan_task_delete", { id }),
  planEventSave: (event: Partial<PlanEvent> & { title: string; kind: PlanEventKind; start: number; end: number }) => invoke<PlanEvent>("plan_event_save", { event }),
  planEventDelete: (id: number) => invoke<void>("plan_event_delete", { id }),
  planProjectSet: (key: string, patch: { priority?: number; estimateMin?: number | null; color?: string | null }) => invoke<ProjectPlan>("plan_project_set", { key, patch }),
  planLogAdd: (project: string | null, taskId: number | null, title: string, startedAt: number, seconds: number) => invoke<WorkLog>("plan_log_add", { project, taskId, title, startedAt, seconds }),
  planApply: (actions: ScheduleAction[], origin: "auto" | "claude") => invoke<PlanApplied>("plan_apply", { actions, origin }),
  assistantStart: (question: string, context: string, subjectOf: string | null) => invoke<number>("assistant_start", { question, context, subjectOf }),

  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  suggestRoots: () => invoke<RootSuggestion[]>("suggest_roots"),
  envStatus: () => invoke<EnvStatus>("env_status"),
  testGithubSsh: () => invoke<{ ok: boolean; message: string }>("test_github_ssh"),

  scanRepos: () => invoke<RepoInfo[]>("scan_repos"),
  setFavorite: (path: string, favorite: boolean) => invoke<void>("set_favorite", { path, favorite }),
  recentActivity: (limit: number) => invoke<Activity[]>("recent_activity", { limit }),

  openIde: (path: string) => invoke<void>("open_ide", { path }),
  openTerminal: (path: string) => invoke<void>("open_terminal", { path }),
  openWorkspace: (path: string) => invoke<{ ide: string | null; terminal: string | null }>("open_workspace", { path }),
  revealInFiles: (path: string) => invoke<void>("reveal_in_files", { path }),

  launchCandidates: () => invoke<Candidate[]>("launch_candidates"),
  cloneProject: (url: string, parent: string) => invoke<CloneOutcome>("clone_project", { url, parent }),
  defaultVars: (target: string) => invoke<Vars>("default_vars", { target }),

  templatesList: () => invoke<TemplateSummary[]>("templates_list"),
  templateSources: () => invoke<string[]>("template_sources"),
  templateFiles: (id: string) => invoke<TemplateFile[]>("template_files", { id }),
  templateReadFile: (id: string, rel: string) => invoke<FilePreview>("template_read_file", { id, rel }),
  templateImport: (source: string, name: string, description: string) =>
    invoke<{ id: string; files: number; skipped: number }>("template_import", { source, name, description }),
  templateDuplicate: (id: string, name: string) => invoke<string>("template_duplicate", { id, name }),
  templateDelete: (id: string) => invoke<void>("template_delete", { id }),
  templateEdit: (id: string) => invoke<void>("template_edit", { id }),
  templatePlan: (id: string, target: string, vars: Vars) => invoke<PlanEntry[]>("template_plan", { id, target, vars }),
  templateApply: (id: string, target: string, vars: Vars, selected: string[], overwrite: string[]) =>
    invoke<ApplyReport>("template_apply", { id, target, vars, selected, overwrite }),

  stageFiles: (repo: string, files: string[]) => invoke<RepoStatus>("stage_files", { repo, files }),
  commitStaged: (repo: string, message: string) => invoke<RepoStatus>("commit_staged", { repo, message }),

  projectGet: (path: string) => invoke<ProjectSheet>("project_get", { path }),
  projectSave: (path: string, sheet: SheetInput) => invoke<ProjectSheet>("project_save", { path, sheet }),
  projectSetStatus: (path: string, status: Progress) => invoke<void>("project_set_status", { path, status }),
  projectSetKind: (path: string, kind: RepoKind | null) => invoke<void>("project_set_kind", { path, kind }),
  projectSetMy: (path: string, projectId: number | null) => invoke<void>("project_set_my", { path, projectId }),
  projectDeadlineFromMy: (path: string) => invoke<void>("project_deadline_from_my", { path }),
  projectRunInfo: (path: string) => invoke<BinaryInfo>("project_run_info", { path }),
  projectLaunch: (path: string) => invoke<string>("project_launch", { path }),
  openRemote: (path: string) => invoke<{ url: string; browser: "firefox" | "default" }>("open_remote", { path }),
  deadlineBoard: () => invoke<BoardItem[]>("deadline_board"),
  uiPrefsGet: () => invoke<Record<string, unknown>>("ui_prefs_get"),
  uiPrefsSet: (prefs: Record<string, unknown>) => invoke<void>("ui_prefs_set", { prefs }),
  quickRun: (repo: string, command: string) => invoke<number>("quick_run", { repo, command }),
  quickHistory: (repo: string) => invoke<string[]>("quick_history", { repo }),
  quickForget: (repo: string, command: string) => invoke<void>("quick_forget", { repo, command }),
  jobActive: (repo: string, kind: RunKind) => invoke<number | null>("job_active", { repo, kind }),
  claudeInfo: () => invoke<ClaudeReport>("claude_info"),
  claudeCheck: () => invoke<ClaudeCheck>("claude_check"),
  projectBuild: (path: string) => invoke<RunReport>("project_build", { path }),

  subjectsList: () => invoke<Subject[]>("subjects_list"),
  subjectsScan: (dir?: string) => invoke<{ dir: string; files: SubjectCandidate[] }>("subjects_scan", { dir: dir ?? null }),
  subjectsImport: (items: Array<{ path: string; repoPath: string | null }>) => invoke<SubjectImportResult[]>("subjects_import", { items }),
  subjectLink: (id: number, repoPath: string | null) => invoke<void>("subject_link", { id, repoPath }),
  subjectRemove: (id: number) => invoke<void>("subject_remove", { id }),
  subjectOpen: (id: number) => invoke<void>("subject_open", { id }),

  gitDetail: (repo: string) => invoke<GitDetail>("git_detail", { repo }),
  gitDiff: (repo: string, path: string, staged: boolean, untracked: boolean) => invoke<string>("git_diff", { repo, path, staged, untracked }),
  gitUnstage: (repo: string, files: string[]) => invoke<void>("git_unstage", { repo, files }),
  gitSync: (repo: string, op: "fetch" | "pull" | "push") => invoke<string>("git_sync", { repo, op }),
  gitCreateBranch: (repo: string, name: string) => invoke<void>("git_create_branch", { repo, name }),
  gitSwitchBranch: (repo: string, name: string) => invoke<void>("git_switch_branch", { repo, name }),

  analytics: () => invoke<Analytics>("analytics"),

  cozyStatus: () => invoke<CozyStatus>("cozy_status"),
  cozyUpdate: (patch: Companion) => invoke<CozyStatus>("cozy_update", { patch }),
  cozySend: (command: string) => invoke<void>("cozy_send", { command }),
  cozyRestore: (name: string) => invoke<CozyStatus>("cozy_restore", { name }),

  libraryList: () => invoke<Library[]>("library_list"),
  librarySuggestions: () => invoke<string[]>("library_suggestions"),
  libraryAdd: (name: string, path: string, copy: boolean) => invoke<Library>("library_add", { name, path, copy }),
  libraryUnregister: (id: number) => invoke<void>("library_unregister", { id }),
  libraryCatalog: (id: number) => invoke<Catalog>("library_catalog", { id }),
  libraryRead: (id: number, rel: string) => invoke<string>("library_read", { id, rel }),
  librarySetMeta: (id: number, rel: string, meta: LibMeta) => invoke<void>("library_set_meta", { id, rel, meta }),
  libraryPresets: (id: number) => invoke<LibPreset[]>("library_presets", { id }),
  libraryPresetSave: (id: number, name: string, files: string[]) => invoke<void>("library_preset_save", { id, name, files }),
  libraryPresetDelete: (presetId: number) => invoke<void>("library_preset_delete", { presetId }),
  libraryProject: (repo: string, id: number, libDir?: string) => invoke<LibProjectStatus>("library_project", { repo, id, libDir: libDir ?? null }),
  libraryPlan: (repo: string, id: number, request: LibPlanRequest) => invoke<LibPlan>("library_plan", { repo, id, request }),
  libraryApply: (repo: string, id: number, request: LibPlanRequest, confirmed: string[]) => invoke<LibApplyReport>("library_apply", { repo, id, request, confirmed }),
  libraryDiff: (repo: string, id: number, libDir: string, rel: string) => invoke<string>("library_diff", { repo, id, libDir, rel }),
  libraryBackups: (repo: string, path: string) => invoke<Array<{ stamp: string; size: number }>>("library_backups", { repo, path }),
  libraryRestore: (repo: string, path: string, stamp: string) => invoke<void>("library_restore", { repo, path, stamp }),
  libraryBuild: (repo: string, libDir: string) => invoke<RunReport>("library_build", { repo, libDir }),
  libraryImportAnalyze: (id: number, paths: string[]) => invoke<ImportAnalysis>("library_import_analyze", { id, paths }),
  libraryImport: (id: number, items: Array<{ source: string; dir: string; overwrite: boolean }>, header: string | null) => invoke<LibImportReport>("library_import", { id, items, header }),
  libraryReveal: (id: number) => invoke<void>("library_reveal", { id }),

  projectConfigGet: (repo: string) => invoke<ProjectConfig>("project_config_get", { repo }),
  projectConfigSet: (repo: string, config: ProjectConfig) => invoke<ProjectConfig>("project_config_set", { repo, config }),
  jobGet: (id: number) => invoke<JobView>("job_get", { id }),
  jobGetSince: (id: number, logFrom: number, eventsFrom: number) => invoke<JobView>("job_get", { id, logFrom, eventsFrom }),
  jobCancel: (id: number) => invoke<void>("job_cancel", { id }),
  runsList: (repo: string | null, kind: RunKind | null, limit: number) => invoke<Run[]>("runs_list", { repo, kind, limit }),
  runGet: (id: number) => invoke<Run>("run_get", { id }),
  testingInfo: (repo: string) => invoke<TestingInfo>("testing_info", { repo }),
  testsRun: (repo: string, command: string, acknowledged: boolean) => invoke<number>("tests_run", { repo, command, acknowledged }),
  bananaRun: (repo: string) => invoke<number>("banana_run", { repo }),
  testrepoStart: (repo: string, params: TestRepoParams) => invoke<number>("testrepo_start", { repo, params }),
  testrepoEnvs: () => invoke<TestEnv[]>("testrepo_envs"),
  testrepoEnvDelete: (name: string) => invoke<void>("testrepo_env_delete", { name }),
  testrepoEnvOpen: (name: string, terminal: boolean) => invoke<void>("testrepo_env_open", { name, terminal }),
  moulinetteStart: (repo: string, params: MoulinetteParams) => invoke<number>("moulinette_start", { repo, params }),
  analysisStart: (repo: string) => invoke<number>("analysis_start", { repo }),
  promptsList: () => invoke<PromptDef[]>("prompts_list"),
  promptSave: (id: string, preset: string, body: string, activate: boolean) => invoke<string[]>("prompt_save", { id, preset, body, activate }),
  promptDelete: (id: string, preset: string) => invoke<void>("prompt_delete", { id, preset }),
  promptActivate: (id: string, preset: string | null) => invoke<void>("prompt_activate", { id, preset }),
  promptPreview: (id: string, body: string, repo: string | null) => invoke<PromptPreview>("prompt_preview", { id, body, repo }),
  claudeBrief: (repo: string, task: "tests" | "readme" | "subject" | "analysis", disclosure: boolean) => invoke<ClaudeBrief>("claude_brief", { repo, task, disclosure }),
  genTestsStart: (repo: string) => invoke<number>("gen_tests_start", { repo }),
  packagePreview: (repo: string, options: PackOptions) => invoke<PackPreview>("package_preview", { repo, options }),
  packageCreate: (repo: string, options: PackOptions) => invoke<{ path: string; dir: string; files: number; size: number }>("package_create", { repo, options }),
  packageReveal: () => invoke<void>("package_reveal"),
  readmeDraft: (repo: string, disclosure: boolean) => invoke<ReadmeDraft>("readme_draft", { repo, disclosure }),
  readmeDiff: (repo: string, text: string) => invoke<string>("readme_diff", { repo, text }),
  readmeWrite: (repo: string, content: string, expectedHash: string | null) => invoke<string | null>("readme_write", { repo, content, expectedHash }),
  readmeAiStart: (repo: string, disclosure: boolean) => invoke<number>("readme_ai_start", { repo, disclosure }),

  myStatus: () => invoke<MyStatus>("my_status"),
  myConnect: () => invoke<void>("my_connect"),
  mySync: () => invoke<MySyncReport>("my_sync"),
  myData: () => invoke<{ entries: MyEntry[]; history: Array<{ at: number; ok: number; failed: number; detail: string }> }>("my_data"),
  myForget: (eraseCache: boolean) => invoke<void>("my_forget", { eraseCache }),

  myImportSubjects: () => invoke<{ imported: number; problems: string[] }>("my_import_subjects"),
  myAgenda: () => invoke<Agenda>("my_agenda"),
  myAcademic: () => invoke<Academic>("my_academic"),
  myOverview: () => invoke<MyOverview>("my_overview"),
  myApplyDeadlines: (projectIds: number[]) => invoke<number>("my_apply_deadlines", { projectIds }),


  aiSend: (thread: number | null, text: string, screen: Screen) => invoke<{ threadId: number; jobId: number }>("ai_send", { thread, text, screen }),
  aiThreads: () => invoke<AiThread[]>("ai_threads"),
  aiThread: (id: number) => invoke<AiMessage[]>("ai_thread", { id }),
  aiThreadDelete: (id: number) => invoke<void>("ai_thread_delete", { id }),
  aiContextPreview: (screen: Screen) => invoke<string>("ai_context_preview", { screen }),
  aiSettingsGet: () => invoke<AiSettings>("ai_settings_get"),
  aiSettingsSet: (settings: AiSettings) => invoke<AiSettings>("ai_settings_set", { settings }),
  aiUndo: (id: number) => invoke<string>("ai_undo", { id }),
  aiActions: (limit?: number) => invoke<AiAction[]>("ai_actions", { limit: limit ?? null }),
  aiProposals: (status?: string | null) => invoke<AiProposal[]>("ai_proposals", { status: status ?? null }),
  aiProposalDecide: (id: number, accept: boolean, keep: number[] | null) => invoke<unknown>("ai_proposal_decide", { id, accept, keep }),
  aiTool: (name: string, args: Record<string, unknown>) => invoke<Record<string, unknown>>("ai_tool", { name, args }),
  memoryList: (scope?: string | null, archived?: boolean) => invoke<Memory[]>("memory_list", { scope: scope ?? null, archived: archived ?? false }),
  memoryAdd: (scope: string, kind: MemoryKind, content: string, pinned: boolean) => invoke<Memory>("memory_add", { scope, kind, content, pinned }),
  memoryUpdate: (id: number, patch: { content?: string; kind?: MemoryKind; pinned?: boolean; archived?: boolean }) => invoke<Memory>("memory_update", { id, patch }),
  memoryDelete: (id: number) => invoke<void>("memory_delete", { id }),
  insightsList: () => invoke<Insight[]>("insights_list"),
  insightSet: (id: number, status: "dismiss" | "snooze" | "done", hours?: number) => invoke<void>("insight_set", { id, status, hours: hours ?? null }),
  insightsRefresh: () => invoke<number>("insights_refresh"),
  focusGet: () => invoke<FocusSession | null>("focus_get"),
  focusStart: (start: FocusStart) => invoke<FocusSession>("focus_start", { start }),
  focusPause: () => invoke<FocusSession>("focus_pause"),
  focusResume: () => invoke<FocusSession>("focus_resume"),
  focusExtend: (minutes: number) => invoke<FocusSession>("focus_extend", { minutes }),
  focusStop: (done: boolean) => invoke<FocusSession>("focus_stop", { done }),
  focusDiscard: () => invoke<void>("focus_discard"),
  focusStats: (from: number, to: number) => invoke<FocusStats>("focus_stats", { from, to }),

  startup: () => invoke<{ page: string | null; sheet: string | null; theme: string | null; repo: string | null; pick: string | null; tool: string | null; run: string | null; report: number | null; anchor: string | null }>("startup"),
};
