// Algorithm Arena: pick a program (a project, a branch or commit of it, or a Playground
// draft), optionally a second version to compare, describe the data (generators, sizes,
// seed), and measure. Everything runs on throwaway copies in the sandbox; the results come
// in point by point. Artix can write the generators (shown before anything runs) and the
// final report (from the measurements only). Nothing here edits the original code.
import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FilePlus2, Share2, GitCompare, History, Play, Plus, Save, Sparkles, Square, Trash2, X } from "lucide-react";
import { api, asAppError, type ArenaResults, type ArenaScenario, type ArenaVariant, type BenchConfig, type DraftFile } from "../../lib/api";
import { useJob } from "../../lib/jobs";
import { useUi } from "../../lib/store";
import { aiGate } from "../../lib/ai";
import { useAiStatus } from "../settings/AiProvider";
import { ProjectPicker } from "../../components/ProjectPicker";
import { Select } from "../../components/Select";
import { Modal } from "../../components/Modal";
import { Badge, Button, cn, EmptyState, ErrorNote, Field, IconButton, Input, Spinner } from "../../components/ui";
import { doubling, emptyConfig, mergeGenerated, newScenario, parseSizes, STARTER_GENERATOR } from "../../lib/arena";
import { timeAgo } from "../../lib/format";
import { STATUS_LABEL, STATUS_TONE } from "../testing/Report";
import { useArena } from "./store";
import { JobSteps, Results, type JobLike } from "./Results";
import { t } from "../../lib/i18n";

const CodeEditor = lazy(() => import("../../components/CodeEditor"));

