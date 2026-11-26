// Data hooks: one query key per backend resource, plus the actions shared by several screens.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { homeDir } from "@tauri-apps/api/path";
import { useCallback, useEffect, useState } from "react";
import { api, asAppError, type Progress, type RepoInfo, type RepoKind } from "./api";
import { useUi } from "./store";
import { t } from "./i18n";
import { applyMode, crossFade, MODE_KEY, storedMode, type ColorMode } from "./appearance";
import { ACCENT_KEY, applyAccent } from "./color";

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
/** Shown in everyday lists: not archived, and an Epitech project when "Epitech Projects Only" is on. */
export const everyday = (r: RepoInfo, epitechOnly: boolean) => r.meta.visibility !== "archived" && (!epitechOnly || r.kind === "epitech");

/** Projects (hidden ones are never listed by the backend). `all`: archived and personal ones too,
 *  for the screens that manage projects or look one up by its path. */
export function useRepos(enabled = true, opts: { all?: boolean } = {}) {
  const only = useSettings().data?.epitechOnly ?? true;
  const all = opts.all ?? false;
  const select = useCallback((list: RepoInfo[]) => (all ? list : list.filter((r) => everyday(r, only))), [all, only]);
  return useQuery({ queryKey: keys.repos, queryFn: api.scanRepos, enabled, select });
}
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
      if (partial) toast({ kind: "error", title: report.ide ? t("L'IDE n'a pas démarré") : t("Le terminal n'a pas démarré"), detail: partial });
      refresh();
    },
    onError: fail("Espace de travail non ouvert"),
  });
  const ide = useMutation({ mutationFn: (repo: RepoInfo) => api.openIde(repo.path), onSuccess: refresh, onError: fail("IDE non ouvert") });
  const terminal = useMutation({ mutationFn: (repo: RepoInfo) => api.openTerminal(repo.path), onSuccess: refresh, onError: fail("Terminal non ouvert") });
  const files = useMutation({ mutationFn: (repo: RepoInfo) => api.revealInFiles(repo.path), onError: fail("Dossier non ouvert") });
  const favorite = useMutation({
    mutationFn: (repo: RepoInfo) => api.setFavorite(repo.path, !repo.meta.favorite),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.repos }),
    onError: fail("Favori non modifié"),
  });
  const progress = useMutation({
    mutationFn: ({ repo, status }: { repo: RepoInfo; status: Progress }) => api.projectSetStatus(repo.path, status),
    // Shown at once; the rescan confirms it.
    onMutate: ({ repo, status }) => {
      qc.setQueryData<RepoInfo[]>(keys.repos, (old) => old?.map((r) => (r.path === repo.path ? { ...r, progress: status, progressInferred: false, meta: { ...r.meta, status, archived: status === "done" } } : r)));
    },
    onSettled: refresh,
    onSuccess: (_r, { repo, status }) => {
      if (repo.progress === status) return;
      toast({ kind: "ok", title: t("Statut changé : {s}", { s: status === "done" ? t("terminé") : status === "in_progress" ? t("en cours") : t("à faire") }), action: { label: t("Annuler"), run: () => progress.mutate({ repo: { ...repo, progress: status }, status: repo.progress }) } });
    },
    onError: fail("Statut non modifié"),
  });
  const kind = useMutation({
    mutationFn: ({ repo, kind }: { repo: RepoInfo; kind: RepoKind | null }) => api.projectSetKind(repo.path, kind),
    onSuccess: (_r, { repo }) => {
      refresh();
      toast({ kind: "ok", title: t("Classement modifié"), action: { label: t("Annuler"), run: () => void api.projectSetKind(repo.path, repo.meta.kindOverride).then(refresh) } });
    },
    onError: fail("Classement non modifié"),
  });
  const remote = useMutation({
    mutationFn: (repo: RepoInfo) => api.openRemote(repo.path),
    onSuccess: (r) => {
      if (r.browser !== "firefox") toast({ kind: "info", title: t("Firefox n'est pas installé"), detail: `Ouvert dans ton navigateur par défaut : ${r.url}` });
    },
    onError: fail("Page du dépôt non ouverte"),
  });
  const launch = useMutation({
    mutationFn: (repo: RepoInfo) => api.projectLaunch(repo.path),
    onSuccess: (bin) => {
      toast({ kind: "ok", title: t("{b} lancé dans un terminal", { b: bin }) });
      void qc.invalidateQueries({ queryKey: keys.activity });
    },
    onError: fail("Le programme n'a pas démarré"),
  });
  const copyUrl = (repo: RepoInfo) => {
    if (!repo.remoteUrl) return;
    navigator.clipboard.writeText(repo.remoteUrl).then(
      () => toast({ kind: "ok", title: t("URL distante copiée") }),
      fail("Copie impossible"),
    );
  };
  // Hidden / archived / shown again: only TekBoard's view changes, the folder stays where it is.
  const visibility = useMutation({
    mutationFn: ({ repo, visibility }: { repo: RepoInfo; visibility: "hidden" | "archived" | null }) => api.projectSetVisibility(repo.path, visibility),
    onSuccess: (_r, v) => {
      refresh();
      void qc.invalidateQueries({ queryKey: ["hidden-repos"] });
      toast({
        kind: "ok",
        title: v.visibility === "hidden" ? t("Projet masqué") : v.visibility === "archived" ? t("Projet archivé") : t("Projet restauré"),
        detail: v.visibility ? t("Son dossier n'a pas bougé.") : undefined,
        action: { label: t("Annuler"), run: () => visibility.mutate({ repo: { ...v.repo, meta: { ...v.repo.meta, visibility: v.visibility } }, visibility: v.repo.meta.visibility }) },
      });
    },
    onError: (e) => toast({ kind: "error", title: t("Non modifié"), detail: asAppError(e).message }),
  });
  return { workspace, ide, terminal, files, favorite, copyUrl, progress, kind, remote, launch, visibility };
}

