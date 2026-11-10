// The other tabs of a project sheet: its libraries, its checks, its documents.
import { useQuery } from "@tanstack/react-query";
import { FileText, FlaskConical, GitBranch, LibraryBig, PackageOpen, ShieldCheck } from "lucide-react";
import { Badge, Button, Spinner } from "../../components/ui";
import { api, type RepoInfo, type RunKind } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { useUi } from "../../lib/store";
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE } from "../testing/Report";

export function LibraryTab({ repo }: { repo: RepoInfo }) {
  const openLibrary = useUi((s) => s.openLibrary);
  const libs = useQuery({ queryKey: ["libraries"], queryFn: api.libraryList });
  return (
    <div className="flex flex-col gap-3">
      {libs.isLoading ? <Spinner /> : (libs.data?.length ?? 0) === 0 ? (
        <p className="text-[13px] text-muted">No library is registered yet. Add one on the Library screen to install functions here one by one.</p>
      ) : (
        <ul className="rounded-lg border border-line bg-bg py-1">
          {libs.data!.map((l) => <LibRow key={l.id} repo={repo.path} id={l.id} name={l.name} />)}
        </ul>
      )}
      <div><Button variant="primary" icon={<LibraryBig className="size-3.5" />} onClick={() => openLibrary(repo.path)}>Add or manage functions</Button></div>
    </div>
  );
}

function LibRow({ repo, id, name }: { repo: string; id: number; name: string }) {
  const st = useQuery({ queryKey: ["lib-status", id, repo], queryFn: () => api.libraryProject(repo, id), staleTime: 0 });
  const src = (st.data?.files ?? []).filter((f) => f.rel.endsWith(".c"));
  const present = src.filter((f) => f.state !== "absent").length;
  const edited = src.filter((f) => f.state === "modified" || f.state === "modified_update" || f.state === "differs").length;
  const updates = src.filter((f) => f.state === "update" || f.state === "modified_update").length;
  return (
    <li className="flex min-h-9 items-center gap-2.5 px-3 text-[13px]">
      <span className="font-medium">{name}</span>
      {st.data && <span className="font-mono text-xs text-faint">{st.data.libDir}</span>}
      <span className="ml-auto flex items-center gap-1.5">
        {st.isLoading ? <Spinner /> : st.error ? <span className="text-xs text-danger">unreadable</span> : !st.data?.exists ? <span className="text-xs text-muted">not in this project</span> : (
          <>
            <Badge tone="ok">{present} of {src.length} files</Badge>
            {edited > 0 && <Badge tone="warn">{edited} edited here</Badge>}
            {updates > 0 && <Badge tone="info">{updates} update{updates > 1 ? "s" : ""}</Badge>}
          </>
        )}
      </span>
    </li>
  );
}

export function TestingTab({ repo }: { repo: RepoInfo }) {
  const openTesting = useUi((s) => s.openTesting);
  const runs = useQuery({ queryKey: ["runs", repo.path, "all"], queryFn: () => api.runsList(repo.path, null, 30), staleTime: 0 });
  // The most recent run of each kind: the project's current state at a glance.
  const latest = new Map<RunKind, NonNullable<typeof runs.data>[number]>();
  for (const r of runs.data ?? []) if (!latest.has(r.kind)) latest.set(r.kind, r);
  return (
    <div className="flex flex-col gap-3">
      {runs.isLoading ? <Spinner /> : latest.size === 0 ? (
        <p className="text-[13px] text-muted">Nothing was run on this project yet.</p>
      ) : (
        <ul className="rounded-lg border border-line bg-bg py-1">
          {[...latest.values()].map((r) => (
            <li key={r.id}>
              <button type="button" className="row-hover flex h-9 w-full items-center gap-2.5 px-3 text-left text-[13px]" onClick={() => { openTesting(repo.path); useUi.setState({ runId: r.id }); }}>
                <span className="w-36 shrink-0">{KIND_LABEL[r.kind] ?? r.kind}</span>
                <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                <span className="ml-auto text-xs text-faint">{timeAgo(r.startedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<FlaskConical className="size-3.5" />} onClick={() => openTesting(repo.path)}>Open the Testing center</Button>
        <span className="flex items-center gap-1.5 text-xs text-muted"><GitBranch className="size-3.5" />TestRepo · <ShieldCheck className="size-3.5" />Banana, pre-check and test generation are there</span>
      </div>
    </div>
  );
}

export function DocsTab({ repo, subjects, onOpenSubject }: { repo: RepoInfo; subjects: Array<{ id: number; name: string }>; onOpenSubject: (id: number) => void }) {
  const openTool = useUi((s) => s.openTool);
  const setPage = useUi((s) => s.setPage);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="mb-1 block text-xs font-medium text-muted">Subject</span>
        {subjects.length === 0 ? (
          <p className="text-[13px] text-muted">No subject is linked. <button type="button" className="text-accent-strong hover:underline" onClick={() => { useUi.getState().closeSheet(); setPage("subjects"); }}>Link one from the Subjects screen</button> to open it from here and let the pre-check read it.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {subjects.map((s) => <li key={s.id}><Button size="sm" icon={<FileText className="size-3.5" />} onClick={() => onOpenSubject(s.id)}>{s.name}</Button></li>)}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button icon={<FileText className="size-3.5" />} onClick={() => openTool("readme", repo.path)}>Generate README</Button>
        <Button icon={<PackageOpen className="size-3.5" />} onClick={() => openTool("package", repo.path)}>Package for AI</Button>
      </div>
      <p className="text-xs text-faint">The README is proposed, compared with the current one and written only when you validate. The archive is created on this computer and never sent anywhere.</p>
    </div>
  );
}
