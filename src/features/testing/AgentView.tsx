// What an agent does on a copy of the project, live: its steps, the checks it declared and
// their results with the proof, the real commands it ran in the sandbox, then its report.
// For test generation, the files it wrote come back as a diff applied only on request.
import { useMutation } from "@tanstack/react-query";
import { Check, ChevronRight, CircleDashed, FlaskConical, LoaderCircle, Minus, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";
import { DiffView } from "../../components/DiffView";
import { Badge, Button, cn } from "../../components/ui";
import { api, asAppError, type JobEvent, type RunSummary } from "../../lib/api";
import { useUi } from "../../lib/store";
import { Markdown } from "../artix/Markdown";
import { t } from "../../lib/i18n";

const PHASES: Record<string, string> = { subject: "Sujet", build: "Compilation", arguments: "Arguments", edge_cases: "Cas limites", errors: "Erreurs", memory: "Mémoire", style: "Style", robustness: "Robustesse", report: "Rapport" };

function CheckIcon({ status }: { status: string }) {
  const c = "size-4 shrink-0";
  if (status === "passed") return <Check className={cn(c, "text-ok")} />;
  if (status === "failed") return <X className={cn(c, "text-danger")} />;
  if (status === "warning") return <TriangleAlert className={cn(c, "text-warn")} />;
  if (status === "skipped") return <Minus className={cn(c, "text-faint")} />;
  if (status === "running") return <LoaderCircle className={cn(c, "anim-spin text-accent")} />;
  return <CircleDashed className={cn(c, "text-faint")} />;
}

interface Change {
  path: string;
  status: "added" | "modified";
  before: string | null;
  after: string;
}

/** A unified diff of two texts, line by line (enough for files of a few hundred lines). */
function diffText(before: string | null, after: string): string {
  if (before === null) return after.split("\n").map((l) => `+${l}`).join("\n");
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) (out.push(` ${a[i]}`), i++, j++);
    else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) out.push(`+${b[j++]}`);
    else out.push(`-${a[i++]}`);
  }
  return out.join("\n");
}

export function AgentView({ kind, status, events, summary, repo, runId }: { kind: "moulinette_ai" | "gen_tests"; status: string; events: JobEvent[]; summary: RunSummary; repo: string | null; runId: number | null }) {
  const running = status === "running";
  const all = events.length ? events : ((summary.events as JobEvent[] | undefined) ?? []);
  const checks = all.filter((e) => e.kind === "check");
  const phases = useMemo(() => [...new Set(all.filter((e) => e.kind === "phase").map((e) => String(e.phase)))], [all]);
  const current = running ? phases.at(-1) : null;
  const activity = all.filter((e) => e.kind === "exec" || e.kind === "tool").filter((e) => e.kind === "exec" || !String(e.tool ?? "").startsWith("mcp__tekboard__"));
  const count = (s: string) => checks.filter((c) => c.status === s).length;
  const report = typeof summary.report === "string" ? summary.report : null;
  const verdict = typeof summary.verdict === "string" ? summary.verdict : null;
  const lastPhaseText = all.filter((e) => e.kind === "phase").at(-1)?.text;
  return (
    <div className="flex flex-col gap-4">
      {kind === "moulinette_ai" && (
        <p className="flex items-center gap-2 rounded-lg border border-accent/25 bg-accent-soft/40 px-3 py-2 text-xs text-muted">
          <ShieldCheck className="size-4 shrink-0 text-accent" />
          Simulation par Artix, dans un bac à sable sans réseau, sur une copie de ton projet. Ce n'est pas la moulinette officielle d'Epitech.
        </p>
      )}
      {phases.length > 0 && (
        <ol className="flex flex-wrap items-center gap-1 text-xs">
          {phases.map((p, i) => (
            <li key={p} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3 text-faint" />}
              <span className={cn("rounded-md px-2 py-0.5", p === current ? "bg-accent-soft text-accent-strong" : "text-muted")}>
                {p === current && <LoaderCircle className="anim-spin mr-1 inline size-3" />}
                {PHASES[p] ?? p}
              </span>
            </li>
          ))}
        </ol>
      )}
      {running && lastPhaseText && <p className="text-sm text-muted">{String(lastPhaseText)}…</p>}
      {checks.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge tone="ok">{count("passed")} réussie{count("passed") > 1 ? "s" : ""}</Badge>
            <Badge tone="danger">{count("failed")} échouée{count("failed") > 1 ? "s" : ""}</Badge>
            {count("warning") > 0 && <Badge tone="warn">{count("warning")} à surveiller</Badge>}
            {count("planned") > 0 && <Badge>{count("planned")} prévue{count("planned") > 1 ? "s" : ""}</Badge>}
          </div>
          <ul className="flex flex-col divide-y divide-ink/5 rounded-lg border border-ink/7">
            {checks.map((c) => (
              <CheckRow key={String(c.id)} c={c} running={running} />
            ))}
          </ul>
        </>
      )}
      {verdict && <p className="text-base font-medium">{verdict}</p>}
      {report && !running && (
        <div className="rounded-lg border border-ink/7 bg-well px-4 py-3">
          <Markdown text={report} className="selectable text-sm leading-relaxed" />
        </div>
      )}
      {kind === "gen_tests" && !running && <Changes summary={summary} repo={repo} runId={runId} />}
      {activity.length > 0 && <Activity items={activity} running={running} />}
    </div>
  );
}

