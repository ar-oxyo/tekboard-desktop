// The Today screen's main blocks: what is on now, four indicators, the day's timeline and the
// projects under way. Everything shown comes from real data; nothing is estimated for the user.
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Building2, CalendarDays, ClipboardCheck, Clock3, CloudDownload, Code2, Flag, GitCommitHorizontal, GraduationCap, Lock, Play, SquareTerminal, Sun, TriangleAlert, Wand2, CircleCheck } from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Button, cn, DoneCheck, IconButton, Meter, Notice, Spinner } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { api, type BoardItem, type RepoInfo } from "../../lib/api";
import { useBoard, useNow, usePref, useProjectActions, useRepos, useSettings } from "../../lib/hooks";
import { addDays, fmtDur, hhmm, MIN, nextUp, startOfDay, toRegister, workload, type CalItem } from "../../lib/plan";
import { attention, daysLeft, displayName, due } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { locale, plural, t } from "../../lib/i18n";
import { suggestPlan } from "../artix/suggest";
import { hours } from "../myepitech/LogtimePage";
import { startFocus } from "../planning/Focus";
import { useLoads, usePlanData } from "../planning/usePlan";
import { FreeSlots } from "./Today";

/** "J-3", "J-0", "J+2": days to a hand-in, the way students count them. */
function jLabel(day: string | null): { text: string; urgent: boolean } | null {
  const d = day ? daysLeft(day) : null;
  if (d === null) return null;
  return { text: d >= 0 ? `J-${d}` : `J+${-d}`, urgent: d <= 3 };
}

function JChip({ day }: { day: string | null }) {
  const j = jLabel(day);
  if (!j) return null;
  return <span className={cn("shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-xs font-medium", j.urgent ? "ink-urgent text-fg" : "bg-ink/6 text-muted")}>{j.text}</span>;
}

const sameDay = (i: CalItem, day: number) => i.start < addDays(day, 1) && i.end > day && i.kind !== "campus" && !(i.allDay && i.kind !== "deadline" && i.kind !== "holiday");

