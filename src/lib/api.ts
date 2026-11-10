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

  startup: () => invoke<{ page: string | null; sheet: string | null }>("startup"),
};
