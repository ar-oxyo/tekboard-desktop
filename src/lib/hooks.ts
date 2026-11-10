// Data hooks: one query key per backend resource, plus the actions shared by several screens.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { homeDir } from "@tauri-apps/api/path";
import { api, asAppError, type RepoInfo } from "./api";
import { useUi } from "./store";

export const keys = {
  settings: ["settings"] as const,
  repos: ["repos"] as const,
  env: ["env"] as const,
  templates: ["templates"] as const,
  candidates: ["candidates"] as const,
  activity: ["activity"] as const,
  home: ["home"] as const,
  subjects: ["subjects"] as const,
};

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.getSettings, staleTime: Infinity });
export const useRepos = (enabled = true) => useQuery({ queryKey: keys.repos, queryFn: api.scanRepos, enabled });
export const useEnv = () => useQuery({ queryKey: keys.env, queryFn: api.envStatus, staleTime: 60_000 });
export const useTemplates = () => useQuery({ queryKey: keys.templates, queryFn: api.templatesList });
export const useSubjects = () => useQuery({ queryKey: keys.subjects, queryFn: api.subjectsList });
export const useActivity = () => useQuery({ queryKey: keys.activity, queryFn: () => api.recentActivity(12) });
export const useHome = () => useQuery({ queryKey: keys.home, queryFn: homeDir, staleTime: Infinity }).data ?? null;

/** Remote repositories not cloned yet. Only asked for once `gh` is known to be ready. */
export const useCandidates = (enabled: boolean) =>
  useQuery({ queryKey: keys.candidates, queryFn: api.launchCandidates, enabled, staleTime: 5 * 60_000 });

/** Opening actions on a project, with error toasts and state refresh. */
export function useProjectActions() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.repos });
    void qc.invalidateQueries({ queryKey: keys.activity });
  };
  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });

  const workspace = useMutation({
    mutationFn: (repo: RepoInfo) => api.openWorkspace(repo.path),
    onSuccess: (report) => {
      const partial = report.ide ?? report.terminal;
      if (partial) toast({ kind: "error", title: report.ide ? "The IDE did not start" : "The terminal did not start", detail: partial });
      refresh();
    },
    onError: fail("Could not open the workspace"),
  });
  const ide = useMutation({ mutationFn: (repo: RepoInfo) => api.openIde(repo.path), onSuccess: refresh, onError: fail("Could not open the IDE") });
  const terminal = useMutation({ mutationFn: (repo: RepoInfo) => api.openTerminal(repo.path), onSuccess: refresh, onError: fail("Could not open a terminal") });
  const files = useMutation({ mutationFn: (repo: RepoInfo) => api.revealInFiles(repo.path), onError: fail("Could not open the folder") });
  const favorite = useMutation({
    mutationFn: (repo: RepoInfo) => api.setFavorite(repo.path, !repo.meta.favorite),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.repos }),
    onError: fail("Could not update the favorite"),
  });
  const copyUrl = (repo: RepoInfo) => {
    if (!repo.remoteUrl) return;
    navigator.clipboard.writeText(repo.remoteUrl).then(
      () => toast({ kind: "ok", title: "Remote URL copied" }),
      fail("Could not copy"),
    );
  };
  return { workspace, ide, terminal, files, favorite, copyUrl };
}