export default function ArenaPage() {
  const toast = useUi((s) => s.toast);
  const ai = aiGate(useAiStatus().data);
  const { config, savedId, runJob, aiJob, reportJob, viewRun, set } = useArena();
  const tools = useQuery({ queryKey: ["arena-tools"], queryFn: api.arenaTools, staleTime: 60_000 });
  const saved = useQuery({ queryKey: ["arena"], queryFn: api.arenaList });
  const run = useJob(runJob);
  const gen = useJob(aiJob);
  const rep = useJob(reportJob);
  const past = useQuery({ queryKey: ["run", viewRun], queryFn: () => api.runGet(viewRun!), enabled: viewRun !== null });
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState("");
  const update = (patch: Partial<BenchConfig>) => set({ config: { ...config, ...patch } });

  // A run from the history has the same summary as the job that made it.
  const shown: (JobLike & { summary: Record<string, unknown> }) | undefined =
    viewRun !== null ? (past.data ? { steps: (past.data.summary?.steps as JobLike["steps"]) ?? [], log: past.data.log ?? "", status: past.data.status, summary: past.data.summary ?? {} } : undefined) : run.data;
  const results = (shown?.summary as { arena?: ArenaResults } | undefined)?.arena ?? null;
  const shownRunId = viewRun ?? run.data?.runId ?? null;
  const report = rep.data && (rep.data.summary as { runId?: number }).runId === shownRunId ? ((rep.data.summary as { report?: string }).report ?? null) : null;
  const running = run.data?.status === "running";
  const generating = gen.data?.status === "running";

  const problem = (() => {
    if (tools.data?.sandbox) return t("Bac à sable indisponible : {w}", { w: tools.data.sandbox });
    if (config.variants.length === 0) return t("Choisis le programme à mesurer");
    for (const s of config.scenarios) if (s.generator?.endsWith(".py") && tools.data && !tools.data.python) return t("python3 est nécessaire pour {g}", { g: s.generator });
    return null;
  })();

  const start = async () => {
    setBusy(true);
    try {
      const id = await api.arenaRun(config);
      set({ runJob: id, viewRun: null });
    } catch (e) {
      toast({ kind: "error", title: t("Impossible de lancer le benchmark"), detail: asAppError(e).message });
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    try {
      const s = await api.arenaSave(savedId, config);
      set({ savedId: s.id });
      toast({ kind: "ok", title: t("Benchmark enregistré") });
    } catch (e) {
      toast({ kind: "error", title: t("Enregistrement impossible"), detail: asAppError(e).message });
    }
  };
  const generate = async () => {
    try {
      const id = await api.arenaGenerate(config, focus);
      set({ aiJob: id });
    } catch (e) {
      toast({ kind: "error", title: t("Artix ne peut pas préparer le benchmark"), detail: asAppError(e).message });
    }
  };
  const askReport = async () => {
    if (shownRunId === null) return;
    try {
      set({ reportJob: await api.arenaReport(shownRunId) });
    } catch (e) {
      toast({ kind: "error", title: t("Rapport impossible"), detail: asAppError(e).message });
    }
  };

  return (
    <div className="grid grid-cols-[minmax(340px,420px)_minmax(0,1fr)] gap-4">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Input className="h-8 flex-1 text-sm font-medium" value={config.name} onChange={(e) => update({ name: e.target.value })} aria-label={t("Nom du benchmark")} />
          <Select<string> className="w-40" size="sm" label={t("Benchmarks enregistrés")} placeholder={t("Enregistrés…")} value={savedId !== null ? String(savedId) : null} onChange={(v) => { const s = saved.data?.find((x) => String(x.id) === v); if (s) set({ config: s.config, savedId: s.id }); }} options={(saved.data ?? []).map((s) => ({ value: String(s.id), label: s.config.name, hint: timeAgo(s.updatedAt) }))} emptyState={{ text: t("Aucun benchmark enregistré") }} />
          <IconButton label={t("Nouveau benchmark")} onClick={() => set({ config: emptyConfig(), savedId: null })}>
            <Plus className="size-4" />
          </IconButton>
        </div>
        <VariantsCard config={config} onChange={update} />
        <ScenariosCard config={config} onChange={update} />
        <FilesCard files={config.files} onChange={(files) => update({ files })} />
        <OptionsCard config={config} onChange={update} valgrind={tools.data?.valgrind ?? true} />
        <section className="card p-3">
          <h3 className="mb-1 flex items-center gap-1.5 text-xs text-faint">
            <Sparkles className="size-3.5" /> {t("Construire l'environnement avec Artix")}
          </h3>
          <p className="mb-2 text-xs text-muted">{t("Artix lit le programme et écrit des générateurs de données et des scénarios. Tu les vois apparaître ici, puis tu décides de les utiliser : rien n'est exécuté avant que tu lances le benchmark.")}</p>
          <div className="flex gap-2">
            <Input className="h-8 text-xs" placeholder={t("Ce que tu veux tester (facultatif) : le tri, la recherche…")} value={focus} onChange={(e) => setFocus(e.target.value)} />
            <Button size="sm" icon={<Sparkles className="size-3.5" />} busy={generating} disabled={!ai.read || config.variants.length === 0} disabledReason={!ai.read ? (ai.why ?? t("L'IA choisie ne lit pas les fichiers")) : t("Choisis d'abord le programme")} onClick={() => void generate()}>
              {t("Préparer")}
            </Button>
          </div>
          {gen.data && <Generation job={gen.data} onUse={(files, scenarios) => { update(mergeGenerated(config, files, scenarios)); toast({ kind: "ok", title: t("Fichiers et scénarios ajoutés"), detail: t("Relis-les avant de lancer le benchmark.") }); }} />}
        </section>
      </div>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <Button variant="danger" icon={<Square className="size-3.5" />} onClick={() => runJob !== null && void api.jobCancel(runJob)}>
              {t("Arrêter")}
            </Button>
          ) : (
            <Button variant="primary" icon={<Play className="size-3.5" />} busy={busy} disabled={!!problem} disabledReason={problem} onClick={() => void start()}>
              {t("Lancer le benchmark")}
            </Button>
          )}
          <Button variant="ghost" icon={<Save className="size-3.5" />} onClick={() => void save()}>
            {t("Enregistrer")}
          </Button>
          <Button variant="ghost" icon={<History className="size-3.5" />} onClick={() => setHistory(true)}>
            {t("Historique")}
          </Button>
          {shownRunId !== null && !running && results && (
            <Button variant="ghost" icon={<Share2 className="size-3.5" />} onClick={() => useUi.getState().openShare({ kind: "arenaRun", runId: shownRunId })}>
              {t("Partager")}
            </Button>
          )}
          {viewRun !== null && (
            <Badge>
              {t("Résultat passé")}
              <button type="button" aria-label={t("Revenir au dernier")} onClick={() => set({ viewRun: null })}>
                <X className="size-3" />
              </button>
            </Badge>
          )}
          {problem && !running && <span className="text-xs text-faint">{problem}</span>}
        </div>
        {shown?.status === "failed" && typeof (shown.summary as { error?: string }).error === "string" && <ErrorNote title={t("Le benchmark a échoué")}>{(shown.summary as { error: string }).error}</ErrorNote>}
        {results ? (
          <Results r={results} job={shown ?? null} report={report} reportBusy={rep.data?.status === "running"} onReport={() => void askReport()} reportDisabled={!ai.text ? (ai.why ?? "") : shownRunId === null ? t("Le benchmark n'est pas encore enregistré") : null} />
        ) : shown ? (
          <div className="card space-y-2 p-3">
            <JobSteps job={shown} />
            {shown.status === "running" && (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Spinner /> {t("Préparation des copies et compilation…")}
              </p>
            )}
          </div>
        ) : (
          <EmptyState icon={<GitCompare className="size-6" />} title={t("Mesure, compare, comprends")}>
            {t("Choisis un projet ou un brouillon, décris les données (un générateur et des tailles croissantes) et lance : TekBoard mesure le temps, le CPU et la mémoire à chaque taille, estime la complexité, compte les instructions par fonction et compare deux versions sans toucher à ton dossier.")}
          </EmptyState>
        )}
      </div>
      <HistoryModal open={history} onClose={() => setHistory(false)} onPick={(id) => { set({ viewRun: id }); setHistory(false); }} />
    </div>
  );
}

