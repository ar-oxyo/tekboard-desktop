// Testing center: everything that checks a project — unit tests, clean-clone test, Banana,
// the pre-check, test generation — with one live report and one history.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banana as BananaIcon, Bot, ChevronDown, FileText, FlaskConical, FolderOpen, GitBranch, PackageOpen, PenLine, Play, ScanSearch, ShieldCheck, Sparkles, SquareTerminal, Trash2 } from "lucide-react";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../../components/Menu";
import { useEffect, useState, type ReactNode } from "react";
import { ProjectPicker } from "../../components/ProjectPicker";
import { Select } from "../../components/Select";
import { Button, Card, CardTitle, cn, Dot, EmptyState, ErrorNote, IconButton, Input, PageHeader, Spinner } from "../../components/ui";
import { useJob } from "../../lib/jobs";
import { api, asAppError, type RunKind, type TestingInfo } from "../../lib/api";
import { formatBytes, timeAgo } from "../../lib/format";
import { usePref, useRepos } from "../../lib/hooks";
import { displayName } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { ClaudeBriefDialog } from "../tools/ClaudeBrief";
import { QuickBar } from "./QuickBar";
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

  const job = useJob(runId === null ? jobId : null);
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => api.runGet(runId!), enabled: runId !== null });
  const finished = job.data && job.data.status !== "running" ? job.data.runId : null;
  useEffect(() => {
    if (finished !== null && finished !== undefined) {
      void qc.invalidateQueries({ queryKey: ["runs"] });
      void qc.invalidateQueries({ queryKey: ["testrepo-envs"] });
      void qc.invalidateQueries({ queryKey: ["repos"] });
      void qc.invalidateQueries({ queryKey: ["job-active"] });
    }
  }, [finished, qc]);

  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });
  const start = useMutation({ mutationFn: (fn: () => Promise<number>) => fn(), onSuccess: (id) => showJob(id, repoPath), onError: fail("Could not start") });
  const cancel = useMutation({ mutationFn: (id: number) => api.jobCancel(id), onError: fail("Could not cancel") });
  const openEnv = (name: string, terminal: boolean) => api.testrepoEnvOpen(name, terminal).catch(fail(terminal ? "The terminal did not start" : "Could not open the folder"));
  const [toDelete, setToDelete] = useState<string | null>(null);
  const delEnv = useMutation({ mutationFn: (name: string) => api.testrepoEnvDelete(name), onSuccess: () => { setToDelete(null); void qc.invalidateQueries({ queryKey: ["testrepo-envs"] }); }, onError: fail("Not deleted") });
  const [brief, setBrief] = useState<"tests" | "analysis" | null>(null);

  const raw: ReportData | null = runId !== null ? (run.data ? { ...run.data, steps: run.data.summary.steps ?? [], log: run.data.log ?? "" } : null) : (job.data ?? null);
  const busy = job.data?.status === "running" && runId === null;
  // "clear" empties the log shown here, from that point on. The process, if any, is not touched.
  const [cut, setCut] = useState<{ key: string; at: number } | null>(null);
  const viewKey = runId !== null ? `run${runId}` : jobId !== null ? `job${jobId}` : "";
  const data: ReportData | null = raw && cut?.key === viewKey ? { ...raw, log: raw.log.slice(Math.min(cut.at, raw.log.length)) } : raw;
  const clearLog = () => {
    if (raw && raw.status === "running") setCut({ key: viewKey, at: raw.log.length });
    else {
      setCut(null);
      useUi.setState({ jobId: null, runId: null });
    }
  };
  // A command still running in this repository is shown again when coming back to the screen.
  const active = useQuery({ queryKey: ["job-active", repoPath, "command"], queryFn: () => api.jobActive(repoPath!, "command"), enabled: repoPath !== null, staleTime: 0, refetchInterval: busy && job.data?.kind === "command" ? 1000 : false });
  const runningCommand = job.data?.kind === "command" && job.data.status === "running" ? job.data.id : (active.data ?? null);

  return (
    <>
      <PageHeader
        title="Testing"
        subtitle="Run, check and validate a project. Every result below was produced on this computer."
        actions={
          <ProjectPicker className="w-64" value={repoPath} onChange={(v) => useUi.setState({ testingRepo: v, runId: null })} />
        }
      />
      {repoPath === null ? (
        <Card>
          <EmptyState icon={<FlaskConical className="size-6" />} title="Choose a project">Pick a repository at the top right to see what can be run on it.</EmptyState>
        </Card>
      ) : info.isLoading ? (
        <p className="flex items-center gap-2 py-16 text-muted"><Spinner /> Looking at the project…</p>
      ) : info.error || !info.data ? (
        <ErrorNote>{asAppError(info.error).message}</ErrorNote>
      ) : (
        <>
        <div className="mb-4">
          <QuickBar
            key={repoPath}
            repo={repoPath}
            running={runningCommand}
            terminal={info.data.terminal}
            onClear={clearLog}
            onStarted={(id) => {
              setCut(null);
              showJob(id, repoPath);
              void qc.invalidateQueries({ queryKey: ["job-active", repoPath, "command"] });
            }}
            onStop={(id) => cancel.mutate(id)}
          />
        </div>
        <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-start gap-4">
          <div className="flex min-w-0 flex-col gap-4">
            <Actions key={repoPath} repo={repoPath} info={info.data} busy={start.isPending} onStart={(fn) => start.mutate(fn)} onBrief={setBrief} onTool={(k) => openTool(k, repoPath)} />

            <Card>
              <CardTitle right={
                <Select size="sm" className="w-40" label="Kind of run" value={kind} onChange={(v) => setKind(v as RunKind | "all")} options={[{ value: "all", label: "Everything" }, ...(Object.keys(KIND_LABEL) as RunKind[]).map((k) => ({ value: k as string, label: KIND_LABEL[k] }))]} />
              }>History</CardTitle>
              {(runs.data?.length ?? 0) === 0 ? (
                <p className="px-4 py-4 text-[13px] text-muted">Nothing was run on this project yet. Builds, tests and checks are listed here with their logs.</p>
              ) : (
                <ul className="max-h-72 overflow-y-auto py-1">
                  {runs.data!.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => useUi.setState({ runId: r.id })} className={cn("row-hover flex h-9 w-full items-center gap-3 px-4 text-left", runId === r.id && "bg-raised")}>
                        <span className="flex w-20 shrink-0">
                          <Dot tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Dot>
                        </span>
                        <span className="w-28 shrink-0 truncate text-[13px]">{KIND_LABEL[r.kind] ?? r.kind}</span>
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
              <Report data={data} onCancel={busy && jobId !== null ? () => cancel.mutate(jobId) : undefined} envActions={(n, t) => void openEnv(n, t)} onClear={clearLog} />
            ) : (runId !== null && run.isLoading) || (jobId !== null && job.isLoading) ? (
              <p className="flex items-center gap-2 px-4 py-8 text-[13px] text-muted"><Spinner /> Loading…</p>
            ) : job.error && jobId !== null ? (
              <div className="p-4"><ErrorNote>{asAppError(job.error).message}</ErrorNote></div>
            ) : (
              <EmptyState icon={<ShieldCheck className="size-5" />} title="Nothing running">Start a check on the left, or open a past report from the history. {repo ? `Project: ${displayName(repo)}.` : ""}</EmptyState>
            )}
          </Card>
        </div>
        </>
      )}
      {brief && repoPath && (
        <ClaudeBriefDialog
          repo={repoPath}
          task={brief}
          confirmLabel="Start Claude Code"
          onClose={() => setBrief(null)}
          onConfirm={() => {
            const task = brief;
            setBrief(null);
            start.mutate(() => (task === "tests" ? api.genTestsStart(repoPath) : api.analysisStart(repoPath)));
          }}
        />
      )}
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
        <button key={o.id} type="button" disabled={o.disabled} title={o.title} onClick={() => onChange(o.id)} className={cn("h-6 rounded-md px-2.5 text-xs transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40", value === o.id ? "bg-raised text-fg" : "text-muted hover:text-fg")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One check: its button is always there; its options fold away (remembered). */
function Tile({ id, icon, title, children, action, folded, onToggle }: { id: string; icon: ReactNode; title: string; children: ReactNode; action: ReactNode; folded: string[]; onToggle: (id: string) => void }) {
  const closed = folded.includes(id);
  return (
    <div className="border-b border-white/6 px-4 py-2 last:border-b-0">
      <div className="flex h-8 items-center gap-3">
        <button type="button" aria-expanded={!closed} onClick={() => onToggle(id)} className="group flex min-w-0 flex-1 items-center gap-3 text-left" title={closed ? "Show the options" : "Hide the options"}>
          <span className="flex w-4 shrink-0 justify-center text-faint">{icon}</span>
          <h3 className="min-w-0 truncate text-[13px] font-medium">{title}</h3>
          <ChevronDown className={cn("size-3.5 shrink-0 text-faint transition-transform duration-150 group-hover:text-fg", closed && "-rotate-90")} />
        </button>
        {action}
      </div>
      {!closed && <div className="mt-2 flex flex-col gap-2 pb-2 pl-7 text-xs text-muted">{children}</div>}
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

function Actions({ repo, info, busy, onStart, onBrief, onTool }: { repo: string; info: TestingInfo; busy: boolean; onStart: (fn: () => Promise<number>) => void; onBrief: (task: "tests" | "analysis") => void; onTool: (kind: "package" | "readme") => void }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const suites = info.detection.suites;
  const saved = info.config.testCmd;
  const firstTrusted = suites.find((s) => s.trusted)?.command ?? saved ?? null;
  const [command, setCommand] = useState(saved ?? suites[0]?.command ?? "\0custom");
  const [custom, setCustom] = useState(saved ?? "");
  const [ack, setAck] = useState(false);
  const chosen = suites.find((s) => s.command === command);
  const sandbox = useQuery({ queryKey: ["sandbox"], queryFn: api.sandboxCheck, staleTime: 10 * 60_000, retry: false });
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
  const claudeReady = info.claude.state === "ready";
  const setPage = useUi((s) => s.setPage);
  // Options folded by default: the buttons stay, the screen breathes.
  const [folded, setFolded] = usePref<string[]>("testing.folded", ["testrepo", "banana", "moulinette", "ai"]);
  const fold = { folded, onToggle: (id: string) => setFolded(folded.includes(id) ? folded.filter((f) => f !== id) : [...folded, id]) };
  const banana = info.banana.repoChecker !== null || (info.banana.epiclang !== null && info.banana.plugin);

  return (
    <Card>
      <CardTitle>Checks</CardTitle>
      <Tile id="tests" {...fold} icon={<FlaskConical className="size-4" />} title="Unit tests" action={<Button variant="primary" size="sm" icon={<Play className="size-3.5" />} busy={busy} disabled={command === "\0custom" ? !custom.trim() : !command || (chosen !== undefined && !chosen.trusted && !ack)} onClick={() => onStart(command === "\0custom" ? runCustom : () => api.testsRun(repo, command, ack))}>Run Unit Tests</Button>}>
        <Select
          size="sm"
          mono
          label="Test command"
          value={command}
          onChange={(v) => {
            setCommand(v);
            setAck(false);
          }}
          options={[
            ...suites.map((s) => ({ value: s.command, label: s.command, hint: s.trusted ? undefined : "script" })),
            ...(saved && !suites.some((s) => s.command === saved) ? [{ value: saved, label: saved, hint: "saved" }] : []),
            { value: "\0custom", label: "Another command…" },
          ]}
        />
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

      <Tile id="testrepo" {...fold} icon={<GitBranch className="size-4" />} title="TestRepo" action={<Button size="sm" icon={<Play className="size-3.5" />} busy={busy} disabled={!build.trim()} onClick={() => onStart(() => api.testrepoStart(repo, { mode, rev: null, build: build.trim(), tests: withTests ? firstTrusted : null, isolation, image: info.config.image }))}>TestRepo</Button>}>
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

      <Tile id="banana" {...fold} icon={<BananaIcon className="size-4" />} title="Banana" action={<Button size="sm" icon={<Play className="size-3.5" />} busy={busy} disabled={!banana} onClick={() => onStart(() => api.bananaRun(repo))}>Run Banana</Button>}>
        {banana ? (
          <p className="selectable">
            {info.banana.repoChecker ? <>Delivery files with <code className="font-mono">{info.banana.repoChecker}</code>{info.banana.version && ` (${info.banana.version})`}</> : "banana-check-repo is not installed"}
            {info.banana.epiclang && info.banana.plugin ? "; coding style with epiclang's Banana plugin on every tracked .c and .h." : "; epiclang's Banana plugin was not found, so coding-style rules are skipped."}
          </p>
        ) : (
          <p className="text-warn">Banana was not found on this computer (neither banana-check-repo nor epiclang's Banana plugin). TekBoard does not download it.</p>
        )}
      </Tile>

      <Tile id="tika" {...fold} icon={<Sparkles className="size-4" />} title="Moulinette de Tika" action={<Button size="sm" variant="primary" icon={<Play className="size-3.5" />} busy={busy} disabled={!claudeReady || sandbox.isError} title={!claudeReady ? "Claude Code n'est pas disponible : voir Réglages → Outils" : sandbox.isError ? String(sandbox.error) : undefined} onClick={() => onStart(() => api.moulinetteAiStart(repo))}>Lancer</Button>}>
        <p>Tika joue l'évaluateur : il lit le sujet et le code, décide des tests, compile, essaie les arguments et les cas limites, passe valgrind et creuse ce qui casse. Tu suis chaque vérification en direct. Simulation, pas la moulinette officielle.</p>
        {sandbox.isError ? (
          <p className="text-warn">Bac à sable indisponible : {asAppError(sandbox.error).message || String(sandbox.error)}. Rien ne serait exécuté.</p>
        ) : (
          <p className="text-faint">Sur une copie de ton projet, dans bubblewrap : pas de réseau, ton dossier personnel est masqué, ton projet n'est jamais modifié. Compte dans ton usage de Claude.</p>
        )}
      </Tile>

      <Tile id="moulinette" {...fold} icon={<ShieldCheck className="size-4" />} title="Vérifications rapides" action={<Button size="sm" icon={<Play className="size-3.5" />} busy={busy} disabled={!build.trim()} title={!build.trim() ? "Indique la commande de compilation dans la tuile « Simulation de rendu »" : undefined} onClick={() => { if (memory.trim() !== (info.config.runCmd ?? "")) saveConfig.mutate({ runCmd: memory.trim() || null }); onStart(() => api.moulinetteStart(repo, { build: build.trim(), tests: firstTrusted, memoryRun: memory.trim() || null, subjectAi })); }}>Run pre-check</Button>}>
        <p>Compilation, structure, Banana, tests et mémoire, sans IA et en quelques secondes, dans ton dossier de travail.</p>
        <Labeled label="Memory run"><Input className="h-7 font-mono text-xs" placeholder={info.valgrind ? "./program arguments — run under Valgrind" : "Valgrind is not installed"} disabled={!info.valgrind} value={memory} onChange={(e) => setMemory(e.target.value)} /></Labeled>
        <label className={cn("flex items-start gap-2", (!claudeReady || !info.subject) && "opacity-60")}>
          <input type="checkbox" className="mt-0.5 accent-(--color-accent)" disabled={!claudeReady || !info.subject} checked={subjectAi} onChange={(e) => setSubjectAi(e.target.checked)} />
          <span>
            Ask Claude Code to compare the code with the subject
            {info.subject ? <> (<span className="font-mono">{info.subject}</span>)</> : " — link a subject to this project first"}
            {!claudeReady && " — Claude Code is not installed"}
            {subjectAi && <span className="block text-faint">Read-only. The subject's text and the files Claude reads are sent to Anthropic; it counts toward your Claude usage.</span>}
          </span>
        </label>
      </Tile>

      <Tile
        id="ai"
        {...fold}
        icon={<Bot className="size-4" />}
        title="Claude Code"
        action={
          <Menu
            trigger={
              <Button size="sm" icon={<Bot className="size-3.5" />}>
                AI tools
              </Button>
            }
          >
            <MenuLabel>{claudeReady ? `Claude Code ${info.claude.version?.split(" ")[0] ?? ""}` : "Claude Code is not available"}</MenuLabel>
            <MenuItem icon={<FlaskConical className="size-4" />} disabled={!claudeReady || busy} onSelect={() => onStart(() => api.genTestsStart(repo))} hint="diff à valider">
              Générer des tests
            </MenuItem>
            <MenuItem icon={<ScanSearch className="size-4" />} disabled={!claudeReady || busy} onSelect={() => onBrief("analysis")} hint="read-only">
              Analyse repository…
            </MenuItem>
            <MenuItem icon={<FileText className="size-4" />} onSelect={() => onTool("readme")}>
              Generate README…
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<PackageOpen className="size-4" />} onSelect={() => onTool("package")} hint="no AI call">
              Package for AI…
            </MenuItem>
            <MenuItem icon={<PenLine className="size-4" />} onSelect={() => setPage("prompts")}>
              Edit the prompts
            </MenuItem>
          </Menu>
        }
      >
        {claudeReady ? (
          <p>La génération de tests travaille sur une copie : Tika écrit, compile et lance les tests dans le bac à sable, puis te montre les fichiers à appliquer. L'analyse et le README sont en lecture seule.</p>
        ) : (
          <p className="text-warn">
            {info.claude.state === "not_found" ? "Claude Code was not found on this computer." : (info.claude.detail ?? "Claude Code cannot be used.")}{" "}
            <button type="button" className="text-accent-strong hover:underline" onClick={() => setPage("settings")}>
              Check it in Settings
            </button>
          </p>
        )}
      </Tile>
    </Card>
  );
}
