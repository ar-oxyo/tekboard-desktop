// Planning: the student's week on a timeline, with MY Epitech sessions and hand-ins drawn
// read-only underneath, an inbox of tasks to drag in, and the projects' remaining work.
import { useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, ChevronLeft, ChevronRight, Inbox, Lightbulb, ListFilter, Plus, RefreshCw, Settings2, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { Menu, MenuChoice, MenuItem, MenuLabel, MenuSeparator } from "../../components/Menu";
import { Button, cn, Dot, ErrorNote, IconButton, Spinner, Tag } from "../../components/ui";
import type { PlanTask } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { useNow, usePref } from "../../lib/hooks";
import { addDays, DEFAULT_FILTERS, fmtDur, MIN, reorganize, schedule, startOfDay, startOfWeek, unplanned, visible, type CalItem, type Filters, type Load, type PlanProject } from "../../lib/plan";
import { invalidate } from "../../lib/sync";
import { useUi } from "../../lib/store";
import { Countdown } from "../projects/RepoBits";
import { PrefsDialog, ReviewDialog } from "./Dialogs";
import { MonthGrid } from "./MonthGrid";
import { dropTarget, TimeGrid } from "./TimeGrid";
import { useLoads, usePlanActions, usePlanData } from "./usePlan";
import { due } from "../../lib/repos";

type View = "day" | "week" | "month";
const FILTER_LABEL: Array<[keyof Filters, string]> = [["work", "Work sessions and tasks"], ["personal", "Events and reminders"], ["handins", "Hand-ins"], ["school", "Your school sessions"], ["campus", "Whole campus"], ["holidays", "Holidays"]];

export function PlanningPage() {
  const data = usePlanData();
  const act = usePlanActions();
  const qc = useQueryClient();
  const nowDate = useNow(30_000);
  const now = nowDate.getTime();
  const loads = useLoads(data, now);
  const [view, setView] = usePref<View>("plan.view", "week");
  const [filters, setFilters] = usePref<Filters>("plan.filters", DEFAULT_FILTERS);
  const [side, setSide] = usePref<"inbox" | "projects">("plan.side", "inbox");
  const [date, setDate] = useState(() => useUi.getState().planDate ?? now);
  // Left open overnight on "today": follow the new day.
  useEffect(() => {
    const onDay = () => setDate((d) => (startOfDay(d) === startOfDay(Date.now() - 86_400_000) ? Date.now() : d));
    window.addEventListener("tekboard:day-changed", onDay);
    return () => window.removeEventListener("tekboard:day-changed", onDay);
  }, []);
  const [ghost, setGhost] = useState<{ start: number; end: number; title: string } | null>(null);
  const [dialog, setDialog] = useState<"prefs" | "review" | null>(null);
  const propose = useUi((s) => s.propose);
  const toast = useUi((s) => s.toast);
  const f = { ...DEFAULT_FILTERS, ...filters };

  useEffect(() => {
    const d = useUi.getState().planDate;
    if (d !== null) {
      setDate(d);
      useUi.setState({ planDate: null });
    }
  }, []);

  const days = useMemo(() => {
    if (view === "day") return [startOfDay(date)];
    const start = startOfWeek(date);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [view, date]);
  const shown = useMemo(() => data.items.filter((i) => visible(i, f)), [data.items, f]);

  const step = (n: number) => setDate(view === "month" ? new Date(new Date(date).getFullYear(), new Date(date).getMonth() + n, 1).getTime() : addDays(date, n * (view === "day" ? 1 : 7)));
  const label =
    view === "month"
      ? new Date(date).toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : view === "day"
        ? new Date(date).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
        : `${new Date(days[0]).toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${new Date(days[6]).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;

  const open = (i: CalItem) => {
    if (i.source === "plan") useUi.getState().editEvent(i.event!);
    else if (i.project) useUi.getState().openSheet(i.project);
    else toast({ kind: "info", title: i.title, detail: [i.module, i.detail, "From MY Epitech: read-only. Plan your work around it."].filter(Boolean).join(" · ") });
  };
  const move = (i: CalItem, start: number, end: number) => i.event && act.saveEvent.mutate({ ...i.event, start: Math.floor(start / 1000), end: Math.floor(end / 1000) });
  const create = (start: number, end: number) => useUi.getState().editEvent({ kind: "session", start: Math.floor(start / 1000), end: Math.floor(end / 1000) });

  /** An inbox task dragged onto the calendar becomes an entry holding it. */
  const dragTask = (e: RPointerEvent, t: PlanTask) => {
    if (e.button !== 0) return;
    const minutes = Math.min(t.estimateMin ?? 60, data.prefs.sessionMinutes) || 60;
    const [x0, y0] = [e.clientX, e.clientY];
    let moved = false;
    let target: ReturnType<typeof dropTarget> = null;
    const mv = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      moved = true;
      document.body.style.userSelect = "none";
      target = dropTarget(ev.clientX, ev.clientY);
      const start = target ? (target.time ?? target.day + data.prefs.dayStart * MIN) : null;
      setGhost(start !== null ? { start, end: start + minutes * MIN, title: t.title } : null);
    };
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      setGhost(null);
      if (!moved) return useUi.getState().editTask(t);
      if (!target) return;
      const start = target.time ?? target.day + data.prefs.dayStart * MIN;
      act.saveEvent.mutate({ kind: "task", title: t.title, project: t.project, taskId: t.id, start: Math.floor(start / 1000), end: Math.floor((start + minutes * MIN) / 1000) });
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };

  const autoPlan = (scope: "week" | "day") => {
    const r = schedule(data.projects, data.state.events, data.busy, data.prefs, now, { horizonDays: scope === "day" ? 1 : 7 });
    if (r.actions.length === 0 && r.unplaced.length === 0) {
      return toast({ kind: "info", title: "Nothing to plan", detail: "Give a project an estimate of the work left (Projects tab on the right) and TekBoard will spread it before the hand-in." });
    }
    propose({ title: scope === "day" ? "Plan for today" : "Plan for the week", origin: "auto", actions: r.actions, note: r.unplaced.length ? `Not enough free time for: ${r.unplaced.map((u) => `${u.title} (${fmtDur(u.minutes)})`).join(", ")}.` : null });
  };
  const reorg = () => {
    const r = reorganize(data.state.events, data.projects, data.busy, data.prefs, now);
    if (r.actions.length === 0) return toast({ kind: "info", title: "Nothing to move", detail: r.unplaced.length ? "No free time found for what was not done." : "Every past session is marked done." });
    propose({ title: "Move what was not done", origin: "auto", actions: r.actions, note: r.unplaced.length ? `No room before the hand-in for: ${r.unplaced.map((u) => u.title).join(", ")}.` : null });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/6 px-6 py-3">
        <h1 className="display mr-2 text-[20px] font-medium">Planning</h1>
        <Button size="sm" onClick={() => setDate(now)}>
          Today
        </Button>
        <IconButton label="Previous" onClick={() => step(-1)}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <IconButton label="Next" onClick={() => step(1)}>
          <ChevronRight className="size-4" />
        </IconButton>
        <span className="min-w-0 truncate text-[13px] capitalize">{label}</span>
        {data.fetching && <Spinner />}
        <div className="ml-auto flex items-center gap-1.5">
          <div role="tablist" aria-label="View" className="flex gap-0.5 rounded-(--btn-radius) border border-white/8 p-0.5">
            {(["day", "week", "month"] as View[]).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cn("h-6 rounded-[calc(var(--btn-radius)-3px)] px-2.5 text-xs capitalize transition-colors duration-150", view === v ? "bg-raised text-fg" : "text-muted hover:text-fg")}>
                {v}
              </button>
            ))}
          </div>
          <Menu
            label="Filters"
            trigger={
              <IconButton label="What to show">
                <ListFilter className="size-4" />
              </IconButton>
            }
          >
            <MenuLabel>Show</MenuLabel>
            {FILTER_LABEL.map(([k, text]) => (
              <MenuChoice key={k} checked={f[k]} onSelect={() => setFilters({ ...f, [k]: !f[k] })}>
                {text}
              </MenuChoice>
            ))}
          </Menu>
          <Menu
            label="Plan"
            trigger={
              <Button size="sm" icon={<Wand2 className="size-3.5" />}>
                Plan
              </Button>
            }
          >
            <MenuLabel>Computed here, previewed before saving</MenuLabel>
            <MenuItem icon={<CalendarCheck className="size-4" />} onSelect={() => autoPlan("day")}>
              Plan my day
            </MenuItem>
            <MenuItem icon={<CalendarCheck className="size-4" />} onSelect={() => autoPlan("week")}>
              Plan my week
            </MenuItem>
            <MenuItem icon={<RefreshCw className="size-4" />} onSelect={reorg}>
              Reorganize what was not done
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<CalendarCheck className="size-4" />} onSelect={() => setDialog("review")}>
              Weekly review
            </MenuItem>
            <MenuItem icon={<Settings2 className="size-4" />} onSelect={() => setDialog("prefs")}>
              Working hours and limits…
            </MenuItem>
          </Menu>
          <Button size="sm" icon={<Sparkles className="size-3.5" />} onClick={() => useUi.getState().openAssistant()} title="Ask Claude to organise your planning. Nothing changes before you apply its plan.">
            Ask Claude
          </Button>
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => create(Math.ceil(now / (15 * MIN)) * 15 * MIN, Math.ceil(now / (15 * MIN)) * 15 * MIN + 60 * MIN)}>
            New
          </Button>
        </div>
      </header>
      {data.error && (
        <div className="px-6 pt-3">
          <ErrorNote title="The planning could not be read">{String((data.error as { message?: string }).message ?? data.error)}</ErrorNote>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {data.loading ? (
            <p className="flex items-center gap-2 p-8 text-muted">
              <Spinner /> Reading your calendar…
            </p>
          ) : view === "month" ? (
            <MonthGrid date={date} items={shown} now={now} onOpen={open} onMove={move} onPickDay={(d) => (setDate(d), setView("day"))} />
          ) : (
            <TimeGrid days={days} items={shown} now={now} prefs={data.prefs} ghost={ghost} onCreate={create} onOpen={open} onMove={move} onPickDay={(d) => (setDate(d), setView("day"))} />
          )}
        </div>
        <aside className="flex w-[300px] shrink-0 flex-col border-l border-white/6">
          <div role="tablist" className="flex shrink-0 gap-4 border-b border-white/6 px-4">
            {([["inbox", "Inbox"], ["projects", "Projects"]] as const).map(([id, text]) => (
              <button key={id} type="button" role="tab" aria-selected={side === id} onClick={() => setSide(id)} className={cn("-mb-px h-10 border-b-2 text-[13px] transition-colors duration-150", side === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
                {text}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {side === "inbox" ? <InboxPanel data={data} onDrag={dragTask} now={now} /> : <ProjectsPanel projects={data.projects} loads={loads} now={nowDate} />}
          </div>
          <p className="shrink-0 border-t border-white/6 px-4 py-2 text-[11px] text-faint">
            {data.agenda?.syncedAt ? `MY Epitech synced ${timeAgo(data.agenda.syncedAt)} · its entries are read-only` : "MY Epitech not synced: only your own entries are shown."}{" "}
            <button type="button" className="hover:text-fg" onClick={() => invalidate(qc, ["plan", "repos", "my"])}>
              Refresh
            </button>
          </p>
        </aside>
      </div>
      {dialog === "prefs" && <PrefsDialog onClose={() => setDialog(null)} />}
      {dialog === "review" && <ReviewDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function InboxPanel({ data, onDrag, now }: { data: ReturnType<typeof usePlanData>; onDrag: (e: RPointerEvent, t: PlanTask) => void; now: number }) {
  const act = usePlanActions();
  const tasks = unplanned(data.state.tasks, data.state.events, now).filter((t) => t.parentId === null);
  const ideas = data.state.tasks.filter((t) => t.kind === "idea" && t.doneAt === null);
  const color = (key: string | null) => data.projects.find((p) => p.key === key)?.color ?? "var(--color-faint)";
  const name = (key: string | null) => data.projects.find((p) => p.key === key)?.title;
  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-xs text-faint">{tasks.length === 0 ? "Nothing waiting" : `${tasks.length} to place · drag onto the calendar`}</span>
        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => useUi.getState().editTask({})}>
          Task
        </Button>
      </div>
      {tasks.length === 0 && (
        <p className="flex flex-col items-center gap-2 px-4 py-8 text-center text-[13px] text-muted">
          <Inbox className="size-5 text-faint" />
          Tasks without a time land here. Ctrl+I captures one from any screen.
        </p>
      )}
      {tasks.map((t) => (
        <div key={t.id} onPointerDown={(e) => onDrag(e, t)} className="group row-hover flex cursor-grab items-start gap-2 rounded-md px-2 py-1.5 active:cursor-grabbing" style={{ touchAction: "none" }}>
          <input type="checkbox" aria-label="Done" className="mt-0.5 accent-(--color-accent)" checked={false} onPointerDown={(e) => e.stopPropagation()} onChange={() => act.toggleTask(t)} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px]">{t.title}</span>
            <span className="flex items-center gap-2 text-[11px] text-faint">
              {t.project && (
                <span className="flex min-w-0 items-center gap-1 truncate">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: color(t.project) }} />
                  {name(t.project) ?? "project"}
                </span>
              )}
              {t.estimateMin !== null && <span>{fmtDur(t.estimateMin)}</span>}
              {t.priority >= 3 && <span className="text-warn">high</span>}
              {t.dueDay && <span>due {new Date(`${t.dueDay}T12:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>}
            </span>
          </span>
        </div>
      ))}
      {ideas.length > 0 && (
        <>
          <p className="mt-3 flex items-center gap-1.5 px-1 text-xs text-faint">
            <Lightbulb className="size-3.5" /> Ideas
          </p>
          {ideas.map((t) => (
            <button key={t.id} type="button" onClick={() => useUi.getState().editTask(t)} className="row-hover truncate rounded-md px-2 py-1 text-left text-[13px] text-muted">
              {t.title}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

const RISK: Record<Load["risk"], { tone: "danger" | "warn" | "ok" | "neutral"; text: string }> = { late: { tone: "danger", text: "late" }, risk: { tone: "warn", text: "at risk" }, ok: { tone: "ok", text: "on track" }, unknown: { tone: "neutral", text: "no estimate" } };

export function ProjectsPanel({ projects, loads, now }: { projects: PlanProject[]; loads: Map<string, Load>; now: Date }) {
  const withDate = projects.filter((p) => p.dueMs !== null || p.estimateMin !== null);
  if (withDate.length === 0) return <p className="p-6 text-center text-[13px] text-muted">No project with a hand-in date or an estimate yet. Sync MY Epitech, or set a deadline in a project sheet.</p>;
  return (
    <ul className="flex flex-col gap-1 p-3">
      {withDate.map((p) => {
        const l = loads.get(p.key);
        const d = due(p.day, p.at, now);
        const planned = l?.planned ?? 0;
        const total = Math.max(p.estimateMin ?? 0, planned);
        return (
          <li key={p.key}>
            <button type="button" onClick={() => useUi.getState().openSheet(p.repoPath ?? "")} disabled={!p.repoPath} className="row-hover flex w-full flex-col gap-1.5 rounded-md px-2 py-2 text-left disabled:cursor-default">
              <span className="flex w-full items-center gap-2">
                <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{p.title}</span>
                {d.state !== "unknown" && <Countdown tone={d.tone}>{d.label}</Countdown>}
              </span>
              <span className="flex w-full items-center gap-2 pl-4 text-[11px] text-faint">
                {p.module && <Tag>{p.module}</Tag>}
                <span className="ml-auto">{l && <Dot tone={RISK[l.risk].tone}>{RISK[l.risk].text}</Dot>}</span>
              </span>
              {p.estimateMin !== null && (
                <span className="flex w-full items-center gap-2 pl-4" title={l?.why}>
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/6">
                    <span className="block h-full rounded-full" style={{ width: `${total ? (Math.min(planned, total) / total) * 100 : 100}%`, background: p.color } as CSSProperties} />
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted">
                    {fmtDur(planned)} / {fmtDur(p.estimateMin)}
                  </span>
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
