// Compare two versions of a draft (A and B) under the same conditions: same input, options
// and limits, outputs checked, timed in alternation. A difference within the noise is said
// to be one. The code of the two versions is shown side by side as a line diff.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, GitCompare } from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "../../components/Modal";
import { Select } from "../../components/Select";
import { Button, cn, Dot, ErrorNote, Notice, Spinner } from "../../components/ui";
import { api, asAppError, type BenchVerdict, type Draft, type PlaygroundBench } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import { t } from "../../lib/i18n";
import { useJob } from "../../lib/jobs";
import { lineDiff } from "../../lib/playground";
import { JobSteps } from "../arena/Results";

const ms = (v: number) => (v < 1 ? `${(v * 1000).toFixed(0)} µs` : v < 100 ? `${v.toFixed(2)} ms` : `${Math.round(v)} ms`);

export function CompareDialog({ draft: given, onClose, flush }: { draft: Draft; onClose: () => void; flush: (id: number) => Promise<unknown> }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["playground"], queryFn: api.playgroundList, staleTime: Infinity });
  const drafts = list.data ?? [];
  const draft = drafts.find((d) => d.id === given.id) ?? given;
  const others = drafts.filter((d) => d.id !== draft.id);
  const [b, setB] = useState<number | null>(others[0]?.id ?? null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useJob(jobId);
  const running = job.data?.status === "running";
  const versionB = drafts.find((d) => d.id === b) ?? null;

  const duplicate = async () => {
    const d = await api.playgroundCreate(`${draft.title} · B`, draft.files, draft.settings);
    await qc.invalidateQueries({ queryKey: ["playground"] });
    setB(d.id);
  };
  const start = async () => {
    if (b === null) return;
    setError(null);
    try {
      await flush(draft.id);
      await flush(b);
      setJobId(await api.playgroundCompare(draft.id, b));
    } catch (e) {
      setError(asAppError(e).message);
    }
  };
  const s = job.data?.summary ?? {};
  const ba = s.bench_a as PlaygroundBench | undefined;
  const bb = s.bench_b as PlaygroundBench | undefined;
  const verdict = s.verdict as BenchVerdict | undefined;
  const runA = s.run_a as { stdout: string; exitCode: number | null } | undefined;
  const runB = s.run_b as { stdout: string; exitCode: number | null } | undefined;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("Comparer deux versions")}
      description={t("Même entrée, mêmes options, mêmes limites (celles de A). Les deux versions tournent en alternance.")}
      width="w-[860px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("Fermer")}</Button>
          <Button variant="primary" icon={<GitCompare className="size-3.5" />} busy={running} disabled={b === null} disabledReason={t("Choisis la version B")} onClick={() => void start()}>
            {t("Comparer")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="mb-1 text-xs text-faint">A</p>
            <p className="truncate">{draft.title}</p>
          </div>
          <div>
            <p className="mb-1 text-xs text-faint">B</p>
            <div className="flex gap-2">
              <Select size="sm" className="min-w-0 flex-1" label={t("Version B")} value={b !== null ? String(b) : null} onChange={(v) => setB(Number(v))} options={others.map((d) => ({ value: String(d.id), label: d.title }))} emptyState={{ text: t("Aucun autre brouillon") }} />
              <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => void duplicate()} title={t("Crée une copie de A à modifier")}>{t("Dupliquer A")}</Button>
            </div>
          </div>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        {job.data && <JobSteps job={job.data} />}
        {running && <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> {t("Compilation et mesures en cours…")}</p>}
        {runA && runB && (s.sameOutput === false || s.sameCode === false) && (
          <Notice tone="warn">{t("Les deux versions ne donnent pas le même résultat : comparer leur vitesse n'a de sens que si elles font la même chose.")}</Notice>
        )}
        {verdict && ba && bb && (
          <section className="space-y-3">
            <p className="text-sm">
              {verdict.significant ? (
                <span className="font-medium text-fg">{t("{v} est {x}× plus rapide", { v: verdict.faster === "a" ? "A" : "B", x: verdict.ratio.toFixed(2) })}</span>
              ) : (
                <span className="font-medium text-fg">{t("Pas de différence mesurable")}</span>
              )}
              <span className="ml-2 text-muted">{verdict.why}</span>
            </p>
            <table className="w-full text-xs tabular-nums">
              <thead className="text-left text-faint">
                <tr><th className="py-1 font-normal" /><th className="font-normal">{t("Médiane")}</th><th className="font-normal">{t("Minimum")}</th><th className="font-normal">{t("Écart")}</th><th className="font-normal">CPU</th><th className="font-normal">{t("Mémoire max")}</th><th className="font-normal">{t("Exécutions")}</th><th className="font-normal">{t("Code")}</th></tr>
              </thead>
              <tbody>
                {([["A", ba, runA], ["B", bb, runB]] as const).map(([name, x, run]) => (
                  <tr key={name} className={cn("border-t border-line", verdict.faster === name.toLowerCase() && "text-accent-strong")}>
                    <td className="py-1.5 font-medium">{name}</td>
                    <td className="font-mono">{ms(x.wall.median)}</td>
                    <td className="font-mono">{ms(x.wall.min)}</td>
                    <td className="font-mono">±{(x.spread * 100).toFixed(1)} %</td>
                    <td className="font-mono">{ms(x.cpu.median)}</td>
                    <td className="font-mono">{formatBytes(x.maxRssKb * 1024)}</td>
                    <td className="font-mono">{x.runs}</td>
                    <td className="font-mono">{run?.exitCode ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Dot tone={s.sameOutput ? "ok" : "warn"}>{s.sameOutput ? t("Même sortie standard") : t("Sorties différentes")}</Dot>
          </section>
        )}
        {versionB && <CodeDiff a={draft} b={versionB} />}
      </div>
    </Modal>
  );
}

/** Line diff of the files the two versions have in common (and those only one has). */
function CodeDiff({ a, b }: { a: Draft; b: Draft }) {
  const names = useMemo(() => [...new Set([...a.files, ...b.files].map((f) => f.name))].sort(), [a, b]);
  const changed = names.filter((n) => a.files.find((f) => f.name === n)?.content !== b.files.find((f) => f.name === n)?.content);
  const [open, setOpen] = useState<string | null>(changed[0] ?? null);
  if (changed.length === 0) return <p className="text-xs text-muted">{t("Le code des deux versions est identique.")}</p>;
  const lines = open ? lineDiff(a.files.find((f) => f.name === open)?.content ?? "", b.files.find((f) => f.name === open)?.content ?? "") : [];
  return (
    <details open className="text-xs">
      <summary className="cursor-pointer text-muted hover:text-fg">{t("Différences de code ({n} fichier(s))", { n: changed.length })}</summary>
      <div className="mt-2 flex flex-wrap gap-1">
        {changed.map((n) => (
          <button key={n} type="button" onClick={() => setOpen(n)} className={cn("h-6 rounded-[4px] px-2 font-mono", open === n ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-fg")}>{n}</button>
        ))}
      </div>
      <pre className="selectable mt-2 max-h-72 overflow-auto rounded-md bg-well p-2 font-mono text-2xs leading-relaxed">
        {lines.map((l, i) => (
          <div key={i} className={cn(l.kind === "add" && "bg-ok/12 text-fg", l.kind === "del" && "bg-danger/10 text-muted line-through decoration-danger/40")}>
            <span className="mr-2 inline-block w-3 text-faint select-none">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
            {l.text || " "}
          </div>
        ))}
      </pre>
    </details>
  );
}
