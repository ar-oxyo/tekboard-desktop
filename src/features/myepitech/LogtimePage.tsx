// Logtime: Epitech asks for 30 hours a week on campus. What is left this week reads at a
// glance; the days and the previous weeks are underneath. Everything comes from MY Epitech
// (`/students/logtime`, read at each sync): nothing is estimated, a missing sync is said.
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, Clock, RefreshCw } from "lucide-react";
import { Button, Card, CardTitle, cn, EmptyState, ErrorNote, PageHeader, Spinner } from "../../components/ui";
import { api, type Logtime } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { locale, t } from "../../lib/i18n";
import { useMySync } from "./useMySync";

const HOUR = 3600;

/** `12 h 05`, `45 min`, `0 h`. */
export function hours(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return m === 0 ? "0 h" : `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

const dayDate = (iso: string) => new Date(`${iso}T12:00`);
const short = (iso: string, opts: Intl.DateTimeFormatOptions) => dayDate(iso).toLocaleDateString(locale(), opts);

/** Week label: `17 – 23 nov.` */
function weekLabel(w: Logtime["weeks"][number]) {
  const sameMonth = w.start.slice(0, 7) === w.end.slice(0, 7);
  return `${short(w.start, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" })} – ${short(w.end, { day: "numeric", month: "short" })}`;
}

export function LogtimePage() {
  const data = useQuery({ queryKey: ["my-logtime"], queryFn: api.myLogtime, staleTime: 0, refetchInterval: 5 * 60_000 });
  const sync = useMySync();
  const action = (
    <Button variant="primary" icon={<RefreshCw className={cn("size-3.5", sync.busy && "anim-spin")} />} disabled={sync.busy} onClick={() => void sync.sync()}>
      {sync.label}
    </Button>
  );
  const l = data.data;
  return (
    <>
      <PageHeader title="Logtime" subtitle={t("Objectif Epitech : {h} h de présence par semaine. Chiffres de MY Epitech.", { h: l?.goalHours ?? 30 })} actions={action} />
      {data.isLoading ? (
        <p className="flex items-center gap-2 py-16 text-muted">
          <Spinner /> {t("Chargement…")}
        </p>
      ) : !l || l.unavailable === "never_synced" ? (
        <Card>
          <EmptyState icon={<Clock className="size-6" />} title={t("Pas encore de logtime")} action={action}>
            {t("Le logtime vient de MY Epitech. Lance une synchronisation : il s'affichera ici, semaine par semaine.")}
          </EmptyState>
        </Card>
      ) : l.unavailable ? (
        <ErrorNote title={t("Logtime indisponible")}>{l.unavailable === "no_answer" ? t("MY Epitech n'a pas répondu à la dernière synchronisation. Réessaie avec « Sync ».") : t("MY Epitech a refusé cette information ({why}). Rien n'est affiché plutôt qu'un chiffre faux.", { why: l.unavailable.replace("http_", "HTTP ") })}</ErrorNote>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <ThisWeek l={l} />
          <History l={l} />
        </div>
      )}
    </>
  );
}

function ThisWeek({ l }: { l: Logtime }) {
  const w = l.weeks[0];
  const goal = l.goalHours * HOUR;
  const done = w?.seconds ?? 0;
  const left = Math.max(0, goal - done);
  const reached = done >= goal;
  const pct = Math.min(100, (done / goal) * 100);
  // Days still ahead in the week, today included.
  const daysLeft = 7 - l.weekday;
  const perDay = left / daysLeft;
  const stale = l.lastDay !== null && l.lastDay < l.today;
  const max = Math.max(goal / 5, ...(w?.days ?? [0]));
  const names = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale(), { weekday: "short" }));
  return (
    <Card>
      <CardTitle right={w && <span className="text-xs font-normal text-faint">{weekLabel(w)}</span>}>{t("Cette semaine")}</CardTitle>
      <div className="flex flex-col gap-5 p-5">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            {reached ? (
              <p className="display flex items-center gap-2 text-3xl font-medium text-ok">
                <CircleCheck className="size-7" /> {t("Objectif atteint")}
              </p>
            ) : (
              <p className="display text-4xl font-medium tabular-nums">{hours(left)}</p>
            )}
            <p className="mt-1 text-sm text-muted">{reached ? t("{d} faites cette semaine, sur {g}.", { d: hours(done), g: hours(goal) }) : t("restantes pour atteindre {g}", { g: hours(goal) })}</p>
          </div>
          <div className="text-sm text-muted">
            <p>
              <span className="font-medium text-fg tabular-nums">{hours(done)}</span> {t("faites")}
            </p>
            {!reached && <p>{daysLeft > 1 ? t("≈ {h} par jour sur les {n} jours restants", { h: hours(perDay), n: daysLeft }) : t("≈ {h} aujourd'hui", { h: hours(perDay) })}</p>}
          </div>
        </div>
        <div>
          <div className="h-2.5 overflow-hidden rounded-full bg-ink/6" role="progressbar" aria-valuemin={0} aria-valuemax={l.goalHours} aria-valuenow={Math.round((done / HOUR) * 10) / 10} aria-label={t("Logtime de la semaine")}>
            <div className={cn("h-full rounded-full transition-[width] duration-500", reached ? "bg-ok" : "bg-accent")} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-2xs text-faint tabular-nums">
            <span>0 h</span>
            <span>{hours(goal)}</span>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-2" aria-label={t("Logtime par jour")}>
          {names.map((name, i) => {
            const sec = w?.days[i] ?? 0;
            const future = i > l.weekday;
            return (
              <div key={name} className="flex flex-col items-center gap-1.5" title={future ? t("à venir") : hours(sec)}>
                <div className="flex h-24 w-full items-end justify-center rounded-md bg-ink/3 px-2">
                  {sec > 0 && <div className={cn("w-full max-w-7 rounded-t-[4px]", i === l.weekday ? "bg-accent" : "bg-accent/55")} style={{ height: `${Math.max(4, (sec / max) * 100)}%` }} />}
                </div>
                <span className={cn("text-2xs capitalize", i === l.weekday ? "font-medium text-fg" : future ? "text-faint/60" : "text-faint")}>{name}</span>
                <span className="text-2xs text-muted tabular-nums">{future ? "" : hours(sec)}</span>
              </div>
            );
          })}
        </div>
        <p className={cn("text-xs", stale && w && l.lastDay! < w.start ? "text-warn" : "text-faint")}>
          {stale && l.lastDay ? t("Dernier jour transmis par MY Epitech : {d}. Les jours suivants arrivent avec une prochaine synchronisation.", { d: short(l.lastDay, { weekday: "long", day: "numeric", month: "long" }) }) + " " : ""}
          {l.fetchedAt ? t("Synchronisé {when}.", { when: timeAgo(l.fetchedAt) }) : ""}
        </p>
      </div>
    </Card>
  );
}

