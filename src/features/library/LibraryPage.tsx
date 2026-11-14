// Library manager: browse the functions of a source library like a component catalog,
// tick what a project should hold, review the exact changes, apply.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { BookMarked, Check, ChevronDown, ChevronRight, FilePlus2, FolderOpen, FolderPlus, Hammer, Library as LibraryIcon, PackagePlus, Plus, Search, Trash2, TriangleAlert, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CodeView, DiffView } from "../../components/DiffView";
import { Select } from "../../components/Select";
import { Badge, Button, Card, CardTitle, cn, EmptyState, ErrorNote, IconButton, Input, PageHeader, Spinner } from "../../components/ui";
import { api, asAppError, type CatalogFile, type LibFileState, type LibPlanAction, type RunReport } from "../../lib/api";
import { tildify } from "../../lib/format";
import { useHome, useRepos } from "../../lib/hooks";
import { repoOptions } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { AddLibraryDialog, FileDetailDialog, ImportDialog } from "./LibraryDialogs";
import { buildRequest, counts, fileTitle, filterFiles, isEmptyRequest, isPresent, needsAttention, type StateFilter } from "./model";

const STATE_BADGE: Partial<Record<LibFileState, { tone: "ok" | "warn" | "info"; label: string; title: string }>> = {
  installed: { tone: "ok", label: "in project", title: "Same as the library" },
  update: { tone: "info", label: "update", title: "The library changed since this file was installed" },
  modified: { tone: "warn", label: "edited here", title: "You changed this copy in the project" },
  modified_update: { tone: "warn", label: "edited · update", title: "Changed in the project and in the library" },
  differs: { tone: "warn", label: "differs", title: "Present in the project, different from the library" },
};

const OP_TONE: Record<LibPlanAction["op"], "ok" | "warn" | "info" | "danger" | "neutral"> = { create: "ok", overwrite: "warn", edit: "info", delete: "danger", keep: "neutral" };

function useStored(key: string): [number | null, (v: number | null) => void] {
  const [value, setValue] = useState<number | null>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? Number(raw) : null;
    } catch {
      return null;
    }
  });
  return [
    value,
    (v) => {
      setValue(v);
      try {
        if (v === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, String(v));
      } catch {
        /* storage unavailable: the choice just is not remembered */
      }
    },
  ];
}

