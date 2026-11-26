// Academic analytics: what MY Epitech reported at the last sync — credits, units and their
// learning outcomes, skills, log time, automated test results. Shown as reported: nothing
// here is a prediction, and what could not be read is listed.
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge, Button, Card, CardTitle, Input, Section } from "../../components/ui";
import { api, type Academic } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { useUi } from "../../lib/store";
import { Columns, Stat } from "./AnalyticsPage";
import { locale, plural, t } from "../../lib/i18n";

const hours = (secs: number) => (secs >= 3600 ? `${(secs / 3600).toFixed(1)} h` : `${Math.round(secs / 60)} min`);
const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "short" });

/** A proportion with its numbers written out: the bar helps the eye, the text carries the value. */
function Meter({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-ink/8" role="img" aria-label={`${value} / ${total}`}>
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: "var(--color-accent)" }} />
    </span>
  );
}

const CAP = 8;

/**
 * A long list shows its first rows, with "Tout voir" and, past the cap, a filter. Short lists
 * show everything and no control.
 */
export function useCapped<T>(items: T[], text: (x: T) => string) {
  const [all, setAll] = useState(false);
  const [q, setQ] = useState("");
  const long = items.length > CAP;
  const needle = q.trim().toLowerCase();
  const filtered = needle ? items.filter((x) => text(x).toLowerCase().includes(needle)) : items;
  const shown = all || needle ? filtered : filtered.slice(0, CAP);
  const filter = long ? <Input className="h-7 w-36 text-xs" placeholder={t("Filtrer…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Filtrer la liste")} /> : null;
  const more: ReactNode = long && !needle ? (
    <button type="button" className="w-full border-t border-ink/6 px-4 py-2 text-left text-xs text-muted hover:text-fg" onClick={() => setAll(!all)}>
      {all ? t("Réduire") : t("Tout voir ({n})", { n: items.length })}
    </button>
  ) : needle && filtered.length === 0 ? (
    <p className="px-4 py-2 text-xs text-faint">{t("Rien ne correspond.")}</p>
  ) : null;
  return { shown, filter, more };
}

export function AcademicSection() {
  const setPage = useUi((s) => s.setPage);
  const q = useQuery({ queryKey: ["my-academic"], queryFn: api.myAcademic, staleTime: 60_000 });
  const a = q.data;
  if (!a) return null;
  const empty = a.syncedAt === null;
  return (
    <Section
      id="parcours"
      className="scroll-mt-4"
      title={t("Parcours")}
      meta={empty ? t("Depuis MY Epitech : rien de synchronisé pour l'instant.") : `${t("D'après MY Epitech, synchronisé {ago}", { ago: timeAgo(a.syncedAt!) })}${a.semester !== null ? ` · ${t("semestre {s}", { s: a.semester })}` : ""}`}
      action={
        <Button size="sm" variant="ghost" onClick={() => setPage("myepitech")}>
          {empty ? t("Connecter MY Epitech") : "MY Epitech"}
        </Button>
      }
    >
      {!empty && (
        <div className="mt-3 flex flex-col gap-4">
          <Filled a={a} />
        </div>
      )}
    </Section>
  );
}

