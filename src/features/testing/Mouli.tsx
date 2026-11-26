// The TekBoard moulinette, for one project: a test plan prepared from the subject (one AI
// call), run in the sandbox without AI, results by category with what was expected and what
// came out. It gives results, never solutions. The score is TekBoard's, not an Epitech grade.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, FileCode2, ListChecks, Play, RotateCcw, Sparkles, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CodeView } from "../../components/DiffView";
import { Button, cn, Dot, EmptyState, ErrorNote, Notice, Spinner } from "../../components/ui";
import { api, asAppError, type MouliCase, type MouliReport, type MouliResult, type MouliStatus, type MouliSuite } from "../../lib/api";
import { aiGate } from "../../lib/ai";
import { t } from "../../lib/i18n";
import { useJob } from "../../lib/jobs";
import { useUi } from "../../lib/store";
import { useAiStatus } from "../settings/AiProvider";
import { JobSteps } from "../arena/Results";

const STATUS: Record<MouliStatus, { tone: "ok" | "danger" | "warn" | "neutral" | "info"; label: string }> = {
  passed: { tone: "ok", label: t("Réussi") },
  failed: { tone: "danger", label: t("Échoué") },
  timeout: { tone: "warn", label: t("Délai dépassé") },
  crashed: { tone: "danger", label: t("Plantage") },
  memory: { tone: "danger", label: t("Erreur mémoire") },
  skipped: { tone: "neutral", label: t("Ignoré") },
  build_error: { tone: "danger", label: t("Ne compile pas") },
  mouli_error: { tone: "warn", label: t("Erreur de la moulinette") },
};

const CATEGORY: Record<string, string> = {
  simple: t("Simples"),
  fonctionnel: t("Fonctionnels"),
  limites: t("Valeurs limites"),
  erreurs: t("Entrées invalides"),
  robustesse: t("Robustesse"),
  memoire: t("Mémoire"),
  performance: t("Performances"),
  regression: t("Régression"),
};

type Tab = "results" | "plan" | "files";