export function LibraryPage() {
  const qc = useQueryClient();
  const home = useHome();
  const toast = useUi((s) => s.toast);
  const repoPath = useUi((s) => s.libraryRepo);
  const setRepo = (p: string | null) => useUi.setState({ libraryRepo: p });
  const repos = useRepos();
  const libs = useQuery({ queryKey: ["libraries"], queryFn: api.libraryList });
  const [storedId, setLibId] = useStored("tekboard.library");
  const libId = libs.data?.some((l) => l.id === storedId) ? storedId : (libs.data?.[0]?.id ?? null);

  const catalog = useQuery({ queryKey: ["lib-catalog", libId], queryFn: () => api.libraryCatalog(libId!), enabled: libId !== null, staleTime: 0 });
  const status = useQuery({ queryKey: ["lib-status", libId, repoPath], queryFn: () => api.libraryProject(repoPath!, libId!), enabled: libId !== null && repoPath !== null, staleTime: 0 });
  const presets = useQuery({ queryKey: ["lib-presets", libId], queryFn: () => api.libraryPresets(libId!), enabled: libId !== null });

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [desired, setDesired] = useState<Set<string>>(new Set());
  const [replace, setReplace] = useState<Set<string>>(new Set());
  const [exclude, setExclude] = useState<Set<string>>(new Set());
  const [init, setInit] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState<string[] | null>(null);
  const [dropping, setDropping] = useState(false);
  const [build, setBuild] = useState<RunReport | null>(null);

  const states = useMemo(() => new Map((status.data?.files ?? []).map((f) => [f.rel, f.state])), [status.data]);
  const present = useMemo(() => new Set((status.data?.files ?? []).filter((f) => f.rel.endsWith(".c") && isPresent(f.state)).map((f) => f.rel)), [status.data]);

  // The boxes start as the project is: ticked = in the project.
  const resetKey = `${libId}|${repoPath}|${status.dataUpdatedAt}`;
  useEffect(() => {
    // `--pick` ticks files once, when the project's state first arrives.
    const pick = status.data ? useUi.getState().libraryPick : [];
    if (pick.length > 0) useUi.setState({ libraryPick: [] });
    setDesired(new Set([...present, ...pick]));
    setReplace(new Set());
    setExclude(new Set());
    setInit(false);
    setConfirmed(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Files dropped anywhere on this screen go to the import dialog.
  useEffect(() => {
    let off: (() => void) | undefined;
    let dead = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type === "enter" || e.payload.type === "over") setDropping(true);
        else if (e.payload.type === "leave") setDropping(false);
        else if (e.payload.type === "drop") {
          setDropping(false);
          if (e.payload.paths.length > 0) setImporting(e.payload.paths);
        }
      })
      .then((fn) => (dead ? fn() : (off = fn)), () => undefined);
    return () => {
      dead = true;
      off?.();
    };
  }, []);

  const files = catalog.data?.files ?? [];
  const sources = useMemo(() => files.filter((f) => !f.isHeader), [files]);
  const shown = useMemo(() => filterFiles(files, { query, category, tag, state: stateFilter }, states), [files, query, category, tag, stateFilter, states]);
  const libDir = status.data?.libDir ?? "";
  const request = useMemo(() => buildRequest(libDir, desired, present, replace, exclude, init), [libDir, desired, present, replace, exclude, init]);
  const hasProject = repoPath !== null && status.data !== undefined;
  const planOn = hasProject && !isEmptyRequest(request);
  const plan = useQuery({ queryKey: ["lib-plan", libId, repoPath, request], queryFn: () => api.libraryPlan(repoPath!, libId!, request), enabled: planOn, staleTime: 0 });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["lib-catalog", libId] });
    void qc.invalidateQueries({ queryKey: ["lib-status", libId] });
    void qc.invalidateQueries({ queryKey: ["lib-presets", libId] });
  };
  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });

  const apply = useMutation({
    mutationFn: () => api.libraryApply(repoPath!, libId!, request, [...confirmed]),
    onSuccess: (r) => {
      const parts = [r.written.length && `${r.written.length} written`, r.deleted.length && `${r.deleted.length} removed`, r.skipped.length && `${r.skipped.length} left untouched`].filter(Boolean);
      toast({ kind: r.skipped.length ? "info" : "ok", title: parts.length ? `Library: ${parts.join(", ")}` : "Nothing to change", detail: r.backupDir ? "Previous versions were saved and can be restored from each file." : undefined });
      setBuild(null);
      refresh();
      void qc.invalidateQueries({ queryKey: ["repos"] });
    },
    onError: fail("The library was not changed"),
  });
  const runBuild = useMutation({ mutationFn: () => api.libraryBuild(repoPath!, libDir), onSuccess: setBuild, onError: fail("Could not run make") });
  const saveDir = useMutation({ mutationFn: (dir: string) => api.libraryProject(repoPath!, libId!, dir), onSuccess: () => void qc.invalidateQueries({ queryKey: ["lib-status", libId] }), onError: fail("Invalid folder") });
  const savePreset = useMutation({ mutationFn: (name: string) => api.libraryPresetSave(libId!, name, [...desired].sort()), onSuccess: () => { toast({ kind: "ok", title: "Preset saved" }); void qc.invalidateQueries({ queryKey: ["lib-presets", libId] }); }, onError: fail("Preset not saved") });
  const dropPreset = useMutation({ mutationFn: (id: number) => api.libraryPresetDelete(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ["lib-presets", libId] }), onError: fail("Preset not deleted") });

  const toggle = (rel: string) => {
    const next = new Set(desired);
    if (next.has(rel)) next.delete(rel);
    else next.add(rel);
    setDesired(next);
  };
  const flip = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setter(next);
  };

  async function browse(directory: boolean) {
    const picked = await open(directory ? { directory: true, title: "Folder to add to the library" } : { multiple: true, title: "Files to add to the library", filters: [{ name: "C sources, headers, archives", extensions: ["c", "h", "zip", "tar", "gz", "tgz"] }] });
    const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
    if (paths.length > 0) setImporting(paths);
  }

  if (libs.isLoading) return <p className="flex items-center gap-2 py-16 text-muted"><Spinner /> Loading libraries…</p>;
  if (libs.error) return <ErrorNote>{asAppError(libs.error).message}</ErrorNote>;

  if ((libs.data?.length ?? 0) === 0 || libId === null) {
    return (
      <>
        <PageHeader title="Library" subtitle="Your reusable C code, installed function by function." />
        <Card>
          <EmptyState icon={<LibraryIcon className="size-6" />} title="No library yet" action={<Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Add a library</Button>}>
            A library is any folder of <code className="font-mono text-xs">.c</code> and <code className="font-mono text-xs">.h</code> files, organised the way you like. TekBoard reads it, lists its functions and their dependencies, and copies into a project only what you tick.
          </EmptyState>
        </Card>
        {adding && <AddLibraryDialog onClose={() => setAdding(false)} onAdded={(l) => { setLibId(l.id); void qc.invalidateQueries({ queryKey: ["libraries"] }); }} />}
      </>
    );
  }

  const lib = libs.data!.find((l) => l.id === libId)!;
  const cats = counts(sources.map((f) => f.category));
  const tags = counts(sources.flatMap((f) => [...new Set([...f.tags, ...f.autoTags])]));
  const attention = sources.filter((f) => needsAttention(states.get(f.rel))).length;
  const risky = (plan.data?.actions ?? []).filter((a) => a.risky);
  const real = (plan.data?.actions ?? []).filter((a) => a.op !== "keep");
  const kept = (plan.data?.actions ?? []).filter((a) => a.op === "keep" && !a.reason.startsWith("already"));
  const selectedRepo = repos.data?.find((r) => r.path === repoPath);

  return (
    <>
      <PageHeader
        title="Library"
        subtitle={<span className="selectable">{tildify(lib.path, home)} · {sources.length} files · {sources.reduce((n, f) => n + f.functions.length, 0)} functions</span>}
        actions={
          <>
            <Select className="w-44" label="Library" value={String(libId)} onChange={(v) => setLibId(Number(v))} options={libs.data!.map((l) => ({ value: String(l.id), label: l.name }))} />
            <IconButton label="Open the library folder" onClick={() => api.libraryReveal(libId).catch(fail("Could not open the folder"))}><FolderOpen className="size-4" /></IconButton>
            <Button icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Library</Button>
          </>
        }
      />

      {catalog.error && <div className="mb-4"><ErrorNote title="This library cannot be read">{asAppError(catalog.error).message}</ErrorNote></div>}

      <div className="grid grid-cols-[176px_minmax(0,1fr)_320px] items-start gap-4">
        {/* ── left: filters */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Folders</CardTitle>
            <ul className="py-1.5">
              <FilterRow label="Everything" count={sources.length} active={category === null} onClick={() => setCategory(null)} />
              {cats.map(([c, n]) => <FilterRow key={c} label={c === "" ? "(root)" : c} count={n} active={category === c} onClick={() => setCategory(c)} mono />)}
            </ul>
          </Card>
          {tags.length > 0 && (
            <Card>
              <CardTitle>Tags</CardTitle>
              <div className="flex flex-wrap gap-1.5 p-3">
                {tags.map(([t, n]) => (
                  <button key={t} type="button" onClick={() => setTag(tag === t ? null : t)} className={cn("h-6 rounded-full border px-2 text-[11px] transition-colors", tag === t ? "border-accent/40 bg-accent-soft text-accent-strong" : "border-line text-muted hover:border-line-strong hover:text-fg")}>
                    {t} <span className="text-faint">{n}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}
          <button
            type="button"
            onClick={() => void browse(false)}
            className={cn("flex flex-col items-center gap-1.5 rounded-xl border border-dashed px-3 py-4 text-center text-xs transition-colors", dropping ? "border-accent bg-accent-soft text-accent-strong" : "border-line-strong text-muted hover:border-accent/50 hover:text-fg")}
          >
            <Upload className="size-4" />
            <span className="font-medium">Drop files to your library</span>
            <span className="text-faint">.c, .h, folders, archives — or click to browse</span>
          </button>
          <Button size="sm" variant="ghost" icon={<FolderPlus className="size-3.5" />} onClick={() => void browse(true)}>Add a folder…</Button>
        </div>

        {/* ── centre: catalog */}
        <Card className="min-w-0">
          <div className="flex items-center gap-2 border-b border-white/6 p-2.5">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
              <Input autoFocus className="pl-8" aria-label="Search a function, a tag or a file" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <Select className="w-44" label="Filter by state" value={stateFilter} onChange={(v) => setStateFilter(v as StateFilter)} disabled={!hasProject} options={[{ value: "all", label: "All" }, { value: "in", label: "In the project" }, { value: "out", label: "Not installed" }, { value: "attention", label: "Needs attention", hint: attention ? String(attention) : undefined }]} />
          </div>
          {catalog.isLoading ? (
            <p className="flex items-center gap-2 px-4 py-10 text-[13px] text-muted"><Spinner /> Reading the library…</p>
          ) : shown.length === 0 ? (
            <EmptyState icon={<Search className="size-5" />} title={sources.length === 0 ? "This library has no source file" : "Nothing matches"}>
              {sources.length === 0 ? "Drop .c files on this window to add some." : "Try fewer words, or clear the folder and tag filters."}
            </EmptyState>
          ) : (
            <ul className="max-h-[calc(100vh-232px)] overflow-y-auto py-1">
              {shown.map((f) => <FileRow key={f.rel} file={f} state={states.get(f.rel)} checked={desired.has(f.rel)} replacing={replace.has(f.rel)} onToggle={() => toggle(f.rel)} onOpen={() => setDetail(f.rel)} onReplace={hasProject && needsAttention(states.get(f.rel)) ? () => flip(replace, setReplace, f.rel) : undefined} />)}
            </ul>
          )}
          {(catalog.data?.duplicates.length ?? 0) > 0 && (
            <p className="selectable border-t border-white/6 px-4 py-2 text-xs text-faint">
              Defined in several files: {catalog.data!.duplicates.map((d) => `${d.name} (${d.files.join(", ")})`).join(" · ")}. Dependencies on these are marked “assumed”.
            </p>
          )}
        </Card>

        {/* ── right: project and changes */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle right={status.isFetching ? <Spinner /> : undefined}>Project</CardTitle>
            <div className="flex flex-col gap-2.5 p-3">
              <Select label="Target project" search value={repoPath ?? ""} onChange={(v) => setRepo(v || null)} options={[{ value: "", label: "No project — browse only" }, ...repoOptions(repos.data ?? [])]} />
              {status.error && <ErrorNote>{asAppError(status.error).message}</ErrorNote>}
              {hasProject && (
                <>
                  <LibDirField value={libDir} busy={saveDir.isPending} onSave={(d) => saveDir.mutate(d)} />
                  {status.data!.exists ? (
                    <p className="text-xs text-muted">
                      <span className="text-fg">{present.size}</span> of {sources.length} files in the project
                      {attention > 0 && <> · <button type="button" className="text-warn hover:underline" onClick={() => setStateFilter("attention")}>{attention} need attention</button></>}
                      {status.data!.extra.length > 0 && <span title={status.data!.extra.join("\n")}> · {status.data!.extra.length} of your own</span>}
                    </p>
                  ) : (
                    <p className="text-xs text-muted">This project has no <code className="font-mono">{libDir}</code> yet.</p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {!status.data!.hasMakefile && <Button size="sm" variant={init ? "primary" : "secondary"} icon={<PackagePlus className="size-3.5" />} onClick={() => setInit(!init)}>{init ? "Empty library: planned" : "Create an empty library"}</Button>}
                    {status.data!.hasMakefile && <Button size="sm" icon={<Hammer className="size-3.5" />} busy={runBuild.isPending} onClick={() => runBuild.mutate()}>Check it compiles</Button>}
                    {selectedRepo && <Button size="sm" variant="ghost" onClick={() => useUi.getState().openSheet(selectedRepo.path)}>Project sheet</Button>}
                  </div>
                  {build && <BuildResult report={build} onClose={() => setBuild(null)} />}
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardTitle right={plan.isFetching ? <Spinner /> : undefined}>Changes</CardTitle>
            {!hasProject ? (
              <p className="px-4 py-4 text-[13px] text-muted">Choose a project to install functions into it. Without one, ticking only prepares a preset.</p>
            ) : !planOn ? (
              <p className="px-4 py-4 text-[13px] text-muted">Tick a function to add it, untick one to remove it. Nothing is written before you apply.</p>
            ) : plan.error ? (
              <div className="p-3"><ErrorNote>{asAppError(plan.error).message}</ErrorNote></div>
            ) : plan.data ? (
              <div className="flex flex-col">
                {plan.data.required.length > 0 && (
                  <div className="border-b border-white/6 px-3 py-2.5">
                    <p className="mb-1.5 text-xs text-muted">Required</p>
                    {plan.data.required.map((r) => (
                      <label key={r.rel} className="flex min-h-6 items-center gap-2 text-xs" title={`Needed by ${r.neededBy}${r.via.length ? ` (${r.via.join(", ")})` : ""}`}>
                        <input type="checkbox" className="accent-(--color-accent)" checked onChange={() => flip(exclude, setExclude, r.rel)} />
                        <span className="min-w-0 flex-1 truncate font-mono">{r.rel}</span>
                        <Badge tone={r.kind === "detected" ? "ok" : r.kind === "declared" ? "accent" : "warn"}>{r.kind === "ambiguous" ? "assumed" : r.kind}</Badge>
                      </label>
                    ))}
                  </div>
                )}
                {exclude.size > 0 && (
                  <div className="border-b border-white/6 px-3 py-2 text-xs text-warn">
                    Left out: {[...exclude].map((r) => <button key={r} type="button" className="mr-1.5 font-mono underline decoration-dotted" onClick={() => flip(exclude, setExclude, r)} title="Include again">{r}</button>)}
                  </div>
                )}
                <ul className="max-h-[38vh] overflow-y-auto py-1">
                  {real.length === 0 && <li className="px-4 py-3 text-xs text-muted">Nothing to write: the project already has these files.</li>}
                  {real.map((a) => <ActionRow key={a.path} action={a} confirmed={confirmed.has(a.path)} onConfirm={() => flip(confirmed, setConfirmed, a.path)} />)}
                </ul>
                {kept.length > 0 && (
                  <p className="border-t border-white/6 px-3 py-2 text-xs text-muted" title={kept.map((k) => `${k.path}: ${k.reason}`).join("\n")}>
                    {kept.length} file{kept.length > 1 ? "s" : ""} kept as you have {kept.length > 1 ? "them" : "it"} (not overwritten).
                  </p>
                )}
                {plan.data.warnings.map((w) => (
                  <p key={w} className="selectable flex gap-2 border-t border-white/6 px-3 py-2 text-xs text-warn"><TriangleAlert className="mt-px size-3.5 shrink-0" />{w}</p>
                ))}
                <div className="flex items-center justify-between gap-2 border-t border-white/6 p-3">
                  <span className="text-xs text-faint">{risky.length > 0 ? `${confirmed.size}/${risky.length} risky change${risky.length > 1 ? "s" : ""} confirmed` : "Existing files are saved first"}</span>
                  <Button variant="primary" icon={<Check className="size-3.5" />} busy={apply.isPending} disabled={real.length === 0 || plan.isFetching} onClick={() => apply.mutate()}>Apply</Button>
                </div>
              </div>
            ) : (
              <p className="flex items-center gap-2 px-4 py-4 text-[13px] text-muted"><Spinner /> Working out the changes…</p>
            )}
          </Card>

          <Card>
            <CardTitle>Presets</CardTitle>
            <div className="flex flex-col gap-1 p-2">
              {(presets.data ?? []).length === 0 && <p className="px-2 py-1.5 text-xs text-muted">Save the ticked functions as a group to reuse it in another project.</p>}
              {(presets.data ?? []).map((p) => (
                <div key={p.id} className="row-hover flex h-8 items-center gap-2 rounded-md pr-1 pl-2">
                  <BookMarked className="size-3.5 text-faint" />
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-[13px] hover:text-accent-strong" title="Tick these functions (keeps what is already ticked)" onClick={() => setDesired(new Set([...desired, ...p.files.filter((f) => sources.some((s) => s.rel === f))]))}>
                    {p.name} <span className="text-xs text-faint">{p.files.length}</span>
                  </button>
                  <IconButton label={`Delete preset ${p.name}`} onClick={() => dropPreset.mutate(p.id)}><Trash2 className="size-3.5" /></IconButton>
                </div>
              ))}
              <PresetSaver disabled={desired.size === 0} count={desired.size} busy={savePreset.isPending} onSave={(n) => savePreset.mutate(n)} />
            </div>
          </Card>
        </div>
      </div>

      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-black/55">
          <div className="glass flex flex-col items-center gap-2 border border-accent/50 px-10 py-8 text-center">
            <FilePlus2 className="size-8 text-accent-strong" />
            <p className="display text-lg font-medium">Drop files to your library</p>
            <p className="text-[13px] text-muted">Added to “{lib.name}” after you review them</p>
          </div>
        </div>
      )}
      {adding && <AddLibraryDialog onClose={() => setAdding(false)} onAdded={(l) => { setLibId(l.id); void qc.invalidateQueries({ queryKey: ["libraries"] }); }} />}
      {importing && <ImportDialog libraries={libs.data!} libraryId={libId} paths={importing} onClose={() => setImporting(null)} onImported={(id) => { setLibId(id); refresh(); void qc.invalidateQueries({ queryKey: ["lib-catalog"] }); }} />}
      {detail && catalog.data && <FileDetailDialog catalog={catalog.data} rel={detail} repo={hasProject ? repoPath : null} libDir={libDir} state={states.get(detail)} onClose={() => setDetail(null)} onChanged={refresh} onOpen={setDetail} />}
    </>
  );
}

function FilterRow({ label, count, active, onClick, mono }: { label: string; count: number; active: boolean; onClick: () => void; mono?: boolean }) {
  return (
    <li>
      <button type="button" onClick={onClick} className={cn("flex h-7 w-full items-center gap-2 px-3 text-left text-xs transition-colors", active ? "bg-accent-soft text-accent-strong" : "text-muted hover:bg-white/5 hover:text-fg")}>
        <span className={cn("min-w-0 flex-1 truncate", mono && "font-mono")}>{label}</span>
        <span className="text-faint">{count}</span>
      </button>
    </li>
  );
}

function FileRow({ file, state, checked, replacing, onToggle, onOpen, onReplace }: { file: CatalogFile; state: LibFileState | undefined; checked: boolean; replacing: boolean; onToggle: () => void; onOpen: () => void; onReplace?: () => void }) {
  const badge = state ? STATE_BADGE[state] : undefined;
  const more = file.functions.length - 1;
  return (
    <li className="row-hover flex items-start gap-3 px-3 py-2">
      <input type="checkbox" aria-label={`${fileTitle(file)} in the project`} className="mt-1 size-4 shrink-0 accent-(--color-accent)" checked={checked} onChange={onToggle} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          <span className="truncate font-mono text-[13px] font-medium text-fg">{fileTitle(file)}</span>
          {more > 0 && <span className="shrink-0 text-xs text-faint" title={file.functions.slice(1).map((f) => f.name).join(", ")}>+{more}</span>}
          {badge && <Badge tone={badge.tone} title={badge.title}>{badge.label}</Badge>}
          {replacing && <Badge tone="warn">will be replaced</Badge>}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[11.5px] text-muted">{file.functions[0]?.signature ?? file.rel}</span>
        {file.description && <span className="mt-0.5 block truncate text-xs text-muted">{file.description}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-faint">{file.rel}</span>
          {file.deps.length > 0 && <Badge title={file.deps.map((d) => `${d.rel}${d.via.length ? ` — ${d.via.join(", ")}` : ""} (${d.kind === "ambiguous" ? "assumed" : d.kind})`).join("\n")}>{file.deps.length} dep{file.deps.length > 1 ? "s" : ""}</Badge>}
          {[...file.tags, ...file.autoTags.filter((t) => !file.tags.includes(t))].slice(0, 3).map((t) => <span key={t} className="text-[11px] text-faint">#{t}</span>)}
          {file.parseErrors && <span className="text-[11px] text-warn" title="The parser did not understand every line (often a macro taking a type, like va_arg). The functions listed were still found.">partly parsed</span>}
        </span>
      </button>
      {onReplace && <Button size="sm" variant={replacing ? "secondary" : "ghost"} onClick={onReplace} title="Replace the project's copy with the library's version (asks before overwriting your edits)">{replacing ? "Keep mine" : "Use library"}</Button>}
    </li>
  );
}

function ActionRow({ action, confirmed, onConfirm }: { action: LibPlanAction; confirmed: boolean; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-3 py-1.5">
      <div className="flex items-center gap-2">
        <Badge tone={OP_TONE[action.op]}>{action.op}</Badge>
        <button type="button" disabled={!action.diff} onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-1 text-left font-mono text-xs disabled:cursor-default" title={action.reason}>
          {action.diff && (open ? <ChevronDown className="size-3 shrink-0 text-faint" /> : <ChevronRight className="size-3 shrink-0 text-faint" />)}
          <span className="truncate">{action.path}</span>
        </button>
      </div>
      <p className="mt-0.5 pl-1 text-[11px] text-faint">{action.reason}</p>
      {action.risky && (
        <label className="mt-1 flex items-center gap-2 rounded-md border border-warn/30 bg-warn/10 px-2 py-1 text-xs text-warn">
          <input type="checkbox" className="accent-(--color-warn)" checked={confirmed} onChange={onConfirm} />
          {action.op === "delete" ? "Yes, delete my edited copy" : "Yes, replace my edited copy"}
        </label>
      )}
      {open && action.diff && <DiffView text={action.diff} className="mt-1.5 max-h-64 rounded-md" />}
    </li>
  );
}

function LibDirField({ value, busy, onSave }: { value: string; busy: boolean; onSave: (dir: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() !== "" && draft.trim() !== value) onSave(draft.trim());
    setDraft(null);
  };
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="shrink-0">Folder in the project</span>
      <Input className="h-7 font-mono text-xs" value={draft ?? value} disabled={busy} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </label>
  );
}

function PresetSaver({ disabled, count, busy, onSave }: { disabled: boolean; count: number; busy: boolean; onSave: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <form className="mt-1 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onSave(name.trim()); setName(""); } }}>
      <Input className="h-7 text-xs" placeholder={disabled ? "Tick functions first" : `Name for these ${count}`} value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} />
      <Button size="sm" type="submit" busy={busy} disabled={disabled || !name.trim()}>Save</Button>
    </form>
  );
}

function BuildResult({ report, onClose }: { report: RunReport; onClose: () => void }) {
  const ok = report.code === 0;
  return (
    <div className={cn("rounded-md border", ok ? "border-ok/30 bg-ok/8" : "border-danger/30 bg-danger/8")}>
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
        <span className={ok ? "text-ok" : "text-danger"}>{report.timedOut ? "make timed out" : ok ? "make succeeded" : `make failed (exit ${report.code ?? "?"})`}</span>
        <span className="text-faint">{(report.durationMs / 1000).toFixed(1)} s</span>
        <IconButton label="Hide" className="ml-auto size-5" onClick={onClose}><X className="size-3" /></IconButton>
      </div>
      {(!ok || report.output.includes("warning")) && <CodeView text={report.output.trim() || "(no output)"} className="max-h-56 rounded-b-md" />}
    </div>
  );
}
