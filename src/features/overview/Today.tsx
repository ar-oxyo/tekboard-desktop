// Dashboard blocks centred on the day: what to do now, today's timeline, the coming load, quick actions.
import { CalendarDays, CalendarPlus, ClipboardCheck, Flag, Lock, PenLine, Play, Plus, Sparkles, Sun, TriangleAlert, Wand2 } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { api, asAppError } from "../../lib/api";
import { Button, Card, CardTitle, cn, Dot, Spinner, Tag } from "../../components/ui";
import { useNow } from "../../lib/hooks";
import { addDays, fmtDur, hhmm, MIN, nextUp, schedule, startOfDay, toRegister, workload, type CalItem } from "../../lib/plan";
import { due } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { ReviewDialog } from "../planning/Dialogs";
import { startFocus } from "../planning/Focus";
import { useLoads, usePlanData } from "../planning/usePlan";
import { Countdown } from "../projects/RepoBits";

export function TodayCard() {
  const data = usePlanData();
  const nowDate = useNow(30_000);
  const now = nowDate.getTime();
  const loads = useLoads(data, now);
  const ui = useUi.getState;
  const day = startOfDay(now);
  const today = useMemo(() => data.items.filter((i) => i.start < addDays(day, 1) && i.end > day && i.kind !== "campus" && !(i.allDay && i.kind !== "deadline" && i.kind !== "holiday")), [data.items, day]);
  const next = nextUp(data.items, data.projects, loads, now);
  const register = toRegister(data.items, now);
  const peerTodo = data.agenda?.peerTodo ?? [];
  const workToday = today.filter((i) => i.kind === "session" || i.kind === "task");
  // The "morning plan": offered (never applied) when nothing is planned and there is work to place.
  const suggestion = useMemo(() => (data.prefs.morningPlan && workToday.length === 0 ? schedule(data.projects, data.state.events, data.busy, data.prefs, now, { horizonDays: 1 }) : null), [data.prefs, workToday.length, data.projects, data.state.events, data.busy, now]);
  const greeting = new Date(now).getHours() < 12 ? "Good morning" : new Date(now).getHours() < 18 ? "Good afternoon" : "Good evening";

  let hero: ReactNode;
  if (next.kind === "now" || next.kind === "soon") {
    const i = next.item;
    hero = (
      <>
        <p className="text-xs text-faint">{next.kind === "now" ? `Now · until ${hhmm(i.end)}` : `Next · ${hhmm(i.start)}, in ${fmtDur((i.start - now) / MIN)}`}</p>
        <h3 className="display mt-2 truncate text-[28px] leading-[1.15] font-medium">{i.title}</h3>
        <p className="mt-1 text-[13px] text-muted">{[i.module, fmtDur((i.end - i.start) / MIN), i.detail].filter(Boolean).join(" · ")}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" icon={<Play className="size-3.5" />} onClick={() => startFocus({ title: i.title, project: i.project, taskId: i.event?.taskId ?? null, eventId: i.event?.id ?? null, plannedMin: Math.round((i.end - Math.max(now, i.start)) / MIN) })}>
            Start focus
          </Button>
          <Button onClick={() => i.event && ui().editEvent(i.event)}>Edit</Button>
        </div>
      </>
    );
  } else if (next.kind === "plan" || next.kind === "start") {
    const p = next.project;
    const d = due(p.day, p.at, nowDate);
    hero = (
      <>
        <p className="text-xs text-faint">{next.kind === "plan" ? "Needs time in your calendar" : "Nearest hand-in"}</p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
          <h3 className="display truncate text-[28px] leading-[1.15] font-medium">{p.title}</h3>
          {p.module && <Tag>{p.module}</Tag>}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-3 text-[13px] text-muted">
          {d.state !== "unknown" && <Countdown tone={d.tone}>{d.label}</Countdown>}
          <span>{next.load.why || (p.estimateMin === null ? "no estimate of the work left yet" : "")}</span>
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" icon={<Play className="size-3.5" />} onClick={() => startFocus({ title: p.title, project: p.key, taskId: null, eventId: null, plannedMin: data.prefs.sessionMinutes })}>
            Work on it now
          </Button>
          <Button icon={<Wand2 className="size-3.5" />} onClick={() => ui().openAssistant({ text: "#week" })}>
            Plan my week
          </Button>
          {p.repoPath && <Button onClick={() => ui().openSheet(p.repoPath!)}>Project</Button>}
        </div>
      </>
    );
  } else {
    hero = (
      <>
        <p className="text-xs text-faint">Nothing urgent</p>
        <h3 className="display mt-2 text-[28px] leading-[1.15] font-medium">Your day is free</h3>
        <p className="mt-1 text-[13px] text-muted">No session planned and no hand-in ahead. Capture what you want to do, or pick a project.</p>
        <div className="mt-5 flex gap-2">
          <Button icon={<Plus className="size-3.5" />} onClick={() => ui().setCaptureOpen(true)}>
            Capture a task
          </Button>
        </div>
      </>
    );
  }

  return (
    <Card hero>
      <div className="p-6">
        <div className="flex items-center justify-between text-xs text-faint">
          <span>{greeting}</span>
          {data.loading && <Spinner />}
        </div>
        <div className="mt-3">{hero}</div>
      </div>
      {register.length > 0 && (
        <div className="flex items-start gap-3 border-t border-white/6 px-6 py-3 text-[13px]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
          <div className="min-w-0 flex-1">
            <p className="text-muted">Mandatory {register.length === 1 ? "session" : "sessions"} you are not registered to. Register on MY Epitech.</p>
            <ul className="mt-1">
              {register.map((i) => (
                <li key={i.id} className="flex min-h-7 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <span className="shrink-0 text-xs text-faint">{new Date(i.start).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span>
                  {i.agenda?.eventId != null && <FreeSlots eventId={i.agenda.eventId} />}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {peerTodo.length > 0 && (
        <div className="flex items-center gap-3 border-t border-white/6 px-6 py-3 text-[13px]">
          <ClipboardCheck className="size-4 shrink-0 text-warn" />
          <span className="min-w-0 flex-1 truncate text-muted">
            {peerTodo.length} peer evaluation{peerTodo.length > 1 ? "s" : ""} to submit: <span className="text-fg">{[...new Set(peerTodo)].join(", ")}</span>
          </span>
        </div>
      )}
      {suggestion && suggestion.actions.length > 0 && (
        <div className="flex items-center gap-3 border-t border-white/6 px-6 py-3 text-[13px]">
          <Sun className="size-4 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 text-muted">
            Nothing planned today. {suggestion.actions.length} session{suggestion.actions.length > 1 ? "s" : ""} would fit ({fmtDur(suggestion.actions.reduce((s, a) => s + (a.type === "create_session" ? (Date.parse(a.end) - Date.parse(a.start)) / MIN : 0), 0))}).
          </span>
          <Button size="sm" onClick={() => ui().propose({ title: "Plan for today", origin: "auto", actions: suggestion.actions, note: null })}>
            Review
          </Button>
        </div>
      )}
      <div className="border-t border-white/6 px-6 py-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-faint">Today</span>
          <button type="button" className="flex items-center gap-1 text-xs text-muted hover:text-fg" onClick={() => ui().openPlanning(now)}>
            <CalendarDays className="size-3.5" /> Open planning
          </button>
        </div>
        {today.length === 0 ? (
          <p className="py-2 text-[13px] text-muted">Nothing on the calendar today.</p>
        ) : (
          <ul>
            {today.map((i) => (
              <TodayRow key={i.id} i={i} now={now} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function TodayRow({ i, now }: { i: CalItem; now: number }) {
  const past = i.end < now && i.kind !== "deadline";
  const current = i.start <= now && i.end > now;
  const ui = useUi.getState;
  return (
    <li>
      <button type="button" onClick={() => (i.event ? ui().editEvent(i.event) : i.project ? ui().openSheet(i.project) : ui().openPlanning(now))} className={cn("row-hover -mx-2 flex min-h-9 w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 text-left text-[13px]", past && "opacity-50")}>
        <span className="w-24 shrink-0 font-mono text-xs text-muted">{i.allDay ? "all day" : i.kind === "deadline" ? hhmm(i.end) : `${hhmm(i.start)} – ${hhmm(i.end)}`}</span>
        <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: i.color } as CSSProperties} />
        <span className={cn("min-w-0 flex-1 truncate", i.done && "line-through", current && "font-medium")}>{i.title}</span>
        {i.kind === "deadline" && <Flag className="size-3.5 shrink-0 text-danger" />}
        {i.source === "my" && i.kind !== "deadline" && <Lock className="size-3 shrink-0 text-faint" aria-label="From MY Epitech" />}
        {current && <Dot tone="accent">now</Dot>}
      </button>
    </li>
  );
}

/** The next seven days as bars: school, planned work, other entries, and hand-ins. */
export function WorkloadCard() {
  const data = usePlanData();
  const now = useNow().getTime();
  const days = workload(data.items, data.prefs, startOfDay(now), 7);
  const span = data.prefs.dayEnd - data.prefs.dayStart;
  return (
    <Card>
      <CardTitle right={<span className="text-xs text-faint">max {fmtDur(data.prefs.maxMinutesPerDay)} of work a day</span>}>Coming days</CardTitle>
      <ul className="flex flex-col gap-1.5 px-4 py-3">
        {days.map((d) => {
          const total = d.school + d.work + d.other;
          return (
            <li key={d.day}>
              <button type="button" onClick={() => useUi.getState().openPlanning(d.day)} className="grid w-full grid-cols-[72px_minmax(0,1fr)_64px] items-center gap-3 text-left text-xs" title={`School ${fmtDur(d.school)} · work ${fmtDur(d.work)} · other ${fmtDur(d.other)}${d.handIns.length ? `\nHand-in: ${d.handIns.join(", ")}` : ""}`}>
                <span className={cn("capitalize", d.day === startOfDay(now) ? "font-medium text-fg" : "text-muted")}>{new Date(d.day).toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}</span>
                <span className="relative flex h-2 overflow-hidden rounded-full bg-white/6">
                  <span className="h-full bg-info/70" style={{ width: `${Math.min(100, (d.school / span) * 100)}%` }} />
                  <span className="h-full bg-accent" style={{ width: `${Math.min(100, (d.work / span) * 100)}%` }} />
                  <span className="h-full bg-faint/60" style={{ width: `${Math.min(100, (d.other / span) * 100)}%` }} />
                </span>
                <span className="flex items-center justify-end gap-1.5">
                  {d.handIns.length > 0 && <Flag className="size-3 text-danger" />}
                  <span className={cn("font-mono", d.level === "over" ? "text-danger" : d.level === "busy" ? "text-warn" : "text-faint")}>{total ? fmtDur(total) : "free"}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="flex gap-4 border-t border-white/6 px-4 py-2 text-[11px] text-faint">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-info/70" /> school
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-accent" /> work planned
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-faint/60" /> other
        </span>
      </p>
    </Card>
  );
}

export function QuickActionsCard() {
  const ui = useUi.getState;
  const [review, setReview] = useState(false);
  const row = (icon: ReactNode, label: string, hint: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className="row-hover flex h-10 w-full items-center gap-3 px-4 text-left text-[13px]">
      <span className="flex w-4 justify-center text-faint">{icon}</span>
      <span className="flex-1">{label}</span>
      <span className="text-xs text-faint">{hint}</span>
    </button>
  );
  return (
    <Card>
      <CardTitle>Quick actions</CardTitle>
      <div className="py-1">
        {row(<PenLine className="size-4" />, "Capture a task or an idea", "Ctrl I", () => ui().setCaptureOpen(true))}
        {row(<CalendarPlus className="size-4" />, "Plan my week", "local", () => ui().openAssistant({ text: "#week" }))}
        {row(<Sparkles className="size-4" />, "Ask Claude", "uses credits", () => ui().openAssistant())}
        {row(<ClipboardCheck className="size-4" />, "Weekly review", "", () => setReview(true))}
        {row(<Plus className="size-4" />, "New project", "Ctrl N", () => ui().openLauncher({ mode: "new" }))}
      </div>
      {review && <ReviewDialog onClose={() => setReview(false)} />}
    </Card>
  );
}

/** Free slots of a session, asked to MY Epitech only when the button is pressed. */
function FreeSlots({ eventId }: { eventId: number }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["my-free-slots", eventId], queryFn: () => api.myFreeSlots(eventId), enabled: open, staleTime: 120_000, retry: false });
  const byDay = new Map<string, Array<{ start: string; end: string }>>();
  for (const f of q.data ?? []) {
    const d = new Date(f.start).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    byDay.set(d, [...(byDay.get(d) ?? []), f]);
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="shrink-0 text-xs text-accent-strong hover:underline">
          Free slots
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} collisionPadding={8} className="menu anim-pop z-[70] max-h-80 w-72 overflow-y-auto p-3 text-[13px]">
          {q.isLoading ? (
            <p className="flex items-center gap-2 text-muted">
              <Spinner /> Asking MY Epitech…
            </p>
          ) : q.error ? (
            <p className="text-danger">{asAppError(q.error).message}</p>
          ) : (q.data?.length ?? 0) === 0 ? (
            <p className="text-muted">No free slot left.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-faint">{q.data!.length} free slot{q.data!.length > 1 ? "s" : ""}. Registering is done on MY Epitech.</p>
              {[...byDay.entries()].map(([d, list]) => (
                <div key={d} className="mb-2">
                  <p className="text-xs text-muted capitalize">{d}</p>
                  <p className="font-mono text-xs leading-relaxed">{list.map((f) => hhmm(Date.parse(f.start))).join("  ")}</p>
                </div>
              ))}
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
