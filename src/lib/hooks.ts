// Data hooks: one query key per backend resource, plus the actions shared by several screens.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { homeDir } from "@tauri-apps/api/path";
import { useEffect, useState } from "react";
import { api, asAppError, type Progress, type RepoInfo, type RepoKind } from "./api";
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
  /** Under `repos` on purpose: whatever refreshes the repositories refreshes the deadlines. */
  board: ["repos", "board"] as const,
  prefs: ["ui-prefs"] as const,
};

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.getSettings, staleTime: Infinity });
export const useRepos = (enabled = true) => useQuery({ queryKey: keys.repos, queryFn: api.scanRepos, enabled });
export const useEnv = () => useQuery({ queryKey: keys.env, queryFn: api.envStatus, staleTime: 60_000 });
export const useTemplates = () => useQuery({ queryKey: keys.templates, queryFn: api.templatesList });
export const useSubjects = () => useQuery({ queryKey: keys.subjects, queryFn: api.subjectsList });
export const useActivity = () => useQuery({ queryKey: keys.activity, queryFn: () => api.recentActivity(12) });
export const useHome = () => useQuery({ queryKey: keys.home, queryFn: homeDir, staleTime: Infinity }).data ?? null;

export const useBoard = (enabled = true) => useQuery({ queryKey: keys.board, queryFn: api.deadlineBoard, enabled });

/** The current time, refreshed every `ms`: keeps "today 19:42" / "8 min late" honest while the window stays open. */
export function useNow(ms = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * One remembered interface preference (sort order, filters, folded sections), stored with the settings.
 * Returns the fallback until the saved value is read.
 */
export function usePref<T>(name: string, fallback: T): [T, (value: T) => void] {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: keys.prefs, queryFn: api.uiPrefsGet, staleTime: Infinity });
  const stored = prefs.data?.[name];
  const value = stored === undefined ? fallback : (stored as T);
  const set = (next: T) => {
    const all = { ...(qc.getQueryData<Record<string, unknown>>(keys.prefs) ?? {}), [name]: next };
    qc.setQueryData(keys.prefs, all);
    void api.uiPrefsSet(all).catch(() => undefined);
  };
  return [value, set];
}

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
  const progress = useMutation({
    mutationFn: ({ repo, status }: { repo: RepoInfo; status: Progress }) => api.projectSetStatus(repo.path, status),
    // Shown at once; the rescan confirms it.
    onMutate: ({ repo, status }) => {
      qc.setQueryData<RepoInfo[]>(keys.repos, (old) => old?.map((r) => (r.path === repo.path ? { ...r, progress: status, progressInferred: false, meta: { ...r.meta, status, archived: status === "done" } } : r)));
    },
    onSettled: refresh,
    onError: fail("Status not changed"),
  });
  const kind = useMutation({
    mutationFn: ({ repo, kind }: { repo: RepoInfo; kind: RepoKind | null }) => api.projectSetKind(repo.path, kind),
    onSuccess: refresh,
    onError: fail("Classification not changed"),
  });
  const remote = useMutation({
    mutationFn: (repo: RepoInfo) => api.openRemote(repo.path),
    onSuccess: (r) => {
      if (r.browser !== "firefox") toast({ kind: "info", title: "Firefox is not installed", detail: `Opened in your default browser instead: ${r.url}` });
    },
    onError: fail("Could not open the repository page"),
  });
  const launch = useMutation({
    mutationFn: (repo: RepoInfo) => api.projectLaunch(repo.path),
    onSuccess: (bin) => {
      toast({ kind: "ok", title: `${bin} started in a terminal` });
      void qc.invalidateQueries({ queryKey: keys.activity });
    },
    onError: fail("The program did not start"),
  });
  const copyUrl = (repo: RepoInfo) => {
    if (!repo.remoteUrl) return;
    navigator.clipboard.writeText(repo.remoteUrl).then(
      () => toast({ kind: "ok", title: "Remote URL copied" }),
      fail("Could not copy"),
    );
  };
  return { workspace, ide, terminal, files, favorite, copyUrl, progress, kind, remote, launch };
}
