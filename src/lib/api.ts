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
  /** Interface language. */
  language: "fr" | "en";
  /** Only Epitech projects in lists, planning and Artix. */
  epitechOnly: boolean;
  /** Step of the first-run assistant reached so far ("" = not started). */
  onboardingStep: string;
  /** Look for a new release now and then. */
  updateCheck: boolean;
  /** Global shortcut of the capture window (X11 only). "" = none. */
  captureShortcut: string;
  /** Icon in the notification area. */
  trayIcon: boolean;
}

/** One of Tekboard's folders. */
export interface DataLocation {
  kind: "data" | "session" | "cache";
  path: string;
  bytes: number;
}
export interface ExportSummary {
  path: string;
  bytes: number;
  files: number;
}
export interface BackupManifest {
  app: string;
  format: number;
  version: string;
  schema: number;
  createdAt: number;
  dataDir: string;
}
export interface UpdateInfo {
  version: string;
  install: "appimage" | "deb" | "manual";
  canInstall: boolean;
  needsPassword: boolean;
  releasesUrl: string;
}
export interface UpdateAvailable {
  version: string;
  current: string;
  notes: string | null;
  date: string | null;
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
  /** `hidden` (a copy, a zombie) or `archived`; null = shown. The folder is never touched. */
  visibility: "hidden" | "archived" | null;
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
  /** Another folder holds the same project: this one looks like the copy. */
  duplicateOf: string | null;
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
  myProjectId: number | null;
  /** `manual` (chosen by the user, never changed automatically), `auto`, or null. */
  linkSource: "manual" | "auto" | null;
  main: boolean;
}

