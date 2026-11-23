// Academic analytics: what MY Epitech reported at the last sync — credits, units and their
// learning outcomes, skills, log time, automated test results. Shown as reported: nothing
// here is a prediction, and what could not be read is listed.
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, CardTitle } from "../../components/ui";
import { api, type Academic } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { useUi } from "../../lib/store";
import { Columns, Stat } from "./AnalyticsPage";

const hours = (secs: number) => (secs >= 3600 ? `${(secs / 3600).toFixed(1)} h` : `${Math.round(secs / 60)} min`);
const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

/** A proportion with its numbers written out: the bar helps the eye, the text carries the value. */
function Meter({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-white/8" role="img" aria-label={`${value} of ${total}`}>
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: "#7c6ef2" }} />
    </span>
  );
}

export function AcademicSection() {
  const setPage = useUi((s) => s.setPage);
  const q = useQuery({ queryKey: ["my-academic"], queryFn: api.myAcademic, staleTime: 60_000 });
  const a = q.data;
  if (!a) return null;
  const empty = a.syncedAt === null;
  return (
    <>
      <div id="academic" className="mt-2 flex scroll-mt-4 items-end justify-between gap-3">
        <div>
          <h2 className="display text-lg font-medium">Parcours</h2>
          <p className="text-xs text-muted">{empty ? "From MY Epitech — nothing synced yet." : `As reported by MY Epitech, synced ${timeAgo(a.syncedAt!)}${a.semester !== null ? ` · semester ${a.semester}` : ""}.`}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setPage("myepitech")}>
          {empty ? "Connect MY Epitech" : "MY Epitech"}
        </Button>
      </div>
      {!empty && <Filled a={a} />}
    </>
  );
}

