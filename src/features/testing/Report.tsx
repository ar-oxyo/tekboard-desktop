// One report view for every kind of run (tests, clean clone, Banana, pre-check, …),
// used both while a task is running and for reports reopened from the history.
import { Ban, Check, ChevronDown, ChevronRight, Circle, FolderOpen, Minus, SquareTerminal, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CodeView } from "../../components/DiffView";
import { Badge, Button, cn, Spinner } from "../../components/ui";
import type { JobStatus, JobStep, RunKind, RunSummary, StepStatus } from "../../lib/api";

export interface ReportData {
  kind: RunKind;
  status: JobStatus;
  title: string;
  steps: JobStep[];
  summary: RunSummary;
  log: string;
  durationMs: number;
  startedAt: number;
}

export const STATUS_LABEL: Record<JobStatus, string> = { running: "Running", success: "Success", warning: "Warning", failed: "Failed", cancelled: "Cancelled" };
export const STATUS_TONE: Record<JobStatus, "info" | "ok" | "warn" | "danger" | "neutral"> = { running: "info", success: "ok", warning: "warn", failed: "danger", cancelled: "neutral" };
export const KIND_LABEL: Record<RunKind, string> = { tests: "Unit tests", testrepo: "TestRepo", banana: "Banana", moulinette: "Claude Moulinette", gen_tests: "Generated tests", readme: "README", build: "Build", command: "Command", analysis: "Repository analysis" };

export function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

function StepIcon({ status }: { status: StepStatus }) {
  const box = "flex size-5 shrink-0 items-center justify-center rounded-full";
  switch (status) {
    case "running":
      return <span className={cn(box, "bg-info/15 text-info")}><Spinner className="size-3" /></span>;
    case "success":
      return <span className={cn(box, "bg-ok/15 text-ok")}><Check className="size-3" /></span>;
    case "warning":
      return <span className={cn(box, "bg-warn/15 text-warn")}><TriangleAlert className="size-3" /></span>;
    case "failed":
      return <span className={cn(box, "bg-danger/15 text-danger")}><X className="size-3" /></span>;
    case "cancelled":
      return <span className={cn(box, "bg-raised text-muted")}><Ban className="size-3" /></span>;
    case "skipped":
      return <span className={cn(box, "text-faint")}><Minus className="size-3" /></span>;
    default:
      return <span className={cn(box, "text-faint")}><Circle className="size-2.5" /></span>;
  }
}

