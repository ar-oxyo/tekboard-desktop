// Project sheet: what you add to a repository — deadline, notes, build command, subjects.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleCheck, CircleX, FileText, Hammer, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "../../components/Modal";
import { Badge, Button, cn, ErrorNote, Field, Input, Spinner } from "../../components/ui";
import { api, asAppError, type ProjectSheet as Sheet, type RepoInfo } from "../../lib/api";
import { tildify } from "../../lib/format";
import { keys, useHome, useProjectActions, useRepos, useSubjects } from "../../lib/hooks";
import { daysLeft, deadlineLabel, displayName } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { BranchLabel, RepoActions, StatusChips } from "./RepoBits";

export function ProjectSheetDialog({ path }: { path: string }) {
  const close = useUi((s) => s.closeSheet);
  const repos = useRepos();
  const repo = repos.data?.find((r) => r.path === path);
  const sheet = useQuery({ queryKey: ["sheet", path], queryFn: () => api.projectGet(path), staleTime: 0 });

  if (!repo) {
    return (
      <Modal open onClose={close} title="Project" width="w-[720px]">
        {repos.isLoading ? <Spinner /> : <ErrorNote>This repository is no longer in your projects folders.</ErrorNote>}
      </Modal>
    );
  }
  return (
    <Modal open onClose={close} title={displayName(repo)} width="w-[760px]">
      {sheet.isLoading ? (
        <p className="flex items-center gap-2 py-8 text-muted">
          <Spinner /> Loading…
        </p>
      ) : sheet.error ? (
        <ErrorNote>{asAppError(sheet.error).message}</ErrorNote>
      ) : (
        <SheetBody repo={repo} initial={sheet.data!} />
      )}
    </Modal>
  );
}

function SheetBody({ repo, initial }: { repo: RepoInfo; initial: Sheet }) {
  const qc = useQueryClient();
  const home = useHome();
  const toast = useUi((s) => s.toast);
  const openGit = useUi((s) => s.openGit);
  const act = useProjectActions();
  const subjects = useSubjects();
  const [saved, setSaved] = useState<Sheet>(initial);
  const [draft, setDraft] = useState<Sheet>(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const save = useMutation({
    mutationFn: (s: Sheet) => api.projectSave(repo.path, s),
    onSuccess: (s) => {
      setSaved(s);
      setDraft((d) => ({ ...d, deadline: s.deadline, buildCmd: s.buildCmd }));
      qc.setQueryData(["sheet", repo.path], s);
      void qc.invalidateQueries({ queryKey: keys.repos });
    },
    onError: (e) => toast({ kind: "error", title: "Not saved", detail: asAppError(e).message }),
  });

  // Ctrl+S saves; leaving the dialog with unsaved notes saves them too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty) save.mutate(draft);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    return () => {
      const latest = latestDraft.current;
      if (latest && JSON.stringify(latest.draft) !== JSON.stringify(latest.saved)) {
        api.projectSave(repo.path, latest.draft).then(
          () => void qc.invalidateQueries({ queryKey: keys.repos }),
          () => undefined,
        );
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const latestDraft = useLatest({ draft, saved });

  const build = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync(draft);
      return api.projectBuild(repo.path);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.repos });
      void qc.invalidateQueries({ queryKey: keys.activity });
    },
  });

  const days = draft.deadline ? daysLeft(draft.deadline) : null;
  const linked = (subjects.data ?? []).filter((s) => s.repoPath === repo.path);
  const openSubject = useMutation({ mutationFn: (id: number) => api.subjectOpen(id), onError: (e) => toast({ kind: "error", title: "Could not open the document", detail: asAppError(e).message }) });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {repo.epitech && (
          <Badge tone="accent" mono>
            {repo.epitech.module}
          </Badge>
        )}
        <BranchLabel repo={repo} />
        <StatusChips repo={repo} max={3} />
        <span className="ml-auto flex items-center gap-1">
          <RepoActions repo={repo} />
          <Button size="sm" onClick={() => openGit(repo.path)}>
            Git
          </Button>
          <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} onClick={() => act.workspace.mutate(repo)}>
            Open workspace
          </Button>
        </span>
      </div>
      <p className="selectable -mt-2 truncate font-mono text-xs text-faint">{tildify(repo.path, home)}</p>

      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
        <Field label="Deadline" hint={days !== null ? <span className={cn(days < 0 ? "text-danger" : days <= 2 ? "text-warn" : "")}>{deadlineLabel(days)}</span> : "Not set"}>
          <Input type="date" value={draft.deadline ?? ""} onChange={(e) => setDraft({ ...draft, deadline: e.target.value || null })} />
        </Field>
        <Field label="Build command" hint="Run directly in the project folder, without a shell.">
          <Input className="font-mono text-xs" placeholder="make" value={draft.buildCmd ?? ""} onChange={(e) => setDraft({ ...draft, buildCmd: e.target.value || null })} />
        </Field>
        <label className="mb-[22px] flex h-8 items-center gap-2 text-[13px]" title="Finished projects leave the working lists. The repository is never touched.">
          <input type="checkbox" className="accent-(--color-accent)" checked={draft.archived} onChange={(e) => setDraft({ ...draft, archived: e.target.checked })} />
          Done
        </label>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-muted">Notes</span>
          <span className="text-xs text-faint">{dirty ? "Unsaved — Ctrl+S" : "Saved"}</span>
        </div>
        <textarea
          spellCheck={false}
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          placeholder={"Markdown. Useful commands, what broke and how you fixed it, TODO…"}
          className="h-40 w-full resize-y rounded-md border border-line bg-bg p-2.5 font-mono text-xs leading-relaxed text-fg placeholder:text-faint hover:border-line-strong focus:border-accent focus:outline-none"
        />
      </div>

      {linked.length > 0 && (
        <div>
          <span className="mb-1 block text-xs font-medium text-muted">Subjects</span>
          <ul className="flex flex-wrap gap-2">
            {linked.map((s) => (
              <li key={s.id}>
                <Button size="sm" icon={<FileText className="size-3.5" />} onClick={() => openSubject.mutate(s.id)}>
                  {s.name}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button icon={<Hammer className="size-3.5" />} busy={build.isPending} onClick={() => build.mutate()}>
          Build
        </Button>
        <Button variant="primary" icon={<Check className="size-3.5" />} disabled={!dirty} busy={save.isPending} onClick={() => save.mutate(draft)}>
          Save
        </Button>
        {build.data && (
          <span className={cn("ml-1 flex items-center gap-1.5 text-[13px]", build.data.code === 0 ? "text-ok" : "text-danger")}>
            {build.data.code === 0 ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
            {build.data.timedOut ? "Stopped after 5 minutes" : build.data.code === 0 ? "Build succeeded" : `Build failed (exit ${build.data.code ?? "?"})`}
            <span className="text-faint">· {(build.data.durationMs / 1000).toFixed(1)} s</span>
          </span>
        )}
      </div>
      {build.error && <ErrorNote title="The build could not start">{asAppError(build.error).message}</ErrorNote>}
      {build.data && build.data.output.trim() !== "" && (
        <pre className="selectable max-h-56 overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted">{build.data.output}</pre>
      )}
    </div>
  );
}

/** Always-current value readable from an unmount cleanup. */
function useLatest<T>(value: T) {
  const [ref] = useState<{ current: T }>({ current: value });
  ref.current = value;
  return ref;
}
