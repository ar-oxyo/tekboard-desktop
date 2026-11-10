// Dialogs of the Library screen: register a library, import dropped files, inspect one file.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { CodeView, DiffView } from "../../components/DiffView";
import { Modal } from "../../components/Modal";
import { Badge, Button, cn, ErrorNote, Field, Input, Select, Spinner } from "../../components/ui";
import { api, asAppError, type Catalog, type ImportCandidate, type LibFileState, type Library } from "../../lib/api";
import { formatBytes, tildify } from "../../lib/format";
import { useHome } from "../../lib/hooks";
import { useUi } from "../../lib/store";

// ───────────────────────────── add a library ─────────────────────────────

export function AddLibraryDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (lib: Library) => void }) {
  const home = useHome();
  const suggestions = useQuery({ queryKey: ["lib-suggestions"], queryFn: api.librarySuggestions, staleTime: 0 });
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [copy, setCopy] = useState(true);
  const add = useMutation({
    mutationFn: () => api.libraryAdd(name.trim(), path.trim(), copy),
    onSuccess: (lib) => {
      onAdded(lib);
      onClose();
    },
  });

  const pick = (p: string) => {
    setPath(p);
    if (!name.trim()) setName(p.includes("tekinit") ? "MyLib C" : (p.split("/").filter(Boolean).pop() ?? ""));
  };
  async function browse() {
    const dir = await open({ directory: true, title: "Folder that holds the library" });
    if (typeof dir === "string") pick(dir);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a library"
      description="Any folder of .c and .h files. Its layout is kept as it is."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={add.isPending} disabled={!path.trim() || !name.trim()} onClick={() => add.mutate()}>Add</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {(suggestions.data?.length ?? 0) > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Found on this computer</p>
            <ul className="rounded-lg border border-line bg-bg py-1">
              {suggestions.data!.map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => pick(s)} className={cn("flex h-8 w-full items-center px-3 text-left font-mono text-xs hover:bg-raised", path === s && "text-accent-strong")}>
                    {tildify(s, home)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Field label="Folder">
          <div className="flex gap-2">
            <Input className="font-mono" value={path} placeholder="/path/to/lib/my" onChange={(e) => setPath(e.target.value)} />
            <Button icon={<FolderOpen className="size-3.5" />} onClick={() => void browse()}>Browse…</Button>
          </div>
        </Field>
        <Field label="Name">
          <Input value={name} placeholder="MyLib C" onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-2 text-[13px]">
          <label className="flex items-start gap-2.5">
            <input type="radio" name="mode" className="mt-1 accent-(--color-accent)" checked={copy} onChange={() => setCopy(true)} />
            <span>
              Copy it into TekBoard <span className="text-muted">— recommended.</span>
              <span className="block text-xs text-muted">Only .c, .h and the Makefile are copied. The original folder is never written to; files you drop later go to the copy.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5">
            <input type="radio" name="mode" className="mt-1 accent-(--color-accent)" checked={!copy} onChange={() => setCopy(false)} />
            <span>
              Use this folder in place
              <span className="block text-xs text-muted">TekBoard reads it directly. Files you drop into the library are written there.</span>
            </span>
          </label>
        </div>
        {add.error && <ErrorNote>{asAppError(add.error).message}</ErrorNote>}
      </div>
    </Modal>
  );
}

// ───────────────────────────── import dropped files ─────────────────────────────

interface Row {
  on: boolean;
  dir: string;
  overwrite: boolean;
}

export function ImportDialog({ libraries, libraryId, paths, onClose, onImported }: { libraries: Library[]; libraryId: number; paths: string[]; onClose: () => void; onImported: (libraryId: number) => void }) {
  const toast = useUi((s) => s.toast);
  const [target, setTarget] = useState(libraryId);
  const analysis = useQuery({ queryKey: ["lib-import", target, paths], queryFn: () => api.libraryImportAnalyze(target, paths), staleTime: 0, gcTime: 0 });
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [header, setHeader] = useState<string>("");

  useEffect(() => {
    if (!analysis.data) return;
    setRows(Object.fromEntries(analysis.data.candidates.map((c) => [c.source, { on: true, dir: c.suggestedDir, overwrite: false }])));
    setHeader(analysis.data.headers.find((h) => !h.includes("list")) ?? analysis.data.headers[0] ?? "");
  }, [analysis.data]);

  const chosen = (analysis.data?.candidates ?? []).filter((c) => rows[c.source]?.on);
  const anyUndeclared = chosen.some((c) => c.undeclared.length > 0);
  const [declare, setDeclare] = useState(true);
  const run = useMutation({
    mutationFn: () => api.libraryImport(target, chosen.map((c) => ({ source: c.source, dir: rows[c.source].dir, overwrite: rows[c.source].overwrite })), declare && anyUndeclared && header ? header : null),
    onSuccess: (r) => {
      const bits = [r.imported.length && `${r.imported.length} added`, r.unchanged.length && `${r.unchanged.length} already there`, r.conflicts.length && `${r.conflicts.length} not replaced`].filter(Boolean).join(", ");
      toast({ kind: r.conflicts.length ? "info" : "ok", title: `Library: ${bits || "nothing imported"}`, detail: r.prototypesAdded.length ? `Prototypes added to ${r.header}: ${r.prototypesAdded.join(", ")}` : undefined });
      onImported(target);
      if (r.conflicts.length === 0) onClose();
    },
  });
  const set = (source: string, patch: Partial<Row>) => setRows({ ...rows, [source]: { ...rows[source], ...patch } });
  const lib = libraries.find((l) => l.id === target);

  return (
    <Modal
      open
      onClose={onClose}
      width="w-[760px]"
      title={`Import to ${lib?.name ?? "library"}`}
      description="Review what was found, choose where each file goes, then import."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={run.isPending} disabled={chosen.length === 0} onClick={() => run.mutate()}>Import {chosen.length || ""} file{chosen.length === 1 ? "" : "s"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {libraries.length > 1 && (
          <Field label="Library">
            <Select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              {libraries.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
        )}
        {analysis.isLoading && <p className="flex items-center gap-2 py-6 text-[13px] text-muted"><Spinner /> Reading the files…</p>}
        {analysis.error && <ErrorNote>{asAppError(analysis.error).message}</ErrorNote>}
        {analysis.data && analysis.data.candidates.length === 0 && <p className="py-4 text-[13px] text-muted">No .c or .h file was found in what you dropped.</p>}
        {analysis.data && analysis.data.candidates.length > 0 && (
          <ul className="flex flex-col gap-2">
            {analysis.data.candidates.map((c) => rows[c.source] && <CandidateRow key={c.source} c={c} row={rows[c.source]} dirs={analysis.data.dirs} existing={analysis.data.existing} onChange={(p) => set(c.source, p)} />)}
          </ul>
        )}
        {anyUndeclared && analysis.data && analysis.data.headers.length > 0 && (
          <label className="flex items-center gap-2.5 rounded-lg border border-line bg-bg px-3 py-2 text-[13px]">
            <input type="checkbox" className="accent-(--color-accent)" checked={declare} onChange={(e) => setDeclare(e.target.checked)} />
            <span className="flex-1">Add the prototypes of new functions to</span>
            <Select className="h-7 w-40 font-mono text-xs" value={header} onChange={(e) => setHeader(e.target.value)} disabled={!declare}>
              {analysis.data.headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </Select>
          </label>
        )}
        {(analysis.data?.ignored.length ?? 0) > 0 && (
          <p className="selectable text-xs text-faint">Ignored: {analysis.data!.ignored.join(" · ")}</p>
        )}
        {run.error && <ErrorNote>{asAppError(run.error).message}</ErrorNote>}
        {run.data && run.data.conflicts.length > 0 && <ErrorNote title="Not replaced">A different file already has this name: {run.data.conflicts.join(", ")}. Tick “replace” on these rows to overwrite (the old version is saved).</ErrorNote>}
      </div>
    </Modal>
  );
}

function CandidateRow({ c, row, dirs, existing, onChange }: { c: ImportCandidate; row: Row; dirs: string[]; existing: string[]; onChange: (p: Partial<Row>) => void }) {
  const [custom, setCustom] = useState(false);
  const dest = row.dir ? `${row.dir}/${c.name}` : c.name;
  const exists = existing.includes(dest);
  return (
    <li className={cn("rounded-lg border px-3 py-2.5", row.on ? "border-line bg-bg" : "border-line/50 opacity-60")}>
      <div className="flex items-center gap-2.5">
        <input type="checkbox" className="size-4 accent-(--color-accent)" checked={row.on} onChange={(e) => onChange({ on: e.target.checked })} aria-label={`Import ${c.name}`} />
        <span className="font-mono text-[13px] font-medium">{c.name}</span>
        {c.isHeader ? <Badge>header</Badge> : c.functions.length === 0 ? <Badge tone="warn" title="No exported function was found in this file">no function</Badge> : null}
        {exists && <Badge tone="warn" title="A file with this name is already at this place in the library">already exists</Badge>}
        {c.parseErrors && <Badge tone="warn" title="The parser did not understand every line; the functions listed were still found">partly parsed</Badge>}
      </div>
      {c.functions.length > 0 && (
        <p className="mt-1.5 text-xs text-muted">
          Detected {c.functions.length > 1 ? "functions" : "function"}:{" "}
          {c.functions.map((f) => <code key={f} className="mr-1.5 font-mono text-fg">{f}()</code>)}
          {c.staticFunctions.length > 0 && <span className="text-faint">+ {c.staticFunctions.length} static</span>}
        </p>
      )}
      {c.alreadyDefined.map((d) => (
        <p key={d.name} className="mt-1 text-xs text-warn">{d.name}() is already defined in {d.files.join(", ")}: the library would hold it twice.</p>
      ))}
      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        <span className="shrink-0">Destination</span>
        {custom ? (
          <Input autoFocus className="h-7 w-48 font-mono text-xs" value={row.dir} placeholder="new/folder" onChange={(e) => onChange({ dir: e.target.value.replace(/^\/+|\/+$/g, "") })} />
        ) : (
          <Select className="h-7 w-48 font-mono text-xs" value={row.dir} onChange={(e) => (e.target.value === "\0new" ? setCustom(true) : onChange({ dir: e.target.value }))}>
            {[...new Set([...dirs, row.dir])].map((d) => <option key={d} value={d}>{d === "" ? "(library root)" : `${d}/`}</option>)}
            <option value={"\0new"}>New folder…</option>
          </Select>
        )}
        <span className="min-w-0 flex-1 truncate text-faint" title={c.suggestionReason}>{row.dir === c.suggestedDir ? `Suggested: ${c.suggestionReason}` : ""}</span>
        {exists && (
          <label className="flex shrink-0 items-center gap-1.5 text-warn">
            <input type="checkbox" className="accent-(--color-warn)" checked={row.overwrite} onChange={(e) => onChange({ overwrite: e.target.checked })} />
            replace
          </label>
        )}
      </div>
    </li>
  );
}

// ───────────────────────────── one file ─────────────────────────────

type Tab = "code" | "diff" | "details" | "history";

export function FileDetailDialog({ catalog, rel, repo, libDir, state, onClose, onChanged, onOpen }: { catalog: Catalog; rel: string; repo: string | null; libDir: string; state: LibFileState | undefined; onClose: () => void; onChanged: () => void; onOpen: (rel: string) => void }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const file = catalog.files.find((f) => f.rel === rel);
  const inProject = repo !== null && state !== undefined && state !== "absent";
  const differs = inProject && state !== "installed";
  const [tab, setTab] = useState<Tab>("code");
  const source = useQuery({ queryKey: ["lib-source", catalog.library.id, rel, file?.hash], queryFn: () => api.libraryRead(catalog.library.id, rel) });
  const diff = useQuery({ queryKey: ["lib-diff", catalog.library.id, repo, libDir, rel], queryFn: () => api.libraryDiff(repo!, catalog.library.id, libDir, rel), enabled: tab === "diff" && inProject, staleTime: 0 });
  const path = `${libDir}/${rel}`;
  const backups = useQuery({ queryKey: ["lib-backups", repo, path], queryFn: () => api.libraryBackups(repo!, path), enabled: tab === "history" && repo !== null, staleTime: 0 });
  const restore = useMutation({
    mutationFn: (stamp: string) => api.libraryRestore(repo!, path, stamp),
    onSuccess: () => {
      toast({ kind: "ok", title: "Version restored", detail: "The file it replaced was saved too." });
      void qc.invalidateQueries({ queryKey: ["lib-backups", repo, path] });
      onChanged();
    },
    onError: (e) => toast({ kind: "error", title: "Not restored", detail: asAppError(e).message }),
  });

  const [description, setDescription] = useState(file?.description ?? "");
  const [tags, setTags] = useState((file?.tags ?? []).join(", "));
  const [deps, setDeps] = useState((file?.declaredDeps ?? []).join(", "));
  const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const saveMeta = useMutation({
    mutationFn: () => api.librarySetMeta(catalog.library.id, rel, { description: description.trim() || null, tags: split(tags), deps: split(deps) }),
    onSuccess: () => {
      toast({ kind: "ok", title: "Details saved" });
      onChanged();
    },
  });
  if (!file) return null;
  const usedBy = catalog.files.filter((f) => f.deps.some((d) => d.rel === rel));
  const tabs: Array<[Tab, string]> = [["code", "Code"], ...(differs ? ([["diff", "Diff with project"]] as Array<[Tab, string]>) : []), ["details", "Details"], ...(repo ? ([["history", "Saved versions"]] as Array<[Tab, string]>) : [])];

  return (
    <Modal open onClose={onClose} width="w-[820px]" title={file.functions[0]?.name ?? rel} description={rel}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {file.functions.map((f) => (
            <span key={f.name} className="selectable rounded-md border border-line bg-bg px-2 py-1 font-mono text-[11.5px]" title={f.doc ?? undefined}>
              {f.signature}
              {f.header ? <span className="text-faint"> · {f.header}</span> : <span className="text-warn"> · no prototype</span>}
            </span>
          ))}
        </div>
        {(file.deps.length > 0 || usedBy.length > 0) && (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="mb-1 font-medium text-muted">Needs</p>
              {file.deps.length === 0 ? <p className="text-faint">Nothing from this library.</p> : file.deps.map((d) => (
                <button key={d.rel} type="button" onClick={() => onOpen(d.rel)} className="flex w-full items-center gap-2 py-0.5 text-left hover:text-accent-strong">
                  <span className="truncate font-mono">{d.rel}</span>
                  <Badge tone={d.kind === "detected" ? "ok" : d.kind === "declared" ? "accent" : "warn"} title={d.kind === "detected" ? `The parser saw ${d.via.join(", ")} used here and one file defines it` : d.kind === "declared" ? "Declared by hand" : `${d.via.join(", ")} is defined in several files; this one is assumed`}>{d.kind === "ambiguous" ? "assumed" : d.kind}</Badge>
                </button>
              ))}
            </div>
            <div>
              <p className="mb-1 font-medium text-muted">Used by</p>
              {usedBy.length === 0 ? <p className="text-faint">No other file of this library.</p> : usedBy.slice(0, 8).map((u) => (
                <button key={u.rel} type="button" onClick={() => onOpen(u.rel)} className="block w-full truncate py-0.5 text-left font-mono hover:text-accent-strong">{u.rel}</button>
              ))}
              {usedBy.length > 8 && <p className="text-faint">and {usedBy.length - 8} more</p>}
            </div>
          </div>
        )}
        <div className="flex gap-1 border-b border-white/6">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={cn("-mb-px h-8 border-b-2 px-3 text-[13px] transition-colors", tab === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>{label}</button>
          ))}
        </div>
        {tab === "code" && (source.isLoading ? <p className="flex items-center gap-2 py-4 text-muted"><Spinner /> Reading…</p> : source.error ? <ErrorNote>{asAppError(source.error).message}</ErrorNote> : <CodeView numbered text={(source.data ?? "").replace(/\n$/, "")} className="max-h-[46vh] rounded-md" />)}
        {tab === "diff" && (diff.isLoading ? <p className="flex items-center gap-2 py-4 text-muted"><Spinner /> Comparing…</p> : diff.error ? <ErrorNote>{asAppError(diff.error).message}</ErrorNote> : (
          <>
            <p className="text-xs text-muted"><span className="text-danger">−</span> your project's copy · <span className="text-ok">+</span> the library's version</p>
            {(diff.data ?? "").trim() === "" ? <p className="py-3 text-[13px] text-muted">The two files are identical.</p> : <DiffView text={diff.data!} className="max-h-[42vh] rounded-md" />}
          </>
        ))}
        {tab === "details" && (
          <div className="flex flex-col gap-3">
            <Field label="Description" hint="Shown in the catalog and searched. Leave empty to use the comment found in the file.">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this does" />
            </Field>
            <Field label="Tags" hint={file.autoTags.length ? `Separated by commas. Guessed from the names: ${file.autoTags.join(", ")}.` : "Separated by commas."}>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="string, validation" />
            </Field>
            <Field label="Extra dependencies" hint="Files of this library to install with this one, when the parser cannot see the link (macros, function pointers set elsewhere). Paths separated by commas.">
              <Input className="font-mono" value={deps} onChange={(e) => setDeps(e.target.value)} placeholder="utils/my_strlen.c" />
            </Field>
            {saveMeta.error && <ErrorNote>{asAppError(saveMeta.error).message}</ErrorNote>}
            <div className="flex items-center justify-between">
              <span className="text-xs text-faint">{file.lines} lines · {file.staticFunctions.length} static function{file.staticFunctions.length === 1 ? "" : "s"} · includes {file.headers.join(", ") || "no library header"}</span>
              <Button variant="primary" busy={saveMeta.isPending} onClick={() => saveMeta.mutate()}>Save details</Button>
            </div>
          </div>
        )}
        {tab === "history" && (backups.isLoading ? <p className="flex items-center gap-2 py-4 text-muted"><Spinner /> Looking…</p> : (backups.data?.length ?? 0) === 0 ? (
          <p className="py-3 text-[13px] text-muted">No saved version of <code className="font-mono text-xs">{path}</code>. One is kept each time TekBoard replaces or removes this file.</p>
        ) : (
          <ul className="rounded-lg border border-line bg-bg py-1">
            {backups.data!.map((b) => (
              <li key={b.stamp} className="flex h-9 items-center gap-3 pr-2 pl-3">
                <span className="selectable flex-1 font-mono text-xs">{b.stamp.replace(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2}).*/, "$1-$2-$3 $4:$5:$6")}</span>
                <span className="text-xs text-faint">{formatBytes(b.size)}</span>
                <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} busy={restore.isPending && restore.variables === b.stamp} onClick={() => restore.mutate(b.stamp)}>Restore</Button>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </Modal>
  );
}
