// Typed access to the Rust backend. This file is the only place that calls `invoke`.
import { invoke } from "@tauri-apps/api/core";

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

export interface RepoMeta {
  favorite: boolean;
  archived: boolean;
  lastOpenedAt: number | null;
  deadline: string | null;
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
  buildCmd: string | null;
  notes: string;
  archived: boolean;
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
export type JobStatus = "running" | "success" | "warning" | "failed" | "cancelled";
export interface JobStep {
  id: string;
  label: string;
  status: StepStatus;
  detail: string | null;
  durationMs: number | null;
}
export type RunKind = "tests" | "testrepo" | "banana" | "moulinette" | "gen_tests" | "readme" | "build";
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
  claude: { path: string | null; version: string | null };
  banana: { repoChecker: string | null; version: string | null; epiclang: string | null; plugin: boolean };
  docker: boolean;
  valgrind: boolean;
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

// ── MY Epitech
export interface MyStatus {
  windowOpen: boolean;
  connected: boolean;
  expiresAt: number | null;
  account: string | null;
  sessionStored: boolean;
  routes: string[];
}
export interface MyEntry {
  route: string;
  label: string;
  fetchedAt: number;
  status: number;
  size: number;
  body: unknown;
}
export interface MySyncReport {
  ok: number;
  failed: number;
  unauthorized: boolean;
  detail: string;
}

export const api = {
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
  projectSave: (path: string, sheet: ProjectSheet) => invoke<ProjectSheet>("project_save", { path, sheet }),
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
  claudeBrief: (repo: string, task: "tests" | "readme" | "subject", disclosure: boolean) => invoke<ClaudeBrief>("claude_brief", { repo, task, disclosure }),
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

  startup: () => invoke<{ page: string | null; sheet: string | null; theme: string | null; repo: string | null; pick: string | null; tool: string | null; run: string | null; report: number | null }>("startup"),
};
