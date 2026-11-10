// Testing center: everything that checks a project — unit tests, clean-clone test, Banana,
// the pre-check, test generation — with one live report and one history.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banana as BananaIcon, Bot, FileText, FlaskConical, FolderOpen, GitBranch, PackageOpen, Play, ShieldCheck, Sparkles, SquareTerminal, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Badge, Button, Card, CardTitle, cn, EmptyState, ErrorNote, IconButton, Input, PageHeader, Select, Spinner } from "../../components/ui";
import { api, asAppError, type RunKind, type TestingInfo } from "../../lib/api";
import { formatBytes, timeAgo } from "../../lib/format";
import { useRepos } from "../../lib/hooks";
import { displayName } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { ClaudeBriefDialog } from "../tools/ClaudeBrief";
import { duration, KIND_LABEL, Report, STATUS_LABEL, STATUS_TONE, type ReportData } from "./Report";

export function TestingPage() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const repoPath = useUi((s) => s.testingRepo);
  const jobId = useUi((s) => s.jobId);
  const runId = useUi((s) => s.runId);
  const showJob = useUi((s) => s.showJob);
  const openTool = useUi((s) => s.openTool);
  const repos = useRepos();
  const repo = repos.data?.find((r) => r.path === repoPath);
  const info = useQuery({ queryKey: ["testing-info", repoPath], queryFn: () => api.testingInfo(repoPath!), enabled: repoPath !== null, staleTime: 0 });
  const [kind, setKind] = useState<RunKind | "all">("all");
  const runs = useQuery({ queryKey: ["runs", repoPath, kind], queryFn: () => api.runsList(repoPath, kind === "all" ? null : kind, 40), enabled: repoPath !== null, staleTime: 0 });
  const envs = useQuery({ queryKey: ["testrepo-envs"], queryFn: api.testrepoEnvs, staleTime: 0 });

  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.jobGet(jobId!),
    enabled: jobId !== null && runId === null,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== "running" && q.state.data.runId !== null ? false : 600),
    staleTime: 0,
    retry: false,
  });
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => api.runGet(runId!), enabled: runId !== null });
  const finished = job.data && job.data.status !== "running" ? job.data.runId : null;
  useEffect(() => {
    if (finished !== null && finished !== undefined) {
      void qc.invalidateQueries({ queryKey: ["runs"] });
      void qc.invalidateQueries({ queryKey: ["testrepo-envs"] });
      void qc.invalidateQueries({ queryKey: ["repos"] });
    }
  }, [finished, qc]);

  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });
  const start = useMutation({ mutationFn: (fn: () => Promise<number>) => fn(), onSuccess: (id) => showJob(id, repoPath), onError: fail("Could not start") });
  const cancel = useMutation({ mutationFn: (id: number) => api.jobCancel(id), onError: fail("Could not cancel") });
  const openEnv = (name: string, terminal: boolean) => api.testrepoEnvOpen(name, terminal).catch(fail(terminal ? "The terminal did not start" : "Could not open the folder"));
  const [toDelete, setToDelete] = useState<string | null>(null);
  const delEnv = useMutation({ mutationFn: (name: string) => api.testrepoEnvDelete(name), onSuccess: () => { setToDelete(null); void qc.invalidateQueries({ queryKey: ["testrepo-envs"] }); }, onError: fail("Not deleted") });
  const [brief, setBrief] = useState(false);

  const data: ReportData | null = runId !== null ? (run.data ? { ...run.data, steps: run.data.summary.steps ?? [], log: run.data.log ?? "" } : null) : (job.data ?? null);
  const busy = job.data?.status === "running" && runId === null;

  return (
    <>
      <PageHeader
        title="Testing"
        subtitle="Run, check and validate a project. Every result below was produced on this computer."
        actions={
          <Select className="w-64" value={repoPath ?? ""} onChange={(e) => useUi.setState({ testingRepo: e.target.value || null, runId: null })} aria-label="Project">
            <option value="">Choose a project…</option>
            {(repos.data ?? []).map((r) => <option key={r.path} value={r.path}>{displayName(r)}</option>)}
          </Select>
        }
      />
      {repoPath === null ? (
        <Card hero>
          <EmptyState icon={<FlaskConical className="size-6" />} title="Choose a project">Pick a repository at the top right to see what can be run on it.</EmptyState>
        </Card>
      ) : info.isLoading ? (
        <p className="flex items-center gap-2 py-16 text-muted"><Spinner /> Looking at the project…</p>
      ) : info.error || !info.data ? (
        <ErrorNote>{asAppError(info.error).message}</ErrorNote>
      ) : (
        <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-start gap-4">
          <div className="flex min-w-0 flex-col gap-4">
            <Actions key={repoPath} repo={repoPath} info={info.data} busy={start.isPending} onStart={(fn) => start.mutate(fn)} onBrief={() => setBrief(true)} onTool={(k) => openTool(k, repoPath)} />

            <Card>
              <CardTitle right={
                <Select className="h-7 w-36 text-xs" value={kind} onChange={(e) => setKind(e.target.value as RunKind | "all")} aria-label="Kind of run">
                  <option value="all">Everything</option>
                  {(Object.keys(KIND_LABEL) as RunKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </Select>
              }>History</CardTitle>
              {(runs.data?.length ?? 0) === 0 ? (
                <p className="px-4 py-4 text-[13px] text-muted">Nothing was run on this project yet. Builds, tests and checks are listed here with their logs.</p>
              ) : (
                <ul className="max-h-72 overflow-y-auto py-1">
                  {runs.data!.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => useUi.setState({ runId: r.id })} className={cn("row-hover flex h-9 w-full items-center gap-2.5 px-4 text-left", runId === r.id && "bg-accent-soft")}>
                        <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                        <span className="w-28 shrink-0 text-[13px]">{KIND_LABEL[r.kind] ?? r.kind}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted">{headline(r.kind, r.summary) ?? r.title.split(" — ").pop()}</span>
                        <span className="shrink-0 text-xs text-faint">{duration(r.durationMs)} · {timeAgo(r.startedAt)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardTitle>Test environments</CardTitle>
              {(envs.data?.length ?? 0) === 0 ? (
                <p className="px-4 py-4 text-[13px] text-muted">TestRepo clones are kept here until you delete them, so you can open a terminal in one and try the program.</p>
              ) : (
                <ul className="max-h-56 overflow-y-auto py-1">
                  {envs.data!.map((e) => (
                    <li key={e.name} className="flex min-h-9 items-center gap-2 pr-2 pl-4">
                      <span className="selectable min-w-0 flex-1 truncate font-mono text-xs">{e.name}</span>
                      <span className="shrink-0 text-xs text-faint">{formatBytes(e.size)}</span>
                      {toDelete === e.name ? (
                        <>
                          <Button size="sm" variant="danger" busy={delEnv.isPending} onClick={() => delEnv.mutate(e.name)}>Delete this clone</Button>
                          <Button size="sm" variant="ghost" onClick={() => setToDelete(null)}>Keep</Button>
                        </>
                      ) : (
                        <>
                          <IconButton label="Open a terminal in this clone" onClick={() => void openEnv(e.name, true)}><SquareTerminal className="size-3.5" /></IconButton>
                          <IconButton label="Open the folder" onClick={() => void openEnv(e.name, false)}><FolderOpen className="size-3.5" /></IconButton>
                          <IconButton label="Delete this test environment" onClick={() => setToDelete(e.name)}><Trash2 className="size-3.5" /></IconButton>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card className="min-w-0">
            <CardTitle right={runId !== null && jobId !== null ? <Button size="sm" variant="ghost" onClick={() => useUi.setState({ runId: null })}>Back to the current task</Button> : undefined}>
              {runId !== null ? "Report from the history" : busy ? "Running" : "Report"}
            </CardTitle>
            {data ? (
              <Report data={data} onCancel={busy && jobId !== null ? () => cancel.mutate(jobId) : undefined} envActions={(n, t) => void openEnv(n, t)} />
            ) : (runId !== null && run.isLoading) || (jobId !== null && job.isLoading) ? (
              <p className="flex items-center gap-2 px-4 py-8 text-[13px] text-muted"><Spinner /> Loading…</p>
            ) : job.error && jobId !== null ? (
              <div className="p-4"><ErrorNote>{asAppError(job.error).message}</ErrorNote></div>
            ) : (
              <EmptyState icon={<ShieldCheck className="size-5" />} title="Nothing running">Start a check on the left, or open a past report from the history. {repo ? `Project: ${displayName(repo)}.` : ""}</EmptyState>
            )}
          </Card>
        </div>
      )}
      {brief && repoPath && <ClaudeBriefDialog repo={repoPath} task="tests" confirmLabel="Start Claude Code" onClose={() => setBrief(false)} onConfirm={() => { setBrief(false); start.mutate(() => api.genTestsStart(repoPath)); }} />}
    </>
  );
}

/** One line for the history list, from the facts stored with the run. */
function headline(kind: RunKind, s: Record<string, unknown>): string | null {
  const o = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const t = o(s.tests);
  if ((kind === "tests" || kind === "gen_tests") && typeof t.total === "number") return `${t.passed}/${t.total} passed`;
  if (kind === "testrepo") return `${s.mode === "remote" ? "Remote clone" : "Local snapshot"}${typeof s.commit === "string" ? ` · ${s.commit.slice(0, 7)}` : ""}`;
  if (kind === "banana" && typeof s.total === "number") return s.total === 0 ? "no infraction" : `${s.total} infraction(s)`;
  if (kind === "moulinette" && typeof s.overall === "string") return s.overall;
  if (kind === "build") return `${String(s.command ?? "")} · ${Number(s.warnings ?? 0)} warning(s)`;
  return null;
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: Array<{ id: T; label: string; disabled?: boolean; title?: string }>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-bg p-0.5">
      {options.map((o) => (
        <button key={o.id} type="button" disabled={o.disabled} title={o.title} onClick={() => onChange(o.id)} className={cn("h-6 rounded-md px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40", value === o.id ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-fg")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Tile({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action: ReactNode }) {
  return (
    <div className="border-b border-white/6 px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">{icon}</span>
        <h3 className="display min-w-0 flex-1 text-[14px] font-semibold">{title}</h3>
        {action}
      </div>
      <div className="mt-2 flex flex-col gap-2 pl-[38px] text-xs text-muted">{children}</div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-20 shrink-0">{label}</span>
      {children}
    </label>
  );
}

function Actions({ repo, info, busy, onStart, onBrief, onTool }: { repo: string; info: TestingInfo; busy: boolean; onStart: (fn: () => Promise<number>) => void; onBrief: () => void; onTool: (kind: "package" | "readme") => void }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const suites = info.detection.suites;
  const saved = info.config.testCmd;
  const firstTrusted = suites.find((s) => s.trusted)?.command ?? saved ?? null;
  const [command, setCommand] = useState(saved ?? suites[0]?.command ?? "\0custom");
  const [custom, setCustom] = useState(saved ?? "");
  const [ack, setAck] = useState(false);
  const chosen = suites.find((s) => s.command === command);
  const [mode, setMode] = useState<"remote" | "snapshot">(info.hasRemote ? "remote" : "snapshot");
  const [isolation, setIsolation] = useState<"none" | "docker">("none");
  const [build, setBuild] = useState(info.defaultBuild);
  const [withTests, setWithTests] = useState(false);
  const [memory, setMemory] = useState(info.config.runCmd ?? "");
  const [subjectAi, setSubjectAi] = useState(false);
  const saveConfig = useMutation({
    mutationFn: (patch: Partial<TestingInfo["config"]>) => api.projectConfigSet(repo, { ...info.config, ...patch }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["testing-info", repo] }),
    onError: (e) => toast({ kind: "error", title: "Not saved", detail: asAppError(e).message }),
  });
  const runCustom = async () => {
    await api.projectConfigSet(repo, { ...info.config, testCmd: custom.trim() });
    void qc.invalidateQueries({ queryKey: ["testing-info", repo] });
    return api.testsRun(repo, custom.trim(), false);
  };
  const banana = info.banana.repoChecker !== null || (info.banana.epiclang !== null && info.banana.plugin);

  return (
    <Card>
      <CardTitle>Checks</CardTitle>
      <Tile icon={<FlaskConical className="size-4" />} title="Unit tests" action={<Button variant="primary" size="sm" icon={<Play className="size-3.5" />} busy={busy} disabled={command === "\0custom" ? !custom.trim() : !command || (chosen !== undefined && !chosen.trusted && !ack)} onClick={() => onStart(command === "\0custom" ? runCustom : () => api.testsRun(repo, command, ack))}>Run Unit Tests</Button>}>
        <Select className="h-7 font-mono text-xs" value={command} onChange={(e) => { setCommand(e.target.value); setAck(false); }} aria-label="Test command">
          {suites.map((s) => <option key={s.id} value={s.command}>{s.command}{s.trusted ? "" : "  (script)"}</option>)}
          {saved && !suites.some((s) => s.command === saved) && <option value={saved}>{saved}  (saved)</option>}
          <option value={"\0custom"}>Another command…</option>
        </Select>
        {command === "\0custom" && <Input className="h-7 font-mono text-xs" placeholder="make my_tests" value={custom} onChange={(e) => setCustom(e.target.value)} />}
        {command === "\0custom" && <p>Saved for this project. One program and its arguments: no pipes, quotes or &amp;&amp; (put those in a Makefile rule).</p>}
        {chosen && !chosen.trusted && (
          <label className="flex items-start gap-2 text-warn">
            <input type="checkbox" className="mt-0.5 accent-(--color-warn)" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>{chosen.note} I have read <code className="font-mono">{chosen.label}</code>.</span>
          </label>
        )}
        <p>
          {info.detection.frameworks.length > 0 ? `${info.detection.frameworks.join(", ")} · ` : ""}{info.detection.testFiles} test file{info.detection.testFiles === 1 ? "" : "s"}

        </p>
        {info.detection.notes.map((n) => <p key={n} className="text-warn">{n}</p>)}
      </Tile>

      <Tile icon={<GitBranch className="size-4" />} title="TestRepo" action={<Button variant="primary" size="sm" icon={<Play className="size-3.5" />} busy={busy} disabled={!build.trim()} onClick={() => onStart(() => api.testrepoStart(repo, { mode, rev: null, build: build.trim(), tests: withTests ? firstTrusted : null, isolation, image: info.config.image }))}>TestRepo</Button>}>
        <p>Clones the repository into a fresh folder and builds it there, to see what someone else gets.</p>
        <Labeled label="Source">
          <Seg value={mode} onChange={setMode} options={[{ id: "remote", label: "Remote clone", disabled: !info.hasRemote, title: info.hasRemote ? "What is published: the reference before a hand-in" : "This repository has no remote" }, { id: "snapshot", label: "Local Git snapshot", title: "What Git holds here at HEAD. Does not prove it was pushed." }]} />
        </Labeled>
        <Labeled label="Runs on">
          <Seg value={isolation} onChange={setIsolation} options={[{ id: "none", label: "This computer" }, { id: "docker", label: "Container", disabled: !info.docker, title: info.docker ? `Docker image ${info.config.image ?? info.defaultImage}, no network` : "Docker is not installed" }]} />
        </Labeled>
        {isolation === "docker" ? (
          <Labeled label="Image">
            <Input className="h-7 font-mono text-xs" defaultValue={info.config.image ?? ""} placeholder={info.defaultImage} onBlur={(e) => e.target.value.trim() !== (info.config.image ?? "") && saveConfig.mutate({ image: e.target.value.trim() || null })} />
          </Labeled>
        ) : (
          <p className="text-faint">“This computer” is a clean clone, not an isolated environment: your compiler and installed libraries are used.</p>
        )}
        {isolation === "docker" && <p className="text-faint">The image must already be on this computer; TekBoard does not download it. The container has no network and cannot see your home folder. It is not Epitech's correction environment unless you use their image.</p>}
        <Labeled label="Build"><Input className="h-7 font-mono text-xs" value={build} onChange={(e) => setBuild(e.target.value)} /></Labeled>
        <label className={cn("flex items-center gap-2", !firstTrusted && "opacity-50")}>
          <input type="checkbox" className="accent-(--color-accent)" disabled={!firstTrusted} checked={withTests} onChange={(e) => setWithTests(e.target.checked)} />
          Then run the tests {firstTrusted ? <code className="font-mono">({firstTrusted})</code> : "(no test command found)"}
        </label>
      </Tile>

      <Tile icon={<BananaIcon className="size-4" />} title="Banana Repo Checker" action={<Button variant="primary" size="sm" icon={<Play className="size-3.5" />} busy={busy} disabled={!banana} onClick={() => onStart(() => api.bananaRun(repo))}>Run Banana</Button>}>
        {banana ? (
          <p className="selectable">
            {info.banana.repoChecker ? <>Delivery files with <code className="font-mono">{info.banana.repoChecker}</code>{info.banana.version && ` (${info.banana.version})`}</> : "banana-check-repo is not installed"}
            {info.banana.epiclang && info.banana.plugin ? "; coding style with epiclang's Banana plugin on every tracked .c and .h." : "; epiclang's Banana plugin was not found, so coding-style rules are skipped."}
          </p>
        ) : (
          <p className="text-warn">Banana was not found on this computer (neither banana-check-repo nor epiclang's Banana plugin). TekBoard does not download it.</p>
        )}
      </Tile>

      <Tile icon={<ShieldCheck className="size-4" />} title="Claude Moulinette" action={<Button variant="primary" size="sm" icon={<Play className="size-3.5" />} busy={busy} disabled={!build.trim()} onClick={() => { if (memory.trim() !== (info.config.runCmd ?? "")) saveConfig.mutate({ runCmd: memory.trim() || null }); onStart(() => api.moulinetteStart(repo, { build: build.trim(), tests: firstTrusted, memoryRun: memory.trim() || null, subjectAi })); }}>Run pre-check</Button>}>
        <p>Build, structure, Banana, tests, memory, then the subject. A personal pre-check in your working folder: not Epitech's Moulinette, and no grade.</p>
        <Labeled label="Memory run"><Input className="h-7 font-mono text-xs" placeholder={info.valgrind ? "./program arguments — run under Valgrind" : "Valgrind is not installed"} disabled={!info.valgrind} value={memory} onChange={(e) => setMemory(e.target.value)} /></Labeled>
        <label className={cn("flex items-start gap-2", (!info.claude.path || !info.subject) && "opacity-60")}>
          <input type="checkbox" className="mt-0.5 accent-(--color-accent)" disabled={!info.claude.path || !info.subject} checked={subjectAi} onChange={(e) => setSubjectAi(e.target.checked)} />
          <span>
            Ask Claude Code to compare the code with the subject
            {info.subject ? <> (<span className="font-mono">{info.subject}</span>)</> : " — link a subject to this project first"}
            {!info.claude.path && " — Claude Code is not installed"}
            {subjectAi && <span className="block text-faint">Read-only. The subject's text and the files Claude reads are sent to Anthropic; it counts toward your Claude usage.</span>}
          </span>
        </label>
      </Tile>

      <Tile icon={<Bot className="size-4" />} title="Generate Unit Tests with Claude" action={<Button size="sm" icon={<Sparkles className="size-3.5" />} disabled={!info.claude.path || busy} onClick={onBrief}>Review &amp; start…</Button>}>
        {info.claude.path ? <p>Claude Code {info.claude.version?.split(" ")[0]} reads the project and writes tests in <code className="font-mono">tests/</code> only. You see exactly what it may do before it starts, and review the files afterwards.</p> : <p className="text-warn">Claude Code is not installed on this computer (the <code className="font-mono">claude</code> command was not found).</p>}
      </Tile>

      <div className="flex items-center gap-2 px-4 py-3">
        <Button size="sm" icon={<PackageOpen className="size-3.5" />} onClick={() => onTool("package")}>Package for AI</Button>
        <Button size="sm" icon={<FileText className="size-3.5" />} onClick={() => onTool("readme")}>Generate README</Button>
      </div>
    </Card>
  );
}
