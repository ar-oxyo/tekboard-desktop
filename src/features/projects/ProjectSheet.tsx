// Project sheet: what you add to a repository — status, deadline, notes, build and run commands, subjects.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleCheck, CircleX, Code2, Hammer, Rocket } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "../../components/Modal";
import { Button, cn, ErrorNote, Field, Input, Spinner, Tag } from "../../components/ui";
import { api, asAppError, type ProjectSheet as Sheet, type RepoInfo, type SheetInput } from "../../lib/api";
import { tildify } from "../../lib/format";
import { keys, useHome, useNow, useProjectActions, useRepos, useSubjects } from "../../lib/hooks";
import { displayName, due, localTime, moduleOf } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { Countdown, ProgressPicker } from "./RepoBits";
import { AdvancedTab, GitTab, PlanOverview } from "./SheetPlan";
import { DocsTab, LibraryTab, TestingTab } from "./SheetTabs";

type Tab = "overview" | "details" | "git" | "library" | "testing" | "docs" | "advanced";
const TABS: Array<[Tab, string]> = [["overview", "Overview"], ["details", "Deadline & notes"], ["git", "Git"], ["library", "Library"], ["testing", "Testing"], ["docs", "Documentation"], ["advanced", "Advanced"]];

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

const toInput = (s: Sheet): SheetInput => ({ deadline: s.deadline, deadlineTime: localTime(s.deadlineAt) || null, buildCmd: s.buildCmd, notes: s.notes, runBin: s.runBin, runArgs: s.runArgs });

