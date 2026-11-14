// Planning data for every screen that shows it: the user's entries, MY Epitech's, and what follows from both.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, asAppError, type ScheduleAction, type PlanEvent, type PlanState, type PlanTask } from "../../lib/api";
import { useBoard, usePref, useRepos } from "../../lib/hooks";
import { busySpans, calItems, DEFAULT_PREFS, planProjects, projectLoad, type Load, type PlanPrefs } from "../../lib/plan";
import { useUi } from "../../lib/store";

export const planKey = ["plan"] as const;
const EMPTY: PlanState = { tasks: [], events: [], projects: [], log: [] };

export function usePlanPrefs(): [PlanPrefs, (p: PlanPrefs) => void] {
  const [stored, set] = usePref<Partial<PlanPrefs>>("plan.prefs", DEFAULT_PREFS);
  return [useMemo(() => ({ ...DEFAULT_PREFS, ...stored }), [stored]), set];
}

export function usePlanData() {
  const plan = useQuery({ queryKey: planKey, queryFn: api.planState });
  const agenda = useQuery({ queryKey: ["repos", "agenda"], queryFn: api.myAgenda });
  const board = useBoard();
  const repos = useRepos();
  const [prefs, setPrefs] = usePlanPrefs();
  const state = plan.data ?? EMPTY;
  const projects = useMemo(() => planProjects(board.data ?? [], repos.data ?? [], plan.data), [board.data, repos.data, plan.data]);
  const items = useMemo(() => calItems(plan.data, agenda.data?.items ?? [], projects), [plan.data, agenda.data, projects]);
  const busy = useMemo(() => busySpans(items), [items]);
  return { state, agenda: agenda.data, projects, items, busy, prefs, setPrefs, loading: plan.isLoading || agenda.isLoading || board.isLoading, fetching: agenda.isFetching || plan.isFetching, error: plan.error ?? agenda.error };
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
  const fail = (title: string) => (e: unknown) => {
    toast({ kind: "error", title, detail: asAppError(e).message });
    refresh();
  };
  const patch = (fn: (s: PlanState) => PlanState) => qc.setQueryData<PlanState>(planKey, (old) => (old ? fn(old) : old));

  const saveEvent = useMutation({
    mutationFn: (e: Parameters<typeof api.planEventSave>[0]) => api.planEventSave(e),
    // A dragged entry stays where it was dropped while the save is on its way.
    onMutate: (e) => {
      if (e.id) patch((s) => ({ ...s, events: s.events.map((x) => (x.id === e.id ? ({ ...x, ...e } as PlanEvent) : x)) }));
    },
    onSuccess: refresh,
    onError: fail("Entry not saved"),
  });
  const removeEvent = useMutation({
    mutationFn: (id: number) => api.planEventDelete(id),
    onMutate: (id) => patch((s) => ({ ...s, events: s.events.filter((x) => x.id !== id) })),
    onSuccess: refresh,
    onError: fail("Entry not removed"),
  });
  const saveTask = useMutation({
    mutationFn: (t: Parameters<typeof api.planTaskSave>[0]) => api.planTaskSave(t),
    onMutate: (t) => {
      if (t.id) patch((s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === t.id ? ({ ...x, ...t } as PlanTask) : x)) }));
    },
    onSuccess: refresh,
    onError: fail("Task not saved"),
  });
  const removeTask = useMutation({ mutationFn: (id: number) => api.planTaskDelete(id), onSuccess: refresh, onError: fail("Task not removed") });
  const setProject = useMutation({
    mutationFn: ({ key, ...p }: { key: string; priority?: number; estimateMin?: number | null; color?: string | null }) => api.planProjectSet(key, p),
    onSuccess: refresh,
    onError: fail("Project not updated"),
  });
  const apply = useMutation({
    mutationFn: ({ actions, origin }: { actions: ScheduleAction[]; origin: "auto" | "claude" }) => api.planApply(actions, origin),
    onSuccess: (r) => {
      refresh();
      const parts = [r.created && `${r.created} added`, r.moved && `${r.moved} moved`, r.deleted && `${r.deleted} removed`, r.tasks && `${r.tasks} task${r.tasks > 1 ? "s" : ""}`, r.projects && `${r.projects} project setting${r.projects > 1 ? "s" : ""}`].filter(Boolean);
      toast({ kind: "ok", title: "Plan applied", detail: parts.join(" · ") });
    },
    onError: fail("Plan not applied — nothing was changed"),
  });
  const toggleTask = (t: PlanTask) => saveTask.mutate({ ...t, doneAt: t.doneAt === null ? Math.floor(Date.now() / 1000) : null });
  return { saveEvent, removeEvent, saveTask, removeTask, setProject, apply, toggleTask, refresh };
}