/** A link TekBoard is not sure about: the user accepts or refuses it. */
export interface SubjectSuggestion {
  subjectId: number;
  repoPath: string;
  reason: string;
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
  /** Dynamic library (.so) instead of a static one, when TekBoard writes its Makefile. */
  shared?: boolean;
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
// ───────────────────────── Code Playground ─────────────────────────
export interface DraftFile {
  name: string;
  content: string;
  /** Library the file was imported from (read-only by default). */
  library?: string | null;
}
export interface DraftSettings {
  compiler: "gcc" | "clang" | "epiclang";
  flags: string;
  args: string;
  stdin: string;
  asan: boolean;
  ubsan: boolean;
  valgrind: boolean;
  timeoutS: number;
  memMb: number;
}
export interface Draft {
  id: number;
  title: string;
  files: DraftFile[];
  settings: DraftSettings;
  open: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface PlaygroundTools {
  compilers: Array<{ name: string; path: string | null; version: string | null }>;
  valgrind: string | null;
  sandbox: string | null;
  cgroupLimits: boolean;
}
export interface CDiagnostic {
  file: string;
  line: number | null;
  col: number | null;
  severity: "error" | "warning" | "note";
  message: string;
  flag: string | null;
  origin: "compiler" | "linker";
}
export interface MemFrame {
  function: string;
  file: string | null;
  line: number | null;
}
export interface MemIssue {
  tool: "asan" | "lsan" | "ubsan" | "valgrind";
  kind: string;
  message: string;
  at: MemFrame | null;
  frames: MemFrame[];
  bytes: number | null;
}
export interface PlaygroundCompile {
  ok: boolean;
  command: string;
  output: string;
  diagnostics: CDiagnostic[];
  durationMs: number;
  /** Compilation, link and make times, objects reused (since 1.0). */
  build?: { mode: "full" | "incremental" | "make"; compileMs: number; linkMs: number; makeMs: number; compiled: number; cached: number } | null;
}
export interface PlaygroundRun {
  command: string;
  exitCode: number | null;
  signal: number | null;
  signalName: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
  memory: MemIssue[];
  valgrind: { errors: number | null; definitelyLost: number | null; indirectlyLost: number | null; stillReachable: number | null } | null;
}

/** Timed runs of a program (Playground): median, minimum and spread of several runs. */
export interface PlaygroundBench {
  runs: number;
  wall: ArenaStats;
  cpu: ArenaStats;
  maxRssKb: number;
  /** Relative spread (robust deviation / median). */
  spread: number;
}
export interface BenchVerdict {
  faster: "a" | "b" | "none";
  ratio: number;
  significant: boolean;
  why: string;
}

// ───────────────────────── Algorithm Arena ─────────────────────────
export type ArenaSource = { kind: "project"; path: string; rev: string | null } | { kind: "draft"; id: number };
export interface ArenaVariant {
  label: string;
  source: ArenaSource;
  build: string;
  program: string;
}
export interface ArenaScenario {
  name: string;
  generator: string | null;
  sizes: number[];
  seed: number;
  args: string;
  stdin: boolean;
}
export interface ArenaOptions {
  repeats: number;
  warmup: boolean;
  callgrind: boolean;
  massif: boolean;
  heap: boolean;
  timeoutS: number;
  memMb: number;
}
export interface BenchConfig {
  name: string;
  variants: ArenaVariant[];
  scenarios: ArenaScenario[];
  files: DraftFile[];
  options: ArenaOptions;
  /** Artix's reading of the code when it prepared the benchmark (hypotheses). */
  hypotheses?: Array<{ function: string; file: string; line: number | null; message: string }>;
}
export interface ArenaSaved {
  id: number;
  config: BenchConfig;
  updatedAt: number;
}
export interface ArenaStats {
  median: number;
  mad: number;
  min: number;
  max: number;
  outliers: number[];
}
export interface ArenaSample {
  wallUs: number;
  userUs: number;
  sysUs: number;
  maxRssKb: number;
  exit: number;
  signal: number;
}
export interface ArenaPoint {
  n: number;
  samples: ArenaSample[];
  wall: ArenaStats | null;
  cpu: ArenaStats | null;
  maxRssKb: number | null;
  ir: number | null;
  failed: string | null;
}
export interface ArenaFit {
  model: string | null;
  confidence: "likely" | "uncertain" | "insufficient";
  exponent: number | null;
  candidates: Array<{ model: string; r2: number }>;
  why: string;
}
export interface HotFunction {
  function: string;
  file: string | null;
  ir: number;
  percent: number;
  own: boolean;
}
export interface ArenaSeries {
  variant: number;
  scenario: number;
  points: ArenaPoint[];
  fitTime: ArenaFit | null;
  fitIr: ArenaFit | null;
  hot: { totalIr: number | null; functions: HotFunction[] } | null;
  profiledN: number | null;
  heapPeak: number | null;
  heap: { allocs: number; frees: number; bytes: number } | null;
}
export interface ArenaHypothesis {
  file: string;
  function: string;
  line: number | null;
  kind?: string;
  weight?: string;
  message: string;
  provenance?: string;
  /** "project" (the program's files) or "library" (library folders, imported code, tests). */
  scope?: "project" | "library";
  /** Variants where the same finding was read. */
  seenIn?: string[];
  /** Places it was merged from. */
  count?: number;
}
export interface ArenaResults {
  config: BenchConfig | null;
  variants: string[];
  series: ArenaSeries[];
  hypotheses: ArenaHypothesis[];
  inputs: Array<{ scenario: number; n: number; bytes: number; head: string }>;
  notes: string[];
  machine: { cpu: string | null; cores: number; load: string | null };
  /** The Valgrind run in progress. */
  current?: { tool: string; variant: number; scenario: number; n: number; limitS: number; startedAt: number } | null;
}
export interface ArenaGenerated {
  files: DraftFile[];
  scenarios: ArenaScenario[];
  hypotheses: ArenaHypothesis[];
  rejected: string[];
}
export interface ArenaTools {
  sandbox: string | null;
  valgrind: boolean;
  callgrindAnnotate: boolean;
  python: boolean;
  compiler: boolean;
}
export interface Revisions {
  current: string | null;
  branches: string[];
  commits: Array<[string, string]>;
}

// ───────────────────────── TekBoard Connect ─────────────────────────
export type ConnectStatus = "available" | "coding" | "session" | "dnd" | "invisible" | "helping" | "offline";
export interface ConnectProfile {
  nick: string;
  avatar: string;
  status: ConnectStatus;
}
export interface ConnectConfig {
  enabled: boolean;
  profile: ConnectProfile;
  port: number;
  interface: string;
  space: boolean;
}
export interface PeerView {
  fp: string;
  short: string;
  profile: ConnectProfile;
  online: boolean;
  discovered: boolean;
  trusted: boolean;
  blocked: boolean;
  addr: string | null;
  app: string | null;
  since: number | null;
  lastSeen: number | null;
}
export interface PairRequest {
  id: number;
  fp: string;
  short: string;
  profile: ConnectProfile;
  addr: string;
  code: string;
  state: "incoming" | "waiting" | "confirm" | "silent";
  at: number;
}
export interface ConnectState {
  enabled: boolean;
  running: boolean;
  fp: string;
  short: string;
  profile: ConnectProfile;
  ip: string | null;
  port: number | null;
  interface: string;
  invite: string | null;
  mdns: boolean;
  peers: PeerView[];
  requests: PairRequest[];
  problems: string[];
  space: boolean;
}
export type Reach = { result: "open" } | { result: "refused" } | { result: "timeout" } | { result: "unreachable"; detail: string };
export interface ConnectDiagnosis {
  interfaces: Array<{ name: string; ip: string; kind: string; default: boolean }>;
  listening: string | null;
  mdns: boolean;
  seen: number;
  probe: Reach | null;
  probeText: string | null;
  advice: string[];
}

// ───────────────────────── Brain Dump ─────────────────────────
export type CaptureKind = "idea" | "note" | "snippet" | "task";
export type CaptureType = "idea" | "bug" | "improvement" | "question" | "code" | "command" | "link" | "task" | "info" | "image";
/** A quick capture: a row of the tasks, `idea` while it waits in the inbox. */
export interface Capture {
  id: number;
  title: string;
  /** The whole text (the details, for a task). */
  text: string;
  project: string | null;
  kind: CaptureKind;
  ctype: CaptureType | "";
  tags: string[];
  pinned: boolean;
  archivedAt: number | null;
  doneAt: number | null;
  createdAt: number;
  updatedAt: number | null;
}
export type CaptureView = "inbox" | "pinned" | "notes" | "snippets" | "archived" | "kept" | "all";
export interface CaptureFilter {
  view: CaptureView;
  query?: string;
  project?: string | null;
  limit?: number;
}
/** What Artix suggests for a capture (nothing is applied by itself). */
export interface CaptureSuggestion {
  title: string;
  ctype: CaptureType;
  project?: string;
  tags: string[];
  rewrite?: string;
  asTask: boolean;
  similarId?: number;
}
export interface DesktopStatus {
  wayland: boolean;
  desktop: string;
  shortcutActive: boolean;
  shortcutError: string | null;
  trayAvailable: boolean;
  trayActive: boolean;
  captureCommand: string;
}

// ───────────────────────── TekShare ─────────────────────────
export type ShareResource =
  | { kind: "file"; path: string }
  | { kind: "folder"; path: string }
  | { kind: "snippet"; title: string; text: string; lang?: string }
  | { kind: "draft"; id: number }
  | { kind: "libraryFiles"; libraryId: number; files: string[] }
  | { kind: "library"; id: number }
  | { kind: "template"; id: string }
  | { kind: "prompt"; id: string; preset: string }
  | { kind: "tests"; repo: string }
  | { kind: "arenaRun"; runId: number }
  | { kind: "log"; title: string; text: string }
  | { kind: "error"; title: string; text: string }
  | { kind: "patch"; repo: string }
  | { kind: "note"; title: string; text: string }
  | { kind: "board"; id: string }
  | { kind: "config" };
export interface ShareCheck {
  kind: string;
  title: string;
  files: string[];
  bytes: number;
  preview: string;
  school: string | null;
  blocked: string[];
}
export interface Transfer {
  id: string;
  direction: "in" | "out";
  peer: string;
  peerNick: string;
  kind: string;
  title: string;
  size: number;
  sha256: string;
  status: "offered" | "sending" | "sent" | "receiving" | "received" | "imported" | "declined" | "failed" | "cancelled" | "expired";
  detail: string | null;
  progress: number;
  preview: string;
  files: string[];
  school: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface OpenedTransfer {
  transfer: Transfer;
  manifest: { v: number; kind: string; title: string; meta: Record<string, unknown>; files: string[] };
  files: Array<[string, number, string | null]>;
  destinations: string[];
}
export type ImportTarget =
  | { to: "playground" }
  | { to: "library"; name: string }
  | { to: "template"; name: string }
  | { to: "prompt"; preset: string }
  | { to: "project"; repo: string; subdir: string }
  | { to: "patch"; repo: string; apply: boolean }
  | { to: "arena" }
  | { to: "downloads" }
  | { to: "config" }
  | { to: "board" }
  | { to: "inbox" };
export interface Imported {
  detail: string;
  open: { page?: string; id?: number; path?: string; runId?: number; reveal?: string; board?: string } | null;
}

// ───────────────────────── TekLive ─────────────────────────
export interface LiveSetup {
  code: string | null;
  codeVersion: string | null;
  extension: string | null;
  bridge: string | null;
  missing: string[];
}
export interface LiveSession {
  project: string;
  name: string;
  state: "waiting" | "live" | "stopped";
  server: string;
  link: string | null;
  room: string | null;
  peers: string[];
  guests: string[];
  refused: number;
  startedAt: number;
  contactsOnly: boolean;
  showProject: boolean;
  invited: string[];
  /** Network interface the server listens on. */
  interface: string;
  /** Something to know (the usual port was taken…). */
  note: string | null;
}
export interface LiveInvitation {
  id: string;
  from: string;
  host: string;
  project: string | null;
  link: string;
  at: number;
}

// ───────────────────────── Whiteboards ─────────────────────────
export interface BoardMeta {
  id: string;
  name: string;
  project: string | null;
  thumb: string | null;
  position: number;
  createdAt: number;
  updatedAt: number;
  elements: number;
}
export interface BoardFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created?: number;
}
export interface BoardData {
  meta: BoardMeta;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, BoardFile>;
}

export type RunKind = "tests" | "testrepo" | "banana" | "moulinette" | "moulinette_ai" | "gen_tests" | "readme" | "build" | "command" | "analysis" | "assistant" | "ollama_pull" | "playground" | "arena" | "arena_ai" | "arena_report" | "board_ai" | "brain" | "mouli_plan" | "mouli_run";
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
/** A case of the TekBoard moulinette's plan (src-tauri/src/mouli). */
export interface MouliCase {
  id: string;
  category: string;
  kind: "io" | "unit";
  title: string;
  source: string;
  args: string[];
  stdin: string | null;
  expectStdout: string | null;
  expectContains: string | null;
  expectCode: number | null;
  timeoutMs: number | null;
  target: string | null;
  suite: string | null;
  name: string | null;
  body: string | null;
  enabled: boolean;
}
export interface MouliFile {
  name: string;
  content: string;
  tests: string[];
}
export interface MouliSuite {
  summary: string;
  cases: MouliCase[];
  unspecified: string[];
  rejected: string[];
  files: MouliFile[];
  withSubject: boolean;
  createdAt: number;
}
export type MouliStatus = "passed" | "failed" | "timeout" | "crashed" | "memory" | "skipped" | "build_error" | "mouli_error";
export interface MouliResult {
  id: string;
  title: string;
  category: string;
  kind: string;
  status: MouliStatus;
  origin: "program" | "mouli";
  input: string;
  expected: string | null;
  got: string | null;
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
  ms: number;
  detail: string | null;
}
export interface MouliReport {
  results: MouliResult[];
  score: number | null;
  build: string | null;
  finishedAt: number;
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
  plan: { available: boolean; unavailable: string | null; provider: string; version: string | null; argv: string[]; canRead: string; canWrite: string; cannot: string; account: string };
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
  /** Planning key of its project (repository path or `my:<id>`). */
  projectKey: string | null;
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
  subjectsLinked: number;
  subjectsToConfirm: number;
}

// ───────────────────────────── planning ─────────────────────────────

/** A task of the user. `project` is a repository path, or `my:<id>` for a MY Epitech project not cloned yet. */
export interface PlanTask {
  id: number;
  title: string;
  notes: string;
  project: string | null;
  parentId: number | null;
  kind: "task" | "idea" | "note" | "snippet";
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
  /** Category chosen by the user; null = the category of its kind. */
  category: string | null;
}
export interface PlanCategory {
  id: string;
  name: string;
  color: string;
  /** One of the five kinds: renamed and recoloured, never deleted. */
  builtin: boolean;
}
export interface Logtime {
  goalHours: number;
  /** The current week first. */
  weeks: Array<{ start: string; end: string; seconds: number; days: number[]; promoSeconds: number | null }>;
  lastDay: string | null;
  fetchedAt: number | null;
  unavailable: string | null;
  today: string;
  weekday: number;
}
export interface ProjectPlan {
  key: string;
  priority: number;
  /** Work still to do, in minutes. */
  estimateMin: number | null;
  color: string | null;
  /** Left out of the calendar (school items of that project). */
  calendarHidden: boolean;
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

// ── Artix (assistant), memory, work sessions
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
export type AiProviderKind = "none" | "claude" | "openrouter" | "ollama";
export interface AiSettings {
  /** Empty only in settings saved before 0.7, until the first start fills it. */
  provider: AiProviderKind | "";
  chatModel: string;
  agentModel: string;
  agentBudgetUsd: number;
  agentMinutes: number;
  autoAnalyze: boolean;
  openrouterModel: string;
  allowPaid: boolean;
  ollamaModel: string;
  ollamaUrl: string;
}
export interface AiCaps {
  text: boolean;
  chat: boolean;
  readFiles: boolean;
  agents: boolean;
}
export interface AiProviderStatus {
  provider: AiProviderKind;
  configured: boolean;
  model: string | null;
  caps: AiCaps;
  detail: string | null;
}
export interface OpenRouterKey {
  hasKey: boolean;
  hint: string | null;
  source: "saved" | "env" | null;
}
export interface OpenRouterModel {
  id: string;
  name: string;
  free: boolean;
  context: number;
  tools: boolean;
  priceIn: number;
  priceOut: number;
  recommended: boolean;
}
export interface OllamaInfo {
  url: string;
  running: boolean;
  installed: boolean;
  version: string | null;
  models: Array<{ name: string; sizeGb: number; parameters: string | null; family: string | null }>;
  hardware: { ramGb: number; gpu: string | null; vramGb: number | null };
  recommended: { model: string; downloadGb: number; why: string };
  detail: string | null;
}
export type SkillStatus = "acquired" | "in_progress" | "available" | "failed" | "locked";
export interface SkillNode {
  id: string;
  kind: "unit" | "skill" | "project";
  label: string;
  status: SkillStatus;
  statusFrom: "graph" | "validations";
  branch: string | null;
  parent: string | null;
  semester: number | null;
  schoolYear: number | null;
  upcoming: boolean;
  credits: number | null;
  grade: string | null;
  validated: number | null;
  total: number | null;
  levelPercent: number | null;
  mandatory: boolean | null;
  unitCode: string | null;
  domain: string | null;
  /** True when `domain` is TekBoard's estimate (always, when set). */
  domainEstimated: boolean;
}
export interface SkillBranch {
  id: string;
  name: string;
  color: string | null;
  threshold: number | null;
  secure: number | null;
  reachable: number | null;
  available: number | null;
  alert: string | null;
  units: string[];
}
export interface SkillTree {
  syncedAt: number | null;
  credits: { acquired: number | null; prior: number | null; thisSemester: number | null; threshold: number | null; secure: number | null; reachable: number | null; lost: number; atRisk: number };
  semester: number | null;
  semesters: Array<{ num: number; schoolYear: number | null; current: boolean; future: boolean }>;
  branches: SkillBranch[];
  nodes: SkillNode[];
  links: Array<{ source: string; target: string; kind: "skill_unit" | "project_skill" }>;
  history: Array<{ at: number; label: string; kind: "mark" | "project" }>;
  notes: string[];
}
/** A credit simulation kept by the student (`data` is a `ScenarioData`, see lib/credits.ts). */
/** What is playing on this computer (MPRIS) or on the Spotify account. */
export interface NowPlaying {
  title: string;
  artist: string;
  art: string | null;
  playing: boolean;
  source: "mpris" | "spotify";
  player: string;
}
export interface CreditScenarioRow {
  id: number;
  name: string;
  data: unknown;
  updatedAt: number;
}
export type DoctorStatus = "ok" | "warn" | "error" | "unconfigured";
export interface DoctorCheck {
  id: string;
  category: string;
  title: string;
  status: DoctorStatus;
  detail: string;
  affects: string | null;
  command: string | null;
  /** `fix:<id>`, `open:<settings tab>` or `my-connect`. */
  action: { id: string; label: string; confirm: string | null } | null;
}
export interface DoctorReport {
  at: number;
  version: string;
  system: string;
  checks: DoctorCheck[];
}
export interface AiProviderTest {
  ok: boolean;
  provider: AiProviderKind;
  model: string | null;
  detail: string;
  ms: number;
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
  startupNotices: () => invoke<string[]>("startup_notices"),
  dataLocations: () => invoke<DataLocation[]>("data_locations"),
  dataOpen: (kind: "data" | "cache") => invoke<void>("data_open", { kind }),
  dataExport: (path: string) => invoke<ExportSummary>("data_export", { path }),
  dataInspect: (path: string) => invoke<BackupManifest>("data_inspect", { path }),
  /** Restores a backup; returns the backup made of the data it replaced. */
  dataImport: (path: string) => invoke<string>("data_import", { path }),
  dataClearCache: () => invoke<number>("data_clear_cache"),
  settingsReset: () => invoke<Settings>("settings_reset"),
  appResetAll: (confirm: string) => invoke<void>("app_reset_all", { confirm }),
  appRestart: () => invoke<void>("app_restart"),
  updateInfo: () => invoke<UpdateInfo>("update_info"),
  updateCheck: () => invoke<UpdateAvailable | null>("update_check"),
  updateInstall: () => invoke<void>("update_install"),
  updateSavePackage: () => invoke<string>("update_save_package"),
  updateOpenReleases: () => invoke<void>("update_open_releases"),
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
  playgroundTools: () => invoke<PlaygroundTools>("playground_tools"),
  playgroundList: () => invoke<Draft[]>("playground_list"),
  playgroundCreate: (title: string, files: DraftFile[] | null, settings: DraftSettings | null) => invoke<Draft>("playground_create", { title, files, settings }),
  playgroundSave: (id: number, title: string, files: DraftFile[], settings: DraftSettings) => invoke<Draft>("playground_save", { id, title, files, settings }),
  playgroundSetOpen: (id: number, open: boolean) => invoke<void>("playground_set_open", { id, open }),
  playgroundDelete: (id: number) => invoke<void>("playground_delete", { id }),
  playgroundRun: (id: number, title: string, files: DraftFile[], settings: DraftSettings) => invoke<number>("playground_run", { id, title, files, settings }),
  playgroundCompare: (a: number, b: number) => invoke<number>("playground_compare", { a, b }),
  playgroundImportLibrary: (libraryId: number, files: string[]) => invoke<DraftFile[]>("playground_import_library", { libraryId, files }),
  playgroundExportPreview: (id: number, name: string) => invoke<DraftFile[]>("playground_export_preview", { id, name }),
  playgroundExport: (id: number, parent: string, name: string, gitInit: boolean) => invoke<string>("playground_export", { id, parent, name, gitInit }),
  arenaTools: () => invoke<ArenaTools>("arena_tools"),
  arenaList: () => invoke<ArenaSaved[]>("arena_list"),
  arenaSave: (id: number | null, config: BenchConfig) => invoke<ArenaSaved>("arena_save", { id, config }),
  arenaDelete: (id: number) => invoke<void>("arena_delete", { id }),
  arenaRevisions: (path: string) => invoke<Revisions>("arena_revisions", { path }),
  arenaRun: (config: BenchConfig) => invoke<number>("arena_run", { config }),
  arenaGenerate: (config: BenchConfig, focus: string) => invoke<number>("arena_generate", { config, focus }),
  arenaReport: (runId: number) => invoke<number>("arena_report", { runId }),
  connectState: () => invoke<ConnectState>("connect_state"),
  connectConfigure: (config: ConnectConfig) => invoke<ConnectState>("connect_configure", { config }),
  connectPair: (fp: string) => invoke<void>("connect_pair", { fp }),
  connectDial: (target: string) => invoke<void>("connect_dial", { target }),
  connectAnswer: (id: number, accept: boolean) => invoke<void>("connect_answer", { id, accept }),
  connectBlock: (fp: string, blocked: boolean) => invoke<void>("connect_block", { fp, blocked }),
  connectForget: (fp: string) => invoke<void>("connect_forget", { fp }),
  connectDiagnose: (target: string | null) => invoke<ConnectDiagnosis>("connect_diagnose", { target }),
  shareCheck: (resource: ShareResource) => invoke<ShareCheck>("share_check", { resource }),
  shareOffer: (fp: string, resource: ShareResource, confirmedSchool: boolean) => invoke<Transfer>("share_offer", { fp, resource, confirmedSchool }),
  shareList: () => invoke<Transfer[]>("share_list"),
  shareAnswer: (id: string, accept: boolean) => invoke<void>("share_answer", { id, accept }),
  shareCancel: (id: string) => invoke<void>("share_cancel", { id }),
  shareForget: (id: string) => invoke<void>("share_forget", { id }),
  shareOpen: (id: string) => invoke<OpenedTransfer>("share_open", { id }),
  shareImport: (id: string, target: ImportTarget) => invoke<Imported>("share_import", { id, target }),
  liveSetup: () => invoke<LiveSetup>("live_setup"),
  liveInstall: (what: "extension" | "bridge") => invoke<string>("live_install", { what }),
  liveStart: (project: string, contactsOnly: boolean, showProject: boolean, iface: string | null = null) => invoke<LiveSession>("live_start", { project, contactsOnly, showProject, interface: iface }),
  liveInterfaces: () => invoke<Array<{ name: string; ip: string; kind: string; default: boolean }>>("live_interfaces"),
  liveStop: () => invoke<void>("live_stop"),
  liveState: () => invoke<LiveSession | null>("live_state"),
  liveInvite: (fp: string) => invoke<void>("live_invite", { fp }),
  liveInvitations: () => invoke<LiveInvitation[]>("live_invitations"),
  liveJoin: (id: string) => invoke<void>("live_join", { id }),
  liveDecline: (id: string) => invoke<void>("live_decline", { id }),
  sessionSend: (fp: string, msg: Record<string, unknown>) => tauriInvoke<void>("session_send", { fp, msg }),
  sessionBroadcast: (fps: string[], msg: Record<string, unknown>) => tauriInvoke<number>("session_broadcast", { fps, msg }),
  musicNow: (source: "mpris" | "spotify") => invoke<NowPlaying | null>("music_now", { source }),
  spotifyStatus: () => invoke<{ clientId: string | null; connected: boolean; redirectUri: string }>("spotify_status"),
  spotifyLogin: (clientId: string) => invoke<string>("spotify_login", { clientId }),
  spotifyLogout: () => invoke<void>("spotify_logout"),
  spaceOpenJam: (url: string) => tauriInvoke<void>("space_open_jam", { url }),
  boardList: (project: string | null, query: string | null) => invoke<BoardMeta[]>("board_list", { project, query }),
  boardCreate: (name: string, project: string | null) => invoke<BoardMeta>("board_create", { name, project }),
  boardGet: (id: string) => invoke<BoardData>("board_get", { id }),
  boardSave: (id: string, elements: unknown[], appState: Record<string, unknown>, files: Record<string, BoardFile>, thumb: string | null) => tauriInvoke<BoardMeta>("board_save", { id, elements, appState, files, thumb }),
  boardRename: (id: string, name: string) => invoke<void>("board_rename", { id, name }),
  boardSetProject: (id: string, project: string | null) => invoke<void>("board_set_project", { id, project }),
  boardSetPosition: (id: string, position: number) => invoke<void>("board_set_position", { id, position }),
  boardDuplicate: (id: string) => invoke<BoardMeta>("board_duplicate", { id }),
  boardDelete: (id: string) => invoke<void>("board_delete", { id }),
  boardVersions: (id: string) => invoke<Array<{ at: number; elements: number }>>("board_versions", { id }),
  boardRestore: (id: string, at: number) => invoke<BoardData>("board_restore", { id, at }),
  boardWriteFile: (path: string, base64: string | null, text: string | null) => invoke<void>("board_write_file", { path, base64, text }),
  boardWritePdf: (path: string, jpeg: string, width: number, height: number) => invoke<void>("board_write_pdf", { path, jpeg, width, height }),
  boardExportJson: (id: string) => invoke<string>("board_export_json", { id }),
  boardImport: (path: string, project: string | null) => invoke<BoardMeta>("board_import", { path, project }),
  boardExportToProject: (id: string, repo: string) => invoke<string>("board_export_to_project", { id, repo }),
  boardAi: (kind: "diagram" | "annotate", request: string, context: string) => invoke<number>("board_ai", { kind, request, context }),
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
  mouliState: (repo: string) => invoke<{ suite: MouliSuite | null; report: MouliReport | null }>("mouli_state", { repo }),
  mouliAnalyze: (repo: string) => invoke<number>("mouli_analyze", { repo }),
  mouliRun: (repo: string, only: string[] | null = null) => invoke<number>("mouli_run", { repo, only }),
  mouliToggle: (repo: string, ids: string[], enabled: boolean) => invoke<MouliSuite>("mouli_toggle", { repo, ids, enabled }),
  mouliExport: (repo: string, names: string[]) => invoke<{ written: string[]; kept: string[] }>("mouli_export", { repo, names }),
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
  /** The one Sync button: session in memory, stored session, or sign-in; then syncs. */
  mySyncAuto: () => invoke<MySyncReport>("my_sync_auto"),
  myLogtime: () => invoke<Logtime>("my_logtime"),
  subjectsAssociate: () => invoke<{ linked: number; suggestions: SubjectSuggestion[] }>("subjects_associate"),
  subjectSuggestionDecide: (id: number, repoPath: string, accept: boolean) => invoke<void>("subject_suggestion_decide", { id, repoPath, accept }),
  projectSetVisibility: (path: string, visibility: "hidden" | "archived" | null) => invoke<void>("project_set_visibility", { path, visibility }),
  hiddenRepos: () => invoke<RepoInfo[]>("hidden_repos"),
  planProjectCalendar: (key: string, hidden: boolean) => invoke<void>("plan_project_calendar", { key, hidden }),
  planCategories: () => invoke<PlanCategory[]>("plan_categories"),
  planCategorySave: (id: string | null, name: string, color: string) => invoke<PlanCategory>("plan_category_save", { id, name, color }),
  planCategoryDelete: (id: string) => invoke<void>("plan_category_delete", { id }),
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
  mySkillTree: () => invoke<SkillTree>("my_skill_tree"),
  appSetIcon: (theme: string) => invoke<void>("app_set_icon", { theme }),
  appSetZoom: (zoom: number) => invoke<number>("app_set_zoom", { zoom }),
  creditScenarios: () => invoke<CreditScenarioRow[]>("credit_scenarios"),
  creditScenarioSave: (id: number | null, name: string, data: unknown) => invoke<CreditScenarioRow>("credit_scenario_save", { id, name, data }),
  creditScenarioDelete: (id: number) => invoke<void>("credit_scenario_delete", { id }),
  doctorRun: (deep = false) => invoke<DoctorReport>("doctor_run", { deep }),
  doctorFix: (id: string) => invoke<string>("doctor_fix", { id }),
  doctorExport: () => invoke<string>("doctor_export"),
  openHelpUrl: (url: string) => invoke<void>("open_help_url", { url }),
  aiProviderStatus: () => invoke<AiProviderStatus>("ai_provider_status"),
  aiProviderTest: () => invoke<AiProviderTest>("ai_provider_test"),
  aiOpenRouterKey: () => invoke<OpenRouterKey>("ai_openrouter_key"),
  aiOpenRouterKeySet: (key: string | null) => invoke<OpenRouterKey>("ai_openrouter_key_set", { key }),
  aiOpenRouterModels: (refresh = false) => invoke<OpenRouterModel[]>("ai_openrouter_models", { refresh }),
  aiOllamaInfo: () => invoke<OllamaInfo>("ai_ollama_info"),
  aiOllamaPull: (model: string) => invoke<number>("ai_ollama_pull", { model }),
  aiUndo: (id: number) => invoke<string>("ai_undo", { id }),
  aiActions: (limit?: number) => invoke<AiAction[]>("ai_actions", { limit: limit ?? null }),
  aiProposals: (status?: string | null) => invoke<AiProposal[]>("ai_proposals", { status: status ?? null }),
  aiProposalDecide: (id: number, accept: boolean, keep: number[] | null) => invoke<unknown>("ai_proposal_decide", { id, accept, keep }),
  /** `threadTitle`: what it proposes goes to the conversation of that name (reused for 7 days). */
  aiTool: (name: string, args: Record<string, unknown>, thread: number | null = null, threadTitle: string | null = null) => invoke<Record<string, unknown>>("ai_tool", { name, args, thread, threadTitle }),
  memoryList: (scope?: string | null, archived?: boolean) => invoke<Memory[]>("memory_list", { scope: scope ?? null, archived: archived ?? false }),
  memoryAdd: (scope: string, kind: MemoryKind, content: string, pinned: boolean) => invoke<Memory>("memory_add", { scope, kind, content, pinned }),
  memoryUpdate: (id: number, patch: { content?: string; kind?: MemoryKind; pinned?: boolean; archived?: boolean }) => invoke<Memory>("memory_update", { id, patch }),
  memoryDelete: (id: number) => invoke<void>("memory_delete", { id }),
  subjectAnalyze: (id: number) => invoke<number>("subject_analyze", { id }),
  subjectBriefs: () => invoke<Record<string, { stale: boolean; updatedAt: number; brief: { summary?: string; binary?: string; estimateTotalMin?: number; features?: { name: string; estimateMin: number; mandatory: boolean }[] } }>>("subject_briefs"),
  insightsList: () => invoke<Insight[]>("insights_list"),
  insightSet: (id: number, status: "dismiss" | "snooze" | "done", hours?: number) => invoke<void>("insight_set", { id, status, hours: hours ?? null }),
  insightsRefresh: () => invoke<number>("insights_refresh"),
  moulinetteAiStart: (repo: string) => invoke<number>("moulinette_ai_start", { repo }),
  genTestsApply: (repo: string, runId: number, paths: string[]) => invoke<number>("gen_tests_apply", { repo, runId, paths }),
  sandboxCheck: () => invoke<void>("sandbox_check"),
  focusGet: () => invoke<FocusSession | null>("focus_get"),
  focusStart: (start: FocusStart) => invoke<FocusSession>("focus_start", { start }),
  focusPause: () => invoke<FocusSession>("focus_pause"),
  focusResume: () => invoke<FocusSession>("focus_resume"),
  focusExtend: (minutes: number) => invoke<FocusSession>("focus_extend", { minutes }),
  focusStop: (done: boolean) => invoke<FocusSession>("focus_stop", { done }),
  focusDiscard: () => invoke<void>("focus_discard"),
  focusStats: (from: number, to: number) => invoke<FocusStats>("focus_stats", { from, to }),

