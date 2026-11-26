// Code Playground: write a few lines of C and run them now — no project, no Makefile.
// Each tab is a draft (several files), saved as you type; a run compiles and executes it in
// the sandbox and the right side shows what came out. Artix explains on request only.
import { lazy, Suspense, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, GitCompare, Share2, FilePlus2, FileCode2, FolderPlus, History, LibraryBig, Lock, LockOpen, Pencil, Play, Plus, Settings2, Sparkles, Square, Trash2, X } from "lucide-react";
import { api, asAppError, type Draft, type DraftFile, type DraftSettings } from "../../lib/api";
import { useJob } from "../../lib/jobs";
import { usePref } from "../../lib/hooks";
import { useUi } from "../../lib/store";
import { aiGate } from "../../lib/ai";
import { useAiStatus } from "../settings/AiProvider";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../../components/Menu";
import { Select } from "../../components/Select";
import { Badge, Button, cn, EmptyState, ErrorNote, IconButton, Input, Kbd, Spinner } from "../../components/ui";
import { artixRequest, DEFAULT_SETTINGS, diagnosticsFor, fileNameError, identifiersOf, nextFileName, resultOf, sortFiles, starterFor, type ArtixAsk } from "../../lib/playground";
import { flush, usePlayground } from "./store";
import { CompareDialog } from "./Compare";
import { Output } from "./Output";
import { ExportDialog, HistoryDialog, LibraryImportDialog } from "./Dialogs";
import { t } from "../../lib/i18n";

const CodeEditor = lazy(() => import("../../components/CodeEditor"));

export default function PlaygroundPage() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const drafts = useQuery({ queryKey: ["playground"], queryFn: api.playgroundList, staleTime: Infinity });
  const tools = useQuery({ queryKey: ["playground-tools"], queryFn: api.playgroundTools, staleTime: 60_000 });
  const { active, edits, setActive, forget } = usePlayground();
  const [defaults, setDefaults] = usePref<DraftSettings>("playground.defaults", DEFAULT_SETTINGS);
  const [history, setHistory] = useState(false);

  const open = (drafts.data ?? []).filter((d) => d.open).map((d) => edits[d.id] ?? d);
  const current = open.find((d) => d.id === active) ?? open[0] ?? null;

  const create = async (title: string, files: DraftFile[] | null = null, settings: DraftSettings | null = null) => {
    try {
      const d = await api.playgroundCreate(title, files, settings ?? { ...DEFAULT_SETTINGS, ...defaults, args: "", stdin: "" });
      await qc.invalidateQueries({ queryKey: ["playground"] });
      setActive(d.id);
    } catch (e) {
      toast({ kind: "error", title: t("Impossible de créer le brouillon"), detail: asAppError(e).message });
    }
  };

  // First visit: a ready-to-run draft instead of an empty screen.
  useEffect(() => {
    if (drafts.data && drafts.data.length === 0) void create(t("Premier essai"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts.data]);

  const close = async (d: Draft) => {
    await flush(d.id).catch(() => undefined);
    await api.playgroundSetOpen(d.id, false);
    forget(d.id);
    if (active === d.id) setActive(open.find((x) => x.id !== d.id)?.id ?? null);
  };

  return (
    <div className="flex h-[calc(100vh-7.5rem)] min-h-[520px] flex-col gap-3">
      <div className="flex items-center gap-1 overflow-x-auto">
        {open.map((d) => (
          <DraftTab key={d.id} draft={d} on={current?.id === d.id} onSelect={() => setActive(d.id)} onClose={() => void close(d)} />
        ))}
        <IconButton label={t("Nouveau brouillon")} onClick={() => void create(t("Brouillon"))}>
          <Plus className="size-4" />
        </IconButton>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" icon={<History className="size-3.5" />} onClick={() => setHistory(true)}>
            {t("Historique")}
          </Button>
        </div>
      </div>
      {tools.data?.sandbox && (
        <ErrorNote title={t("Le bac à sable ne fonctionne pas")}>
          {tools.data.sandbox} {t("Le Playground n'exécute jamais de code hors du bac à sable : voir Réglages → Doctor.")}
        </ErrorNote>
      )}
      {drafts.isLoading ? (
        <Spinner />
      ) : current ? (
        <DraftView key={current.id} draft={current} tools={tools.data ?? null} onDefaults={setDefaults} onDuplicate={() => void create(`${current.title} (${t("copie")})`, current.files, current.settings)} />
      ) : (
        <EmptyState icon={<FileCode2 className="size-6" />} title={t("Aucun brouillon ouvert")} action={<Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => void create(t("Brouillon"))}>{t("Nouveau brouillon")}</Button>}>
          {t("Les brouillons fermés sont dans l'historique.")}
        </EmptyState>
      )}
      <HistoryDialog
        open={history}
        onClose={() => setHistory(false)}
        drafts={drafts.data ?? []}
        current={current?.id ?? null}
        onReopen={async (d) => {
          await api.playgroundSetOpen(d.id, true);
          await qc.invalidateQueries({ queryKey: ["playground"] });
          setActive(d.id);
          setHistory(false);
        }}
        onRestore={(title, files, settings) => {
          setHistory(false);
          void create(title, files, settings);
        }}
        onDelete={async (d) => {
          await api.playgroundDelete(d.id);
          forget(d.id);
        }}
      />
    </div>
  );
}