function SheetBody({ repo, initial }: { repo: RepoInfo; initial: Sheet }) {
  const qc = useQueryClient();
  const home = useHome();
  const now = useNow();
  const toast = useUi((s) => s.toast);
  const act = useProjectActions();
  const subjects = useSubjects();
  const [stored, setStored] = useState<Sheet>(initial);
  const [saved, setSaved] = useState<SheetInput>(() => toInput(initial));
  const [draft, setDraft] = useState<SheetInput>(() => toInput(initial));
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const [tab, setTab] = useState<Tab>("overview");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.repos });
    void qc.invalidateQueries({ queryKey: ["run-info", repo.path] });
  };
  const accept = (s: Sheet) => {
    setStored(s);
    setSaved(toInput(s));
    // Keep what is being typed in the notes; take the normalised values of the rest.
    setDraft((d) => ({ ...toInput(s), notes: d.notes }));
    qc.setQueryData(["sheet", repo.path], s);
    refresh();
  };
  const save = useMutation({
    mutationFn: (s: SheetInput) => api.projectSave(repo.path, s),
    onSuccess: (s, sent) => {
      setStored(s);
      setSaved({ ...toInput(s), notes: sent.notes });
      setDraft((d) => ({ ...toInput(s), notes: d.notes }));
      qc.setQueryData(["sheet", repo.path], s);
      refresh();
    },
    onError: (e) => toast({ kind: "error", title: "Not saved", detail: asAppError(e).message }),
  });
  // Ctrl+S saves; leaving the dialog with unsaved changes saves them too.
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
  const latestDraft = useLatest({ draft, saved });
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
  const build = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync(draft);
      return api.projectBuild(repo.path);
    },
    onSettled: () => {
      refresh();
      void qc.invalidateQueries({ queryKey: keys.activity });
    },
  });
  const runInfo = useQuery({ queryKey: ["run-info", repo.path], queryFn: () => api.projectRunInfo(repo.path), staleTime: 0 });
  const launch = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync(draft);
      return api.projectLaunch(repo.path);
    },
    onSuccess: (bin) => toast({ kind: "ok", title: `${bin} started in a terminal`, detail: "The window stays open when the program ends and shows its exit code." }),
  });
  const fromMy = useMutation({
    mutationFn: async () => {
      await api.projectDeadlineFromMy(repo.path);
      // Listing the repositories applies the MY Epitech date again.
      await qc.invalidateQueries({ queryKey: keys.repos });
      await qc.refetchQueries({ queryKey: keys.repos, exact: true });
      return api.projectGet(repo.path);
    },
    onSuccess: accept,
    onError: (e) => toast({ kind: "error", title: "Date not restored", detail: asAppError(e).message }),
  });
  const d = due(draft.deadline, draft.deadline && draft.deadlineTime ? `${draft.deadline}T${draft.deadlineTime}` : null, now);
  const linked = (subjects.data ?? []).filter((s) => s.repoPath === repo.path);
  const openSubject = useMutation({ mutationFn: (id: number) => api.subjectOpen(id), onError: (e) => toast({ kind: "error", title: "Could not open the document", detail: asAppError(e).message }) });
  const mod = moduleOf(repo);
  const my = repo.my;
  const differs = my?.deadline && stored.deadline && stored.deadlineSource === "manual" && (my.deadline !== stored.deadline || localTime(my.deadlineAt) !== localTime(stored.deadlineAt));
  const bin = runInfo.data;
  const binary = draft.runBin ?? bin?.detected ?? null;
  const source = !draft.deadline ? null : dirty && (draft.deadline !== saved.deadline || draft.deadlineTime !== saved.deadlineTime) ? "will be saved as typed by you" : stored.deadlineSource === "my" ? "from MY Epitech" : stored.deadlineSource === "manual" ? "typed by you" : null;
  const buildState = build.data && (
    <span className={cn("flex items-center gap-1.5 text-[13px]", build.data.code === 0 ? "text-ok" : "text-danger")}>
      {build.data.code === 0 ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
      {build.data.timedOut ? "Stopped after 5 minutes" : build.data.code === 0 ? "Build succeeded" : `Build failed (exit ${build.data.code ?? "?"})`}
      <span className="text-faint">· {(build.data.durationMs / 1000).toFixed(1)} s</span>
    </span>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ProgressPicker repo={repo} />
        {mod && <Tag title={my?.unitName ?? repo.kindReason}>{mod}</Tag>}
        {d.state !== "unknown" ? <Countdown tone={d.tone} title={source ?? undefined}>{d.label}</Countdown> : <button type="button" className="text-xs text-faint hover:text-fg" onClick={() => setTab("details")}>no deadline</button>}
        <span className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="primary" icon={<Code2 className="size-3.5" />} busy={act.workspace.isPending} onClick={() => act.workspace.mutate(repo)} title="Opens the IDE and a terminal in the project">
            Open IDE
          </Button>
          <Button size="sm" icon={<Hammer className="size-3.5" />} busy={build.isPending} onClick={() => build.mutate()} title={draft.buildCmd ? `Runs ${draft.buildCmd}` : "Runs make (set another command in Deadline & notes)"}>
            Build
          </Button>
          <Button
            size="sm"
            icon={<Rocket className="size-3.5" />}
            busy={launch.isPending}
            disabled={bin !== undefined && !bin.terminal}
            title={!bin ? undefined : !bin.terminal ? "No terminal is configured to run programs (Settings → Workspace)" : binary ? `Runs ./${binary}${draft.runArgs ? ` ${draft.runArgs}` : ""} in a terminal` : "Set the binary in Deadline & notes: TekBoard could not tell which program this project builds"}
            onClick={() => launch.mutate()}
          >
            Run
          </Button>
        </span>
      </div>
      <p className="selectable -mt-2 truncate font-mono text-xs text-faint">{tildify(repo.path, home)}</p>
      {(buildState || build.error || launch.error) && (
        <div className="-mt-1 flex flex-col gap-2">
          {buildState}
          {launch.error && <ErrorNote title="The program did not start">{asAppError(launch.error).message}</ErrorNote>}
          {build.error && <ErrorNote title="The build could not start">{asAppError(build.error).message}</ErrorNote>}
          {build.data && build.data.output.trim() !== "" && build.data.code !== 0 && (
            <pre className="selectable max-h-48 overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted">{build.data.output}</pre>
          )}
        </div>
      )}
      <div className="flex gap-5 border-b border-white/6">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={cn("-mb-px h-9 border-b-2 px-1 text-[13px] whitespace-nowrap transition-colors duration-150", tab === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && <PlanOverview repo={repo} />}
      {tab === "git" && <GitTab repo={repo} />}
      {tab === "advanced" && <AdvancedTab repo={repo} />}
      {tab === "library" && <LibraryTab repo={repo} />}
      {tab === "testing" && <TestingTab repo={repo} />}
      {tab === "docs" && <DocsTab repo={repo} subjects={linked} onOpenSubject={(id) => openSubject.mutate(id)} />}
      {tab === "details" && (
        <>
          <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start gap-3">
            <Field
              label="Deadline"
              hint={
                d.state === "unknown" ? (
                  my?.deadline ? "Not set" : "Not set — TekBoard never guesses a date"
                ) : (
                  <>
                    <span className={cn(d.tone === "danger" ? "text-danger" : d.tone === "warn" ? "text-warn" : "")}>{d.label}</span>
                    {source && <span> · {source}</span>}
                  </>
                )
              }
            >
              <span className="flex gap-2">
                <Input type="date" aria-label="Hand-in day" value={draft.deadline ?? ""} onChange={(e) => setDraft({ ...draft, deadline: e.target.value || null, deadlineTime: e.target.value ? draft.deadlineTime : null })} />
                <Input type="time" aria-label="Hand-in time (optional)" title="Optional. Without a time, the project is due until the end of that day." className="w-[128px]" disabled={!draft.deadline} value={draft.deadlineTime ?? ""} onChange={(e) => setDraft({ ...draft, deadlineTime: e.target.value || null })} />
              </span>
            </Field>
            <Field label="Build command" hint="Run directly in the project folder, without a shell.">
              <Input className="font-mono text-xs" placeholder="make" value={draft.buildCmd ?? ""} onChange={(e) => setDraft({ ...draft, buildCmd: e.target.value || null })} />
            </Field>
          </div>
          {differs && (
            <p className="-mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              MY Epitech says {my!.deadline}
              {localTime(my!.deadlineAt) && ` at ${localTime(my!.deadlineAt)}`} for “{my!.name}”. Your own date is kept.
              <Button size="sm" variant="ghost" busy={fromMy.isPending} onClick={() => fromMy.mutate()}>
                Use the MY Epitech date
              </Button>
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Binary to run" hint={bin?.detected ? `Detected: ${bin.detected} (${bin.detectedFrom}). Leave empty to use it.${bin && binary && !bin.exists && draft.runBin === saved.runBin ? " Not built yet." : ""}` : "Nothing detected (no plain NAME in the Makefile, no executable at the root)."}>
              <Input className="font-mono text-xs" placeholder={bin?.detected ?? "path/inside/the/project"} value={draft.runBin ?? ""} onChange={(e) => setDraft({ ...draft, runBin: e.target.value || null })} />
            </Field>
            <Field label="Arguments" hint={"Quotes group words. No pipes or redirections: the program is started without a shell."}>
              <Input className="font-mono text-xs" placeholder={'-n 3 "a file.txt"'} value={draft.runArgs ?? ""} onChange={(e) => setDraft({ ...draft, runArgs: e.target.value || null })} />
            </Field>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs text-muted">Notes</span>
              <span className="text-xs text-faint">{dirty ? "Unsaved — Ctrl+S" : "Saved"}</span>
            </div>
            <textarea
              spellCheck={false}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder={"Markdown. Useful commands, what broke and how you fixed it, TODO…"}
              className="h-36 w-full resize-y rounded-md border border-line bg-bg p-2.5 font-mono text-xs leading-relaxed text-fg placeholder:text-faint hover:border-line-strong focus:border-accent focus:outline-none"
            />
          </div>
          <div className="flex justify-end">
            <Button variant="primary" icon={<Check className="size-3.5" />} disabled={!dirty} busy={save.isPending} onClick={() => save.mutate(draft)}>
              Save
            </Button>
          </div>
        </>
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
