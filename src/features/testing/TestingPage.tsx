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
import { t } from "../../lib/i18n";

const tr = t;

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
  const start = useMutation({ mutationFn: (fn: () => Promise<number>) => fn(), onSuccess: (id) => showJob(id, repoPath), onError: fail("Démarrage impossible") });
  const cancel = useMutation({ mutationFn: (id: number) => api.jobCancel(id), onError: fail("Annulation impossible") });
  const openEnv = (name: string, terminal: boolean) => api.testrepoEnvOpen(name, terminal).catch(fail(terminal ? t("Le terminal n'a pas démarré") : t("Dossier non ouvert")));
  const [toDelete, setToDelete] = useState<string | null>(null);
  const delEnv = useMutation({ mutationFn: (name: string) => api.testrepoEnvDelete(name), onSuccess: () => { setToDelete(null); void qc.invalidateQueries({ queryKey: ["testrepo-envs"] }); }, onError: fail("Non supprimé") });
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
        title="Tests"
        subtitle={t("Lancer, tester et valider un projet. Chaque résultat ci-dessous a été produit sur cet ordinateur.")}
        actions={
          <ProjectPicker className="w-64" value={repoPath} onChange={(v) => useUi.setState({ testingRepo: v, runId: null })} />
        }
      />
      {repoPath === null ? (
        <Card>
          <EmptyState icon={<FlaskConical className="size-6" />} title={t("Choisis un projet")}>{t("Choisis un dépôt en haut à droite pour voir ce qui peut être lancé.")}</EmptyState>
        </Card>
      ) : info.isLoading ? (
        <p className="flex items-center gap-2 py-16 text-muted"><Spinner /> {t("Lecture du projet…")}</p>
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
                <Select size="sm" className="w-40" label={t("Type d'exécution")} value={kind} onChange={(v) => setKind(v as RunKind | "all")} options={[{ value: "all", label: t("Tout") }, ...(Object.keys(KIND_LABEL) as RunKind[]).map((k) => ({ value: k as string, label: KIND_LABEL[k] }))]} />
              }>Historique</CardTitle>
              {(runs.data?.length ?? 0) === 0 ? (
                <p className="px-4 py-4 text-[13px] text-muted">{t("Rien n'a encore été lancé sur ce projet. Compilations, tests et vérifications s'affichent ici avec leur journal.")}</p>
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
              <CardTitle>{t("Environnements de test")}</CardTitle>
              {(envs.data?.length ?? 0) === 0 ? (
                <p className="px-4 py-4 text-[13px] text-muted">{t("Les clones de la simulation de rendu restent ici jusqu'à ce que tu les supprimes : tu peux y ouvrir un terminal et essayer le programme.")}</p>
              ) : (
                <ul className="max-h-56 overflow-y-auto py-1">
                  {envs.data!.map((e) => (
                    <li key={e.name} className="flex min-h-9 items-center gap-2 pr-2 pl-4">
                      <span className="selectable min-w-0 flex-1 truncate font-mono text-xs">{e.name}</span>
                      <span className="shrink-0 text-xs text-faint">{formatBytes(e.size)}</span>
                      {toDelete === e.name ? (
                        <>
                          <Button size="sm" variant="danger" busy={delEnv.isPending} onClick={() => delEnv.mutate(e.name)}>{t("Supprimer ce clone")}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setToDelete(null)}>{t("Garder")}</Button>
                        </>
                      ) : (
                        <>
                          <IconButton label={t("Ouvrir un terminal dans ce clone")} onClick={() => void openEnv(e.name, true)}><SquareTerminal className="size-3.5" /></IconButton>
                          <IconButton label={t("Ouvrir le dossier")} onClick={() => void openEnv(e.name, false)}><FolderOpen className="size-3.5" /></IconButton>
                          <IconButton label={t("Supprimer cet environnement de test")} onClick={() => setToDelete(e.name)}><Trash2 className="size-3.5" /></IconButton>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card className="min-w-0">
            <CardTitle right={runId !== null && jobId !== null ? <Button size="sm" variant="ghost" onClick={() => useUi.setState({ runId: null })}>{t("Revenir à la tâche en cours")}</Button> : undefined}>
              {runId !== null ? "Report from the history" : busy ? "Running" : "Report"}
            </CardTitle>
            {data ? (
              <Report data={data} onCancel={busy && jobId !== null ? () => cancel.mutate(jobId) : undefined} envActions={(n, t) => void openEnv(n, t)} onClear={clearLog} />
            ) : (runId !== null && run.isLoading) || (jobId !== null && job.isLoading) ? (
              <p className="flex items-center gap-2 px-4 py-8 text-[13px] text-muted"><Spinner /> {t("Chargement…")}</p>
            ) : job.error && jobId !== null ? (
              <div className="p-4"><ErrorNote>{asAppError(job.error).message}</ErrorNote></div>
            ) : (
              <EmptyState icon={<ShieldCheck className="size-5" />} title={t("Rien en cours")}>Start a check on the left, or open a past report from the history. {repo ? `Project: ${displayName(repo)}.` : ""}</EmptyState>
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
  if (kind === "testrepo") return `${s.mode === "remote" ? tr("Clone du dépôt distant") : "Local snapshot"}${typeof s.commit === "string" ? ` · ${s.commit.slice(0, 7)}` : ""}`;
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
    onError: (e) => toast({ kind: "error", title: t("Non enregistré"), detail: asAppError(e).message }),
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
      <CardTitle>Vérifications</CardTitle>
      <Tile id="tests" {...fold} icon={<FlaskConical className="size-4" />} title={t("Tests du projet")} action={<Button variant="primary" size="sm" icon={<Play className="size-3.5" />} busy={busy} disabled={command === "\0custom" ? !custom.trim() : !command || (chosen !== undefined && !chosen.trusted && !ack)} onClick={() => onStart(command === "\0custom" ? runCustom : () => api.testsRun(repo, command, ack))}>{t("Lancer les tests")}</Button>}>
        <Select
          size="sm"
          mono
          label={t("Commande de test")}
          value={command}
          onChange={(v) => {
            setCommand(v);
            setAck(false);
          }}
          options={[
            ...suites.map((s) => ({ value: s.command, label: s.command, hint: s.trusted ? undefined : "script" })),
            ...(saved && !suites.some((s) => s.command === saved) ? [{ value: saved, label: saved, hint: "saved" }] : []),
            { value: "\0custom", label: t("Autre commande…") },
          ]}
        />
        {command === "\0custom" && <Input className="h-7 font-mono text-xs" placeholder="make my_tests" value={custom} onChange={(e) => setCustom(e.target.value)} />}
        {command === "\0custom" && <p>{t("Gardé pour ce projet. Un programme et ses arguments : pas de pipes, de guillemets ni de &amp;&amp; (mets-les dans une règle du Makefile).")}</p>}
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

      <Tile id="testrepo" {...fold} icon={<GitBranch className="size-4" />} title={t("Simulation de rendu")} action={<Button size="sm" icon={<Play className="size-3.5" />} busy={busy} disabled={!build.trim()} onClick={() => onStart(() => api.testrepoStart(repo, { mode, rev: null, build: build.trim(), tests: withTests ? firstTrusted : null, isolation, image: info.config.image }))}>{t("Simulation de rendu")}</Button>}>
        <p>{t("Clone le dépôt dans un dossier neuf et le compile, pour voir ce que la correction reçoit vraiment.")}</p>
        <Labeled label="Source">
          <Seg value={mode} onChange={setMode} options={[{ id: "remote", label: t("Clone du dépôt distant"), disabled: !info.hasRemote, title: info.hasRemote ? "What is published: the reference before a hand-in" : "This repository has no remote" }, { id: "snapshot", label: t("Instantané git local"), title: t("Ce que git contient ici à HEAD. Ne prouve pas que c'est poussé.") }]} />
        </Labeled>
        <Labeled label={t("Exécuté sur")}>
          <Seg value={isolation} onChange={setIsolation} options={[{ id: "none", label: t("Cet ordinateur") }, { id: "docker", label: "Conteneur", disabled: !info.docker, title: info.docker ? `Docker image ${info.config.image ?? info.defaultImage}, no network` : "Docker is not installed" }]} />
        </Labeled>
        {isolation === "docker" ? (
          <Labeled label="Image">
            <Input className="h-7 font-mono text-xs" defaultValue={info.config.image ?? ""} placeholder={info.defaultImage} onBlur={(e) => e.target.value.trim() !== (info.config.image ?? "") && saveConfig.mutate({ image: e.target.value.trim() || null })} />
          </Labeled>
        ) : (
          <p className="text-faint">{t("« Cet ordinateur » est un clone propre, pas un environnement isolé : ton compilateur et tes bibliothèques sont utilisés.")}</p>
        )}
        {isolation === "docker" && <p className="text-faint">{t("L'image doit déjà être sur cet ordinateur ; TekBoard ne la télécharge pas. Le conteneur n'a pas de réseau et ne voit pas ton dossier personnel. Ce n'est l'environnement de correction d'Epitech que si tu utilises leur image.")}</p>}
        <Labeled label="Compilation"><Input className="h-7 font-mono text-xs" value={build} onChange={(e) => setBuild(e.target.value)} /></Labeled>
        <label className={cn("flex items-center gap-2", !firstTrusted && "opacity-50")}>
          <input type="checkbox" className="accent-(--color-accent)" disabled={!firstTrusted} checked={withTests} onChange={(e) => setWithTests(e.target.checked)} />
          Puis lancer les tests {firstTrusted ? <code className="font-mono">({firstTrusted})</code> : "(no test command found)"}
        </label>
      </Tile>

      <Tile id="banana" {...fold} icon={<BananaIcon className="size-4" />} title="Banana" action={<Button size="sm" icon={<Play className="size-3.5" />} busy={busy} disabled={!banana} onClick={() => onStart(() => api.bananaRun(repo))}>{t("Lancer Banana")}</Button>}>
        {banana ? (
          <p className="selectable">
            {info.banana.repoChecker ? <>{t("Fichiers de rendu avec")} <code className="font-mono">{info.banana.repoChecker}</code>{info.banana.version && ` (${info.banana.version})`}</> : "banana-check-repo is not installed"}
            {info.banana.epiclang && info.banana.plugin ? "; coding style with epiclang's Banana plugin on every tracked .c and .h." : "; epiclang's Banana plugin was not found, so coding-style rules are skipped."}
          </p>
        ) : (
          <p className="text-warn">{t("Banana est introuvable sur cet ordinateur (ni banana-check-repo ni le plugin Banana d'epiclang). TekBoard ne le télécharge pas.")}</p>
        )}
      </Tile>

      <Tile id="artix" {...fold} icon={<Sparkles className="size-4" />} title="Moulinette d'Artix" action={<Button size="sm" variant="primary" icon={<Play className="size-3.5" />} busy={busy} disabled={!claudeReady || sandbox.isError} title={!claudeReady ? "Claude Code n'est pas disponible : voir Réglages → Outils" : sandbox.isError ? String(sandbox.error) : undefined} onClick={() => onStart(() => api.moulinetteAiStart(repo))}>{t("Lancer")}</Button>}>
        <p>Artix joue l'évaluateur : il lit le sujet et le code, décide des tests, compile, essaie les arguments et les cas limites, passe valgrind et creuse ce qui casse. Tu suis chaque vérification en direct. Simulation, pas la moulinette officielle.</p>
        {sandbox.isError ? (
          <p className="text-warn">Bac à sable indisponible : {asAppError(sandbox.error).message || String(sandbox.error)}. Rien ne serait exécuté.</p>
        ) : (
          <p className="text-faint">Sur une copie de ton projet, dans bubblewrap : pas de réseau, ton dossier personnel est masqué, ton projet n'est jamais modifié. Compte dans ton usage de Claude.</p>
        )}
      </Tile>

      <Tile id="moulinette" {...fold} icon={<ShieldCheck className="size-4" />} title={t("Vérifications rapides")} action={<Button size="sm" icon={<Play className="size-3.5" />} busy={busy} disabled={!build.trim()} title={!build.trim() ? "Indique la commande de compilation dans la tuile « Simulation de rendu »" : undefined} onClick={() => { if (memory.trim() !== (info.config.runCmd ?? "")) saveConfig.mutate({ runCmd: memory.trim() || null }); onStart(() => api.moulinetteStart(repo, { build: build.trim(), tests: firstTrusted, memoryRun: memory.trim() || null, subjectAi })); }}>{t("Lancer")}</Button>}>
        <p>Compilation, structure, Banana, tests et mémoire, sans IA et en quelques secondes, dans ton dossier de travail.</p>
        <Labeled label={t("Exécution sous valgrind")}><Input className="h-7 font-mono text-xs" placeholder={info.valgrind ? "./program arguments — run under Valgrind" : "Valgrind is not installed"} disabled={!info.valgrind} value={memory} onChange={(e) => setMemory(e.target.value)} /></Labeled>
        <label className={cn("flex items-start gap-2", (!claudeReady || !info.subject) && "opacity-60")}>
          <input type="checkbox" className="mt-0.5 accent-(--color-accent)" disabled={!claudeReady || !info.subject} checked={subjectAi} onChange={(e) => setSubjectAi(e.target.checked)} />
          <span>
            Demander à Claude Code de comparer le code au sujet
            {info.subject ? <> (<span className="font-mono">{info.subject}</span>)</> : " — link a subject to this project first"}
            {!claudeReady && " — Claude Code is not installed"}
            {subjectAi && <span className="block text-faint">{t("Lecture seule. Le texte du sujet et les fichiers lus sont envoyés à Anthropic ; cela compte dans ton usage de Claude.")}</span>}
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
            <MenuItem icon={<FlaskConical className="size-4" />} disabled={!claudeReady || busy} onSelect={() => onStart(() => api.genTestsStart(repo))} hint={t("diff à valider")}>
              {t("Générer des tests")}
            </MenuItem>
            <MenuItem icon={<ScanSearch className="size-4" />} disabled={!claudeReady || busy} onSelect={() => onBrief("analysis")} hint="read-only">
              Analyser le dépôt…
            </MenuItem>
            <MenuItem icon={<FileText className="size-4" />} onSelect={() => onTool("readme")}>
              Générer le README…
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<PackageOpen className="size-4" />} onSelect={() => onTool("package")} hint={t("sans IA")}>
              Paquet pour une IA…
            </MenuItem>
            <MenuItem icon={<PenLine className="size-4" />} onSelect={() => setPage("prompts")}>
              {t("Modifier les prompts")}
            </MenuItem>
          </Menu>
        }
      >
        {claudeReady ? (
          <p>La génération de tests travaille sur une copie : Artix écrit, compile et lance les tests dans le bac à sable, puis te montre les fichiers à appliquer. L'analyse et le README sont en lecture seule.</p>
        ) : (
          <p className="text-warn">
            {info.claude.state === "not_found" ? "Claude Code was not found on this computer." : (info.claude.detail ?? "Claude Code cannot be used.")}{" "}
            <button type="button" className="text-accent-strong hover:underline" onClick={() => setPage("settings")}>
              Vérifier dans Réglages
            </button>
          </p>
        )}
      </Tile>
    </Card>
  );
}