function DraftTab({ draft, on, onSelect, onClose }: { draft: Draft; on: boolean; onSelect: () => void; onClose: () => void }) {
  const dirty = usePlayground((s) => s.dirty[draft.id]);
  return (
    <div role="tab" aria-selected={on} className={cn("group flex h-8 shrink-0 items-center gap-1 rounded-md border pr-1 pl-2.5 text-sm transition-colors", on ? "border-line bg-surface text-fg" : "border-transparent text-muted hover:bg-hover hover:text-fg")}>
      <button type="button" className="max-w-48 truncate" onClick={onSelect} title={draft.title}>
        {draft.title}
      </button>
      {dirty && <span aria-label={t("Pas encore enregistré")} className="size-1.5 rounded-full bg-faint" />}
      <button type="button" aria-label={t("Fermer l'onglet")} onClick={onClose} className="flex size-5 items-center justify-center rounded text-faint opacity-60 hover:bg-hover hover:text-fg group-hover:opacity-100">
        <X className="size-3" />
      </button>
    </div>
  );
}

function DraftView({ draft, tools, onDefaults, onDuplicate }: { draft: Draft; tools: import("../../lib/api").PlaygroundTools | null; onDefaults: (s: DraftSettings) => void; onDuplicate: () => void }) {
  const { edit, file: files, setFile, job: jobs, setJob } = usePlayground();
  const toast = useUi((s) => s.toast);
  const openSheet = useUi((s) => s.openSheet);
  const openAssistant = useUi((s) => s.openAssistant);
  const ai = aiGate(useAiStatus().data);
  const jobId = jobs[draft.id] ?? null;
  const job = useJob(jobId);
  const running = job.data?.status === "running";
  const result = resultOf(job.data);
  const sorted = sortFiles(draft.files);
  const fileName = sorted.some((f) => f.name === files[draft.id]) ? files[draft.id] : (sorted[0]?.name ?? "main.c");
  const file = draft.files.find((f) => f.name === fileName) ?? sorted[0];
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [jump, setJump] = useState<{ line: number; col: number | null; nonce: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [options, setOptions] = useState(false);
  const [dialog, setDialog] = useState<"library" | "export" | "compare" | null>(null);
  const [starting, setStarting] = useState(false);
  const s = draft.settings;

  const update = (patch: Partial<Draft>) => edit({ ...draft, ...patch });
  const setSettings = (patch: Partial<DraftSettings>) => {
    const next = { ...s, ...patch };
    update({ settings: next });
    const { args: _a, stdin: _i, ...kept } = next;
    void _a;
    void _i;
    onDefaults({ ...DEFAULT_SETTINGS, ...kept });
  };
  const setContent = (content: string) => update({ files: draft.files.map((f) => (f.name === file.name ? { ...f, content } : f)) });

  const words = useMemo(() => {
    const all = new Set<string>();
    for (const f of draft.files) for (const w of identifiersOf(f.content)) all.add(w);
    return [...all];
  }, [draft.files]);

  const marks = useMemo(
    () => diagnosticsFor(file?.name ?? "", result.compile?.diagnostics ?? []).filter((d) => d.severity !== "note").map((d) => ({ line: d.line!, col: d.col, severity: d.severity === "error" ? ("error" as const) : ("warning" as const), message: d.flag ? `${d.message} [${d.flag}]` : d.message })),
    [file?.name, result.compile],
  );

  const compilers = (tools?.compilers ?? []).map((c) => ({ value: c.name as DraftSettings["compiler"], label: c.name, disabled: !c.path, hint: c.path ? (c.version?.split(" ").slice(0, 4).join(" ") ?? undefined) : t("non installé") }));
  const compilerMissing = tools ? !tools.compilers.some((c) => c.name === s.compiler && c.path) : false;
  const cannotRun = tools?.sandbox ? t("Bac à sable indisponible") : compilerMissing ? t("{c} n'est pas installé", { c: s.compiler }) : null;

  const run = async () => {
    if (running) return;
    if (cannotRun) {
      toast({ kind: "error", title: cannotRun });
      return;
    }
    setStarting(true);
    try {
      const id = await api.playgroundRun(draft.id, draft.title, draft.files, s);
      usePlayground.setState((st) => ({ dirty: { ...st.dirty, [draft.id]: false } }));
      setJob(draft.id, id);
    } catch (e) {
      toast({ kind: "error", title: t("Impossible de lancer"), detail: asAppError(e).message });
    } finally {
      setStarting(false);
    }
  };

  const onJump = (name: string, line: number, col: number | null) => {
    const target = draft.files.find((f) => f.name === name) ?? draft.files.find((f) => f.name.endsWith(`/${name}`));
    if (!target) return;
    setFile(draft.id, target.name);
    setJump({ line, col, nonce: Date.now() });
  };

  const addFile = (ext: ".c" | ".h") => {
    const name = nextFileName(draft.files, ext);
    update({ files: [...draft.files, { name, content: starterFor(name), library: null }] });
    setFile(draft.id, name);
    setRenaming(name);
  };

  const rename = (from: string, to: string) => {
    setRenaming(null);
    if (from === to) return;
    const err = fileNameError(to, draft.files, from);
    if (err) {
      toast({ kind: "error", title: err });
      return;
    }
    update({ files: draft.files.map((f) => (f.name === from ? { ...f, name: to } : f)) });
    setFile(draft.id, to);
  };

  const remove = (name: string) => {
    if (draft.files.length <= 1) return;
    update({ files: draft.files.filter((f) => f.name !== name) });
  };

  const importFiles = (incoming: DraftFile[]) => {
    const names = new Set(incoming.map((f) => f.name));
    update({ files: [...draft.files.filter((f) => !names.has(f.name)), ...incoming] });
    toast({ kind: "ok", title: t("{n} fichier(s) importé(s)", { n: incoming.length }), detail: t("Ils sont en lecture seule : le cadenas permet de les modifier dans ce brouillon.") });
  };

  const ask = (kind: ArtixAsk) => openAssistant({ text: artixRequest(kind, draft, result) });
  const askConcept = () => {
    const concept = window.prompt(t("Quelle notion veux-tu comprendre ?"), "");
    if (concept?.trim()) openAssistant({ text: artixRequest("concept", draft, result, concept.trim()) });
  };

  const locked = !!file?.library && !unlocked.has(file.name);
  const onKey = (e: KeyboardEvent) => {
    // The editor handles Ctrl+Enter itself (and marks the event): only the other fields land here.
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !e.defaultPrevented) {
      e.preventDefault();
      void run();
    }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(340px,38%)] gap-3" onKeyDown={onKey}>
      <section className="card flex min-h-0 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink/6 px-3 py-2">
          <TitleField value={draft.title} onChange={(title) => update({ title })} />
          <Select<DraftSettings["compiler"]> className="w-28" size="sm" label={t("Compilateur")} value={s.compiler} onChange={(compiler) => setSettings({ compiler })} options={compilers.length ? compilers : [{ value: s.compiler, label: s.compiler }]} />
          <Input className="h-7 w-44 font-mono text-xs" aria-label={t("Options de compilation")} value={s.flags} onChange={(e) => setSettings({ flags: e.target.value })} placeholder="-Wall -Wextra" />
          <Toggle on={s.asan} onChange={(asan) => setSettings({ asan })} title={t("AddressSanitizer : débordements, use-after-free, fuites")}>
            ASan
          </Toggle>
          <Toggle on={s.ubsan} onChange={(ubsan) => setSettings({ ubsan })} title={t("UndefinedBehaviorSanitizer : dépassements d'entiers, décalages, divisions par zéro")}>
            UBSan
          </Toggle>
          <Toggle on={s.valgrind} disabled={!tools?.valgrind} onChange={(valgrind) => setSettings({ valgrind, ...(valgrind ? { asan: false } : {}) })} title={tools?.valgrind ? t("Lancer sous Valgrind (memcheck)") : t("Valgrind n'est pas installé")}>
            Valgrind
          </Toggle>
          <IconButton label={t("Limites et entrées")} active={options} onClick={() => setOptions(!options)}>
            <Settings2 className="size-4" />
          </IconButton>
          <div className="ml-auto flex items-center gap-1.5">
            <Menu
              trigger={
                <Button size="sm" variant="ghost" icon={<Sparkles className="size-3.5" />} disabled={!ai.text} disabledReason={ai.why ?? undefined}>
                  Artix
                </Button>
              }
            >
              <MenuLabel>{t("Demander à Artix")}</MenuLabel>
              <MenuItem onSelect={() => ask("error")} disabled={!result.compile || result.compile.ok}>
                {t("Expliquer l'erreur de compilation")}
              </MenuItem>
              <MenuItem onSelect={() => ask("behavior")} disabled={!result.run}>
                {t("Expliquer le comportement")}
              </MenuItem>
              <MenuItem onSelect={() => ask("memory")} disabled={!result.run?.memory.length}>
                {t("Expliquer les problèmes mémoire")}
              </MenuItem>
              <MenuItem onSelect={() => ask("edge")}>{t("Proposer des cas limites")}</MenuItem>
              <MenuItem onSelect={() => ask("tests")}>{t("Générer un petit environnement de test")}</MenuItem>
              <MenuItem onSelect={() => ask("fix")} disabled={!result.compile}>
                {t("Suggérer une correction (sans l'appliquer)")}
              </MenuItem>
              <MenuItem onSelect={askConcept}>{t("Comprendre une notion…")}</MenuItem>
            </Menu>
            <Menu>
              <MenuItem icon={<LibraryBig className="size-3.5" />} onSelect={() => setDialog("library")}>
                {t("Importer depuis une bibliothèque…")}
              </MenuItem>
              <MenuItem icon={<FolderPlus className="size-3.5" />} onSelect={() => setDialog("export")}>
                {t("Exporter en projet…")}
              </MenuItem>
              <MenuItem icon={<GitCompare className="size-3.5" />} onSelect={() => setDialog("compare")}>
                {t("Comparer à une autre version…")}
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Copy className="size-3.5" />} onSelect={onDuplicate}>
                {t("Dupliquer le brouillon")}
              </MenuItem>
              <MenuItem icon={<Share2 className="size-3.5" />} onSelect={() => void flush(draft.id).then(() => useUi.getState().openShare({ kind: "draft", id: draft.id }))}>
                {t("Partager le brouillon (TekShare)…")}
              </MenuItem>
              {result.compile && !result.compile.ok && (
                <MenuItem icon={<Share2 className="size-3.5" />} onSelect={() => useUi.getState().openShare({ kind: "error", title: t("Erreur de compilation · {t}", { t: draft.title }), text: result.compile!.output })}>
                  {t("Partager l'erreur de compilation…")}
                </MenuItem>
              )}
            </Menu>
            {running ? (
              <Button size="sm" variant="danger" icon={<Square className="size-3.5" />} onClick={() => jobId !== null && void api.jobCancel(jobId)}>
                {t("Arrêter")}
              </Button>
            ) : (
              <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} busy={starting} disabled={!!cannotRun} disabledReason={cannotRun} onClick={() => void run()} title="Ctrl+Entrée">
                {t("Compiler et lancer")}
              </Button>
            )}
          </div>
        </div>
        {options && (
          <div className="grid grid-cols-[1fr_1fr_auto_auto] items-start gap-2 border-b border-ink/6 px-3 py-2">
            <label className="block">
              <span className="mb-1 block text-2xs text-faint">{t("Arguments du programme")}</span>
              <Input className="h-7 font-mono text-xs" value={s.args} onChange={(e) => update({ settings: { ...s, args: e.target.value } })} placeholder={'"un argument" deux 3'} />
            </label>
            <label className="block">
              <span className="mb-1 block text-2xs text-faint">{t("Entrée standard")}</span>
              <textarea spellCheck={false} className="field h-16 w-full resize-y border border-ink/8 px-2 py-1 font-mono text-xs text-fg" value={s.stdin} onChange={(e) => update({ settings: { ...s, stdin: e.target.value } })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-2xs text-faint">{t("Temps (s)")}</span>
              <Input type="number" min={1} max={120} className="h-7 w-20 text-xs" value={s.timeoutS} onChange={(e) => setSettings({ timeoutS: Math.min(120, Math.max(1, Number(e.target.value) || 10)) })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-2xs text-faint">{t("Mémoire (Mo)")}</span>
              <Input type="number" min={16} max={4096} className="h-7 w-24 text-xs" value={s.memMb} onChange={(e) => setSettings({ memMb: Math.min(4096, Math.max(16, Number(e.target.value) || 256)) })} />
            </label>
            {tools && !tools.cgroupLimits && <p className="col-span-4 text-2xs text-warn">{t("La limite mémoire passe par ulimit sur ce système : elle ne s'applique pas avec ASan ni Valgrind.")}</p>}
          </div>
        )}
        <div className="flex items-center gap-0.5 overflow-x-auto border-b border-ink/6 px-2">
          {sorted.map((f) => (
            <FileTab
              key={f.name}
              file={f}
              on={f.name === file?.name}
              errors={diagnosticsFor(f.name, result.compile?.diagnostics ?? []).filter((d) => d.severity === "error").length}
              renaming={renaming === f.name}
              onSelect={() => setFile(draft.id, f.name)}
              onRename={(to) => rename(f.name, to)}
              onStartRename={() => setRenaming(f.name)}
              onRemove={draft.files.length > 1 ? () => remove(f.name) : undefined}
            />
          ))}
          <Menu
            align="start"
            trigger={
              <IconButton label={t("Nouveau fichier")}>
                <FilePlus2 className="size-3.5" />
              </IconButton>
            }
          >
            <MenuItem onSelect={() => addFile(".c")}>{t("Fichier source (.c)")}</MenuItem>
            <MenuItem onSelect={() => addFile(".h")}>{t("En-tête (.h)")}</MenuItem>
          </Menu>
          {file?.library && (
            <button type="button" className="ml-auto flex items-center gap-1 px-2 text-2xs text-faint hover:text-fg" onClick={() => setUnlocked((u) => new Set(u).add(file.name))} disabled={!locked}>
              {locked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
              {locked ? t("Importé de {l} · lecture seule", { l: file.library }) : t("Importé de {l} · modifiable ici", { l: file.library })}
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1">
          <Suspense fallback={<Spinner className="m-4" />}>
            {file && <CodeEditor key={`${draft.id}:${file.name}`} value={file.content} onChange={setContent} readOnly={locked} marks={marks} words={words} onRun={() => void run()} jump={jump} className="h-full overflow-hidden" label={file.name} />}
          </Suspense>
        </div>
        <div className="flex items-center gap-3 border-t border-ink/6 px-3 py-1.5 text-2xs text-faint">
          <span>
            <Kbd>Ctrl</Kbd> <Kbd>{t("Entrée")}</Kbd> {t("compiler et lancer")}
          </span>
          <span>
            <Kbd>Ctrl</Kbd> <Kbd>{t("Espace")}</Kbd> {t("compléter")}
          </span>
          {s.args && <Badge mono>{t("args")} : {s.args}</Badge>}
          {s.stdin && <Badge>{t("stdin : {n} ligne(s)", { n: s.stdin.split("\n").filter(Boolean).length })}</Badge>}
          <span className="ml-auto">{t("Isolé · {s} s · {m} Mo", { s: s.timeoutS, m: s.memMb })}</span>
        </div>
      </section>
      <section className="card min-h-0 overflow-hidden">
        <Output job={job.data} onJump={onJump} />
      </section>
      <LibraryImportDialog open={dialog === "library"} onClose={() => setDialog(null)} onImport={importFiles} />
      {dialog === "compare" && <CompareDialog draft={draft} onClose={() => setDialog(null)} flush={flush} />}
      {dialog === "export" && (
        <ExportDialog
          open
          draft={draft}
          onClose={() => setDialog(null)}
          onDone={(path) => {
            setDialog(null);
            toast({ kind: "ok", title: t("Projet créé"), detail: path, action: { label: t("Ouvrir la fiche"), run: () => openSheet(path) } });
          }}
        />
      )}
    </div>
  );
}

function TitleField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (!editing)
    return (
      <button type="button" className="flex max-w-56 items-center gap-1.5 truncate text-sm font-medium text-fg hover:text-accent" onClick={() => setEditing(true)} title={t("Renommer")}>
        <span className="truncate">{value}</span>
        <Pencil className="size-3 shrink-0 text-faint" />
      </button>
    );
  return <Input autoFocus className="h-7 w-48 text-sm" defaultValue={value} onBlur={(e) => { onChange(e.target.value.trim() || value); setEditing(false); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }} />;
}

function Toggle({ on, onChange, disabled, title, children }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string; children: string }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} title={title} onClick={() => onChange(!on)} className={cn("h-7 rounded-md border px-2 font-mono text-2xs transition-colors disabled:cursor-not-allowed disabled:opacity-40", on ? "border-accent/50 bg-accent-soft text-accent-strong" : "border-ink/8 text-muted hover:text-fg")}>
      {children}
    </button>
  );
}

