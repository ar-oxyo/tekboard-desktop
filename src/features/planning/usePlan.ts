// Planning data for every screen that shows it: the user's entries, MY Epitech's, and what follows from both.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { api, asAppError, type ScheduleAction, type PlanEvent, type PlanState, type PlanTask } from "../../lib/api";
import { useBoard, usePref, useRepos } from "../../lib/hooks";
import { busySpans, calItems, DEFAULT_PREFS, withMode, planProjects, projectLoad, type Load, type PlanPrefs } from "../../lib/plan";
import { useUi } from "../../lib/store";
import { t } from "../../lib/i18n";

export const planKey = ["plan"] as const;
const EMPTY: PlanState = { tasks: [], events: [], projects: [], log: [] };

export function usePlanPrefs(): [PlanPrefs, (p: PlanPrefs) => void] {
  const [stored, set] = usePref<Partial<PlanPrefs>>("plan.prefs", DEFAULT_PREFS);
  // Preferences saved before the rhythms had no mode: their ceiling was the user's own.
  return [useMemo(() => withMode({ ...DEFAULT_PREFS, ...(stored && Object.keys(stored).length && !("mode" in stored) ? { mode: "custom" as const } : {}), ...stored }), [stored]), set];
}

export function usePlanData() {
  const plan = useQuery({ queryKey: planKey, queryFn: api.planState });
  const cats = useQuery({ queryKey: ["plan", "categories"], queryFn: api.planCategories, staleTime: 60_000 });
  const categories = useMemo(() => cats.data ?? [], [cats.data]);
  const agenda = useQuery({ queryKey: ["repos", "agenda"], queryFn: api.myAgenda });
  const board = useBoard();
  const repos = useRepos();
  const [prefs, setPrefs] = usePlanPrefs();
  const state = plan.data ?? EMPTY;
  const projects = useMemo(() => planProjects(board.data ?? [], repos.data ?? [], plan.data), [board.data, repos.data, plan.data]);
  const items = useMemo(() => calItems(plan.data, agenda.data?.items ?? [], projects, categories), [plan.data, agenda.data, projects, categories]);
  const busy = useMemo(() => busySpans(calItems(plan.data, agenda.data?.items ?? [], projects, categories, false)), [plan.data, agenda.data, projects, categories]);
  return { state, agenda: agenda.data, projects, items, busy, categories, prefs, setPrefs, loading: plan.isLoading || agenda.isLoading || board.isLoading, fetching: agenda.isFetching || plan.isFetching, error: plan.error ?? agenda.error };
}

/** Planned / remaining / risk of every project, recomputed when the minute changes. */
export function useLoads(data: ReturnType<typeof usePlanData>, now: number): Map<string, Load> {
  const minute = Math.floor(now / 60_000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => new Map(data.projects.map((p) => [p.key, projectLoad(p, data.state.events, data.busy, data.prefs, now)])), [data.projects, data.state.events, data.busy, data.prefs, minute]);
}