export function Stepper({ steps }: { steps: JobStep[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => (
        <li key={s.id} className="relative flex gap-3 pb-3 last:pb-0">
          {i < steps.length - 1 && <span aria-hidden className="absolute top-5 left-[9.5px] h-[calc(100%-18px)] w-px bg-line" />}
          <StepIcon status={s.status} />
          <div className="min-w-0 flex-1">
            <p className={cn("flex items-baseline gap-2 text-[13px]", s.status === "pending" || s.status === "skipped" ? "text-muted" : "text-fg")}>
              <span>{s.label}</span>
              {s.durationMs !== null && s.status !== "skipped" && <span className="text-[11px] text-faint">{duration(s.durationMs)}</span>}
            </p>
            {s.detail && <p className={cn("selectable text-xs", s.status === "failed" ? "text-danger" : s.status === "warning" ? "text-warn" : "text-muted")}>{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "ok" | "danger" | "warn" }) {
  return (
    <div className="min-w-20 rounded-lg border border-line bg-bg px-3 py-2">
      <p className="text-[11px] tracking-wide text-muted uppercase">{label}</p>
      <p className={cn("display text-xl font-semibold", tone === "ok" && "text-ok", tone === "danger" && "text-danger", tone === "warn" && "text-warn")}>{value}</p>
    </div>
  );
}

function Tests({ tests }: { tests: Record<string, unknown> }) {
  const total = num(tests.total);
  const passed = num(tests.passed);
  const bad = (num(tests.failed) ?? 0) + (num(tests.crashed) ?? 0);
  const failures = arr(tests.failures).map(rec);
  const coverage = num(tests.coverage);
  if (total === null && failures.length === 0) return <p className="text-xs text-muted">The command printed no test summary TekBoard recognises (Criterion, CTest). Its exit code is the only result: see the steps and the log.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {total !== null && <Stat label="Tests" value={total} />}
        {passed !== null && <Stat label="Passed" value={passed} tone="ok" />}
        <Stat label="Failed" value={bad} tone={bad > 0 ? "danger" : undefined} />
        {total !== null && passed !== null && total > 0 && <Stat label="Success rate" value={`${((passed / total) * 100).toFixed(1)}%`} />}
        {coverage !== null && <Stat label="Line coverage" value={`${coverage}%`} />}
      </div>
      {failures.length > 0 && (
        <ul className="rounded-lg border border-danger/25 bg-danger/5 py-1">
          {failures.map((f, i) => (
            <li key={i} className="selectable px-3 py-1.5 text-xs">
              <span className="font-mono font-medium text-danger">{str(f.name)}</span>
              {str(f.location) && <span className="ml-2 font-mono text-muted">{str(f.location)}</span>}
              {str(f.message) && <p className="text-muted">{str(f.message)}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ label, children, tone }: { label: string; children: ReactNode; tone?: "ok" | "warn" | "danger" }) {
  return (
    <div className="flex items-baseline gap-3 py-1 text-[13px]">
      <span className="w-36 shrink-0 text-muted">{label}</span>
      <span className={cn("selectable min-w-0 flex-1 break-words", tone === "ok" && "text-ok", tone === "warn" && "text-warn", tone === "danger" && "text-danger")}>{children}</span>
    </div>
  );
}

function TestRepo({ s, steps, envActions }: { s: RunSummary; steps: JobStep[]; envActions?: (name: string, terminal: boolean) => void }) {
  const step = (id: string) => steps.find((x) => x.id === id);
  const word = (id: string) => {
    const st = step(id)?.status;
    return st === "success" ? "PASS" : st === "warning" ? "WARNING" : st === "failed" ? "FAIL" : st === "skipped" ? "—" : st === "cancelled" ? "CANCELLED" : "…";
  };
  const tone = (id: string) => (step(id)?.status === "success" ? "ok" : step(id)?.status === "failed" ? "danger" : step(id)?.status === "warning" ? "warn" : undefined);
  const build = rec(s.build);
  const exe = rec(s.executable);
  const tests = rec(s.tests);
  const iso = rec(s.isolation);
  const locals = arr(s.localOnly).map(rec);
  const referenced = locals.filter((l) => l.referenced === true);
  const envDir = str(s.envDir);
  const envName = envDir?.split("/").pop();
  const commit = str(s.commit);
  return (
    <div className="flex flex-col gap-3">
      {str(s.verdict) && <p className="display text-[15px] font-semibold">{str(s.verdict)}</p>}
      <div className="rounded-lg border border-line bg-bg px-3 py-1.5">
        <Row label="Source">{s.mode === "remote" ? "Remote clone" : "Local Git snapshot"}{str(s.source) && <span className="text-muted"> · {str(s.source)}</span>}</Row>
        <Row label="Branch">{str(s.branch) ?? "detached"}</Row>
        {commit && <Row label="Commit"><span className="font-mono">{commit.slice(0, 7)}</span>{str(s.localHead) && s.localHead !== commit && <span className="text-warn"> · your HEAD is {String(s.localHead).slice(0, 7)}</span>}</Row>}
        <Row label="Environment">{iso.mode === "docker" ? `Container ${str(iso.image) ?? ""} — no network, home folder not shared` : "This computer's tools and libraries (clean clone, not isolated)"}</Row>
        <Row label="Clone" tone={tone("clone")}>{word("clone")}</Row>
        <Row label="Build" tone={tone("build")}>{word("build")}{str(s.buildCommand) && <span className="font-mono text-muted"> · {str(s.buildCommand)}</span>}</Row>
        {num(build.warnings) !== null && <Row label="Warnings" tone={(num(build.warnings) ?? 0) > 0 ? "warn" : undefined}>{num(build.warnings)}</Row>}
        <Row label="Executable" tone={tone("executable")}>{step("executable")?.status === "success" ? `FOUND · ${str(exe.expected) ?? arr(exe.found).join(", ")}` : step("executable")?.status === "warning" ? `MISSING · ${str(exe.expected) ?? ""}` : "—"}</Row>
        <Row label="Unit tests" tone={tone("tests")}>{num(tests.total) !== null ? `${num(tests.passed)}/${num(tests.total)}` : step("tests")?.status === "skipped" ? "not requested" : word("tests")}</Row>
      </div>
      {arr(s.differences).length > 0 && (
        <div className="rounded-lg border border-warn/25 bg-warn/5 px-3 py-2 text-xs text-warn">
          <p className="mb-0.5 font-medium">Local and cloned versions differ</p>
          {arr(s.differences).map((d, i) => <p key={i}>{String(d)}</p>)}
        </div>
      )}
      {referenced.length > 0 && (
        <div className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-xs">
          <p className="mb-0.5 font-medium text-danger">Files your build mentions that exist only on this computer</p>
          {referenced.map((l, i) => <p key={i} className="selectable font-mono">{String(l.path)} <span className="font-sans text-muted">— {l.kind === "ignored" ? "ignored by Git" : "not added to Git"}</span></p>)}
        </div>
      )}
      {locals.length > referenced.length && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer hover:text-fg">{locals.length - referenced.length} other local-only file(s) or folder(s), not named by the build</summary>
          <p className="selectable mt-1 font-mono leading-relaxed">{locals.filter((l) => l.referenced !== true).map((l) => String(l.path)).join("  ·  ")}</p>
        </details>
      )}
      {num(tests.total) !== null && <Tests tests={tests} />}
      {envName && envActions && (
        <div className="flex items-center gap-2">
          <Button size="sm" icon={<SquareTerminal className="size-3.5" />} onClick={() => envActions(envName, true)}>Terminal in the clone</Button>
          <Button size="sm" variant="ghost" icon={<FolderOpen className="size-3.5" />} onClick={() => envActions(envName, false)}>Open folder</Button>
          <span className="selectable min-w-0 truncate font-mono text-[11px] text-faint">{envDir}</span>
        </div>
      )}
    </div>
  );
}

function Banana({ s }: { s: RunSummary }) {
  const findings = arr(s.findings).map(rec);
  const sev = rec(s.bySeverity);
  const rules = Object.entries(rec(s.byRule)).sort((a, b) => Number(b[1]) - Number(a[1]));
  const tool = rec(s.tool);
  const byFile = new Map<string, Array<Record<string, unknown>>>();
  for (const f of findings) byFile.set(String(f.file), [...(byFile.get(String(f.file)) ?? []), f]);
  const incomplete = arr(s.incomplete);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Stat label="Infractions" value={num(s.total) ?? 0} tone={(num(s.total) ?? 0) === 0 ? "ok" : undefined} />
        <Stat label="Major" value={num(sev.Major) ?? 0} tone={(num(sev.Major) ?? 0) > 0 ? "danger" : undefined} />
        <Stat label="Minor" value={num(sev.Minor) ?? 0} tone={(num(sev.Minor) ?? 0) > 0 ? "warn" : undefined} />
        <Stat label="Info" value={num(sev.Info) ?? 0} />
        <Stat label="Files checked" value={num(s.filesChecked) ?? 0} />
      </div>
      {rules.length > 0 && <div className="flex flex-wrap gap-1.5">{rules.map(([r, n]) => <Badge key={r} mono>{r || "?"} × {String(n)}</Badge>)}</div>}
      {incomplete.length > 0 && <p className="text-xs text-warn">Only partly checked, because a compile error stopped the parser: {incomplete.join(", ")}</p>}
      {[...byFile.entries()].map(([file, list]) => (
        <div key={file} className="rounded-lg border border-line bg-bg">
          <p className="selectable border-b border-line px-3 py-1.5 font-mono text-xs font-medium">{file} <span className="font-sans font-normal text-faint">{list.length}</span></p>
          <ul className="py-1">
            {list.map((f, i) => (
              <li key={i} className="selectable flex items-baseline gap-2 px-3 py-0.5 text-xs">
                <span className="w-12 shrink-0 text-right font-mono text-faint">{num(f.line) ?? ""}</span>
                <span className={cn("w-11 shrink-0", f.severity === "Major" ? "text-danger" : f.severity === "Minor" ? "text-warn" : "text-info")}>{String(f.severity)}</span>
                <span className="w-11 shrink-0 font-mono text-muted">{String(f.rule)}</span>
                <span className="min-w-0 flex-1">{String(f.message)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="selectable text-[11px] text-faint">
        banana-check-repo {str(tool.repoChecker) ? `${str(tool.version) ?? ""} (${str(tool.repoChecker)})` : "not installed"} · epiclang Banana plugin {tool.plugin === true ? "present" : "not found"} · tests/ and bonus/ are skipped, as the official tool does.
      </p>
    </div>
  );
}

const RESULT: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral" | "info" }> = {
  pass: { label: "PASS", tone: "ok" },
  warning: { label: "WARNING", tone: "warn" },
  fail: { label: "FAIL", tone: "danger" },
  partial: { label: "PARTIAL", tone: "info" },
  not_run: { label: "NOT RUN", tone: "neutral" },
};
const EVIDENCE: Record<string, string> = { auto: "measured", ai: "AI opinion", none: "not checked" };

function Moulinette({ s }: { s: RunSummary }) {
  const sections = arr(s.sections).map(rec);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {str(s.overall) && (
        <div>
          <p className="text-[11px] tracking-wide text-muted uppercase">Overall</p>
          <p className="display text-lg font-semibold">{str(s.overall)}</p>
        </div>
      )}
      <ul className="rounded-lg border border-line bg-bg py-1">
        {sections.map((sec) => {
          const id = String(sec.id);
          const r = RESULT[String(sec.result)] ?? RESULT.not_run;
          const items = arr(sec.items).map(rec);
          return (
            <li key={id}>
              <button type="button" disabled={items.length === 0} onClick={() => setOpen(open === id ? null : id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left disabled:cursor-default">
                {items.length > 0 ? open === id ? <ChevronDown className="size-3.5 text-faint" /> : <ChevronRight className="size-3.5 text-faint" /> : <span className="size-3.5" />}
                <span className="w-44 shrink-0 text-[13px]">{String(sec.label)}</span>
                <Badge tone={r.tone} mono>{r.label}</Badge>
                <Badge tone={sec.evidence === "ai" ? "accent" : "neutral"}>{EVIDENCE[String(sec.evidence)] ?? "not checked"}</Badge>
              </button>
              <p className="selectable pr-3 pb-1.5 pl-[34px] text-xs text-muted">{String(sec.detail)}</p>
              {open === id && (
                <ul className="mb-2 ml-[34px] border-l border-line pl-3">
                  {items.map((it, i) => (
                    <li key={i} className="selectable flex items-baseline gap-2 py-0.5 text-xs">
                      <span className={cn("w-14 shrink-0 font-mono", it.status === "pass" ? "text-ok" : it.status === "fail" ? "text-danger" : it.status === "warning" ? "text-warn" : "text-info")}>{it.status === "unclear" ? "unclear" : String(it.status)}</span>
                      <span className="min-w-0 flex-1">{String(it.label)}{str(it.detail) && <span className="text-muted"> — {str(it.detail)}</span>}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-faint">A personal pre-check, not Epitech's Moulinette: it gives no grade and cannot predict one. “measured” lines come from tools run on this computer; “AI opinion” lines are Claude's reading of the code against the subject; “not checked” lines were not verified at all.</p>
    </div>
  );
}

function GenTests({ s }: { s: RunSummary }) {
  const changed = arr(s.changed);
  return (
    <div className="flex flex-col gap-3">
      {changed.length > 0 && (
        <div className="rounded-lg border border-line bg-bg px-3 py-2">
          <p className="mb-1 text-xs font-medium text-muted">Files written by Claude Code — nothing is committed; review them on the Git screen</p>
          {changed.map((c) => <p key={String(c)} className="selectable font-mono text-xs">{String(c)}</p>)}
        </div>
      )}
      {rec(s.tests).framework !== undefined && <Tests tests={rec(s.tests)} />}
      {str(s.report) && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Claude's summary</p>
          <p className="selectable rounded-lg border border-line bg-bg px-3 py-2 text-[13px] whitespace-pre-wrap">{str(s.report)}</p>
        </div>
      )}
    </div>
  );
}

function CommandResult({ s, status }: { s: RunSummary; status: JobStatus }) {
  const code = num(s.exitCode);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="selectable min-w-0 flex-1 truncate rounded-md border border-line bg-bg px-2.5 py-1.5 font-mono text-xs text-fg">$ {str(s.command) ?? ""}</code>
      {status !== "running" && (
        <Badge tone={code === 0 ? "ok" : status === "cancelled" ? "neutral" : "danger"}>
          {status === "cancelled" ? "stopped" : code !== null ? `exit code ${code}` : s.timedOut === true ? "time limit" : "no exit code"}
        </Badge>
      )}
    </div>
  );
}

export function Report({ data, onCancel, envActions, onClear }: { data: ReportData; onCancel?: () => void; envActions?: (name: string, terminal: boolean) => void; onClear?: () => void }) {
  const running = data.status === "running";
  const [full, setFull] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const lines = data.log.split("\n");
  const shown = full || lines.length <= 300 ? data.log : lines.slice(-300).join("\n");
  useEffect(() => {
    if (running && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [running, data.log]);
  const s = data.summary;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2.5">
        <Badge tone={STATUS_TONE[data.status]}>{running && <Spinner className="size-3" />}{STATUS_LABEL[data.status]}</Badge>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{data.title}</span>
        <span className="text-xs text-faint">{duration(data.durationMs)}</span>
        {running && onCancel && <Button size="sm" variant="danger" onClick={onCancel}>{data.kind === "command" ? "Stop" : "Cancel"}</Button>}
      </div>
      {data.kind === "command" ? <CommandResult s={s} status={data.status} /> : <Stepper steps={data.steps} />}
      {data.kind === "testrepo" && <TestRepo s={s} steps={data.steps} envActions={envActions} />}
      {data.kind === "tests" && !running && <Tests tests={rec(s.tests)} />}
      {data.kind === "banana" && !running && <Banana s={s} />}
      {data.kind === "moulinette" && <Moulinette s={s} />}
      {data.kind === "gen_tests" && <GenTests s={s} />}
      {data.kind === "analysis" && str(s.report) && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Claude's analysis — its reading of the code, to verify, not a measurement or a grade</p>
          <div className="selectable max-h-[30rem] overflow-auto rounded-lg border border-line bg-bg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">{str(s.report)}</div>
        </div>
      )}
      {data.kind === "build" && <p className="selectable text-[13px] text-muted"><span className="font-mono text-fg">{str(s.command)}</span> · exit {String(s.exitCode ?? "?")} · {num(s.warnings) ?? 0} warning(s){str(s.commit) && <> · commit <span className="font-mono">{str(s.commit)}</span></>}</p>}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Log</p>
          <span className="flex items-center gap-3">
            {lines.length > 300 && <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => setFull(!full)}>{full ? "Show the end only" : `Show all ${lines.length} lines`}</button>}
            {onClear && <button type="button" className="text-xs text-muted hover:text-fg" onClick={onClear} title="Empties this view. The full log stays in the history.">Clear</button>}
          </span>
        </div>
        <div ref={logRef} className="max-h-80 overflow-auto rounded-md">
          <CodeView text={shown.trim() === "" ? "(nothing printed yet)" : shown.replace(/\n$/, "")} className="min-h-10 overflow-visible" />
        </div>
      </div>
    </div>
  );
}