function VariantsCard({ config, onChange }: { config: BenchConfig; onChange: (p: Partial<BenchConfig>) => void }) {
  const drafts = useQuery({ queryKey: ["playground"], queryFn: api.playgroundList });
  const setVariant = (i: number, v: ArenaVariant) => onChange({ variants: config.variants.map((x, j) => (j === i ? v : x)) });
  const first = config.variants[0];
  return (
    <section className="card space-y-3 p-3">
      <h3 className="text-xs text-faint">{t("Programme mesuré")}</h3>
      {config.variants.length === 0 ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onChange({ variants: [{ label: "A", source: { kind: "project", path: "", rev: null }, build: "", program: "" }] })}>
            {t("Un projet")}
          </Button>
          <Button size="sm" disabled={!drafts.data?.length} disabledReason={t("Aucun brouillon dans le Playground")} onClick={() => onChange({ variants: [{ label: "A", source: { kind: "draft", id: drafts.data![0].id }, build: "", program: "" }] })}>
            {t("Un brouillon du Playground")}
          </Button>
        </div>
      ) : (
        config.variants.map((v, i) => <VariantEditor key={i} v={v} index={i} drafts={drafts.data ?? []} onChange={(nv) => setVariant(i, nv)} onRemove={() => onChange({ variants: config.variants.filter((_, j) => j !== i) })} />)
      )}
      {first && config.variants.length === 1 && (
        <Button size="sm" variant="ghost" icon={<GitCompare className="size-3.5" />} onClick={() => onChange({ variants: [first, { ...first, label: "B", source: first.source.kind === "project" ? { ...first.source, rev: null } : first.source }] })}>
          {t("Comparer avec une autre version")}
        </Button>
      )}
    </section>
  );
}