function History({ l }: { l: Logtime }) {
  const goal = l.goalHours * HOUR;
  const past = l.weeks.slice(1, 16);
  return (
    <Card>
      <CardTitle>{t("Semaines précédentes")}</CardTitle>
      {past.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">{t("Pas encore d'historique : MY Epitech n'a transmis que cette semaine.")}</p>
      ) : (
        <ul className="py-1">
          {past.map((w) => {
            const ok = w.seconds >= goal;
            // After the last day MY Epitech reported, an empty week is missing data, not zero.
            const unknown = w.seconds === 0 && l.lastDay !== null && w.start > l.lastDay;
            return (
              <li key={w.start} className="flex h-10 items-center gap-3 px-4 text-sm" title={unknown ? t("Pas encore transmis par MY Epitech") : `${weekLabel(w)} : ${hours(w.seconds)}`}>
                <span className="w-24 shrink-0 text-muted">{weekLabel(w)}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/6">
                  <span className={cn("block h-full rounded-full", ok ? "bg-ok" : "bg-accent/70")} style={{ width: `${Math.min(100, (w.seconds / goal) * 100)}%` }} />
                </span>
                <span className={cn("w-16 shrink-0 text-right tabular-nums", unknown && "text-faint")}>{unknown ? t("non transmis") : hours(w.seconds)}</span>
                <span className="flex w-5 shrink-0 justify-end">{ok && <CircleCheck className="size-3.5 text-ok" aria-label={t("Objectif atteint")} />}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