function FileTab({ file, on, errors, renaming, onSelect, onRename, onStartRename, onRemove }: { file: DraftFile; on: boolean; errors: number; renaming: boolean; onSelect: () => void; onRename: (to: string) => void; onStartRename: () => void; onRemove?: () => void }) {
  if (renaming)
    return <Input autoFocus className="my-1 h-6 w-40 font-mono text-xs" defaultValue={file.name} onBlur={(e) => onRename(e.target.value.trim())} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") onRename(file.name); }} />;
  return (
    <div className={cn("group -mb-px flex h-8 shrink-0 items-center gap-1 border-b-2 px-2 font-mono text-xs", on ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
      <button type="button" onClick={onSelect} onDoubleClick={file.library ? undefined : onStartRename} title={file.library ? t("Importé de {l}", { l: file.library }) : t("Double-clic pour renommer")}>
        {file.name}
      </button>
      {errors > 0 && <span className="rounded bg-danger/15 px-1 text-3xs text-danger">{errors}</span>}
      {onRemove && (
        <button type="button" aria-label={t("Supprimer {f}", { f: file.name })} onClick={() => { if (window.confirm(t("Supprimer {f} du brouillon ?", { f: file.name }))) onRemove(); }} className="text-faint opacity-0 group-hover:opacity-100 hover:text-danger">
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  );
}
