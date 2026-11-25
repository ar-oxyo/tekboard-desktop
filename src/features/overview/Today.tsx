// Blocks of the Today screen: what to do now, today's timeline, the coming load, quick actions.
import { CalendarDays, CalendarPlus, ClipboardCheck, Flag, Inbox, Lock, PenLine, Play, Plus, Sparkles, Sun, TriangleAlert, Wand2 } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { api, asAppError } from "../../lib/api";
import { Button, cn, Kbd, Notice, Section, Spinner, Tag } from "../../components/ui";
import { useNow } from "../../lib/hooks";
import { addDays, fmtDur, hhmm, MIN, nextUp, startOfDay, toRegister, workload, type CalItem } from "../../lib/plan";
import { due } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { ReviewDialog } from "../planning/Dialogs";
import { suggestPlan } from "../artix/suggest";
import { startFocus } from "../planning/Focus";
import { useLoads, usePlanData } from "../planning/usePlan";
import { Countdown } from "../projects/RepoBits";
import { locale, plural, t } from "../../lib/i18n";

/** What to do now: the session under way or next, else the project that needs time, else a free day. */
export function NowBlock() {
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
  const hasWorkLeft = data.projects.some((p) => (p.estimateMin ?? 0) > 0 && p.status !== "done");
  const suggestion = data.prefs.morningPlan && workToday.length === 0 && hasWorkLeft;

  let kicker: ReactNode;
  let title: ReactNode;
  let meta: ReactNode;
  let actions: ReactNode;
  if (next.kind === "now" || next.kind === "soon") {
    const i = next.item;
    kicker = next.kind === "now" ? t("En cours · jusqu'à {h}", { h: hhmm(i.end) }) : t("Ensuite · {h}, dans {d}", { h: hhmm(i.start), d: fmtDur((i.start - now) / MIN) });
    title = i.title;
    meta = [i.module, fmtDur((i.end - i.start) / MIN), i.detail].filter(Boolean).join(" · ");
    actions = (
      <>
        <Button variant="primary" icon={<Play className="size-3.5" />} onClick={() => startFocus({ title: i.title, project: i.project, taskId: i.event?.taskId ?? null, eventId: i.event?.id ?? null, plannedMin: Math.round((i.end - Math.max(now, i.start)) / MIN) })}>
          {t("Démarrer")}
        </Button>
        {i.event && <Button onClick={() => ui().editEvent(i.event!)}>{t("Modifier")}</Button>}
      </>
    );
  } else if (next.kind === "plan" || next.kind === "start") {
    const p = next.project;
    const d = due(p.day, p.at, nowDate);
    kicker = next.kind === "plan" ? t("A besoin de temps dans ton planning") : t("Rendu le plus proche");
    title = (
      <>
        {p.title}
        {p.module && <Tag>{p.module}</Tag>}
      </>
    );
    meta = (
      <>
        {d.state !== "unknown" && <Countdown tone={d.tone}>{d.label}</Countdown>}
        <span>{next.load.why || (p.estimateMin === null ? t("pas encore d'estimation du travail restant") : "")}</span>
      </>
    );
    actions = (
      <>
        <Button variant="primary" icon={<Play className="size-3.5" />} onClick={() => startFocus({ title: p.title, project: p.key, taskId: null, eventId: null, plannedMin: data.prefs.sessionMinutes })}>
          {t("Y travailler maintenant")}
        </Button>
        <Button icon={<Wand2 className="size-3.5" />} onClick={() => ui().openAssistant({ text: "#week" })}>
          {t("Planifier ma semaine")}
        </Button>
        {p.repoPath && (
          <Button variant="ghost" onClick={() => ui().openSheet(p.repoPath!)}>
            {t("Fiche du projet")}
          </Button>
        )}
      </>
    );
  } else {
    kicker = t("Rien d'urgent");
    title = t("Ta journée est libre");
    meta = t("Aucune session prévue et aucun rendu proche.");
    actions = (
      <Button icon={<Plus className="size-3.5" />} onClick={() => ui().setCaptureOpen(true)}>
        {t("Noter une tâche")}
      </Button>
    );
  }

  return (
    <section className="min-w-0" aria-label={t("Maintenant")}>
      <p className="flex items-center gap-2 text-xs text-faint">
        {kicker}
        {data.loading && <Spinner />}
      </p>
      <h2 className="display mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-3 text-2xl font-(--title-weight) tracking-[-0.015em] [&>span]:tracking-normal">{title}</h2>
      <p className="mt-1 flex min-h-5 flex-wrap items-center gap-3 text-sm text-muted">{meta}</p>
      <div className="mt-4 flex flex-wrap gap-2">{actions}</div>

      {(register.length > 0 || peerTodo.length > 0 || suggestion) && (
        <div className="mt-5 flex flex-col gap-2">
          {register.length > 0 && (
            <Notice tone="warn" icon={<TriangleAlert />}>
              <p>{plural(register.length, "Session obligatoire où tu n'es pas inscrit. Inscris-toi sur MY Epitech.", "Sessions obligatoires où tu n'es pas inscrit. Inscris-toi sur MY Epitech.")}</p>
              <ul className="mt-1">
                {register.map((i) => (
                  <li key={i.id} className="flex min-h-7 items-center gap-2 text-fg">
                    <span className="min-w-0 flex-1 truncate">{i.title}</span>
                    <span className="shrink-0 text-xs text-faint">{new Date(i.start).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" })}</span>
                    {i.agenda?.eventId != null && <FreeSlots eventId={i.agenda.eventId} />}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          {peerTodo.length > 0 && (
            <Notice tone="warn" icon={<ClipboardCheck />}>
              {plural(peerTodo.length, "{n} évaluation de pair à rendre :", "{n} évaluations de pairs à rendre :")} <strong>{[...new Set(peerTodo)].join(", ")}</strong>
            </Notice>
          )}
          {suggestion && (
            <Notice
              icon={<Sun />}
              action={
                <Button size="sm" onClick={() => void suggestPlan("day")}>
                  {t("Proposer")}
                </Button>
              }
            >
              {t("Rien de prévu aujourd'hui. TekBoard peut te proposer une journée réaliste, avec pauses et temps libre.")}
            </Notice>
          )}
        </div>
      )}
    </section>
  );
}

/** Today's calendar, in time order. */
export function ScheduleBlock() {
  const data = usePlanData();
  const now = useNow(30_000).getTime();
  const day = startOfDay(now);
  const today = useMemo(() => data.items.filter((i) => i.start < addDays(day, 1) && i.end > day && i.kind !== "campus" && !(i.allDay && i.kind !== "deadline" && i.kind !== "holiday")), [data.items, day]);
  return (
    <Section
      title={t("Au programme")}
      meta={today.length > 0 ? plural(today.length, "{n} entrée", "{n} entrées") : undefined}
      action={
        <Button variant="ghost" size="sm" icon={<CalendarDays className="size-3.5" />} onClick={() => useUi.getState().openPlanning(now)}>
          {t("Planning")}
        </Button>
      }
    >
      {today.length === 0 ? (
        <p className="py-3 text-sm text-muted">{t("Rien au calendrier aujourd'hui.")}</p>
      ) : (
        <ul>
          {today.map((i) => (
            <TodayRow key={i.id} i={i} now={now} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function TodayRow({ i, now }: { i: CalItem; now: number }) {
  const past = i.end < now && i.kind !== "deadline";
  const current = i.start <= now && i.end > now;
  const ui = useUi.getState;
  return (
    <li className="border-b border-line last:border-b-0">
      <button type="button" onClick={() => (i.event ? ui().editEvent(i.event) : i.project ? ui().openSheet(i.project) : ui().openPlanning(now))} className={cn("ink-row flex min-h-9 w-full items-center gap-3 px-1 text-left text-sm", past && "text-faint")}>
        <span className={cn("w-[104px] shrink-0 font-mono text-xs whitespace-nowrap", current ? "text-accent-strong" : "text-muted")}>{i.allDay ? t("journée") : i.kind === "deadline" ? hhmm(i.end) : `${hhmm(i.start)} – ${hhmm(i.end)}`}</span>
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: i.color } as CSSProperties} />
        <span className={cn("min-w-0 flex-1 truncate", i.done && "line-through", current && "font-medium text-fg")}>{i.title}</span>
        {i.kind === "deadline" && <Flag className="size-3.5 shrink-0 text-accent-2" aria-label={t("Rendu")} />}
        {i.source === "my" && i.kind !== "deadline" && <Lock className="size-3 shrink-0 text-faint" aria-label={t("Depuis MY Epitech")} />}
        {current && <span className="shrink-0 text-xs font-medium text-accent-strong">{t("maintenant")}</span>}
      </button>
    </li>
  );
}

/** The next seven days as bars: school, planned work, other entries, and hand-ins. */
export function WorkloadBlock() {
  const data = usePlanData();
  const now = useNow().getTime();
  const days = workload(data.items, data.prefs, startOfDay(now), 7);
  const span = data.prefs.dayEnd - data.prefs.dayStart;
  return (
    <Section title={t("Sept prochains jours")} meta={t("{d} de travail max par jour", { d: fmtDur(data.prefs.maxMinutesPerDay) })}>
      <ul className="flex flex-col py-1.5">
        {days.map((d) => {
          const total = d.school + d.work + d.other;
          return (
            <li key={d.day}>
              <button type="button" onClick={() => useUi.getState().openPlanning(d.day)} className="ink-row grid h-7 w-full grid-cols-[64px_minmax(0,1fr)_68px] items-center gap-3 rounded-sm px-1 text-left text-xs" title={`${t("École")} ${fmtDur(d.school)} · ${t("travail")} ${fmtDur(d.work)} · ${t("autre")} ${fmtDur(d.other)}${d.handIns.length ? `\n${t("Rendu")} : ${d.handIns.join(", ")}` : ""}`}>
                <span className={cn("capitalize", d.day === startOfDay(now) ? "font-semibold text-fg" : "text-muted")}>{new Date(d.day).toLocaleDateString(locale(), { weekday: "short", day: "numeric" })}</span>
                <span className="relative flex h-1.5 overflow-hidden rounded-full bg-ink/8">
                  <span className="h-full bg-ink/35" style={{ width: `${Math.min(100, (d.school / span) * 100)}%` }} />
                  <span className="h-full bg-accent" style={{ width: `${Math.min(100, (d.work / span) * 100)}%` }} />
                  <span className="h-full bg-ink/15" style={{ width: `${Math.min(100, (d.other / span) * 100)}%` }} />
                </span>
                <span className="flex items-center justify-end gap-1.5">
                  {d.handIns.length > 0 && <Flag className="size-3 text-accent-2" />}
                  <span className={cn("font-mono", d.level === "over" ? "text-danger" : d.level === "busy" ? "text-warn" : "text-faint")}>{total ? fmtDur(total) : t("libre")}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="flex gap-4 pt-1 text-2xs text-faint">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-ink/35" /> {t("école")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-accent" /> {t("travail prévu")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-ink/15" /> {t("autre")}
        </span>
      </p>
    </Section>
  );
}

export function QuickActions() {
  const ui = useUi.getState;
  const [review, setReview] = useState(false);
  const inboxCount = useQuery({ queryKey: ["brain-count"], queryFn: api.brainCount, staleTime: 60_000 }).data ?? 0;
  const row = (icon: ReactNode, label: string, hint: ReactNode, onClick: () => void) => (
    <li className="border-b border-line last:border-b-0">
      <button type="button" onClick={onClick} className="ink-row flex h-9 w-full items-center gap-3 px-1 text-left text-sm">
        <span className="flex w-4 justify-center text-faint">{icon}</span>
        <span className="flex-1 truncate">{label}</span>
        <span className="text-xs text-faint">{hint}</span>
      </button>
    </li>
  );
  return (
    <Section title={t("Actions rapides")}>
      <ul>
        {row(<PenLine className="size-4" />, t("Noter une tâche ou une idée"), <Kbd>Ctrl I</Kbd>, () => ui().setCaptureOpen(true))}
        {row(<Inbox className="size-4" />, t("Ranger mon Inbox"), inboxCount ? String(inboxCount) : "", () => ui().openInbox())}
        {row(<CalendarPlus className="size-4" />, t("Planifier ma semaine"), t("sans IA"), () => ui().openAssistant({ text: "#week" }))}
        {row(<Sparkles className="size-4" />, t("Demander à Artix"), t("utilise des crédits"), () => ui().openAssistant())}
        {row(<ClipboardCheck className="size-4" />, t("Bilan de la semaine"), "", () => setReview(true))}
        {row(<Plus className="size-4" />, t("Nouveau projet"), <Kbd>Ctrl N</Kbd>, () => ui().openLauncher({ mode: "new" }))}
      </ul>
      {review && <ReviewDialog onClose={() => setReview(false)} />}
    </Section>
  );
}

/** Free slots of a session, asked to MY Epitech only when the button is pressed. */
function FreeSlots({ eventId }: { eventId: number }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["my-free-slots", eventId], queryFn: () => api.myFreeSlots(eventId), enabled: open, staleTime: 120_000, retry: false });
  const byDay = new Map<string, Array<{ start: string; end: string }>>();
  for (const f of q.data ?? []) {
    const d = new Date(f.start).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" });
    byDay.set(d, [...(byDay.get(d) ?? []), f]);
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="shrink-0 text-xs text-accent-strong hover:underline">
          {t("Créneaux libres")}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} collisionPadding={8} className="menu anim-pop z-[70] max-h-80 w-72 overflow-y-auto p-3 text-sm">
          {q.isLoading ? (
            <p className="flex items-center gap-2 text-muted">
              <Spinner /> {t("Demande à MY Epitech…")}
            </p>
          ) : q.error ? (
            <p className="text-danger">{asAppError(q.error).message}</p>
          ) : (q.data?.length ?? 0) === 0 ? (
            <p className="text-muted">{t("Plus aucun créneau libre.")}</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-faint">{plural(q.data!.length, "{n} créneau libre.", "{n} créneaux libres.")} {t("L'inscription se fait sur MY Epitech.")}</p>
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
