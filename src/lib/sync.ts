// One place that knows which screens read which data. The backend announces what changed
// (`data-changed` with domains, after every write, job, sync or background task) and this
// table turns it into query invalidations. A screen never needs a "Refresh" button to see
// a change made elsewhere: by Artix, by a sync, by another window part.
import { listen } from "@tauri-apps/api/event";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

export type Domain = "plan" | "repos" | "focus" | "memory" | "insights" | "runs" | "subjects" | "my" | "libraries" | "settings" | "prompts" | "templates" | "ai" | "activity" | "playground" | "arena" | "boards";

/** Query key prefixes fed by each domain. */
export const DOMAIN_KEYS: Record<Domain, QueryKey[]> = {
  plan: [["plan"], ["today"]],
  // `rekey` moves plan entries when a repository appears: the plan follows the repositories.
  repos: [["repos"], ["plan"], ["git"], ["testing-info"], ["run-info"], ["activity"], ["today"]],
  focus: [["focus"], ["plan"], ["today"], ["stats"]],
  memory: [["memory"]],
  insights: [["insights"], ["today"]],
  runs: [["runs"], ["job-active"], ["today"]],
  subjects: [["subjects"], ["briefs"], ["subject-briefs"]],
  my: [["my-status"], ["my-data"], ["my-logtime"], ["my-overview"], ["my-academic"], ["repos"], ["plan"], ["subjects"]],
  libraries: [["libraries"], ["lib-status"], ["lib-catalog"], ["lib-presets"], ["lib-suggestions"]],
  settings: [["settings"], ["ui-prefs"], ["claude-info"]],
  prompts: [["prompts"]],
  templates: [["templates"]],
  ai: [["ai-threads"], ["ai-thread"], ["ai-proposals"], ["ai-actions"], ["focus"]],
  activity: [["activity"]],
  playground: [["playground"]],
  arena: [["arena"]],
  boards: [["boards"]],
};

/** What each writing command changes. Read-only commands are absent. */
export const COMMAND_DOMAINS: Record<string, Domain[]> = {
  save_settings: ["settings", "repos"],
  playground_create: ["playground"],
  playground_set_open: ["playground"],
  playground_delete: ["playground"],
  playground_run: ["runs"],
  playground_export: ["repos"],
  arena_save: ["arena"],
  board_create: ["boards"],
  board_rename: ["boards"],
  board_set_project: ["boards"],
  board_set_position: ["boards"],
  board_duplicate: ["boards"],
  board_delete: ["boards"],
  board_restore: ["boards"],
  board_import: ["boards"],
  arena_delete: ["arena"],
  arena_run: ["runs"],
  arena_generate: ["runs"],
  arena_report: ["runs"],
  ui_prefs_set: ["settings", "plan"],
  set_favorite: ["repos"],
  clone_project: ["repos", "activity"],
  template_import: ["templates"],
  template_duplicate: ["templates"],
  template_delete: ["templates"],
  template_edit: ["templates"],
  template_apply: ["repos", "activity"],
  stage_files: ["repos"],
  commit_staged: ["repos", "activity"],
  project_save: ["repos", "plan"],
  project_set_status: ["repos", "plan", "insights"],
  project_set_kind: ["repos"],
  project_set_my: ["repos", "plan"],
  project_deadline_from_my: ["repos", "plan"],
  project_build: ["runs"],
  subjects_import: ["subjects"],
  subject_link: ["subjects", "repos"],
  subject_remove: ["subjects"],
  git_unstage: ["repos"],
  git_sync: ["repos", "activity"],
  git_create_branch: ["repos"],
  git_switch_branch: ["repos"],
  plan_task_save: ["plan", "insights"],
  plan_task_delete: ["plan"],
  plan_event_save: ["plan", "insights"],
  plan_event_delete: ["plan"],
  plan_project_set: ["plan"],
  plan_log_add: ["plan", "focus"],
  plan_apply: ["plan", "insights"],
  library_add: ["libraries"],
  library_unregister: ["libraries"],
  library_set_meta: ["libraries"],
  library_preset_save: ["libraries"],
  library_preset_delete: ["libraries"],
  library_apply: ["libraries", "repos"],
  library_restore: ["libraries", "repos"],
  library_import: ["libraries"],
  my_import_subjects: ["subjects"],
  my_sync: ["my"],
  my_sync_auto: ["my", "subjects", "repos", "plan"],
  subject_suggestion_decide: ["subjects"],
  subjects_associate: ["subjects"],
  project_set_visibility: ["repos", "plan", "subjects"],
  plan_project_calendar: ["plan"],
  plan_category_save: ["plan"],
  plan_category_delete: ["plan"],
  my_apply_deadlines: ["repos", "plan"],
  my_forget: ["my"],
  project_config_set: ["repos"],
  quick_forget: ["runs"],
  testrepo_env_delete: ["runs"],
  prompt_save: ["prompts"],
  prompt_delete: ["prompts"],
  prompt_activate: ["prompts"],
  readme_write: ["repos"],
  ai_send: ["ai"],
  ai_thread_delete: ["ai"],
  ai_settings_set: ["settings"],
  ai_undo: ["ai", "plan", "memory", "focus"],
  ai_proposal_decide: ["ai", "plan", "insights"],
  ai_tool: ["ai", "plan", "memory", "focus"],
  memory_add: ["memory"],
  memory_update: ["memory"],
  memory_delete: ["memory"],
  insight_set: ["insights"],
  gen_tests_apply: ["repos", "runs"],
  focus_start: ["focus"],
  focus_pause: ["focus"],
  focus_resume: ["focus"],
  focus_extend: ["focus"],
  focus_stop: ["focus", "plan"],
  focus_discard: ["focus"],
};

let client: QueryClient | null = null;

/** Called once by the app: lets `afterCommand` reach the query cache. */
export const getQueryClient = (): QueryClient | null => client;

export function setQueryClient(qc: QueryClient) {
  client = qc;
}

/** After a writing command succeeded: every screen that shows what it changed re-reads it. */
export function afterCommand(command: string) {
  const domains = COMMAND_DOMAINS[command];
  if (client && domains) invalidate(client, domains);
}

/** The distinct key prefixes to invalidate for these domains. Exported for the tests. */
export function keysFor(domains: string[]): QueryKey[] {
  const seen = new Set<string>();
  const out: QueryKey[] = [];
  for (const d of domains) {
    for (const k of DOMAIN_KEYS[d as Domain] ?? []) {
      const id = JSON.stringify(k);
      if (!seen.has(id)) {
        seen.add(id);
        out.push(k);
      }
    }
  }
  return out;
}

export function invalidate(qc: QueryClient, domains: Domain[]) {
  for (const k of keysFor(domains)) void qc.invalidateQueries({ queryKey: k });
}

/** Installs the listener once for the whole app. */
export function listenData(qc: QueryClient) {
  return listen<string[]>("data-changed", (e) => {
    for (const k of keysFor(e.payload)) void qc.invalidateQueries({ queryKey: k });
  });
}