/** Keeps <html data-mode> in step with the preference, the design and the system setting. */
export function useColorMode(theme: string | undefined, forced?: "light" | "dark"): [ColorMode, (m: ColorMode) => void] {
  const [chosen, setStored] = usePref<ColorMode>("colorMode", storedMode());
  // The ambiance of the hour, when that option is on, decides the mode without changing the choice.
  const mode: ColorMode = forced ?? chosen;
  const setPref = (m: ColorMode) => {
    crossFade();
    setStored(m);
  };
  useEffect(() => {
    if (!forced) localStorage.setItem(MODE_KEY, mode);
    applyMode(mode, theme);
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyMode("system", theme);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [mode, theme, forced]);
  return [chosen, setPref];
}

/** A day ambiance and an evening one, switched by the hour (Settings → Appearance). Off by default. */
export interface AutoAmbiance {
  on: boolean;
  dayTheme: string;
  dayMode: "light" | "dark";
  nightTheme: string;
  nightMode: "light" | "dark";
  /** Hour the evening ambiance starts, and the hour the day one comes back. */
  nightFrom: number;
  dayFrom: number;
}
export const AUTO_AMBIANCE: AutoAmbiance = { on: false, dayTheme: "aurora", dayMode: "light", nightTheme: "prune", nightMode: "dark", nightFrom: 19, dayFrom: 7 };

export function useAutoAmbiance(): { theme: string; mode: "light" | "dark"; night: boolean } | null {
  const [a] = usePref<AutoAmbiance>("autoAmbiance", AUTO_AMBIANCE);
  const h = useNow(60_000).getHours();
  if (!a.on) return null;
  const night = a.nightFrom > a.dayFrom ? h >= a.nightFrom || h < a.dayFrom : h >= a.nightFrom && h < a.dayFrom;
  return night ? { theme: a.nightTheme, mode: a.nightMode, night } : { theme: a.dayTheme, mode: a.dayMode, night };
}

/**
 * Personal accent colour (Settings → Appearance), or `null` for the design's own. Applied on
 * top of the design and adjusted for contrast each time the mode or the design changes;
 * mirrored in localStorage so it is there from the first frame.
 */
export function useAccent(): [string | null, (hex: string | null) => void] {
  const [accent, set] = usePref<string | null>("accent", null);
  useEffect(() => {
    if (accent) localStorage.setItem(ACCENT_KEY, accent);
    else localStorage.removeItem(ACCENT_KEY);
    const root = document.documentElement;
    const run = () => applyAccent(accent, root);
    run();
    // Mode and design change the page background the accent is checked against.
    const mo = new MutationObserver(run);
    mo.observe(root, { attributes: true, attributeFilter: ["data-mode", "data-theme"] });
    return () => mo.disconnect();
  }, [accent]);
  return [accent, set];
}

/** Interface animations on or off (Settings → Appearance); the system's reduced-motion setting always wins. */
export function useMotionPref(): [boolean, (on: boolean) => void] {
  const [on, set] = usePref<boolean>("motion", true);
  useEffect(() => {
    document.documentElement.dataset.motion = on ? "on" : "off";
    mirror("tekboard.motion", on ? "on" : "off");
  }, [on]);
  return [on, set];
}

/** Kept in localStorage for `public/boot.js`, which applies it before the first paint. */
function mirror(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not remembered: the default applies at the next start */
  }
}

/** Interface sizes (Settings → Appearance), as zoom factors of the whole window. */
export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;

/**
 * The size suggested for this screen: the window's own scale factor already follows the desktop,
 * so only a very wide logical screen (a large monitor at 100 %) gets a bigger default.
 */
export function suggestedScale(screenWidth = window.screen.width): number {
  return screenWidth >= 3000 ? 1.5 : screenWidth >= 2300 ? 1.25 : screenWidth >= 1900 ? 1.1 : 1;
}

/**
 * Interface size: the webview's native zoom (text, hit areas and menu positions scale
 * together), applied at once by the backend and again at start before the window shows.
 */
export function useUiScale(): [number, (scale: number) => void] {
  const [scale, setPref] = usePref<number>("uiScale", 1);
  const set = (next: number) => {
    void api.appSetZoom(next).then((applied) => setPref(applied), () => undefined);
  };
  return [UI_SCALES.includes(scale as (typeof UI_SCALES)[number]) ? scale : 1, set];
}

/**
 * Light mode (Settings → Appearance): a calmer presentation of every screen, nothing removed.
 * Components read it with `useLite()` (components/lite.tsx); `html[data-lite]` lets the few
 * style-only rules follow, and is set before the first paint from its mirror.
 */
export function useLitePref(): [boolean, (on: boolean) => void] {
  const [on, set] = usePref<boolean>("lite", false);
  useEffect(() => {
    if (on) document.documentElement.dataset.lite = "on";
    else delete document.documentElement.dataset.lite;
    mirror("tekboard.lite", on ? "on" : "off");
  }, [on]);
  return [on, set];
}

/** Developer mode: diagnostics and experiments, off by default (Settings → About, 7 taps). */
export function useDevMode(): [boolean, (on: boolean) => void] {
  return usePref<boolean>("devMode", false);
}
