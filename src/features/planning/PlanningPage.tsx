// Planning: the student's week on a timeline, with MY Epitech sessions and hand-ins drawn
// read-only underneath, an inbox of tasks to drag in, and the projects' remaining work.
import { useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, ChevronLeft, ChevronRight, Inbox, Lightbulb, ListFilter, Plus, RefreshCw, Settings2, Sparkles, Tags, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { Menu, MenuChoice, MenuItem, MenuLabel, MenuSeparator } from "../../components/Menu";
import { Button, cn, Dot, DoneCheck, ErrorNote, IconButton, Spinner, Tag } from "../../components/ui";
import type { PlanTask } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { useNow, usePref } from "../../lib/hooks";
import { addDays, DEFAULT_FILTERS, fmtDur, MIN, startOfDay, startOfWeek, unplanned, visible, type CalItem, type Filters, type Load, type PlanProject } from "../../lib/plan";
import { invalidate } from "../../lib/sync";
import { suggestPlan } from "../artix/suggest";
import { useUi } from "../../lib/store";
import { Countdown } from "../projects/RepoBits";
import { PrefsDialog, ReviewDialog } from "./Dialogs";
import { CalendarSettingsDialog } from "./CalendarSettings";
import { MonthGrid } from "./MonthGrid";
import { dropTarget, TimeGrid } from "./TimeGrid";
import { useLoads, usePlanActions, usePlanData } from "./usePlan";
import { due } from "../../lib/repos";
import { locale, t } from "../../lib/i18n";

// Labels used inside callbacks where `t` names a task.
const L_PROJECT = t("projet");
const L_HIGH = t("priorité haute");
const L_DUE = t("pour le");
const L_IDEAS = t("Idées");

const tr = t;

type View = "day" | "week" | "month";
const FILTER_LABEL: Array<[keyof Filters, string]> = [["work", t("Sessions de travail et tâches")], ["personal", t("Événements et rappels")], ["handins", t("Rendus")], ["school", t("Tes séances d'école")], ["campus", t("Tout le campus")], ["holidays", t("Vacances")]];

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
  const [dialog, setDialog] = useState<"prefs" | "review" | "calendar" | null>(null);
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
      ? new Date(date).toLocaleDateString(locale(), { month: "long", year: "numeric" })
      : view === "day"
        ? new Date(date).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" })
        : `${new Date(days[0]).toLocaleDateString(locale(), { day: "numeric", month: "short" })} – ${new Date(days[6]).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" })}`;

  const open = (i: CalItem) => {
    if (i.source === "plan") useUi.getState().editEvent(i.event!);
    else if (i.project) useUi.getState().openSheet(i.project);
    else toast({ kind: "info", title: i.title, detail: [i.module, i.detail, t("Depuis MY Epitech : en lecture seule. Organise ton travail autour.")].filter(Boolean).join(" · ") });
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

  const autoPlan = (scope: "week" | "day") => void suggestPlan(scope);
  const reorg = () => void suggestPlan("reorganize");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink/6 px-6 py-3">
        <h1 className="display mr-2 text-xl font-medium">{t("Planning")}</h1>
        <Button size="sm" onClick={() => setDate(now)}>
          {t("Aujourd'hui")}
        </Button>
        <IconButton label="Précédent" onClick={() => step(-1)}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <IconButton label="Suivant" onClick={() => step(1)}>
          <ChevronRight className="size-4" />
        </IconButton>
        <span className="min-w-0 truncate text-sm capitalize">{label}</span>
        {data.fetching && <Spinner />}
        <div className="ml-auto flex items-center gap-1.5">
          <div role="tablist" aria-label="Vue" className="flex gap-0.5 rounded-(--btn-radius) border border-ink/8 p-0.5">
            {(["day", "week", "month"] as View[]).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cn("h-6 rounded-[calc(var(--btn-radius)-3px)] px-2.5 text-xs capitalize transition-colors duration-150", view === v ? "bg-raised text-fg" : "text-muted hover:text-fg")}>
                {v === "day" ? t("Jour") : v === "week" ? t("Semaine") : t("Mois")}
              </button>
            ))}
          </div>
          <Menu
            label="Filtres"
            trigger={
              <IconButton label={t("Ce qui est affiché")}>
                <ListFilter className="size-4" />
              </IconButton>
            }
          >
            <MenuLabel>Afficher</MenuLabel>
            {FILTER_LABEL.map(([k, text]) => (
              <MenuChoice key={k} checked={f[k]} onSelect={() => setFilters({ ...f, [k]: !f[k] })}>
                {text}
              </MenuChoice>
            ))}
          </Menu>
          <Menu
            label={t("Planifier")}
            trigger={
              <Button size="sm" icon={<Wand2 className="size-3.5" />}>
                {t("Planifier")}
              </Button>
            }
          >
            <MenuLabel>{t("Calculé par le moteur de TekBoard, à valider avant")}</MenuLabel>
            <MenuItem icon={<CalendarCheck className="size-4" />} onSelect={() => autoPlan("day")}>
              {t("Planifier ma journée")}
            </MenuItem>
            <MenuItem icon={<CalendarCheck className="size-4" />} onSelect={() => autoPlan("week")}>
              {t("Planifier ma semaine")}
            </MenuItem>
            <MenuItem icon={<RefreshCw className="size-4" />} onSelect={reorg}>
              {t("Replacer ce qui n'a pas été fait")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<CalendarCheck className="size-4" />} onSelect={() => setDialog("review")}>
              {t("Bilan de la semaine")}
            </MenuItem>
            <MenuItem icon={<Settings2 className="size-4" />} onSelect={() => setDialog("prefs")}>
              {t("Mon rythme…")}
            </MenuItem>
            <MenuItem icon={<Tags className="size-4" />} onSelect={() => setDialog("calendar")}>
              {t("Catégories et projets affichés…")}
            </MenuItem>
          </Menu>
          <Button size="sm" icon={<Sparkles className="size-3.5" />} onClick={() => useUi.getState().openAssistant()} title={t("Demande à Artix d'organiser ton planning. Rien ne change avant que tu acceptes sa proposition.")}>
            {t("Demander à Artix")}
          </Button>
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => create(Math.ceil(now / (15 * MIN)) * 15 * MIN, Math.ceil(now / (15 * MIN)) * 15 * MIN + 60 * MIN)}>
            {t("Nouveau")}
          </Button>
        </div>
      </header>
      {data.error && (
        <div className="px-6 pt-3">
          <ErrorNote title={t("Le planning n'a pas pu être lu")}>{String((data.error as { message?: string }).message ?? data.error)}</ErrorNote>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {data.loading ? (
            <p className="flex items-center gap-2 p-8 text-muted">
              <Spinner /> {t("Lecture du calendrier…")}
            </p>
          ) : view === "month" ? (
            <MonthGrid date={date} items={shown} now={now} onOpen={open} onMove={move} onPickDay={(d) => (setDate(d), setView("day"))} />
          ) : (
            <TimeGrid days={days} items={shown} now={now} prefs={data.prefs} ghost={ghost} onCreate={create} onOpen={open} onMove={move} onPickDay={(d) => (setDate(d), setView("day"))} />
          )}
        </div>
        <aside className="flex w-[300px] shrink-0 flex-col border-l border-ink/6">
          <div role="tablist" className="flex shrink-0 gap-4 border-b border-ink/6 px-4">
            {([["inbox", t("À placer")], ["projects", t("Projets")]] as const).map(([id, text]) => (
              <button key={id} type="button" role="tab" aria-selected={side === id} onClick={() => setSide(id)} className={cn("-mb-px h-10 border-b-2 text-sm transition-colors duration-150", side === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
                {text}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {side === "inbox" ? <InboxPanel data={data} onDrag={dragTask} now={now} /> : <ProjectsPanel projects={data.projects} loads={loads} now={nowDate} />}
          </div>
          <p className="shrink-0 border-t border-ink/6 px-4 py-2 text-2xs text-faint">
            {data.agenda?.syncedAt ? t("MY Epitech synchronisé {when} · ses entrées sont en lecture seule", { when: timeAgo(data.agenda.syncedAt) }) : t("MY Epitech pas synchronisé : seules tes propres entrées sont affichées.")}{" "}
            <button type="button" className="hover:text-fg" onClick={() => invalidate(qc, ["plan", "repos", "my"])}>
              Actualiser
            </button>
          </p>
        </aside>
      </div>
      {dialog === "prefs" && <PrefsDialog onClose={() => setDialog(null)} />}
      {dialog === "calendar" && <CalendarSettingsDialog onClose={() => setDialog(null)} />}
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
        <span className="text-xs text-faint">{tasks.length === 0 ? t("Rien en attente") : t("{n} à placer · glisse sur le calendrier", { n: tasks.length })}</span>
        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => useUi.getState().editTask({})}>
          {t("Tâche")}
        </Button>
      </div>
      {tasks.length === 0 && (
        <p className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted">
          <Inbox className="size-5 text-faint" />
          {t("Les tâches sans horaire arrivent ici. Ctrl+I en note une depuis n'importe quel écran.")}
        </p>
      )}
      {tasks.map((t) => (
        <div key={t.id} onPointerDown={(e) => onDrag(e, t)} className="group row-hover flex cursor-grab items-start gap-2 rounded-md px-2 py-1.5 active:cursor-grabbing" style={{ touchAction: "none" }}>
          <DoneCheck label={tr("Fait")} className="mt-0.5" checked={false} onChange={() => act.toggleTask(t)} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{t.title}</span>
            <span className="flex flex-wrap items-center gap-x-2 text-2xs whitespace-nowrap text-faint">
              {t.project && (
                <span className="flex min-w-0 items-center gap-1 truncate">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: color(t.project) }} />
                  {name(t.project) ?? L_PROJECT}
                </span>
              )}
              {t.estimateMin !== null && <span>{fmtDur(t.estimateMin)}</span>}
              {t.priority >= 3 && <span className="text-warn">{L_HIGH}</span>}
              {t.dueDay && <span>{L_DUE} {new Date(`${t.dueDay}T12:00`).toLocaleDateString(locale(), { day: "numeric", month: "short" })}</span>}
            </span>
          </span>
        </div>
      ))}
      {ideas.length > 0 && (
        <>
          <p className="mt-3 flex items-center gap-1.5 px-1 text-xs text-faint">
            <Lightbulb className="size-3.5" /> {L_IDEAS}
          </p>
          {ideas.map((t) => (
            <button key={t.id} type="button" onClick={() => useUi.getState().editTask(t)} className="row-hover truncate rounded-md px-2 py-1 text-left text-sm text-muted">
              {t.title}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

const RISK: Record<Load["risk"], { tone: "danger" | "warn" | "ok" | "neutral"; text: string }> = { late: { tone: "danger", text: "late" }, risk: { tone: "warn", text: t("en danger") }, ok: { tone: "ok", text: t("dans les temps") }, unknown: { tone: "neutral", text: t("sans estimation") } };

export function ProjectsPanel({ projects, loads, now }: { projects: PlanProject[]; loads: Map<string, Load>; now: Date }) {
  const withDate = projects.filter((p) => p.dueMs !== null || p.estimateMin !== null);
  if (withDate.length === 0) return <p className="p-6 text-center text-sm text-muted">{t("Aucun projet avec date de rendu ou estimation. Synchronise MY Epitech, ou fixe un rendu dans la fiche d'un projet.")}</p>;
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
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</span>
                {d.state !== "unknown" && <Countdown tone={d.tone}>{d.label}</Countdown>}
              </span>
              <span className="flex w-full items-center gap-2 pl-4 text-2xs text-faint">
                {p.module && <Tag>{p.module}</Tag>}
                <span className="ml-auto">{l && <Dot tone={RISK[l.risk].tone}>{RISK[l.risk].text}</Dot>}</span>
              </span>
              {p.estimateMin !== null && (
                <span className="flex w-full items-center gap-2 pl-4" title={l?.why}>
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-ink/6">
                    <span className="block h-full rounded-full" style={{ width: `${total ? (Math.min(planned, total) / total) * 100 : 100}%`, background: p.color } as CSSProperties} />
                  </span>
                  <span className="shrink-0 font-mono text-3xs text-muted">
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