/** What is on now, or what needs time: the screen's one primary action lives here. */
export function HeroNow() {
  const data = usePlanData();
  const nowDate = useNow(30_000);
  const now = nowDate.getTime();
  const loads = useLoads(data, now);
  const repos = useRepos();
  const act = useProjectActions();
  const ui = useUi.getState;
  const day = startOfDay(now);
  const today = useMemo(() => data.items.filter((i) => sameDay(i, day)), [data.items, day]);
  const next = nextUp(data.items, data.projects, loads, now);
  const register = toRegister(data.items, now);
  const peerTodo = data.agenda?.peerTodo ?? [];
  const workToday = today.filter((i) => i.kind === "session" || i.kind === "task");
  const hasWorkLeft = data.projects.some((p) => (p.estimateMin ?? 0) > 0 && p.status !== "done");
  const suggestion = data.prefs.morningPlan && workToday.length === 0 && hasWorkLeft;
  const repoOf = (key: string | null): RepoInfo | undefined => (key ? repos.data?.find((r) => r.path === key) : undefined);

  let status: ReactNode;
  let side: ReactNode = null;
  let title: ReactNode;
  let progress: ReactNode = null;
  let primary: ReactNode;
  let repo: RepoInfo | undefined;
  let extra: ReactNode = null;
  if (next.kind === "now" || next.kind === "soon") {
    const i = next.item;
    repo = repoOf(i.project);
    const p = data.projects.find((x) => x.key === i.project);
    status = next.kind === "now" ? `${t("Maintenant")} · ${hhmm(i.start)} → ${hhmm(i.end)}` : t("Ensuite · {h}, dans {d}", { h: hhmm(i.start), d: fmtDur((i.start - now) / MIN) });
    side = [i.module ?? p?.module, jLabel(p?.day ?? null)?.text].filter(Boolean).join(" · ");
    title = i.title;
    if (next.kind === "now") {
      const total = i.end - i.start;
      const done = Math.max(0, Math.min(total, now - i.start));
      progress = (
        <div className="flex items-center gap-3.5">
          <Meter value={done} max={total} label={t("Avancement de la session")} className="flex-1" />
          <span className="font-mono text-xs text-muted">{`${fmtDur(done / MIN)} / ${fmtDur(total / MIN)}`}</span>
        </div>
      );
    }
    primary = (
      <Button variant="primary" className="h-9 px-4" icon={<Play className="size-3.5" />} onClick={() => startFocus({ title: i.title, project: i.project, taskId: i.event?.taskId ?? null, eventId: i.event?.id ?? null, plannedMin: Math.round((i.end - Math.max(now, i.start)) / MIN) })}>
        {t("Démarrer")}
      </Button>
    );
  } else if (next.kind === "plan" || next.kind === "start") {
    const p = next.project;
    repo = p.repoPath ? repoOf(p.repoPath) : undefined;
    const d = due(p.day, p.at, nowDate);
    const load = loads.get(p.key);
    status = next.kind === "plan" ? t("A besoin de temps dans ton planning") : t("Rendu le plus proche");
    side = [p.module, jLabel(p.day)?.text].filter(Boolean).join(" · ");
    title = p.title;
    progress =
      load && load.remaining !== null && load.remaining > 0 ? (
        <div className="flex items-center gap-3.5">
          <Meter value={load.planned} max={load.remaining} tone={load.risk === "ok" ? "accent" : "warn"} label={t("Travail planifié")} className="flex-1" />
          <span className="font-mono text-xs text-muted">{t("{p} planifié / {r} restant", { p: fmtDur(load.planned), r: fmtDur(load.remaining) })}</span>
        </div>
      ) : (
        <p className="text-sm text-muted">{[d.state !== "unknown" ? d.label : null, next.load.why || (p.estimateMin === null ? t("pas encore d'estimation du travail restant") : "")].filter(Boolean).join(" · ")}</p>
      );
    primary = (
      <Button variant="primary" className="h-9 px-4" icon={<Play className="size-3.5" />} onClick={() => startFocus({ title: p.title, project: p.key, taskId: null, eventId: null, plannedMin: data.prefs.sessionMinutes })}>
        {t("Y travailler maintenant")}
      </Button>
    );
    extra = (
      <Button variant="ghost" className="h-9" icon={<Wand2 className="size-3.5" />} onClick={() => ui().openAssistant({ text: "#week" })}>
        {t("Planifier ma semaine")}
      </Button>
    );
  } else {
    status = t("Rien d'urgent");
    title = t("Ta journée est libre");
    progress = <p className="text-sm text-muted">{t("Aucune session prévue et aucun rendu proche.")}</p>;
    primary = (
      <Button className="h-9" onClick={() => ui().setCaptureOpen(true)}>
        {t("Noter une tâche")}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <section aria-label={t("Maintenant")} className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface px-7 py-6">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-sm font-semibold text-accent-strong">
            <span aria-hidden className="size-2 rounded-full bg-accent shadow-[0_0_0_4px_var(--color-accent-soft)]" />
            {status}
            {data.loading && <Spinner />}
          </span>
          {side && <span className="font-mono text-xs text-faint">{side}</span>}
        </div>
        <h2 className="display text-[30px] leading-[1.15] font-(--title-weight) tracking-[-0.02em] text-balance">{title}</h2>
        {progress}
        <div className="flex flex-wrap gap-2">
          {primary}
          {repo && (
            <>
              <Button className="h-9" icon={<Code2 className="size-4" />} onClick={() => act.ide.mutate(repo!)}>
                {t("Ouvrir l'IDE")}
              </Button>
              <Button className="h-9" icon={<SquareTerminal className="size-4" />} onClick={() => act.terminal.mutate(repo!)}>
                {t("Terminal")}
              </Button>
            </>
          )}
          {extra}
        </div>
      </section>
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
        <Notice icon={<Sun />} action={<Button size="sm" onClick={() => void suggestPlan("day")}>{t("Proposer")}</Button>}>
          {t("Rien de prévu aujourd'hui. TekBoard peut te proposer une journée réaliste, avec pauses et temps libre.")}
        </Notice>
      )}
    </div>
  );
}