export function MouliView({ repo }: { repo: string }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const ai = aiGate(useAiStatus().data);
  const state = useQuery({ queryKey: ["mouli", repo], queryFn: () => api.mouliState(repo), staleTime: 0 });
  const [jobId, setJobId] = useState<number | null>(null);
  const job = useJob(jobId);
  const running = job.data?.status === "running";
  const [tab, setTab] = useState<Tab>("results");
  useEffect(() => {
    if (job.data && job.data.status !== "running") void qc.invalidateQueries({ queryKey: ["mouli", repo] });
  }, [job.data?.status, qc, repo]); // eslint-disable-line react-hooks/exhaustive-deps

  const suite = (job.data?.kind === "mouli_plan" ? (job.data.summary.suite as MouliSuite | undefined) : undefined) ?? state.data?.suite ?? null;
  const live = job.data?.kind === "mouli_run" ? (job.data.summary.report as MouliReport | undefined) : undefined;
  const report = live ?? state.data?.report ?? null;
  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });
  const start = (fn: () => Promise<number>, then: Tab) => void fn().then((id) => { setJobId(id); setTab(then); }, fail(t("Démarrage impossible")));
  const failedIds = (report?.results ?? []).filter((r) => r.status !== "passed" && r.status !== "skipped").map((r) => r.id);
  const enabled = suite?.cases.filter((c) => c.enabled).length ?? 0;

  if (state.isLoading) return <p className="flex items-center gap-2 py-10 text-muted"><Spinner /> {t("Lecture…")}</p>;
  if (state.error) return <ErrorNote>{asAppError(state.error).message}</ErrorNote>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button variant="danger" icon={<Square className="size-3.5" />} onClick={() => jobId !== null && void api.jobCancel(jobId)}>{t("Arrêter")}</Button>
        ) : (
          <Button variant="primary" icon={<Play className="size-3.5" />} disabled={!suite || enabled === 0} disabledReason={!suite ? t("Prépare d'abord le plan de tests") : t("Aucun cas activé")} onClick={() => start(() => api.mouliRun(repo), "results")}>
            {t("Lancer la moulinette")}
          </Button>
        )}
        {!running && failedIds.length > 0 && (
          <Button icon={<RotateCcw className="size-3.5" />} onClick={() => start(() => api.mouliRun(repo, failedIds), "results")}>{t("Relancer les échecs ({n})", { n: failedIds.length })}</Button>
        )}
        <Button variant="ghost" icon={<Sparkles className="size-3.5" />} busy={running && job.data?.kind === "mouli_plan"} disabled={running || !ai.text} disabledReason={running ? t("Attends la fin de la tâche en cours") : (ai.why ?? "")} onClick={() => start(() => api.mouliAnalyze(repo), "plan")} title={t("Artix lit le sujet et les signatures (pas le code) et écrit un plan de tests. Un seul appel à l'IA.")}>
          {suite ? t("Refaire le plan") : t("Préparer les tests")}
        </Button>
        <span className="flex-1" />
        <Tabs tab={tab} setTab={setTab} counts={{ plan: suite?.cases.length ?? 0, files: suite?.files.length ?? 0 }} />
      </div>
      {job.data && running && <JobSteps job={job.data} />}
      {job.data?.status === "failed" && typeof job.data.summary.error === "string" && <ErrorNote>{job.data.summary.error}</ErrorNote>}

      {!suite && !running ? (
        <EmptyState icon={<ListChecks className="size-6" />} title={t("Pas encore de plan de tests")} action={<Button variant="primary" icon={<Sparkles className="size-3.5" />} disabled={!ai.text} disabledReason={ai.why ?? ""} onClick={() => start(() => api.mouliAnalyze(repo), "plan")}>{t("Préparer les tests")}</Button>}>
          {t("Artix lit le sujet lié au projet et les signatures de tes fonctions, puis propose des tests. Ils tournent ensuite ici, dans le bac à sable, sans IA.")}
        </EmptyState>
      ) : tab === "results" ? (
        <Results report={report} running={running && job.data?.kind === "mouli_run"} total={enabled} />
      ) : tab === "plan" && suite ? (
        <Plan repo={repo} suite={suite} />
      ) : suite ? (
        <Files repo={repo} suite={suite} />
      ) : null}
    </div>
  );
}

