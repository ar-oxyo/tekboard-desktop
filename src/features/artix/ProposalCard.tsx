// A plan waiting for the user's decision, compact: one line per day with the work it adds
// against the rhythm's ceiling, the changes of a day folded under it, each one can be
// unticked, and nothing happens before "Appliquer".
import { AlertTriangle, Check, ChevronRight, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, cn } from "../../components/ui";
import type { ScheduleAction } from "../../lib/api";
import { dayKey, describeAction, fmtDur, fromLocalIso, MIN } from "../../lib/plan";
import { usePlanData } from "../planning/usePlan";
import { locale, t } from "../../lib/i18n";

interface Props {
  title: string;
  rationale?: string | null;
  warnings?: string[];
  actions: ScheduleAction[];
  /** Who made it: Artix (checked by the planning engine) or TekBoard's own scheduler. */
  origin: "claude" | "auto";
  status: "pending" | "accepted" | "rejected";
  outcome?: string | null;
  busy?: boolean;
  onDecide?: (accept: boolean, keep: number[]) => void;
  /** Name of the accept button ("Appliquer" by default). */
  acceptLabel?: string;
  /** A second way to accept (a breakdown: accept, then ask for sessions). */
  alternate?: { label: string; onAccept: (keep: number[]) => void };
}

const startOf = (a: ScheduleAction): number | null => ("start" in a && typeof a.start === "string" ? fromLocalIso(a.start) : null);
const minutesOf = (a: ScheduleAction): number => (a.type === "create_session" ? (fromLocalIso(a.end) - fromLocalIso(a.start)) / MIN : 0);