function Tile({ label, icon, value, unit, pct, tone = "accent", note, onClick }: { label: string; icon: ReactNode; value: string; unit?: string; pct: number; tone?: "accent" | "warn"; note: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="lift flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-surface px-4 py-3.5 text-left hover:border-line-strong">
      <span className="flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="text-faint [&>svg]:size-4">{icon}</span>
      </span>
      <span className="font-mono text-xl font-medium tracking-[-0.02em]">
        {value}
        {unit && <span className="text-xs text-faint">{unit}</span>}
      </span>
      <Meter value={pct} max={100} tone={tone} className="h-[3px]" />
      <span className="truncate text-2xs text-faint">{note}</span>
    </button>
  );
}

/** Four indicators: the week's logtime, credits, today's planned work and the next hand-in. */
export function StatTiles({ hidden = [] }: { hidden?: string[] }) {
  const data = usePlanData();
  const now = useNow().getTime();
  const board = useBoard();
  const setPage = useUi((s) => s.setPage);
  const logtime = useQuery({ queryKey: ["my-logtime"], queryFn: api.myLogtime, staleTime: 60_000 });
  const overview = useQuery({ queryKey: ["my-overview"], queryFn: api.myOverview, staleTime: 60_000 });

  const l = logtime.data;
  const w = l?.weeks[0];
  const goal = (l?.goalHours ?? 0) * 3600;
  const done = w?.seconds ?? 0;
  const left = Math.max(0, goal - done);
  const perDay = l ? left / Math.max(1, 7 - l.weekday) : 0;

  const o = overview.data;
  const today = workload(data.items, data.prefs, startOfDay(now), 1)[0];
  const sessions = data.items.filter((i) => sameDay(i, startOfDay(now)) && (i.kind === "session" || i.kind === "task")).length;

  const coming = (board.data ?? []).map((i) => ({ i, d: due(i.day, i.at) })).filter((x) => x.d.state === "today" || x.d.state === "upcoming");
  const nextDue = coming[0];
  const days = nextDue?.i.day ? daysLeft(nextDue.i.day) : null;

  return (
    <div className={cn("grid grid-cols-2 gap-3", ["", "@4xl:grid-cols-1", "@4xl:grid-cols-2", "@4xl:grid-cols-3", "@4xl:grid-cols-4"][4 - hidden.filter((h) => h.startsWith("tile.")).length])}>
      {!hidden.includes("tile.logtime") && (
      <Tile
          label={t("Logtime de la semaine")}
          icon={<Building2 />}
          value={l && !l.unavailable ? hours(done) : "—"}
          unit={l && !l.unavailable ? ` / ${l.goalHours} h` : undefined}
          pct={goal ? (done / goal) * 100 : 0}
          note={!l || l.unavailable ? t("Synchronise MY Epitech pour le voir") : left === 0 ? t("Objectif atteint") : t("≈ {h} par jour restant", { h: hours(perDay) })}
          onClick={() => setPage("logtime")}
        />
      )}
      {!hidden.includes("tile.credits") && (
      <Tile
          label={t("Crédits")}
          icon={<GraduationCap />}
          value={o?.creditsAcquired != null ? String(o.creditsAcquired) : "—"}
          unit={o?.creditsTotal != null ? ` / ${o.creditsTotal}` : undefined}
          pct={o?.creditsAcquired != null && o.creditsTotal ? (o.creditsAcquired / o.creditsTotal) * 100 : 0}
          note={o?.creditsAcquired != null ? t("D'après MY Epitech") : t("Synchronise MY Epitech pour les voir")}
          onClick={() => setPage("myepitech")}
        />
      )}
      {!hidden.includes("tile.work") && (
      <Tile
          label={t("Travail prévu aujourd'hui")}
          icon={<Clock3 />}
          value={today ? fmtDur(today.work) : "—"}
          unit={` / ${fmtDur(data.prefs.maxMinutesPerDay)}`}
          pct={today ? (today.work / data.prefs.maxMinutesPerDay) * 100 : 0}
          tone={today?.level === "over" ? "warn" : "accent"}
          note={sessions > 0 ? plural(sessions, "{n} session au planning", "{n} sessions au planning") : t("Rien au planning")}
          onClick={() => useUi.getState().openPlanning(now)}
        />
      )}
      {!hidden.includes("tile.due") && (
      <Tile
          label={t("Prochain rendu")}
          icon={<Flag />}
          value={days === null ? "—" : days === 0 ? t("auj.") : String(days)}
          unit={days !== null && days > 0 ? (days === 1 ? ` ${t("jour")}` : ` ${t("jours")}`) : undefined}
          pct={days === null ? 0 : Math.max(5, 100 - (days / 14) * 100)}
          tone={days !== null && days <= 3 ? "warn" : "accent"}
          note={nextDue ? `${nextDue.i.title} · ${new Date(`${nextDue.i.day}T12:00`).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" })}` : t("Aucun rendu connu")}
          onClick={() => nextDue?.i.repoPath && useUi.getState().openSheet(nextDue.i.repoPath)}
        />
      )}
    </div>
  );
}