function VariantEditor({ v, index, drafts, onChange, onRemove }: { v: ArenaVariant; index: number; drafts: import("../../lib/api").Draft[]; onChange: (v: ArenaVariant) => void; onRemove: () => void }) {
  const path = v.source.kind === "project" ? v.source.path : null;
  const revs = useQuery({ queryKey: ["arena-revs", path], queryFn: () => api.arenaRevisions(path!), enabled: !!path, retry: false });
  const revOptions = [{ value: "", label: t("Dossier de travail (tel quel)"), group: t("Version") }, ...(revs.data?.branches ?? []).map((b) => ({ value: b, label: b, group: t("Branches"), hint: b === revs.data?.current ? t("actuelle") : undefined })), ...(revs.data?.commits ?? []).map(([h, s]) => ({ value: h, label: `${h} ${s}`, group: t("Commits récents") }))];
  return (
    <div className={cn("space-y-2 rounded-md border border-ink/6 p-2.5", index === 1 && "border-dashed")}>
      <div className="flex items-center gap-2">
        <Input className="h-7 w-16 text-xs" value={v.label} onChange={(e) => onChange({ ...v, label: e.target.value.slice(0, 24) })} aria-label={t("Nom de la variante")} />
        <Select<"project" | "draft"> size="sm" className="w-32" label={t("Source")} value={v.source.kind} onChange={(k) => onChange({ ...v, source: k === "project" ? { kind: "project", path: "", rev: null } : { kind: "draft", id: drafts[0]?.id ?? 0 } })} options={[{ value: "project", label: t("Projet") }, { value: "draft", label: t("Brouillon"), disabled: drafts.length === 0 }]} />
        <IconButton label={t("Retirer")} className="ml-auto" onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
      {v.source.kind === "project" ? (
        <>
          <ProjectPicker size="sm" value={v.source.path || null} onChange={(p) => onChange({ ...v, source: { kind: "project", path: p ?? "", rev: null } })} />
          {path && <Select<string> size="sm" label={t("Version")} value={v.source.rev ?? ""} onChange={(rev) => onChange({ ...v, source: { kind: "project", path: path, rev: rev || null } })} options={revOptions} search />}
          <div className="grid grid-cols-2 gap-2">
            <Input className="h-7 font-mono text-xs" placeholder="make" value={v.build} onChange={(e) => onChange({ ...v, build: e.target.value })} aria-label={t("Commande de compilation")} title={t("Commande de compilation (sans shell)")} />
            <Input className="h-7 font-mono text-xs" placeholder={t("programme (auto)")} value={v.program} onChange={(e) => onChange({ ...v, program: e.target.value })} aria-label={t("Programme à mesurer")} title={t("Chemin du programme après compilation, ex. ./sort")} />
          </div>
        </>
      ) : (
        <Select<string> size="sm" label={t("Brouillon")} value={String(v.source.id)} onChange={(id) => onChange({ ...v, source: { kind: "draft", id: Number(id) } })} options={drafts.map((d) => ({ value: String(d.id), label: d.title, hint: t("{n} fichier(s)", { n: d.files.length }) }))} />
      )}
    </div>
  );
}

function ScenariosCard({ config, onChange }: { config: BenchConfig; onChange: (p: Partial<BenchConfig>) => void }) {
  const setScenario = (i: number, s: ArenaScenario) => onChange({ scenarios: config.scenarios.map((x, j) => (j === i ? s : x)) });
  const gens = config.files.filter((f) => f.name.endsWith(".py") || f.name.endsWith(".c"));
  return (
    <section className="card space-y-2 p-3">
      <div className="flex items-center">
        <h3 className="text-xs text-faint">{t("Scénarios")}</h3>
        <IconButton label={t("Ajouter un scénario")} className="ml-auto" disabled={config.scenarios.length >= 6} onClick={() => onChange({ scenarios: [...config.scenarios, newScenario(config.files)] })}>
          <Plus className="size-3.5" />
        </IconButton>
      </div>
      {config.scenarios.map((s, i) => (
        <ScenarioEditor key={i} s={s} gens={gens} onChange={(ns) => setScenario(i, ns)} onRemove={config.scenarios.length > 1 ? () => onChange({ scenarios: config.scenarios.filter((_, j) => j !== i) }) : undefined} />
      ))}
      <p className="text-2xs text-faint">{t("Arguments sans shell : {input} = fichier de données, {n} = taille, {seed} = graine. Un générateur est appelé « gen N SEED SORTIE ».")}</p>
    </section>
  );
}