export function usePlanActions() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const refresh = () => void qc.invalidateQueries({ queryKey: planKey });
  /**
   * Optimistic change: reads in flight are cancelled (an older answer must not overwrite the
   * change), the previous state is kept, and put back if the backend refuses. A successful
   * write refreshes the plan by itself (lib/sync.ts).
   */
  const optimistic = async (fn: (s: PlanState) => PlanState) => {
    await qc.cancelQueries({ queryKey: planKey });
    const before = qc.getQueryData<PlanState>(planKey);
    if (before) qc.setQueryData<PlanState>(planKey, fn(before));
    return { before };
  };
  const fail = (title: string) => (e: unknown, _v: unknown, ctx?: { before?: PlanState }) => {
    if (ctx?.before) qc.setQueryData(planKey, ctx.before);
    toast({ kind: "error", title, detail: asAppError(e).message });
    refresh();
  };
  let temp = -1;

  const saveEvent = useMutation({
    mutationFn: (e: Parameters<typeof api.planEventSave>[0]) => api.planEventSave(e),
    // A dragged entry stays where it was dropped; a new one shows at once.
    onMutate: (e) =>
      optimistic((s) =>
        e.id
          ? { ...s, events: s.events.map((x) => (x.id === e.id ? ({ ...x, ...e } as PlanEvent) : x)) }
          : { ...s, events: [...s.events, { allDay: false, project: null, taskId: null, color: null, notes: "", origin: "me", done: false, category: null, ...e, id: temp-- } as PlanEvent] },
      ),
    onError: fail("Élément non enregistré"),
  });
  const current = () => qc.getQueryData<PlanState>(planKey);
  // What was just deleted, to bring it back from the toast.
  const removed = useRef(new Map<string, PlanEvent | PlanTask>());
  const removeEvent = useMutation({
    mutationFn: (id: number) => api.planEventDelete(id),
    onMutate: (id) => {
      const gone = current()?.events.find((x) => x.id === id);
      if (gone) removed.current.set(`e${id}`, gone);
      return optimistic((s) => ({ ...s, events: s.events.filter((x) => x.id !== id) }));
    },
    // Deleted, with a way back: the entry is created again as it was.
    onSuccess: (_r, id) => {
      const gone = removed.current.get(`e${id}`) as PlanEvent | undefined;
      if (gone) toast({ kind: "ok", title: t("Supprimé : {x}", { x: gone.title }), action: { label: t("Annuler"), run: () => saveEvent.mutate({ ...gone, id: undefined }) } });
    },
    onError: fail("Élément non supprimé"),
  });
  const saveTask = useMutation({
    mutationFn: (t: Parameters<typeof api.planTaskSave>[0]) => api.planTaskSave(t),
    onMutate: (t) => optimistic((s) => (t.id ? { ...s, tasks: s.tasks.map((x) => (x.id === t.id ? ({ ...x, ...t } as PlanTask) : x)) } : s)),
    onError: fail("Tâche non enregistrée"),
  });
  const removeTask = useMutation({
    mutationFn: (id: number) => api.planTaskDelete(id),
    onMutate: (id) => {
      const gone = current()?.tasks.find((x) => x.id === id);
      if (gone) removed.current.set(`t${id}`, gone);
      return optimistic((s) => ({ ...s, tasks: s.tasks.filter((x) => x.id !== id) }));
    },
    onSuccess: (_r, id) => {
      const gone = removed.current.get(`t${id}`) as PlanTask | undefined;
      if (gone) toast({ kind: "ok", title: t("Tâche supprimée : {x}", { x: gone.title }), action: { label: t("Annuler"), run: () => saveTask.mutate({ ...gone, id: undefined }, { onSuccess: () => refresh() }) } });
    },
    onError: fail("Tâche non supprimée"),
  });
  const setProject = useMutation({
    mutationFn: ({ key, ...p }: { key: string; priority?: number; estimateMin?: number | null; color?: string | null }) => api.planProjectSet(key, p),
    onError: fail("Projet non mis à jour"),
  });
  const apply = useMutation({
    mutationFn: ({ actions, origin }: { actions: ScheduleAction[]; origin: "auto" | "claude" }) => api.planApply(actions, origin),
    onSuccess: (r) => {
      const parts = [r.created && `${r.created} ajouté${r.created > 1 ? "s" : ""}`, r.moved && `${r.moved} déplacé${r.moved > 1 ? "s" : ""}`, r.deleted && `${r.deleted} supprimé${r.deleted > 1 ? "s" : ""}`, r.tasks && `${r.tasks} tâche${r.tasks > 1 ? "s" : ""}`, r.projects && `${r.projects} réglage${r.projects > 1 ? "s" : ""} de projet`].filter(Boolean);
      toast({ kind: "ok", title: t("Plan appliqué"), detail: parts.join(" · ") });
    },
    onError: fail("Plan non appliqué : rien n'a été modifié"),
  });
  const toggleTask = (task: PlanTask) => {
    const done = task.doneAt === null;
    saveTask.mutate({ ...task, doneAt: done ? Math.floor(Date.now() / 1000) : null });
    if (done) toast({ kind: "ok", title: t("Fait : {x}", { x: task.title }), action: { label: t("Annuler"), run: () => saveTask.mutate({ ...task, doneAt: null }) } });
  };
  return { saveEvent, removeEvent, saveTask, removeTask, setProject, apply, toggleTask, refresh };
}