function Tabs({ tab, setTab, counts }: { tab: Tab; setTab: (t: Tab) => void; counts: { plan: number; files: number } }) {
  const items: Array<[Tab, string]> = [["results", t("Résultats")], ["plan", t("Plan ({n})", { n: counts.plan })], ["files", t("Fichiers Criterion ({n})", { n: counts.files })]];
  return (
    <div className="flex rounded-(--btn-radius) border border-line p-0.5" role="tablist">
      {items.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("h-7 rounded-[4px] px-2.5 text-xs transition-colors", tab === id ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-fg")}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Results({ report, running, total }: { report: MouliReport | null; running: boolean; total: number }) {
  const results = report?.results ?? [];
  const groups = useMemo(() => {
    const m = new Map<string, MouliResult[]>();
    for (const r of results) m.set(r.category, [...(m.get(r.category) ?? []), r]);
    return [...m.entries()];
  }, [results]);
  if (!report && !running) return <p className="text-sm text-muted">{t("Lance la moulinette pour voir les résultats.")}</p>;
  const passed = results.filter((r) => r.status === "passed").length;
  const ours = results.filter((r) => r.origin === "mouli").length;
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
        <p className="leading-none" title={t("Part des tests réussis parmi ceux qui ont pu tourner. Un indicateur TekBoard, pas une note Epitech.")}>
          <span className="display text-3xl font-bold tabular-nums">{report?.score ?? "—"}</span>
          <span className="ml-1 text-lg text-muted">%</span>
          <span className="ml-2 text-sm text-muted">{t("score TekBoard")}</span>
        </p>
        <p className="text-sm text-muted tabular-nums">{t("{p} réussis sur {n}", { p: passed, n: results.length })}{running ? ` · ${t("{d} / {t} lancés", { d: results.length, t: total })}` : ""}</p>
        {ours > 0 && <p className="text-xs text-warn">{t("{n} test(s) n'ont pas pu tourner : erreur de la moulinette, pas de ton programme", { n: ours })}</p>}
        {running && <Spinner />}
      </div>
      {report?.build && <Notice tone="danger"><span className="selectable whitespace-pre-wrap font-mono text-xs">{report.build}</span></Notice>}
      {groups.map(([cat, list]) => (
        <section key={cat}>
          <header className="flex items-center gap-3 border-b border-line pb-1.5">
            <h3 className="text-sm font-semibold">{CATEGORY[cat] ?? cat}</h3>
            <span className="font-mono text-2xs text-muted">{list.filter((r) => r.status === "passed").length}/{list.length}</span>
          </header>
          <ul>{list.map((r) => <ResultRow key={r.id} r={r} />)}</ul>
        </section>
      ))}
    </div>
  );
}

function ResultRow({ r }: { r: MouliResult }) {
  const [open, setOpen] = useState(false);
  const ok = r.status === "passed";
  return (
    <li className="border-b border-line/60 last:border-0">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="ink-row flex min-h-9 w-full items-center gap-3 px-1 text-left">
        <ChevronRight className={cn("size-3.5 shrink-0 text-faint transition-transform", open && "rotate-90")} />
        <span className="w-36 shrink-0"><Dot tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Dot></span>
        <span className="min-w-0 flex-1 truncate text-sm text-fg">{r.title}</span>
        {r.detail && !ok && <span className="hidden max-w-72 truncate text-xs text-muted @3xl:inline">{r.detail.split("\n")[0]}</span>}
        <span className="w-10 shrink-0 text-right font-mono text-2xs text-faint">{r.kind === "unit" ? "unit" : "io"}</span>
        <span className="w-16 shrink-0 text-right font-mono text-2xs text-faint tabular-nums">{r.ms ? `${r.ms} ms` : ""}</span>
      </button>
      {open && (
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 px-8 pt-1 pb-3 text-xs">
          {r.origin === "mouli" && <><dt className="text-warn">{t("Origine")}</dt><dd className="text-warn">{t("Erreur de la moulinette : ce test n'a pas pu tourner, ce n'est pas ton programme.")}</dd></>}
          {r.input && <><dt className="text-faint">{t("Entrée")}</dt><dd className="selectable font-mono break-all">{r.input}</dd></>}
          {r.expected !== null && r.got !== null ? (
            <>
              <dt className="text-faint">{t("Attendu · obtenu")}</dt>
              <dd className="grid grid-cols-2 gap-2">
                <CodeView text={r.expected} className="max-h-40 rounded-md" />
                <CodeView text={r.got || t("(vide)")} className="max-h-40 rounded-md" />
              </dd>
            </>
          ) : r.expected !== null ? (
            <><dt className="text-faint">{t("Attendu")}</dt><dd><CodeView text={r.expected} className="max-h-40 rounded-md" /></dd></>
          ) : null}
          {r.detail && <><dt className="text-faint">{t("Détail")}</dt><dd className="selectable whitespace-pre-wrap font-mono">{r.detail}</dd></>}
          {(r.code !== null || r.signal) && <><dt className="text-faint">{t("Fin")}</dt><dd className="font-mono">{r.signal ? t("signal {s}", { s: r.signal }) : t("code {c}", { c: r.code ?? "—" })}</dd></>}
          {r.stdout && r.got === null && <><dt className="text-faint">stdout</dt><dd><CodeView text={r.stdout} className="max-h-40 rounded-md" /></dd></>}
          {r.stderr && <><dt className="text-faint">stderr</dt><dd><CodeView text={r.stderr} className="max-h-40 rounded-md" /></dd></>}
        </dl>
      )}
    </li>
  );
}

function Plan({ repo, suite }: { repo: string; suite: MouliSuite }) {
  const qc = useQueryClient();
  const toggle = (c: MouliCase) => void api.mouliToggle(repo, [c.id], !c.enabled).then((s) => qc.setQueryData(["mouli", repo], (old: { report: MouliReport | null } | undefined) => ({ report: old?.report ?? null, suite: s })));
  return (
    <div className="space-y-6">
      {!suite.withSubject && <Notice tone="warn">{t("Aucun sujet n'est lié à ce projet : le plan se limite aux conventions (pas de plantage, code 84). Lie le sujet dans la fiche du projet pour des tests précis.")}</Notice>}
      {suite.summary && <p className="max-w-[75ch] text-sm text-muted">{suite.summary}</p>}
      <ul>
        {suite.cases.map((c) => (
          <li key={c.id} className={cn("flex items-start gap-3 border-b border-line/60 px-1 py-2 last:border-0", !c.enabled && "opacity-50")}>
            <input type="checkbox" className="mt-0.5 accent-(--color-accent)" checked={c.enabled} onChange={() => toggle(c)} aria-label={t("Garder ce test")} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg">{c.title}</p>
              <p className="truncate font-mono text-2xs text-faint">{c.kind === "unit" ? `Test(${c.suite}, ${c.name})` : c.args.length ? c.args.join(" ") : t("(sans argument)")}</p>
            </div>
            <span className="shrink-0 text-2xs text-muted">{CATEGORY[c.category] ?? c.category}</span>
            {c.source && <span className="w-40 shrink-0 truncate text-2xs text-faint" title={c.source}>{c.source}</span>}
          </li>
        ))}
      </ul>
      {suite.unspecified.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted hover:text-fg">{t("Non précisé par le sujet, donc pas testé ({n})", { n: suite.unspecified.length })}</summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-muted">{suite.unspecified.map((u) => <li key={u}>{u}</li>)}</ul>
        </details>
      )}
      {suite.rejected.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted hover:text-fg">{t("Écartés par le contrôle ({n})", { n: suite.rejected.length })}</summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-muted">{suite.rejected.map((u) => <li key={u}>{u}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function Files({ repo, suite }: { repo: string; suite: MouliSuite }) {
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(suite.files[0]?.name ?? null);
  if (suite.files.length === 0) return <p className="text-sm text-muted">{t("Le plan ne contient pas de test unitaire.")}</p>;
  const current = suite.files.find((f) => f.name === open) ?? suite.files[0];
  const write = () => {
    if (!window.confirm(t("Écrire {n} fichier(s) dans tests/ ? Un fichier qui existe déjà n'est pas remplacé.", { n: suite.files.length }))) return;
    void api.mouliExport(repo, suite.files.map((f) => f.name)).then(
      (r) => toast({ kind: "ok", title: t("{n} fichier(s) écrit(s)", { n: r.written.length }), detail: r.kept.length ? t("Gardés tels quels (déjà présents) : {f}", { f: r.kept.join(", ") }) : r.written.join(", ") }),
      (e) => toast({ kind: "error", title: t("Fichiers non écrits"), detail: asAppError(e).message }),
    );
  };
  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-4">
      <div className="space-y-2">
        <ul>
          {suite.files.map((f) => (
            <li key={f.name}>
              <button type="button" onClick={() => setOpen(f.name)} className={cn("ink-row flex w-full items-center gap-2 rounded-(--btn-radius) px-2 py-1.5 text-left font-mono text-xs", current.name === f.name && "bg-accent-soft")}>
                <FileCode2 className="size-3.5 shrink-0 text-faint" /> <span className="truncate">{f.name}</span>
                <span className="ml-auto text-faint">{f.tests.length}</span>
              </button>
            </li>
          ))}
        </ul>
        <Button size="sm" className="w-full" onClick={write} title={t("Dans le dossier tests/ du projet, sans jamais remplacer un fichier existant")}>{t("Écrire dans tests/")}</Button>
        <Button size="sm" variant="ghost" className="w-full" onClick={() => void navigator.clipboard.writeText(current.content).then(() => toast({ kind: "ok", title: t("Fichier copié") }))}>{t("Copier ce fichier")}</Button>
      </div>
      <CodeView text={current.content} numbered className="max-h-[60vh] rounded-md" />
    </div>
  );
}