function ScenarioEditor({ s, gens, onChange, onRemove }: { s: ArenaScenario; gens: DraftFile[]; onChange: (s: ArenaScenario) => void; onRemove?: () => void }) {
  const [sizes, setSizes] = useState(s.sizes.join(", "));
  const parsed = parseSizes(sizes);
  // Sizes changed from outside (a saved benchmark loaded, Artix's scenarios): show them,
  // unless the text being typed already means the same list.
  const outside = s.sizes.join(",");
  useEffect(() => {
    const p = parseSizes(sizes);
    if (typeof p === "string" || p.join(",") !== outside) setSizes(outside.split(",").join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outside]);
  return (
    <div className="space-y-1.5 rounded-md border border-ink/6 p-2.5">
      <div className="flex items-center gap-2">
        <Input className="h-7 flex-1 text-xs" value={s.name} onChange={(e) => onChange({ ...s, name: e.target.value })} aria-label={t("Nom du scénario")} />
        <Select<string> size="sm" className="w-32" label={t("Générateur")} value={s.generator ?? ""} onChange={(g) => onChange({ ...s, generator: g || null, args: g ? s.args : s.args.replace("{input}", "{n}"), stdin: g ? s.stdin : false })} options={[{ value: "", label: t("aucun") }, ...gens.map((g) => ({ value: g.name, label: g.name }))]} />
        {onRemove && (
          <IconButton label={t("Retirer")} onClick={onRemove}>
            <Trash2 className="size-3.5" />
          </IconButton>
        )}
      </div>
      <div className="grid grid-cols-[1fr_4.5rem] gap-2">
        <Input className={cn("h-7 font-mono text-xs", typeof parsed === "string" && "border-danger/60")} value={sizes} title={typeof parsed === "string" ? parsed : undefined} onChange={(e) => { setSizes(e.target.value); const p = parseSizes(e.target.value); if (typeof p !== "string") onChange({ ...s, sizes: p }); }} aria-label={t("Tailles")} placeholder="1000, 2000, 4000" />
        <Input className="h-7 text-xs" type="number" value={s.seed} onChange={(e) => onChange({ ...s, seed: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} aria-label={t("Graine")} title={t("Graine : mêmes données à chaque benchmark")} />
      </div>
      <div className="flex items-center gap-2">
        <Input className="h-7 flex-1 font-mono text-xs" value={s.args} onChange={(e) => onChange({ ...s, args: e.target.value })} aria-label={t("Arguments du programme")} placeholder="{input}" />
        <label className="flex items-center gap-1 text-2xs text-muted" title={t("Donner les données sur l'entrée standard")}>
          <input type="checkbox" className="accent-(--color-accent)" disabled={!s.generator} checked={s.stdin} onChange={(e) => onChange({ ...s, stdin: e.target.checked })} />
          stdin
        </label>
        <button type="button" className="text-2xs text-accent hover:underline" onClick={() => { const v = doubling(s.sizes[0] ?? 1000, 6); setSizes(v.join(", ")); onChange({ ...s, sizes: v }); }}>
          ×2
        </button>
      </div>
      {typeof parsed === "string" && <p className="text-2xs text-danger">{parsed}</p>}
    </div>
  );
}

function FilesCard({ files, onChange }: { files: DraftFile[]; onChange: (f: DraftFile[]) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const current = files.find((f) => f.name === open) ?? null;
  const add = () => {
    let i = 1;
    while (files.some((f) => f.name === `gen${i}.py`)) i++;
    onChange([...files, { name: `gen${i}.py`, content: STARTER_GENERATOR, library: null }]);
    setOpen(`gen${i}.py`);
  };
  return (
    <section className="card p-3">
      <div className="mb-1.5 flex items-center">
        <h3 className="text-xs text-faint">{t("Fichiers du benchmark")}</h3>
        <IconButton label={t("Nouveau générateur")} className="ml-auto" onClick={add}>
          <FilePlus2 className="size-3.5" />
        </IconButton>
      </div>
      <div className="flex flex-wrap gap-1">
        {files.map((f) => (
          <span key={f.name} className={cn("group flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-2xs", open === f.name ? "border-accent/50 text-fg" : "border-ink/8 text-muted")}>
            <button type="button" onClick={() => setOpen(open === f.name ? null : f.name)}>
              {f.name}
            </button>
            <button type="button" aria-label={t("Supprimer {f}", { f: f.name })} className="opacity-0 group-hover:opacity-100 hover:text-danger" onClick={() => onChange(files.filter((x) => x.name !== f.name))}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        {files.length === 0 && <p className="text-xs text-muted">{t("Aucun : les tailles sont passées directement au programme.")}</p>}
      </div>
      {current && (
        <div className="mt-2 h-56 overflow-hidden rounded-md border border-ink/6">
          <Suspense fallback={<Spinner className="m-3" />}>
            <CodeEditor key={current.name} value={current.content} language={current.name.endsWith(".c") ? "c" : "plain"} onChange={(content) => onChange(files.map((f) => (f.name === current.name ? { ...f, content } : f)))} className="h-full" label={current.name} />
          </Suspense>
        </div>
      )}
    </section>
  );
}

function OptionsCard({ config, onChange, valgrind }: { config: BenchConfig; onChange: (p: Partial<BenchConfig>) => void; valgrind: boolean }) {
  const o = config.options;
  const set = (p: Partial<BenchConfig["options"]>) => onChange({ options: { ...o, ...p } });
  const check = (key: "warmup" | "callgrind" | "massif" | "heap", label: string, title: string, needsValgrind = true) => (
    <label className="flex items-center gap-1.5 text-xs text-muted" title={needsValgrind && !valgrind ? t("Valgrind n'est pas installé") : title}>
      <input type="checkbox" className="accent-(--color-accent)" disabled={needsValgrind && !valgrind} checked={o[key] && (!needsValgrind || valgrind)} onChange={(e) => set({ [key]: e.target.checked })} />
      {label}
    </label>
  );
  return (
    <details className="card p-3">
      <summary className="cursor-pointer text-xs text-faint">{t("Options de mesure")}</summary>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Field label={t("Répétitions")}>
          <Input type="number" min={1} max={30} className="h-7 text-xs" value={o.repeats} onChange={(e) => set({ repeats: Math.min(30, Math.max(1, Number(e.target.value) || 5)) })} />
        </Field>
        <Field label={t("Limite (s)")}>
          <Input type="number" min={1} max={600} className="h-7 text-xs" value={o.timeoutS} onChange={(e) => set({ timeoutS: Math.min(600, Math.max(1, Number(e.target.value) || 30)) })} />
        </Field>
        <Field label={t("Mémoire (Mo)")}>
          <Input type="number" min={64} max={16384} className="h-7 text-xs" value={o.memMb} onChange={(e) => set({ memMb: Math.min(16384, Math.max(64, Number(e.target.value) || 1024)) })} />
        </Field>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {check("warmup", t("Exécution d'échauffement"), t("Une première exécution non comptée (caches, disque)"), false)}
        {check("callgrind", t("Instructions par fonction (Callgrind)"), t("Compte exact des instructions à chaque taille : lent, mais insensible au bruit"))}
        {check("massif", t("Pic du tas (Massif)"), t("Mémoire allouée au plus haut, à la plus grande taille"))}
        {check("heap", t("Nombre d'allocations"), t("malloc/free comptés par Memcheck, à la plus grande taille"))}
      </div>
    </details>
  );
}

function Generation({ job, onUse }: { job: import("../../lib/api").JobView; onUse: (files: DraftFile[], scenarios: ArenaScenario[]) => void }) {
  const s = job.summary as { generatedFiles?: DraftFile[]; generated?: import("../../lib/api").ArenaGenerated };
  const files = s.generated?.files ?? s.generatedFiles ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const current = files.find((f) => f.name === open);
  const running = job.status === "running";
  return (
    <div className="mt-3 space-y-2 border-t border-ink/6 pt-2">
      <div className="flex items-center gap-2 text-xs">
        {running ? <Spinner /> : <Badge tone={STATUS_TONE[job.status] ?? "neutral"}>{STATUS_LABEL[job.status] ?? job.status}</Badge>}
        <span className="text-muted">{running ? t("Artix lit le code et écrit…") : t("{f} fichier(s), {s} scénario(s)", { f: files.length, s: s.generated?.scenarios.length ?? 0 })}</span>
      </div>
      <ul className="space-y-1">
        {files.map((f) => (
          <li key={f.name} className="anim-rise">
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left font-mono text-2xs text-fg hover:bg-hover" onClick={() => setOpen(open === f.name ? null : f.name)}>
              <FilePlus2 className="size-3 text-ok" /> bench/{f.name}
              <span className="ml-auto text-faint">{t("{n} lignes", { n: f.content.split("\n").length })}</span>
            </button>
          </li>
        ))}
      </ul>
      {current && <pre className="selectable max-h-48 overflow-auto rounded-md bg-well p-2 font-mono text-2xs text-fg/90">{current.content}</pre>}
      {s.generated && (
        <>
          {s.generated.scenarios.map((sc) => (
            <p key={sc.name} className="text-xs text-muted">
              <span className="text-fg">{sc.name}</span> · {sc.generator ?? t("sans générateur")} · n = {sc.sizes.join(", ")} · <span className="font-mono">{sc.args}</span>
            </p>
          ))}
          {s.generated.hypotheses.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted">
              {s.generated.hypotheses.map((h, i) => (
                <li key={i}>
                  <Badge>{t("hypothèse d'Artix")}</Badge> {h.function && <span className="font-mono">{h.function}()</span>} {h.message}
                </li>
              ))}
            </ul>
          )}
          {s.generated.rejected.length > 0 && <p className="text-2xs text-warn">{t("Écarté : {r}", { r: s.generated.rejected.join(" ; ") })}</p>}
          <Button size="sm" variant="primary" disabled={s.generated.scenarios.length === 0} disabledReason={t("Aucun scénario utilisable")} onClick={() => onUse(s.generated!.files, s.generated!.scenarios)}>
            {t("Utiliser ces fichiers et scénarios")}
          </Button>
        </>
      )}
    </div>
  );
}

function HistoryModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: number) => void }) {
  const runs = useQuery({ queryKey: ["runs", "arena"], queryFn: () => api.runsList(null, "arena", 60), enabled: open, staleTime: 0 });
  return (
    <Modal open={open} onClose={onClose} title={t("Historique des benchmarks")} width="w-[640px]">
      {runs.isLoading ? (
        <Spinner />
      ) : (runs.data ?? []).length === 0 ? (
        <p className="text-sm text-muted">{t("Aucun benchmark lancé pour l'instant.")}</p>
      ) : (
        <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto">
          {runs.data!.map((r) => (
            <li key={r.id}>
              <button type="button" className="row-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left" onClick={() => onPick(r.id)}>
                <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{r.title.replace(/^Arena · /, "")}</span>
                <span className="text-xs text-faint">{timeAgo(r.startedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
