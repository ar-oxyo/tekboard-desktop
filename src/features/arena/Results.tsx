// Arena results: curves (time, CPU, memory, instructions), estimated complexity with its
// confidence, the results table, hottest functions, heap, the data used, the hypotheses
// (read from the code — never presented as measurements) and the limits of the run.
import { useState } from "react";
import { AlertTriangle, FileSearch, Flame, Lightbulb, Sparkles } from "lucide-react";
import type { ArenaResults, JobView } from "../../lib/api";
import { LineChart } from "../../components/charts/LineChart";
import { Badge, Button, cn, Dot, Spinner } from "../../components/ui";
import { CodeView } from "../../components/DiffView";
import { bytes, compact, duration } from "../../lib/charts";
import { chartSeries, fitLabel, ratioAt, seriesLabel, type Metric } from "../../lib/arena";
import { Markdown } from "../artix/Markdown";
import { t } from "../../lib/i18n";

const STEP_TONE: Record<string, "ok" | "warn" | "danger" | "accent" | "neutral"> = { success: "ok", warning: "warn", failed: "danger", running: "accent", cancelled: "neutral", skipped: "neutral", pending: "neutral" };

/** What the results need from a job: a live one or a finished run from the history. */
export type JobLike = Pick<JobView, "steps" | "log" | "status">;

export function JobSteps({ job }: { job: JobLike }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {job.steps.map((s) => (
        <Dot key={s.id} tone={STEP_TONE[s.status] ?? "neutral"} title={s.detail ?? undefined}>
          {t(s.label)}
          {s.status === "running" && <Spinner className="ml-1 size-3" />}
        </Dot>
      ))}
    </div>
  );
}