export function ProposalCard({ title, rationale, warnings, actions, origin, status, outcome, busy, onDecide, acceptLabel, alternate }: Props) {
  const data = usePlanData();
  const [off, setOff] = useState<Set<number>>(new Set());
  const rows = useMemo(
    () =>
      actions.map((a, i) => {
        let clash: string | null = null;
        if (a.type === "create_session" || a.type === "move_event") {
          const [s, e] = [fromLocalIso(a.start), fromLocalIso(a.end)];
          const self = a.type === "move_event" ? `p${a.id}` : null;
          const hit = data.items.find((it) => it.id !== self && !it.allDay && it.kind !== "campus" && it.kind !== "reminder" && it.kind !== "deadline" && it.kind !== "start" && it.start < e && it.end > s);
          if (Number.isNaN(s) || Number.isNaN(e) || e <= s) clash = t("heure invalide");
          else if (hit) clash = t("chevauche « {t} »", { t: hit.title });
          else if (s < Date.now() - 5 * MIN) clash = t("dans le passé");
        }
        const start = startOf(a);
        return { a, i, d: describeAction(a, data.projects, data.state.events), clash, day: start !== null && !Number.isNaN(start) ? dayKey(start) : null, minutes: minutesOf(a) };
      }),
    [actions, data.items, data.projects, data.state.events],
  );
  // One group per day (in order), then the changes without a date.
  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) m.set(r.day ?? "", [...(m.get(r.day ?? "") ?? []), r]);
    return [...m.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }, [rows]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(rows.length <= 4 ? groups.map(([k]) => k) : []));
  const chosen = rows.filter((r) => !off.has(r.i));
  const totalMin = chosen.reduce((s, r) => s + r.minutes, 0);
  const sessions = chosen.filter((r) => r.a.type === "create_session").length;
  const ceiling = data.prefs.maxMinutesPerDay;
  const decided = status !== "pending";
  const toggle = (ids: number[], on: boolean) => setOff((s) => { const n = new Set(s); for (const i of ids) (on ? n.delete(i) : n.add(i)); return n; });
  const clashes = rows.filter((r) => r.clash).length;
  return (
    <section className={cn("mt-2 overflow-hidden rounded-xl border", decided ? "border-ink/7 opacity-80" : "border-accent/35 bg-accent-soft/25")}>
      <header className="px-3 pt-2.5 pb-2">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-sm font-medium">{title}</p>
          <span className="shrink-0 pt-0.5 text-2xs text-faint" title={rationale ?? undefined}>{origin === "auto" ? t("calculé par TekBoard") : t("vérifié par le moteur")}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted tabular-nums">
          {[sessions > 0 ? t("{n} séance(s)", { n: sessions }) : null, totalMin > 0 ? fmtDur(totalMin) : null, groups.filter(([k]) => k).length > 1 ? t("{n} jours", { n: groups.filter(([k]) => k).length }) : null, rows.length - sessions > 0 ? t("{n} autre(s) changement(s)", { n: rows.length - sessions }) : null].filter(Boolean).join(" · ")}
          {clashes > 0 && <span className="text-warn"> · {t("{n} à vérifier", { n: clashes })}</span>}
        </p>
      </header>
      {(warnings?.length ?? 0) > 0 && (
        <details className="border-t border-ink/6 px-3 py-1.5 text-xs text-warn">
          <summary className="flex cursor-pointer items-center gap-1.5"><AlertTriangle className="size-3 shrink-0" /> {t("{n} sans créneau", { n: warnings!.length })}</summary>
          <ul className="mt-1 space-y-0.5 pl-4.5">{warnings!.map((w) => <li key={w}>{w}</li>)}</ul>
        </details>
      )}
      <ul className="max-h-80 overflow-y-auto border-t border-ink/6">
        {groups.map(([day, list]) => {
          const added = list.filter((r) => !off.has(r.i)).reduce((s, r) => s + r.minutes, 0);
          const pct = Math.min(100, (added / Math.max(1, ceiling)) * 100);
          const all = list.every((r) => !off.has(r.i));
          const some = list.some((r) => !off.has(r.i));
          const isOpen = open.has(day);
          return (
            <li key={day || "other"} className="border-b border-ink/5 last:border-0">
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
                {!decided && <input type="checkbox" className="accent-(--color-accent)" aria-label={t("Garder ce jour")} checked={all} ref={(el) => { if (el) el.indeterminate = some && !all; }} onChange={() => toggle(list.map((r) => r.i), !all)} />}
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(day)) n.delete(day); else n.add(day); return n; })} aria-expanded={isOpen}>
                  <ChevronRight className={cn("size-3 shrink-0 text-faint transition-transform", isOpen && "rotate-90")} />
                  <span className="w-28 shrink-0 truncate text-fg">{day ? new Date(fromLocalIso(`${day}T12:00`)).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" }) : t("Autres changements")}</span>
                  {day && added > 0 ? (
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/6" title={t("Travail ajouté face au plafond de {d} par jour", { d: fmtDur(ceiling) })}>
                      <span className={cn("block h-full rounded-full", pct > 95 ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} />
                    </span>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <span className="w-16 shrink-0 text-right font-mono text-2xs text-muted">{added > 0 ? `+${fmtDur(added)}` : t("{n} chgt", { n: list.length })}</span>
                  {list.some((r) => r.clash) && <AlertTriangle className="size-3 shrink-0 text-warn" />}
                </button>
              </div>
              {isOpen && (
                <ul className="pb-1">
                  {list.map(({ a, i, d, clash }) => (
                    <li key={i}>
                      <label className={cn("row-hover flex items-start gap-2 py-1 pr-3 pl-9 text-sm", !decided && "cursor-pointer", off.has(i) && "opacity-50")}>
                        {!decided && <input type="checkbox" className="mt-0.5 accent-(--color-accent)" checked={!off.has(i)} onChange={() => toggle([i], off.has(i))} />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{d.text}</span>
                          <span className="block truncate text-2xs text-muted">
                            {d.verb}
                            {d.when && <span className="font-mono"> · {d.when}</span>}
                          </span>
                          {clash && (
                            <span className="flex items-center gap-1 text-2xs text-warn">
                              <AlertTriangle className="size-3" /> {clash}
                            </span>
                          )}
                        </span>
                        {a.type === "create_session" && <span className="shrink-0 font-mono text-2xs text-faint">{fmtDur(minutesOf(a))}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <footer className="flex items-center gap-2 border-t border-ink/6 px-3 py-2">
        {decided ? (
          <span className={cn("flex items-center gap-1.5 text-xs", status === "accepted" ? "text-ok" : "text-muted")}>
            {status === "accepted" ? <Check className="size-3.5" /> : <X className="size-3.5" />}
            {status === "accepted" ? t("Appliqué") : t("Refusé")}
            {outcome && ` · ${outcome}`}
          </span>
        ) : (
          <>
            <span className="flex-1 text-xs text-muted">{t("{n} sur {of}", { n: chosen.length, of: rows.length })}</span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide?.(false, [])}>
              {t("Refuser")}
            </Button>
            <Button size="sm" variant={alternate ? "secondary" : "primary"} icon={<Check className="size-3.5" />} busy={busy} disabled={chosen.length === 0} disabledReason={t("Coche au moins un changement")} onClick={() => onDecide?.(true, chosen.map((r) => r.i))}>
              {acceptLabel ?? t("Appliquer")}
            </Button>
            {alternate && (
              <Button size="sm" variant="primary" busy={busy} disabled={chosen.length === 0} disabledReason={t("Coche au moins un changement")} onClick={() => alternate.onAccept(chosen.map((r) => r.i))}>
                {alternate.label}
              </Button>
            )}
          </>
        )}
      </footer>
    </section>
  );
}