function Filled({ a }: { a: Academic }) {
  const done = a.units.reduce((n, u) => n + u.validated, 0);
  const all = a.units.reduce((n, u) => n + u.total, 0);
  const logged = a.logtime.reduce((n, d) => n + d.mine, 0);
  const recent = a.logtime.slice(-30);
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Crédits acquis" value={a.creditsAcquired !== null ? String(a.creditsAcquired) : "—"} note={a.creditsTotal !== null && a.creditsTotal !== a.creditsAcquired ? `${a.creditsTotal} with prior credits` : undefined} />
        <Stat label="Acquis d'apprentissage" value={all > 0 ? `${done}/${all}` : "—"} note={all > 0 ? `validated, in ${a.units.length} units` : "not available"} />
        <Stat label="Projets" value={a.projectsTotal > 0 ? `${a.projectsDone}/${a.projectsTotal}` : "—"} note="handed in / registered" />
        <Stat label="Temps de présence" value={a.logtime.length > 0 ? hours(logged) : "—"} note={a.logtime.length > 0 ? `over ${a.logtime.length} days` : "not available"} />
      </div>
      {(a.creditsLost.length > 0 || a.creditsAtRisk.length > 0 || a.globalAlert || a.level !== null) && (
        <Card>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-[13px]">
            {a.globalAlert && (
              <span className="flex items-center gap-2">
                <span className="text-muted">MY Epitech alert level</span>
                <Badge tone={a.globalAlert === "green" ? "ok" : a.globalAlert === "red" ? "danger" : "warn"}>{a.globalAlert}</Badge>
              </span>
            )}
            {a.creditsAtRisk.length > 0 && <span className="text-warn">At risk: {a.creditsAtRisk.map(([t, c]) => `${t} (${c} cr.)`).join(", ")}</span>}
            {a.creditsLost.length > 0 && (
              <span className="selectable min-w-0 text-muted" title={a.creditsLost.map(([t, c]) => `${t}: ${c} credit${c === 1 ? "" : "s"}`).join("\n")}>
                Counted as lost by MY Epitech: {a.creditsLost.reduce((n, [, c]) => n + c, 0)} credits in {a.creditsLost.length} unit{a.creditsLost.length === 1 ? "" : "s"}
              </span>
            )}
            {a.level !== null && (
              <span className="ml-auto text-muted">
                Level {a.level}
                {a.xp !== null && ` · ${a.xp.toLocaleString()} XP`}
                {a.xpToNext !== null && ` · ${a.xpToNext.toLocaleString()} to the next`}
              </span>
            )}
          </div>
        </Card>
      )}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardTitle>Unités</CardTitle>
          {a.units.length === 0 ? <p className="px-4 py-4 text-[13px] text-muted">Aucune unité dans les données synchronisées.</p> : <ul className="py-1">{a.units.map((u) => <UnitRow key={u.title} u={u} />)}</ul>}
        </Card>
        <div className="flex flex-col gap-4">
          {a.tests.length > 0 && (
            <Card>
              <CardTitle>Tests automatiques, dernière exécution</CardTitle>
              <ul className="py-1.5">
                {a.tests.map((t) => (
                  <li key={t.project} className="px-4 py-1.5" title={`${t.runs} run${t.runs > 1 ? "s" : ""}${t.date ? `, latest ${new Date(t.date).toLocaleString()}` : ""} · coding style: ${t.styleMajor} major, ${t.styleMinor} minor`}>
                    <div className="mb-1 flex items-baseline gap-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate">{t.project}</span>
                      <span className="font-mono text-[11px] text-faint">{t.module}</span>
                      <span className="text-xs text-muted">{t.passed}/{t.total}</span>
                    </div>
                    <Meter value={t.passed} total={t.total} />
                  </li>
                ))}
              </ul>
              <p className="border-t border-white/6 px-4 py-2.5 text-xs text-faint">Tests réussis à la dernière exécution automatique. Pas une note.</p>
            </Card>
          )}
          {a.competencies.length > 0 && (
            <Card>
              <CardTitle>Blocs de compétences</CardTitle>
              <ul className="py-1">
                {a.competencies.map((c) => (
                  <li key={c.name} className="flex min-h-9 items-center gap-2.5 px-4 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="shrink-0 text-xs text-muted">{c.secure ?? "—"} secured · {c.reachable ?? "—"} reachable · {c.available ?? "—"} available</span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-white/6 px-4 py-2.5 text-xs text-faint">Crédits par bloc, comme MY Epitech les compte.</p>
            </Card>
          )}
          {a.exams.length > 0 && (
            <Card>
              <CardTitle>Examens</CardTitle>
              <ul className="py-1">
                {a.exams.map((e) => (
                  <li key={e.label} className="flex min-h-9 items-center gap-2.5 px-4 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">{e.label}</span>
                    <span className="text-xs text-muted">{e.best ?? "—"}{e.required !== null ? ` · required ${e.required}` : ""}{e.max !== null ? ` / ${e.max}` : ""}</span>
                    {e.best !== null && e.required !== null && <Badge tone={e.best >= e.required ? "ok" : "warn"}>{e.best >= e.required ? "reached" : "below"}</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {(a.marks?.length ?? 0) > 0 && (
            <Card>
              <CardTitle>Notes</CardTitle>
              <ul className="py-1">
                {a.marks.slice(0, 12).map((m, i) => (
                  <li key={`${m.title}-${m.date ?? i}`} title={[m.evaluator && `By ${m.evaluator}`, m.comment].filter(Boolean).join("\n") || undefined} className="flex min-h-9 items-center gap-2.5 px-4 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">{m.title}</span>
                    {m.date && <span className="shrink-0 text-xs text-faint">{new Date(m.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>}
                    <span className="w-10 shrink-0 text-right font-mono text-xs">{m.mark ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
      {recent.length > 0 && (
        <Card>
          <CardTitle>Temps de présence par jour</CardTitle>
          <div className="px-4 pt-4 pb-3">
            <Columns everyLabel={Math.max(1, Math.ceil(recent.length / 10))} data={recent.map((d) => ({ key: d.date, label: shortDay(d.date), value: Math.round((d.mine / 3600) * 10) / 10, tip: `${shortDay(d.date)}: ${hours(d.mine)}${d.promo !== null ? ` · promotion average ${hours(d.promo)}` : ""}` }))} />
            <p className="mt-2 text-xs text-faint">Hours logged on campus tools, last {recent.length} days reported (max is in hours). Hover a day for the promotion average.</p>
          </div>
        </Card>
      )}
      {a.notes.length > 0 && <p className="selectable text-xs text-faint">Not available: {a.notes.join(" ")}</p>}
    </>
  );
}

function UnitRow({ u }: { u: Academic["units"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-white/6 last:border-b-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="row-hover flex w-full items-center gap-2.5 px-4 py-2 text-left">
        {open ? <ChevronDown className="size-3.5 shrink-0 text-faint" /> : <ChevronRight className="size-3.5 shrink-0 text-faint" />}
        <span className="min-w-0 flex-1">
          <span className="mb-1 flex items-baseline gap-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate">{u.title}</span>
            <span className="shrink-0 text-xs text-muted">{u.validated}/{u.total} outcomes</span>
            {u.credits !== null && <span className="w-14 shrink-0 text-right text-xs text-faint">{u.credits} cr.</span>}
          </span>
          <Meter value={u.validated} total={u.total} />
        </span>
        {u.grade && <Badge tone={u.grade === "in progress" ? "neutral" : "accent"}>{u.grade}</Badge>}
      </button>
      {open && (
        <ul className="pb-2 pl-[42px] text-xs">
          {u.outcomes.length === 0 && <li className="py-1 text-faint">Aucun acquis listé.</li>}
          {u.outcomes.map((o) => (
            <li key={o.title} className="flex items-baseline gap-2 py-0.5 pr-4">
              <span className={o.validated ? "text-ok" : "text-faint"}>{o.validated ? "✓" : "○"}</span>
              <span className="min-w-0 flex-1 text-muted">{o.title}{o.mandatory && <span className="text-warn"> · mandatory</span>}</span>
              {o.points !== null && o.total !== null && <span className="shrink-0 text-faint">{o.points}/{o.total} pts</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