function CheckRow({ c, running }: { c: JobEvent; running: boolean }) {
  const [open, setOpen] = useState(c.status === "failed");
  const status = String(c.status === "planned" && running ? "planned" : c.status);
  const detail = typeof c.evidence === "string" || typeof c.fix === "string";
  return (
    <li>
      <button type="button" disabled={!detail} onClick={() => setOpen(!open)} className="flex w-full items-start gap-2.5 px-3 py-2 text-left">
        <CheckIcon status={status} />
        <span className="min-w-0 flex-1">
          <span className="text-sm">{String(c.title)}</span>
          <span className="ml-2 text-2xs text-faint">{PHASES[String(c.category)] ?? String(c.category ?? "")}</span>
        </span>
        {typeof c.severity === "string" && status === "failed" && <Badge tone={c.severity === "critical" ? "danger" : "warn"}>{c.severity === "critical" ? "critique" : c.severity === "major" ? "majeur" : "mineur"}</Badge>}
      </button>
      {open && detail && (
        <div className="flex flex-col gap-1.5 px-3 pb-2.5 pl-9 text-xs">
          {typeof c.evidence === "string" && <p className="selectable font-mono whitespace-pre-wrap text-muted">{c.evidence}</p>}
          {typeof c.fix === "string" && c.fix && (
            <p className="selectable text-fg">
              <span className="text-accent">Piste : </span>
              {c.fix}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function Activity({ items, running }: { items: JobEvent[]; running: boolean }) {
  const [open, setOpen] = useState(running);
  const shown = open ? items.slice(-60) : items.slice(-4);
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} className="mb-1 text-xs text-muted hover:text-fg">
        Ce que Artix a fait ({items.length} action{items.length > 1 ? "s" : ""}) {open ? "· réduire" : "· tout voir"}
      </button>
      <ul className="flex flex-col gap-0.5 rounded-lg bg-well p-2 font-mono text-2xs">
        {shown.map((e, i) => (
          <li key={String(e.id ?? i)} className="flex items-start gap-2">
            <span className={cn("mt-0.5", e.status === "error" ? "text-danger" : e.status === "running" ? "text-accent" : "text-ok")}>{e.status === "running" ? "…" : e.status === "error" ? "✗" : "✓"}</span>
            <span className="selectable min-w-0 flex-1 break-all text-muted">
              {e.kind === "exec" ? <span className="text-fg">$ </span> : <span className="text-faint">{String(e.label)} </span>}
              {String(e.detail ?? "")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Changes({ summary, repo, runId }: { summary: RunSummary; repo: string | null; runId: number | null }) {
  const changes = (summary.changes as Change[] | undefined) ?? [];
  const [off, setOff] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<string | null>(changes[0]?.path ?? null);
  const toast = useUi((s) => s.toast);
  const [done, setDone] = useState(false);
  const apply = useMutation({
    mutationFn: () => api.genTestsApply(repo!, runId!, changes.filter((c) => !off.has(c.path)).map((c) => c.path)),
    onSuccess: (n) => (setDone(true), toast({ kind: "ok", title: `${n} fichier(s) écrit(s) dans ton projet`, detail: "Les fichiers remplacés sont sauvegardés. Rien n'est commité." })),
    onError: (e) => toast({ kind: "error", title: "Non appliqué", detail: asAppError(e).message }),
  });
  if (!changes.length) return <p className="text-sm text-muted">Aucun fichier de test n'a été écrit.</p>;
  const cur = changes.find((c) => c.path === shown);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-ink/7">
      <div className="flex items-center gap-2 border-b border-ink/6 px-3 py-2">
        <FlaskConical className="size-4 text-accent" />
        <span className="flex-1 text-sm">Fichiers écrits par Artix : rien n'est encore dans ton projet</span>
        <Button size="sm" variant="primary" disabled={done || !repo || runId === null || changes.every((c) => off.has(c.path))} busy={apply.isPending} onClick={() => apply.mutate()} title={runId === null ? "Disponible quand l'exécution est enregistrée" : undefined}>
          {done ? t("Appliqué") : "Appliquer au projet"}
        </Button>
      </div>
      <div className="flex min-h-0">
        <ul className="w-56 shrink-0 border-r border-ink/6 py-1">
          {changes.map((c) => (
            <li key={c.path} className={cn("flex items-center gap-2 px-3 py-1 text-xs", shown === c.path && "bg-ink/4")}>
              <input type="checkbox" className="accent-(--color-accent)" checked={!off.has(c.path)} onChange={() => setOff((s) => (s.has(c.path) ? new Set([...s].filter((x) => x !== c.path)) : new Set([...s, c.path])))} />
              <button type="button" className="min-w-0 flex-1 truncate text-left font-mono" onClick={() => setShown(c.path)}>
                {c.path}
              </button>
              <span className={c.status === "added" ? "text-ok" : "text-warn"}>{c.status === "added" ? "nouveau" : "modifié"}</span>
            </li>
          ))}
        </ul>
        {cur && <DiffView text={diffText(cur.before, cur.after)} className="max-h-96 min-w-0 flex-1" />}
      </div>
    </div>
  );
}