/** Today's calendar as a timeline: time, what, and where it comes from. */
export function TimelineBlock() {
  const data = usePlanData();
  const now = useNow(30_000).getTime();
  const day = startOfDay(now);
  const items = useMemo(() => data.items.filter((i) => sameDay(i, day)), [data.items, day]);
  const ui = useUi.getState;
  return (
    <section className="min-w-0">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarDays className="size-4 text-faint" /> {t("Aujourd'hui")}
        </h2>
        <button type="button" onClick={() => ui().openPlanning(now)} className="text-xs text-accent-strong hover:underline">
          {t("Planning")}
        </button>
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg px-3 py-4 text-sm text-muted">{t("Rien au calendrier aujourd'hui.")}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {items.map((i) => {
            const current = i.start <= now && i.end > now;
            const past = i.end < now && i.kind !== "deadline";
            const tag = current ? t("En cours") : i.kind === "deadline" ? t("Rendu") : i.source === "my" ? t("École · lecture seule") : i.done ? t("Fait") : t("Planifié");
            const icon = current ? <Play className="size-3" /> : i.kind === "deadline" ? <Flag className="size-3" /> : i.source === "my" ? <Lock className="size-3" /> : <CalendarDays className="size-3" />;
            return (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => (i.event ? ui().editEvent(i.event) : i.project && !i.project.startsWith("my:") ? ui().openSheet(i.project) : ui().openPlanning(now))}
                  className={cn("grid w-full grid-cols-[3px_52px_minmax(0,1fr)] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-(--dur-fast)", current ? "bg-accent-soft" : "hover:bg-ink/5", past && "opacity-50")}
                >
                  <span aria-hidden className="h-7 rounded-full" style={{ background: i.kind === "deadline" ? "var(--color-accent-2)" : i.color } as CSSProperties} />
                  <span className="font-mono text-xs leading-[1.4] text-muted">
                    {i.allDay ? t("journée") : i.kind === "deadline" ? hhmm(i.end) : (
                      <>
                        {hhmm(i.start)}
                        <br />
                        {hhmm(i.end)}
                      </>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block truncate text-sm font-medium", i.done && "line-through")}>{i.title}</span>
                    <span className={cn("mt-0.5 flex items-center gap-1.5 text-2xs", current ? "text-accent-strong" : "text-faint")}>
                      {icon}
                      {tag}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

type Tab = "active" | "clone" | "commit";

/** Projects under way, school projects not cloned yet, and repositories with work to commit. */
export function ProjectTabs() {
  const repos = useRepos();
  const board = useBoard();
  const data = usePlanData();
  const now = useNow().getTime();
  const loads = useLoads(data, now);
  const setPage = useUi((s) => s.setPage);
  const [tab, setTab] = useState<Tab>("active");
  const all = repos.data ?? [];
  const deadlineOf = (r: RepoInfo) => r.meta.deadlineAt ?? r.meta.deadline ?? "9999";
  const active = all.filter((r) => r.progress !== "done" && r.meta.visibility === null).sort((a, b) => deadlineOf(a).localeCompare(deadlineOf(b)));
  const toClone = (board.data ?? []).filter((i) => !i.cloned && i.repoExpected && i.status !== "done");
  const toCommit = all.filter((r) => r.status && r.status.staged + r.status.unstaged + r.status.untracked + r.status.ahead > 0);
  const tabs: Array<{ id: Tab; label: string; n: number; ink: string }> = [
    { id: "active", label: t("Projets en cours"), n: active.length, ink: "text-muted" },
    { id: "clone", label: t("Pas encore clonés"), n: toClone.length, ink: "text-accent-strong" },
    { id: "commit", label: t("À commiter"), n: toCommit.length, ink: "text-warn" },
  ];
  return (
    <section className="@container min-w-0">
      <div className="mb-3.5 flex items-end justify-between gap-4 border-b border-line">
        <div className="flex gap-5" role="tablist" aria-label={t("Projets")}>
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              onClick={() => setTab(x.id)}
              className={cn("-mb-px flex items-center gap-1.5 border-b-2 py-2 text-sm transition-colors duration-(--dur-fast)", tab === x.id ? "border-accent font-semibold text-fg" : "border-transparent text-muted hover:text-fg")}
            >
              {x.label}
              <span className={cn("rounded-[5px] bg-ink/6 px-1.5 font-mono text-2xs", x.ink)}>{x.n}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setPage("projects")} className="pb-2 text-xs text-accent-strong hover:underline">
          {t("Tous les projets")}
        </button>
      </div>
      {repos.isLoading ? (
        <p className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner /> {t("Lecture de tes projets…")}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @3xl:grid-cols-3">
          {tab === "active" && active.map((r) => <ProjectCard key={r.path} repo={r} load={loads.get(r.path)} />)}
          {tab === "commit" && toCommit.map((r) => <ProjectCard key={r.path} repo={r} load={loads.get(r.path)} />)}
          {tab === "clone" && toClone.map((i) => <CloneCard key={`${i.myId ?? i.title}`} item={i} />)}
          {(tab === "active" ? active : tab === "commit" ? toCommit : toClone).length === 0 && (
            <p className="col-span-full py-6 text-sm text-muted">{tab === "active" ? t("Aucun projet en cours.") : tab === "commit" ? t("Tout est commité et envoyé.") : t("Tous les projets attendus sont clonés.")}</p>
          )}
        </div>
      )}
    </section>
  );
}

function ProjectCard({ repo, load }: { repo: RepoInfo; load?: { remaining: number | null; planned: number } }) {
  const act = useProjectActions();
  const openSheet = useUi((s) => s.openSheet);
  const issue = repo.error ? { level: "danger" as const, label: t("Illisible") } : attention(repo)[0];
  const code = repo.my?.unitCode ?? repo.epitech?.module ?? repo.group;
  return (
    <div className="lift group flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 hover:border-line-strong">
      <button type="button" onClick={() => openSheet(repo.path)} className="flex items-start justify-between gap-2 text-left">
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold">{displayName(repo)}</span>
          {code && <span className="mt-0.5 block font-mono text-2xs text-faint">{code}</span>}
        </span>
        <JChip day={repo.progress === "done" ? null : repo.meta.deadline} />
      </button>
      <div>
        <div className="mb-1.5 flex justify-between text-2xs text-muted">
          <span>{t("Temps planifié")}</span>
          <span className="font-mono">{load?.remaining != null ? `${fmtDur(load.planned)} / ${fmtDur(load.remaining)}` : t("pas d'estimation")}</span>
        </div>
        <Meter value={load?.planned ?? 0} max={load?.remaining ?? 1} tone={load?.remaining != null && load.planned >= load.remaining * 0.9 ? "ok" : "accent"} className="h-1" />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className={cn("flex min-w-0 items-center gap-1.5", !issue ? "text-ok" : issue.level === "danger" ? "text-danger" : issue.level === "warn" ? "text-warn" : "text-accent-strong")}>
          {issue ? <GitCommitHorizontal className="size-3.5 shrink-0" /> : <CircleCheck className="size-3.5 shrink-0" />}
          <span className="truncate">{issue ? issue.label : t("À jour")}</span>
        </span>
        <span className="flex shrink-0">
          <IconButton label={t("Ouvrir dans l'IDE")} onClick={() => act.ide.mutate(repo)}>
            <Code2 className="size-4" />
          </IconButton>
          <IconButton label={t("Ouvrir un terminal ici")} onClick={() => act.terminal.mutate(repo)}>
            <SquareTerminal className="size-4" />
          </IconButton>
        </span>
      </div>
    </div>
  );
}

function CloneCard({ item }: { item: BoardItem }) {
  const openLauncher = useUi((s) => s.openLauncher);
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-dashed border-line-strong p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold">{item.title}</span>
          {item.module && <span className="mt-0.5 block font-mono text-2xs text-faint">{item.module}</span>}
        </span>
        <JChip day={item.day} />
      </div>
      <p className="text-2xs text-muted">{t("Listé par MY Epitech, pas encore de dépôt local.")}</p>
      <Button size="sm" className="self-start" icon={<CloudDownload className="size-3.5" />} onClick={() => openLauncher({ mode: "new" })}>
        {t("Cloner")}
      </Button>
    </div>
  );
}

// ── Today, made to measure: which blocks show, in which order (Settings → Appearance, or the
// "Personnaliser" button of the screen). Everything visible by default.

export type TodayBlock = "hero" | "tiles" | "day" | "more";
export type TodayTile = "logtime" | "credits" | "work" | "due";
export interface TodayLayout {
  order: TodayBlock[];
  hidden: Array<TodayBlock | `tile.${TodayTile}` | "timeline" | "projects" | "checklist">;
}
export const TODAY_LAYOUT: TodayLayout = { order: ["hero", "tiles", "day", "more"], hidden: [] };
export const useTodayLayout = () => usePref<TodayLayout>("today.layout", TODAY_LAYOUT);

const BLOCK_LABEL: Record<TodayBlock, string> = { hero: t("Maintenant"), tiles: t("Indicateurs"), day: t("Journée et projets"), more: t("Rendus, charge et activité") };
const TILE_LABEL: Record<TodayTile, string> = { logtime: t("Logtime de la semaine"), credits: t("Crédits"), work: t("Travail prévu aujourd'hui"), due: t("Prochain rendu") };

export function TodayCustomize({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [layout, setLayout] = useTodayLayout();
  const hidden = new Set(layout.hidden);
  const toggle = (k: TodayLayout["hidden"][number]) => setLayout({ ...layout, hidden: hidden.has(k) ? layout.hidden.filter((x) => x !== k) : [...layout.hidden, k] });
  const move = (b: TodayBlock, by: -1 | 1) => {
    const order = [...layout.order];
    const i = order.indexOf(b);
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setLayout({ ...layout, order });
  };
  const box = (k: TodayLayout["hidden"][number], label: string, sub?: boolean) => (
    <label className={cn("flex min-h-8 flex-1 items-center gap-2.5 text-sm", sub && "pl-7 text-muted")}>
      <input type="checkbox" className="accent-(--color-accent)" checked={!hidden.has(k)} onChange={() => toggle(k)} />
      {label}
    </label>
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Personnaliser Aujourd'hui")}
      description={t("Choisis ce qui s'affiche et dans quel ordre. Rien n'est supprimé : un bloc masqué revient d'un clic.")}
      width="w-[520px]"
      footer={
        <>
          <Button variant="ghost" onClick={() => setLayout(TODAY_LAYOUT)}>
            {t("Rétablir")}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t("Terminé")}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col divide-y divide-line">
        <li className="py-1.5">{box("checklist", t("Guide de démarrage (tant qu'il reste des étapes)"))}</li>
        {layout.order.map((b, i) => (
          <li key={b} className="py-1.5">
            <div className="flex items-center gap-2">
              {box(b, BLOCK_LABEL[b])}
              <IconButton label={t("Monter")} disabled={i === 0} onClick={() => move(b, -1)}>
                <ArrowUp className="size-4" />
              </IconButton>
              <IconButton label={t("Descendre")} disabled={i === layout.order.length - 1} onClick={() => move(b, 1)}>
                <ArrowDown className="size-4" />
              </IconButton>
            </div>
            {b === "tiles" && !hidden.has("tiles") && (["logtime", "credits", "work", "due"] as TodayTile[]).map((x) => <div key={x}>{box(`tile.${x}`, TILE_LABEL[x], true)}</div>)}
            {b === "day" && !hidden.has("day") && (
              <>
                {box("timeline", t("Frise du jour"), true)}
                {box("projects", t("Cartes projets"), true)}
              </>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** First steps, on Today, until each is done (or the student hides the list). */
export function GettingStarted() {
  const [layout, setLayout] = useTodayLayout();
  const settings = useSettings();
  const repos = useRepos();
  const my = useQuery({ queryKey: ["my-status"], queryFn: api.myStatus, staleTime: 30_000 });
  const inbox = useQuery({ queryKey: ["brain-count"], queryFn: api.brainCount, staleTime: 60_000 });
  const [chosen] = usePref<boolean>("ambianceChosen", false);
  const ui = useUi.getState;
  if (layout.hidden.includes("checklist") || !settings.data) return null;
  const steps: Array<{ done: boolean; label: string; action: () => void }> = [
    { done: settings.data.roots.length > 0, label: t("Indique où sont tes projets"), action: () => useUi.setState({ page: "settings", settingsTab: "general" }) },
    { done: (my.data?.lastSync ?? null) !== null, label: t("Synchronise MY Epitech"), action: () => ui().setPage("myepitech") },
    { done: chosen, label: t("Choisis ton ambiance"), action: () => useUi.setState({ page: "settings", settingsTab: "design" }) },
    { done: (repos.data ?? []).some((r) => r.meta.favorite), label: t("Épingle un projet (étoile dans Projets)"), action: () => ui().setPage("projects") },
    { done: (inbox.data ?? 0) > 0, label: t("Note une idée avec Ctrl+I"), action: () => ui().setCaptureOpen(true) },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (left === 0) return null;
  return (
    <section className="rounded-xl border border-dashed border-line-strong px-5 py-4" aria-label={t("Premiers pas")}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          {t("Premiers pas")} <span className="font-normal text-faint">· {plural(left, "{n} étape restante", "{n} étapes restantes")}</span>
        </h2>
        <Button size="sm" variant="ghost" onClick={() => setLayout({ ...layout, hidden: [...layout.hidden, "checklist"] })}>
          {t("Masquer")}
        </Button>
      </div>
      <ul className="grid grid-cols-1 gap-x-6 @3xl:grid-cols-2">
        {steps.map((s) => (
          <li key={s.label}>
            <button type="button" disabled={s.done} onClick={s.action} className={cn("flex min-h-8 w-full items-center gap-2.5 rounded-(--btn-radius) px-1 text-left text-sm", s.done ? "text-faint line-through" : "hover:bg-ink/5")}>
              <DoneCheck checked={s.done} label={s.label} onChange={s.action} />
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
