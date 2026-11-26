// Right side of the Playground: what the last run gave, split the way it is read —
// compiler diagnostics, stdout, stderr, memory reports, and the raw log while it runs.
import { useState } from "react";
import { AlertTriangle, CircleX, Info, MemoryStick } from "lucide-react";
import type { CDiagnostic, JobView } from "../../lib/api";
import { CodeView } from "../../components/DiffView";
import { Badge, cn, Dot, EmptyState, Spinner } from "../../components/ui";
import { counts, memLabel, resultOf, runHeadline } from "../../lib/playground";
import { t } from "../../lib/i18n";

const STEP_TONE: Record<string, "ok" | "warn" | "danger" | "accent" | "neutral"> = { success: "ok", warning: "warn", failed: "danger", running: "accent", cancelled: "neutral", skipped: "neutral", pending: "neutral" };

type Tab = "diagnostics" | "stdout" | "stderr" | "memory" | "log";

export function Output({ job, onJump }: { job: JobView | null | undefined; onJump: (file: string, line: number, col: number | null) => void }) {
  const r = resultOf(job);
  const running = job?.status === "running";
  const diags = r.compile?.diagnostics ?? [];
  const c = counts(diags);
  const mem = r.run?.memory ?? [];
  const auto: Tab = running ? "log" : r.compile && !r.compile.ok ? "diagnostics" : mem.length ? "memory" : r.run ? "stdout" : "diagnostics";
  const [chosen, setChosen] = useState<{ tab: Tab; job: number | null } | null>(null);
  // A new run shows its most telling tab; a tab picked by hand sticks for that run only.
  const tab = chosen && chosen.job === (job?.id ?? null) ? chosen.tab : auto;
  const head = runHeadline(r);
  const tabs: Array<[Tab, string, number | null]> = [
    ["diagnostics", t("Compilation"), diags.length || null],
    ["stdout", "stdout", null],
    ["stderr", "stderr", null],
    ["memory", t("Mémoire"), mem.length || null],
    ["log", t("Journal"), null],
  ];

  if (!job) {
    return (
      <EmptyState icon={<Info className="size-6" />} title={t("Rien n'a encore tourné")}>
        {t("Compile et lance avec le bouton ▶ ou Ctrl+Entrée. Le programme tourne isolé : pas de réseau, système en lecture seule, temps et mémoire limités.")}
      </EmptyState>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-ink/6 px-3 py-2">
        {running ? (
          <span className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> {t("En cours…")}
          </span>
        ) : head ? (
          <Badge tone={head.tone}>{head.text}</Badge>
        ) : (
          <Badge>{job.status}</Badge>
        )}
        {r.compile && <span className="ml-auto text-xs text-faint tabular">{t("compilé en {ms} ms", { ms: r.compile.durationMs })}</span>}
      </div>
      <div className="flex flex-wrap gap-3 px-3 pt-2 pb-1">
        {job.steps.map((st) => (
          <Dot key={st.id} tone={STEP_TONE[st.status] ?? "neutral"} title={st.detail ?? undefined}>
            {t(st.label)}
          </Dot>
        ))}
      </div>
      <div role="tablist" className="flex gap-1 border-b border-ink/6 px-2">
        {tabs.map(([id, label, n]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setChosen({ tab: id, job: job.id })} className={cn("-mb-px flex h-8 items-center gap-1.5 border-b-2 px-2.5 text-xs transition-colors", tab === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
            {label}
            {n !== null && <span className={cn("rounded px-1 text-3xs tabular", id === "memory" || c.errors ? "bg-danger/15 text-danger" : "bg-warn/15 text-warn")}>{n}</span>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "diagnostics" && <Diagnostics diags={diags} raw={r.compile?.output ?? ""} command={r.compile?.command ?? ""} onJump={onJump} />}
        {tab === "stdout" && <Stream text={r.run?.stdout} truncated={r.run?.stdoutTruncated} empty={r.run ? t("Le programme n'a rien écrit sur la sortie standard.") : t("Le programme n'a pas tourné.")} />}
        {tab === "stderr" && <Stream text={r.run?.stderr} truncated={r.run?.stderrTruncated} empty={t("Rien sur la sortie d'erreur.")} />}
        {tab === "memory" && (
          <div className="space-y-2 p-3">
            {r.run?.valgrind && (
              <p className="text-xs text-muted">
                {t("Valgrind : {e} erreur(s), {l} octets perdus définitivement, {i} indirectement", { e: r.run.valgrind.errors ?? "?", l: r.run.valgrind.definitelyLost ?? 0, i: r.run.valgrind.indirectlyLost ?? 0 })}
              </p>
            )}
            {mem.length === 0 ? (
              <p className="text-sm text-muted">{r.run ? t("Aucun problème mémoire signalé. Active ASan, UBSan ou Valgrind pour les chercher.") : t("Le programme n'a pas tourné.")}</p>
            ) : (
              mem.map((m, i) => (
                <div key={i} className="rounded-md border border-ink/6 bg-well p-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <MemoryStick className="size-3.5 text-danger" />
                    <span className="font-medium text-fg">{memLabel(m)}</span>
                    <Badge mono>{m.tool}</Badge>
                    {m.at?.file && m.at.line && (
                      <button type="button" className="ml-auto text-xs text-accent hover:underline" onClick={() => onJump(m.at!.file!, m.at!.line!, null)}>
                        {t("Aller à la ligne")}
                      </button>
                    )}
                  </div>
                  <p className="selectable mt-1 font-mono text-2xs text-muted">{m.message}</p>
                  {m.frames.length > 0 && (
                    <ol className="selectable mt-1.5 space-y-0.5 font-mono text-2xs text-faint">
                      {m.frames.slice(0, 8).map((f, j) => (
                        <li key={j}>
                          {f.function || "?"} {f.file ? `— ${f.file}${f.line ? `:${f.line}` : ""}` : ""}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))
            )}
          </div>
        )}
        {tab === "log" && <CodeView text={job.log || t("(vide)")} className="min-h-full rounded-none" />}
      </div>
    </div>
  );
}

function Stream({ text, truncated, empty }: { text: string | undefined; truncated?: boolean; empty: string }) {
  if (!text) return <p className="p-3 text-sm text-muted">{empty}</p>;
  return (
    <>
      {truncated && <p className="px-3 pt-2 text-xs text-warn">{t("Sortie coupée : seuls les 200 premiers Ko sont gardés.")}</p>}
      <CodeView text={text.replace(/\n$/, "")} className="min-h-full rounded-none" numbered />
    </>
  );
}

function Diagnostics({ diags, raw, command, onJump }: { diags: CDiagnostic[]; raw: string; command: string; onJump: (file: string, line: number, col: number | null) => void }) {
  if (!command) return <p className="p-3 text-sm text-muted">{t("Pas encore compilé.")}</p>;
  return (
    <div className="space-y-1 p-2">
      <p className="selectable px-1 pb-1 font-mono text-2xs text-faint">$ {command}</p>
      {diags.length === 0 && <p className="px-1 text-sm text-ok">{t("Aucune erreur ni aucun avertissement.")}</p>}
      {diags.map((d, i) => {
        const Icon = d.severity === "error" ? CircleX : d.severity === "warning" ? AlertTriangle : Info;
        const can = d.line !== null && d.file !== "";
        return (
          <button key={i} type="button" disabled={!can} onClick={() => can && onJump(d.file, d.line!, d.col)} className={cn("row-hover flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left", d.severity === "note" && "pl-7")}>
            <Icon className={cn("mt-0.5 size-3.5 shrink-0", d.severity === "error" ? "text-danger" : d.severity === "warning" ? "text-warn" : "text-info")} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-fg">{d.message}</span>
              <span className="font-mono text-2xs text-faint">
                {d.file || (d.origin === "linker" ? t("édition de liens") : "")}
                {d.line ? `:${d.line}` : ""}
                {d.col ? `:${d.col}` : ""}
                {d.flag ? `  ${d.flag}` : ""}
              </span>
            </span>
          </button>
        );
      })}
      {diags.length === 0 && raw.trim() && <CodeView text={raw} className="mt-2 rounded-md" />}
    </div>
  );
}