export function Results({ r, job, report, reportBusy, onReport, reportDisabled }: { r: ArenaResults; job: JobLike | null; report: string | null; reportBusy: boolean; onReport: () => void; reportDisabled: string | null }) {
  const [metric, setMetric] = useState<Metric>("wall");
  const [logScale, setLogScale] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const hasIr = r.series.some((s) => s.points.some((p) => p.ir !== null));
  const series = chartSeries(r, metric);
  const metrics: Array<[Metric, string, boolean]> = [
    ["wall", t("Temps réel"), true],
    ["cpu", t("Temps CPU"), true],
    ["rss", t("Mémoire max"), true],
    ["ir", t("Instructions"), hasIr],
  ];
  const fmt = (v: number) => (metric === "rss" ? bytes(v * 1024) : metric === "ir" ? compact(v) : duration(v));
  const running = job?.status === "running";
  const ratio = r.variants.length === 2 ? ratioAt(r.series.find((s) => s.variant === 0), r.series.find((s) => s.variant === 1)) : null;
  const heur = r.hypotheses.filter((h) => (h.provenance ?? "heuristique") === "heuristique");
  return (
    <div className="space-y-4">
      {job && (
        <div className="flex items-center gap-3">
          <JobSteps job={job} />
          <button type="button" className="ml-auto text-xs text-faint hover:text-fg" onClick={() => setShowLog(!showLog)}>
            {showLog ? t("Masquer le journal") : t("Journal")}
          </button>
        </div>
      )}
      {showLog && job && <CodeView text={job.log || "…"} className="max-h-56 rounded-md" />}

      {series.length > 0 ? (
        <section className="card p-3">
          <div className="mb-2 flex flex-wrap items-center gap-1">
            {metrics.map(([id, label, on]) => (
              <button key={id} type="button" disabled={!on} title={on ? undefined : t("Activez Callgrind pour compter les instructions")} onClick={() => setMetric(id)} className={cn("h-7 rounded-md px-2.5 text-xs transition-colors disabled:opacity-40", metric === id ? "bg-accent-soft text-accent-strong" : "text-muted hover:bg-hover hover:text-fg")}>
                {label}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" className="accent-(--color-accent)" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} />
              {t("Échelles logarithmiques")}
            </label>
          </div>
          <LineChart series={series} xLabel={t("taille n")} yLabel={metrics.find((m) => m[0] === metric)?.[1] ?? ""} formatY={fmt} logX={logScale} logY={logScale} />
          {metric === "wall" && <p className="mt-1 text-2xs text-faint">{t("Médiane des exécutions ; la bande montre le minimum et le maximum.")}</p>}
        </section>
      ) : running ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> {t("Les mesures arrivent au fur et à mesure…")}
        </p>
      ) : null}

      {r.series.some((s) => s.fitTime || s.fitIr) && (
        <section className="card p-3">
          <h3 className="mb-2 text-xs text-faint">{t("Complexité estimée (expérimentale)")}</h3>
          <ul className="space-y-1.5">
            {r.series.map((s) => {
              const ft = fitLabel(s.fitTime);
              const fi = fitLabel(s.fitIr);
              return (
                <li key={`${s.variant}-${s.scenario}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-32 text-fg">{seriesLabel(r, s)}</span>
                  <span className="text-xs text-faint">{t("temps")}</span>
                  <Badge tone={ft.tone} title={s.fitTime?.why}>
                    {ft.text}
                  </Badge>
                  {s.fitTime?.exponent != null && <span className="text-xs text-faint tabular">{t("pente ≈ n^{k}", { k: s.fitTime.exponent.toFixed(2) })}</span>}
                  {s.fitIr && (
                    <>
                      <span className="text-xs text-faint">{t("instructions")}</span>
                      <Badge tone={fi.tone} title={s.fitIr.why}>
                        {fi.text}
                      </Badge>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {ratio && (
            <p className="mt-2 text-sm text-muted">
              {ratio.ratio >= 1
                ? t("À n = {n}, {b} est {x}× plus lent que {a}.", { n: compact(ratio.n), a: r.variants[0], b: r.variants[1], x: ratio.ratio.toFixed(2) })
                : t("À n = {n}, {b} est {x}× plus rapide que {a}.", { n: compact(ratio.n), a: r.variants[0], b: r.variants[1], x: (1 / ratio.ratio).toFixed(2) })}
            </p>
          )}
          <p className="mt-1 text-2xs text-faint">{t("Ajustement par moindres carrés sur les tailles mesurées. « ? » : le modèle suivant est trop proche pour conclure. Survole un badge pour le détail.")}</p>
        </section>
      )}

      {r.series.length > 0 && (
        <section className="card overflow-x-auto p-3">
          <h3 className="mb-2 text-xs text-faint">{t("Tableau des résultats")}</h3>
          <table className="w-full text-xs tabular">
            <thead className="text-left text-faint">
              <tr>
                <th className="py-1 pr-3 font-normal">{t("Série")}</th>
                <th className="pr-3 font-normal">n</th>
                <th className="pr-3 font-normal">{t("Temps (médiane)")}</th>
                <th className="pr-3 font-normal">{t("Écart (MAD)")}</th>
                <th className="pr-3 font-normal">CPU</th>
                <th className="pr-3 font-normal">{t("Mémoire max")}</th>
                <th className="pr-3 font-normal">{t("Instructions")}</th>
                <th className="font-normal">{t("Exécutions")}</th>
              </tr>
            </thead>
            <tbody>
              {r.series.flatMap((s) =>
                s.points.map((p) => (
                  <tr key={`${s.variant}-${s.scenario}-${p.n}`} className="border-t border-ink/5 text-fg">
                    <td className="py-1 pr-3 text-muted">{seriesLabel(r, s)}</td>
                    <td className="pr-3">{compact(p.n)}</td>
                    {p.failed ? (
                      <td colSpan={6} className="text-danger">
                        {p.failed}
                      </td>
                    ) : (
                      <>
                        <td className="pr-3">{p.wall ? duration(p.wall.median) : "—"}</td>
                        <td className="pr-3 text-muted">{p.wall ? `± ${duration(p.wall.mad)}` : "—"}</td>
                        <td className="pr-3">{p.cpu ? duration(p.cpu.median) : "—"}</td>
                        <td className="pr-3">{p.maxRssKb !== null ? bytes(p.maxRssKb * 1024) : "—"}</td>
                        <td className="pr-3">{p.ir !== null ? compact(p.ir) : "—"}</td>
                        <td>
                          {p.samples.length}
                          {p.wall && p.wall.outliers.length > 0 && (
                            <span className="ml-1 text-warn" title={t("Exécutions atypiques, ignorées par la médiane")}>
                              ({t("{n} atypique(s)", { n: p.wall.outliers.length })})
                            </span>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </section>
      )}

      {r.series.some((s) => s.hot?.functions.length || s.heap || s.heapPeak) && (
        <section className="card p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs text-faint">
            <Flame className="size-3.5" /> {t("Où passe le temps (Callgrind) et le tas (Massif, Memcheck)")}
          </h3>
          <div className="space-y-4">
            {r.series.map((s) => (
              <div key={`${s.variant}-${s.scenario}`}>
                <p className="mb-1 text-xs text-muted">
                  {seriesLabel(r, s)} {s.profiledN !== null && <span className="text-faint">· n = {compact(s.profiledN)}</span>}
                  {s.heapPeak !== null && <span className="ml-3">{t("pic du tas : {b}", { b: bytes(s.heapPeak) })}</span>}
                  {s.heap && <span className="ml-3">{t("{a} allocation(s), {f} libération(s), {b} alloués", { a: compact(s.heap.allocs), f: compact(s.heap.frees), b: bytes(s.heap.bytes) })}</span>}
                </p>
                <ul className="space-y-1">
                  {(s.hot?.functions ?? []).slice(0, 8).map((f, i) => (
                    <li key={i} className="grid grid-cols-[minmax(0,14rem)_1fr_4.5rem] items-center gap-2 text-xs">
                      <span className={cn("truncate font-mono", f.own ? "text-fg" : "text-faint")} title={f.file ?? undefined}>
                        {f.function}
                        {!f.own && <span className="ml-1 text-3xs">(libc)</span>}
                      </span>
                      <span className="h-2 rounded-sm bg-ink/5">
                        <span className="block h-2 rounded-sm" style={{ width: `${Math.max(1, f.percent)}%`, background: f.own ? "var(--color-accent)" : "var(--color-faint)" }} />
                      </span>
                      <span className="text-right text-muted tabular">{f.percent.toFixed(1)} %</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {(heur.length > 0 || r.hypotheses.length > heur.length) && (
        <section className="card p-3">
          <h3 className="mb-1 flex items-center gap-1.5 text-xs text-faint">
            <Lightbulb className="size-3.5" /> {t("Hypothèses (lues dans le code, pas mesurées)")}
          </h3>
          <p className="mb-2 text-2xs text-faint">{t("Des pistes à confirmer avec les mesures ci-dessus : une boucle imbriquée n'est lente que si elle parcourt beaucoup de données.")}</p>
          <ul className="space-y-1">
            {r.hypotheses.slice(0, 30).map((h, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <Badge tone={h.weight === "high" ? "warn" : "neutral"}>{h.provenance === "artix" ? "Artix" : t("lecture du code")}</Badge>
                <span className="min-w-0 flex-1 text-fg">{h.message}</span>
                <span className="shrink-0 font-mono text-2xs text-faint">
                  {h.function}() · {h.file}
                  {h.line ? `:${h.line}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.inputs.length > 0 && (
        <details className="card p-3">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-faint">
            <FileSearch className="size-3.5" /> {t("Données utilisées ({n} fichier(s), mêmes données pour chaque variante)", { n: r.inputs.length })}
          </summary>
          <ul className="mt-2 space-y-2">
            {r.inputs.map((i) => (
              <li key={`${i.scenario}-${i.n}`}>
                <p className="text-xs text-muted">
                  {r.config?.scenarios[i.scenario]?.name} · n = {compact(i.n)} · {bytes(i.bytes)}
                </p>
                <CodeView text={i.head + (i.bytes > i.head.length ? "\n…" : "")} className="max-h-24 rounded-md" />
              </li>
            ))}
          </ul>
        </details>
      )}

      {(r.notes.length > 0 || r.machine?.cpu) && (
        <section className="space-y-1 text-xs text-muted">
          {r.notes.map((n, i) => (
            <p key={i} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" /> {n}
            </p>
          ))}
          {r.machine?.cpu && (
            <p className="text-faint">
              {t("Mesuré sur {cpu} ({c} cœurs, charge {l}). Les temps varient d'une machine et d'un moment à l'autre ; les instructions comptées, non.", { cpu: r.machine.cpu, c: r.machine.cores, l: r.machine.load ?? "?" })}
            </p>
          )}
        </section>
      )}

      {!running && r.series.length > 0 && (
        <section className="card p-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xs text-faint">{t("Rapport d'Artix")}</h3>
            <Button size="sm" className="ml-auto" icon={<Sparkles className="size-3.5" />} busy={reportBusy} disabled={!!reportDisabled} disabledReason={reportDisabled} onClick={onReport}>
              {report ? t("Réécrire le rapport") : t("Écrire le rapport")}
            </Button>
          </div>
          {report ? <Markdown text={report} className="mt-2 text-sm" /> : <p className="mt-1 text-xs text-muted">{t("Artix explique ce qui ralentit le programme à partir des seules mesures ci-dessus, avec les preuves, les limites et les compromis. Il ne modifie pas le code.")}</p>}
        </section>
      )}
    </div>
  );
}