  brainSave: (text: string, project: string | null) => invoke<Capture>("brain_save", { text, project }),
  brainEdit: (id: number, text: string) => invoke<Capture>("brain_edit", { id, text }),
  brainList: (filter: CaptureFilter) => invoke<Capture[]>("brain_list", { filter }),
  brainCount: () => invoke<number>("brain_count"),
  brainSimilar: (id: number) => invoke<Capture[]>("brain_similar", { id }),
  brainConvert: (id: number, kind: CaptureKind) => invoke<Capture>("brain_convert", { id, kind }),
  brainSetProject: (id: number, project: string | null) => invoke<Capture>("brain_set_project", { id, project }),
  brainPin: (id: number, pinned: boolean) => invoke<Capture>("brain_pin", { id, pinned }),
  brainArchive: (id: number, archived: boolean) => invoke<Capture>("brain_archive", { id, archived }),
  brainTags: (id: number, tags: string[]) => invoke<Capture>("brain_tags", { id, tags }),
  brainDelete: (id: number) => invoke<Capture>("brain_delete", { id }),
  brainRestore: (capture: Capture) => invoke<Capture>("brain_restore", { capture }),
  brainAttach: (mime: string, data: string) => invoke<string>("brain_attach", { mime, data }),
  brainImage: (id: string) => invoke<string>("brain_image", { id }),
  /** Artix's suggestions for a capture, as a job (value `suggestion`). */
  brainArtix: (id: number, projects: [string, string][]) => invoke<number>("brain_artix", { id, projects }),
  brainOpenLink: (id: number, url: string) => invoke<void>("brain_open_link", { id, url }),
  captureOpen: () => invoke<void>("capture_open"),
  /** Hides the capture window; `then` brings the main window up there (`inbox`). */
  captureClose: (then: string | null = null) => invoke<void>("capture_close", { then }),
  desktopStatus: () => invoke<DesktopStatus>("desktop_status"),
  desktopApply: () => invoke<DesktopStatus>("desktop_apply"),

  startup: () => invoke<{ page: string | null; sheet: string | null; theme: string | null; repo: string | null; pick: string | null; tool: string | null; run: string | null; report: number | null; anchor: string | null }>("startup"),
};
