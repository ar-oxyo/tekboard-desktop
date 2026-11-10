// Subjects library: PDF copies kept by TekBoard, linked to projects.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, FilePlus2, FileText, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardTitle, EmptyState, ErrorNote, IconButton, Input, PageHeader, Select, Spinner } from "../../components/ui";
import { api, asAppError, type RepoInfo, type Subject, type SubjectImportResult } from "../../lib/api";
import { formatBytes, tildify, timeAgo } from "../../lib/format";
import { keys, useHome, useRepos, useSettings, useSubjects } from "../../lib/hooks";
import { displayName } from "../../lib/repos";
import { useUi } from "../../lib/store";

export function SubjectsPage() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const settings = useSettings();
  const repos = useRepos((settings.data?.roots.length ?? 0) > 0);
  const subjects = useSubjects();
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);

  const repoList = repos.data ?? [];
  const list = subjects.data ?? [];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    const byPath = new Map(repoList.map((r) => [r.path, displayName(r).toLowerCase()]));
    return list.filter((s) => s.name.toLowerCase().includes(q) || (s.repoPath ? (byPath.get(s.repoPath) ?? "").includes(q) : false));
  }, [list, query, repoList]);

  const report = (results: SubjectImportResult[]) => {
    const added = results.filter((r) => r.subject && !r.duplicate).length;
    const dup = results.filter((r) => r.duplicate).length;
    const failed = results.filter((r) => r.error);
    void qc.invalidateQueries({ queryKey: keys.subjects });
    void qc.invalidateQueries({ queryKey: keys.activity });
    if (failed.length > 0) toast({ kind: "error", title: `${failed.length} file${failed.length === 1 ? "" : "s"} not imported`, detail: failed[0].error ?? undefined });
    if (added + dup > 0) toast({ kind: "ok", title: `${added} document${added === 1 ? "" : "s"} added`, detail: dup > 0 ? `${dup} already in the library (same content) — skipped.` : undefined });
  };

  async function addFiles() {
    const picked = await open({ multiple: true, title: "Add subjects", filters: [{ name: "PDF", extensions: ["pdf"] }] });
    const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    if (paths.length === 0) return;
    try {
      report(await api.subjectsImport(paths.map((path) => ({ path, repoPath: null }))));
    } catch (e) {
      toast({ kind: "error", title: "Import failed", detail: asAppError(e).message });
    }
  }

  return (
    <>
      <PageHeader
        title="Subjects"
        subtitle="Your subjects and course documents, kept in one place and linked to their project."
        actions={
          <>
            <Button icon={<FilePlus2 className="size-4" />} onClick={() => void addFiles()}>
              Add files…
            </Button>
            <Button variant="primary" icon={<Download className="size-4" />} onClick={() => setScanning(true)}>
              Import from Downloads
            </Button>
          </>
        }
      />

      {scanning && <ScanPanel repos={repoList} onClose={() => setScanning(false)} onImported={report} />}

      {subjects.isLoading ? (
        <p className="flex items-center gap-2 py-16 text-muted">
          <Spinner /> Loading…
        </p>
      ) : subjects.error ? (
        <ErrorNote>{asAppError(subjects.error).message}</ErrorNote>
      ) : list.length === 0 ? (
        !scanning && (
          <Card>
            <EmptyState icon={<FileText className="size-6" />} title="No subject yet" action={<Button onClick={() => setScanning(true)}>Import from Downloads</Button>}>
              TekBoard copies the PDFs you choose into its library and suggests the project each one belongs to. Your downloads are left where they are.
            </EmptyState>
          </Card>
        )
      ) : (
        <>
          <div className="relative mb-3 w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <Input className="pl-8" placeholder="Filter by name or project…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Card>
            {shown.length === 0 ? (
              <EmptyState title="Nothing matches">Try another search.</EmptyState>
            ) : (
              <ul>
                {shown.map((s) => (
                  <SubjectRow key={s.id} subject={s} repos={repoList} />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function ProjectSelect({ value, repos, onChange, className }: { value: string | null; repos: RepoInfo[]; onChange: (path: string | null) => void; className?: string }) {
  return (
    <Select className={className} value={value ?? ""} aria-label="Project" onChange={(e) => onChange(e.target.value || null)}>
      <option value="">No project</option>
      {repos.map((r) => (
        <option key={r.path} value={r.path}>
          {displayName(r)}
        </option>
      ))}
    </Select>
  );
}

function SubjectRow({ subject, repos }: { subject: Subject; repos: RepoInfo[] }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [armed, setArmed] = useState(false);
  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.subjects });
  const openDoc = useMutation({ mutationFn: () => api.subjectOpen(subject.id), onError: fail("Could not open the document") });
  const link = useMutation({ mutationFn: (path: string | null) => api.subjectLink(subject.id, path), onSuccess: refresh, onError: fail("Could not link") });
  const remove = useMutation({ mutationFn: () => api.subjectRemove(subject.id), onSuccess: refresh, onError: fail("Could not remove") });
  const missing = subject.repoPath !== null && !repos.some((r) => r.path === subject.repoPath);

  return (
    <li className="group flex h-12 items-center gap-3 border-b border-white/6 pr-2 pl-4 last:border-b-0 row-hover">
      <FileText className="size-4 shrink-0 text-faint" />
      <button type="button" onClick={() => openDoc.mutate()} className="selectable min-w-0 flex-[2] truncate text-left text-[13px] font-medium hover:text-accent-strong" title="Open">
        {subject.name}
      </button>
      {missing && <Badge tone="warn" title="The linked repository is no longer in your projects folders">project missing</Badge>}
      <ProjectSelect className="w-52 shrink-0" value={missing ? null : subject.repoPath} repos={repos} onChange={(p) => link.mutate(p)} />
      <span className="hidden w-16 shrink-0 text-right text-xs text-faint md:block">{formatBytes(subject.size)}</span>
      <span className="hidden w-24 shrink-0 text-right text-xs text-faint lg:block">{timeAgo(subject.addedAt)}</span>
      {armed ? (
        <span className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="danger" busy={remove.isPending} onClick={() => remove.mutate()}>
            Remove copy
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>
            Keep
          </Button>
        </span>
      ) : (
        <IconButton label="Remove from the library" className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" onClick={() => setArmed(true)}>
          <Trash2 className="size-4" />
        </IconButton>
      )}
    </li>
  );
}

function ScanPanel({ repos, onClose, onImported }: { repos: RepoInfo[]; onClose: () => void; onImported: (r: SubjectImportResult[]) => void }) {
  const home = useHome();
  const scan = useQuery({ queryKey: ["subjects-scan"], queryFn: () => api.subjectsScan(), staleTime: 0, gcTime: 0 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [links, setLinks] = useState<Record<string, string | null>>({});
  const [ready, setReady] = useState(false);

  const files = useMemo(() => (scan.data?.files ?? []).filter((f) => !f.inLibrary), [scan.data]);
  const already = (scan.data?.files.length ?? 0) - files.length;

  // Pre-tick only the documents a project was found for; the rest stay opt-in.
  useEffect(() => {
    if (!scan.data || ready) return;
    setPicked(new Set(files.filter((f) => f.suggestedRepo).map((f) => f.path)));
    setLinks(Object.fromEntries(files.map((f) => [f.path, f.suggestedRepo])));
    setReady(true);
  }, [scan.data, files, ready]);

  const run = useMutation({
    mutationFn: () => api.subjectsImport(files.filter((f) => picked.has(f.path)).map((f) => ({ path: f.path, repoPath: links[f.path] ?? null }))),
    onSuccess: (results) => {
      onImported(results);
      onClose();
    },
  });

  const toggle = (path: string) => {
    const next = new Set(picked);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setPicked(next);
  };

  return (
    <Card className="mb-4">
      <CardTitle
        right={
          <span className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={picked.size === 0} busy={run.isPending} onClick={() => run.mutate()}>
              Import {picked.size || ""}
            </Button>
          </span>
        }
      >
        {scan.data ? `PDFs in ${tildify(scan.data.dir, home)}` : "Downloads"}
      </CardTitle>
      {scan.isLoading ? (
        <p className="flex items-center gap-2 px-4 py-5 text-[13px] text-muted">
          <Spinner /> Looking at your downloads…
        </p>
      ) : scan.error ? (
        <div className="p-3">
          <ErrorNote>{asAppError(scan.error).message}</ErrorNote>
        </div>
      ) : files.length === 0 ? (
        <p className="px-4 py-5 text-[13px] text-muted">{already > 0 ? "Every PDF in this folder is already in the library." : "No PDF in this folder."}</p>
      ) : (
        <>
          <p className="border-b border-white/6 px-4 py-2 text-xs text-faint">
            Files are copied, never moved. Ticked ones matched a project by name — check the suggestion before importing.
            {already > 0 && ` ${already} already in the library ${already === 1 ? "is" : "are"} hidden.`}
          </p>
          <ul className="max-h-[340px] overflow-y-auto py-1">
            {files.map((f) => (
              <li key={f.path} className="flex h-10 items-center gap-3 px-4 row-hover">
                <input type="checkbox" className="accent-(--color-accent)" aria-label={`Import ${f.name}`} checked={picked.has(f.path)} onChange={() => toggle(f.path)} />
                <span className="selectable min-w-0 flex-[2] truncate text-[13px]">{f.name}</span>
                {f.suggestedRepo && links[f.path] === f.suggestedRepo && <Badge tone="accent">suggested</Badge>}
                <ProjectSelect className="w-52 shrink-0" value={links[f.path] ?? null} repos={repos} onChange={(p) => setLinks({ ...links, [f.path]: p })} />
                <span className="hidden w-16 shrink-0 text-right text-xs text-faint md:block">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {run.error && (
        <div className="p-3">
          <ErrorNote>{asAppError(run.error).message}</ErrorNote>
        </div>
      )}
    </Card>
  );
}