function Filled({ a }: { a: Academic }) {
  const done = a.units.reduce((n, u) => n + u.validated, 0);
  const all = a.units.reduce((n, u) => n + u.total, 0);
  const [span, setSpan] = useState<14 | 30 | 0>(30);
  const recent = span ? a.logtime.slice(-span) : a.logtime;
  const logged = recent.reduce((n, d) => n + d.mine, 0);
  const units = useCapped(a.units, (u) => u.title);
  const marks = useCapped(a.marks ?? [], (m) => m.title);
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={t("Crédits acquis")} value={a.creditsAcquired !== null ? String(a.creditsAcquired) : "—"} note={a.creditsTotal !== null && a.creditsTotal !== a.creditsAcquired ? t("{n} avec les crédits antérieurs", { n: a.creditsTotal }) : undefined} />
        <Stat label={t("Acquis d'apprentissage")} value={all > 0 ? `${done}/${all}` : "—"} note={all > 0 ? plural(a.units.length, "validés, sur {n} unité", "validés, sur {n} unités") : t("non disponible")} />
        <Stat label={t("Projets")} value={a.projectsTotal > 0 ? `${a.projectsDone}/${a.projectsTotal}` : "—"} note={t("rendus / inscrits")} />
        <Stat label={t("Temps de présence")} value={recent.length > 0 ? hours(logged) : "—"} note={recent.length > 0 ? plural(recent.length, "sur {n} jour", "sur {n} jours") : t("non disponible")} />
      </div>
      {(a.creditsLost.length > 0 || a.creditsAtRisk.length > 0 || a.globalAlert || a.level !== null) && (
        <Card>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
            {a.globalAlert && (
              <span className="flex items-center gap-2">
                <span className="text-muted">{t("Niveau d'alerte MY Epitech")}</span>
                <Badge tone={a.globalAlert === "green" ? "ok" : a.globalAlert === "red" ? "danger" : "warn"}>{a.globalAlert}</Badge>
              </span>
            )}
            {a.creditsAtRisk.length > 0 && <span className="text-warn">{t("En danger : {list}", { list: a.creditsAtRisk.map(([u, c]) => `${u} (${c} cr.)`).join(", ") })}</span>}
            {a.creditsLost.length > 0 && (
              <span className="selectable min-w-0 text-muted" title={a.creditsLost.map(([u, c]) => `${u} : ${c} cr.`).join("\n")}>
                {t("Comptés perdus par MY Epitech : {c} crédits dans {n} unité(s)", { c: a.creditsLost.reduce((n, [, c]) => n + c, 0), n: a.creditsLost.length })}
              </span>
            )}
            {a.level !== null && (
              <span className="ml-auto text-muted">
                {t("Niveau {n}", { n: a.level })}
                {a.xp !== null && ` · ${a.xp.toLocaleString(locale())} XP`}
                {a.xpToNext !== null && ` · ${t("{n} avant le suivant", { n: a.xpToNext.toLocaleString(locale()) })}`}
              </span>
            )}
          </div>
        </Card>
      )}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardTitle right={units.filter}>{t("Unités")}</CardTitle>
          {a.units.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">{t("Aucune unité dans les données synchronisées.")}</p>
          ) : (
            <>
              <ul className="py-1">{units.shown.map((u) => <UnitRow key={u.title} u={u} />)}</ul>
              {units.more}
            </>
          )}
        </Card>
        <div className="flex flex-col gap-4">
          {a.tests.length > 0 && (
            <Card>
              <CardTitle>{t("Tests automatiques, dernière exécution")}</CardTitle>
              <ul className="py-1.5">
                {a.tests.map((x) => (
                  <li key={x.project} className="px-4 py-1.5" title={`${plural(x.runs, "{n} exécution", "{n} exécutions")}${x.date ? ` · ${new Date(x.date).toLocaleString(locale())}` : ""} · ${t("norme : {M} majeures, {m} mineures", { M: x.styleMajor, m: x.styleMinor })}`}>
                    <div className="mb-1 flex items-baseline gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{x.project}</span>
                      <span className="font-mono text-2xs text-faint">{x.module}</span>
                      <span className="text-xs text-muted">{x.passed}/{x.total}</span>
                    </div>
                    <Meter value={x.passed} total={x.total} />
                  </li>
                ))}
              </ul>
              <p className="border-t border-ink/6 px-4 py-2.5 text-xs text-faint">{t("Tests réussis à la dernière exécution automatique. Pas une note.")}</p>
            </Card>
          )}
          {a.competencies.length > 0 && (
            <Card>
              <CardTitle>{t("Blocs de compétences")}</CardTitle>
              <ul className="py-1">
                {a.competencies.map((c) => (
                  <li key={c.name} className="flex min-h-9 items-center gap-2.5 px-4 text-sm">
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="shrink-0 text-xs text-muted">{t("{s} sécurisés · {r} atteignables · {a} disponibles", { s: c.secure ?? "—", r: c.reachable ?? "—", a: c.available ?? "—" })}</span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-ink/6 px-4 py-2.5 text-xs text-faint">{t("Crédits par bloc, comme MY Epitech les compte.")}</p>
            </Card>
          )}
          {a.exams.length > 0 && (
            <Card>
              <CardTitle>{t("Examens")}</CardTitle>
              <ul className="py-1">
                {a.exams.map((e) => (
                  <li key={e.label} className="flex min-h-9 items-center gap-2.5 px-4 text-sm">
                    <span className="min-w-0 flex-1 truncate">{e.label}</span>
                    <span className="text-xs text-muted">
                      {e.best ?? "—"}
                      {e.max !== null ? ` / ${e.max}` : ""}
                      {e.required !== null ? ` · ${t("requis {n}", { n: e.required })}` : ""}
                    </span>
                    {e.best !== null && e.required !== null && <Badge tone={e.best >= e.required ? "ok" : "warn"}>{e.best >= e.required ? t("atteint") : t("en dessous")}</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {(a.marks?.length ?? 0) > 0 && (
            <Card>
              <CardTitle right={marks.filter}>{t("Notes")}</CardTitle>
              <ul className="py-1">
                {marks.shown.map((m, i) => (
                  <li key={`${m.title}-${m.date ?? i}`} title={[m.evaluator && t("Par {n}", { n: m.evaluator }), m.comment].filter(Boolean).join("\n") || undefined} className="flex min-h-9 items-center gap-2.5 px-4 text-sm">
                    <span className="min-w-0 flex-1 truncate">{m.title}</span>
                    {m.date && <span className="shrink-0 text-xs text-faint">{new Date(m.date).toLocaleDateString(locale(), { day: "numeric", month: "short" })}</span>}
                    <span className="w-10 shrink-0 text-right font-mono text-xs">{m.mark ?? "—"}</span>
                  </li>
                ))}
              </ul>
              {marks.more}
            </Card>
          )}
        </div>
      </div>
      {a.logtime.length > 0 && (
        <Card>
          <CardTitle
            right={
              <span className="flex gap-1" role="group" aria-label={t("Période")}>
                {([14, 30, 0] as const).map((s) => (
                  <Button key={s} size="sm" variant={span === s ? "secondary" : "ghost"} aria-pressed={span === s} onClick={() => setSpan(s)}>
                    {s ? t("{n} j", { n: s }) : t("Tout")}
                  </Button>
                ))}
              </span>
            }
          >
            {t("Temps de présence par jour")}
          </CardTitle>
          <div className="px-4 pt-4 pb-3">
            <Columns everyLabel={Math.max(1, Math.ceil(recent.length / 10))} data={recent.map((d) => ({ key: d.date, label: shortDay(d.date), value: Math.round((d.mine / 3600) * 10) / 10, tip: `${shortDay(d.date)} : ${hours(d.mine)}${d.promo !== null ? ` · ${t("moyenne de la promotion {h}", { h: hours(d.promo) })}` : ""}` }))} />
            <p className="mt-2 text-xs text-faint">{t("Heures relevées par les outils du campus, en heures. Survole un jour pour la moyenne de la promotion.")}</p>
          </div>
        </Card>
      )}
      {a.notes.length > 0 && <p className="selectable text-xs text-faint">{t("Non disponible : {list}", { list: a.notes.join(" ") })}</p>}
    </>
  );
}

function UnitRow({ u }: { u: Academic["units"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-ink/6 last:border-b-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="row-hover flex w-full items-center gap-2.5 px-4 py-2 text-left">
        {open ? <ChevronDown className="size-3.5 shrink-0 text-faint" /> : <ChevronRight className="size-3.5 shrink-0 text-faint" />}
        <span className="min-w-0 flex-1">
          <span className="mb-1 flex items-baseline gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{u.title}</span>
            <span className="shrink-0 text-xs text-muted">{t("{v}/{n} acquis", { v: u.validated, n: u.total })}</span>
            {u.credits !== null && <span className="w-14 shrink-0 text-right text-xs text-faint">{u.credits} cr.</span>}
          </span>
          <Meter value={u.validated} total={u.total} />
        </span>
        {u.grade && <Badge tone={u.grade === "in progress" ? "neutral" : "accent"}>{u.grade === "in progress" ? t("en cours") : u.grade}</Badge>}
      </button>
      {open && (
        <ul className="pb-2 pl-[42px] text-xs">
          {u.outcomes.length === 0 && <li className="py-1 text-faint">{t("Aucun acquis listé.")}</li>}
          {u.outcomes.map((o) => (
            <li key={o.title} className="flex items-baseline gap-2 py-0.5 pr-4">
              <span className={o.validated ? "text-ok" : "text-faint"}>{o.validated ? "✓" : "○"}</span>
              <span className="min-w-0 flex-1 text-muted">
                {o.title}
                {o.mandatory && <span className="text-warn"> · {t("obligatoire")}</span>}
              </span>
              {o.points !== null && o.total !== null && <span className="shrink-0 text-faint">{o.points}/{o.total} pts</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
