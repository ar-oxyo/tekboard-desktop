// A plan waiting for the user's decision: each change can be unticked, the work it adds is
// shown per day against the rhythm's ceiling, and nothing happens before "Appliquer".
import { AlertTriangle, Check, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, cn } from "../../components/ui";
import type { ScheduleAction } from "../../lib/api";
import { dayKey, describeAction, fmtDur, fromLocalIso, MIN } from "../../lib/plan";
import { usePlanData } from "../planning/usePlan";

interface Props {
  title: string;
  rationale?: string | null;
  warnings?: string[];
  actions: ScheduleAction[];
  /** Who made it: Tika (checked by the planning engine) or TekBoard's own scheduler. */
  origin: "claude" | "auto";
  status: "pending" | "accepted" | "rejected";
  outcome?: string | null;
  busy?: boolean;
  onDecide?: (accept: boolean, keep: number[]) => void;
}

export function ProposalCard({ title, rationale, warnings, actions, origin, status, outcome, busy, onDecide }: Props) {
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
          if (Number.isNaN(s) || Number.isNaN(e) || e <= s) clash = "heure invalide";
          else if (hit) clash = `chevauche « ${hit.title} »`;
          else if (s < Date.now() - 5 * MIN) clash = "dans le passé";
        }
        return { a, i, d: describeAction(a, data.projects, data.state.events), clash };
      }),
    [actions, data.items, data.projects, data.state.events],
  );
  const chosen = rows.filter((r) => !off.has(r.i));
  // Work added per day, against the ceiling.
  const perDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of chosen) if (r.a.type === "create_session") m.set(dayKey(fromLocalIso(r.a.start)), (m.get(dayKey(fromLocalIso(r.a.start))) ?? 0) + (fromLocalIso(r.a.end) - fromLocalIso(r.a.start)) / MIN);
    return [...m.entries()].sort();
  }, [chosen]);
  const ceiling = data.prefs.maxMinutesPerDay;
  const decided = status !== "pending";
  return (
    <section className={cn("mt-2 overflow-hidden rounded-xl border", decided ? "border-white/7 opacity-80" : "border-accent/35 bg-accent-soft/30")}>
      <header className="flex items-start gap-2 px-3 pt-2.5 pb-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">{title}</p>
          {rationale && <p className="mt-0.5 text-xs text-muted">{rationale}</p>}
        </div>
        <span className="shrink-0 pt-0.5 text-[11px] text-faint">{origin === "auto" ? "calculé par TekBoard" : "vérifié par le moteur"}</span>
      </header>
      {warnings?.map((w) => (
        <p key={w} className="flex items-start gap-1.5 px-3 pb-1.5 text-xs text-warn">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {w}
        </p>
      ))}
      <ul className="max-h-72 overflow-y-auto border-t border-white/6 py-1">
        {rows.map(({ a, i, d, clash }) => (
          <li key={i}>
            <label className={cn("row-hover flex items-start gap-2 px-3 py-1.5 text-[13px]", !decided && "cursor-pointer")}>
              {!decided && <input type="checkbox" className="mt-0.5 accent-(--color-accent)" checked={!off.has(i)} onChange={() => setOff((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))} />}
              <span className="w-16 shrink-0 text-xs text-faint">{d.verb}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{d.text}</span>
                {d.when && <span className="block truncate font-mono text-[11px] text-muted">{d.when}</span>}
                {clash && (
                  <span className="flex items-center gap-1 text-[11px] text-warn">
                    <AlertTriangle className="size-3" /> {clash}
                  </span>
                )}
              </span>
              {a.type === "create_session" && <span className="shrink-0 font-mono text-[11px] text-faint">{fmtDur((fromLocalIso(a.end) - fromLocalIso(a.start)) / MIN)}</span>}
            </label>
          </li>
        ))}
      </ul>
      {perDay.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-white/6 px-3 py-2">
          {perDay.map(([day, added]) => {
            const pct = Math.min(100, (added / ceiling) * 100);
            return (
              <div key={day} className="flex items-center gap-2 text-[11px] text-muted">
                <span className="w-20 shrink-0">{new Date(fromLocalIso(`${day}T12:00`)).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/6">
                  <span className={cn("block h-full rounded-full", pct > 95 ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} />
                </span>
                <span className="w-20 shrink-0 text-right font-mono">+{fmtDur(added)}</span>
              </div>
            );
          })}
          <p className="text-[10px] text-faint">Barre : travail ajouté face au plafond de {fmtDur(ceiling)} par jour.</p>
        </div>
      )}
      <footer className="flex items-center gap-2 border-t border-white/6 px-3 py-2">
        {decided ? (
          <span className={cn("flex items-center gap-1.5 text-xs", status === "accepted" ? "text-ok" : "text-muted")}>
            {status === "accepted" ? <Check className="size-3.5" /> : <X className="size-3.5" />}
            {status === "accepted" ? "Appliqué" : "Refusé"}
            {outcome && ` · ${outcome}`}
          </span>
        ) : (
          <>
            <span className="flex-1 text-xs text-muted">
              {chosen.length} changement{chosen.length > 1 ? "s" : ""} sur {rows.length}
            </span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide?.(false, [])}>
              Refuser
            </Button>
            <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} busy={busy} disabled={chosen.length === 0} title={chosen.length === 0 ? "Coche au moins un changement" : undefined} onClick={() => onDecide?.(true, chosen.map((r) => r.i))}>
              Appliquer
            </Button>
          </>
        )}
      </footer>
    </section>
  );
}
