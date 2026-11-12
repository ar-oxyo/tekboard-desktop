// Git command center: the everyday operations, nothing destructive.
// No reset, no branch deletion, no force push exist in this screen or in the backend.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GitBranch, GitCommitHorizontal, Minus, Play, Plus, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Card, CardTitle, cn, EmptyState, ErrorNote, IconButton, Input, PageHeader, Select, Spinner } from "../../components/ui";
import { api, asAppError, type Change, type GitDetail, type RepoInfo } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { keys, useRepos, useSettings } from "../../lib/hooks";
import { attention, displayName, matchesQuery } from "../../lib/repos";
import { useUi } from "../../lib/store";

export function GitPage() {
  const settings = useSettings();
  const repos = useRepos((settings.data?.roots.length ?? 0) > 0);
  const selectedPath = useUi((s) => s.gitRepo);
  const openGit = useUi((s) => s.openGit);
  const [query, setQuery] = useState("");

  const list = useMemo(() => {
    const all = (repos.data ?? []).filter((r) => r.progress !== "done" && matchesQuery(r, query));
    // Repositories with something to do first; the scan order (latest commit) is kept inside each group.
    return [...all.filter((r) => attention(r).length > 0), ...all.filter((r) => attention(r).length === 0)];
  }, [repos.data, query]);
  const selected = (repos.data ?? []).find((r) => r.path === selectedPath) ?? list[0] ?? null;

  return (
    <>
      <PageHeader title="Git" subtitle="Commit, sync and branch. Nothing here can rewrite or delete history." />
      {repos.isLoading ? (
        <p className="flex items-center gap-2 py-16 text-muted">
          <Spinner /> Scanning…
        </p>
      ) : repos.error ? (
        <ErrorNote>{asAppError(repos.error).message}</ErrorNote>
      ) : (repos.data?.length ?? 0) === 0 ? (
        <Card>
          <EmptyState icon={<GitBranch className="size-6" />} title="No repository yet">
            Add a projects folder in Settings or clone a project first.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-[250px_minmax(0,1fr)] gap-4">
          <div>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
              <Input className="pl-8" placeholder="Filter…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <ul className="card max-h-[calc(100vh-200px)] overflow-y-auto py-1.5">
              {list.map((r) => {
                const a = attention(r);
                return (
                  <li key={r.path}>
                    <button
                      type="button"
                      onClick={() => openGit(r.path)}
                      aria-current={selected?.path === r.path}
                      className={cn("row-hover flex h-9 w-full items-center gap-2 px-3 text-left text-[13px]", selected?.path === r.path ? "bg-accent-soft text-fg" : "text-muted hover:text-fg")}
                    >
                      <span className={cn("size-1.5 shrink-0 rounded-full", a.length === 0 ? "bg-line-strong" : a[0].level === "danger" ? "bg-danger" : a[0].level === "warn" ? "bg-warn" : "bg-info")} />
                      <span className="min-w-0 flex-1 truncate">{displayName(r)}</span>
                      {a[0] && <span className="shrink-0 text-[11px] text-faint">{a[0].label}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          {selected && <RepoGit key={selected.path} repo={selected} />}
        </div>
      )}
    </>
  );
}

function RepoGit({ repo }: { repo: RepoInfo }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const detail = useQuery({ queryKey: ["git", repo.path], queryFn: () => api.gitDetail(repo.path), staleTime: 0 });
  const [file, setFile] = useState<{ path: string; staged: boolean; untracked: boolean } | null>(null);
  const [message, setMessage] = useState("");
  const [confirmPush, setConfirmPush] = useState(false);
  const [newBranch, setNewBranch] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["git", repo.path] });
    void qc.invalidateQueries({ queryKey: ["git-diff", repo.path] });
    void qc.invalidateQueries({ queryKey: keys.repos });
    void qc.invalidateQueries({ queryKey: keys.activity });
  };
  const fail = (title: string) => (e: unknown) => {
    toast({ kind: "error", title, detail: asAppError(e).message });
    refresh();
  };

  const stage = useMutation({ mutationFn: (files: string[]) => api.stageFiles(repo.path, files), onSuccess: refresh, onError: fail("Could not stage") });
  const unstage = useMutation({ mutationFn: (files: string[]) => api.gitUnstage(repo.path, files), onSuccess: refresh, onError: fail("Could not unstage") });
  const commit = useMutation({
    mutationFn: () => api.commitStaged(repo.path, message),
    onSuccess: () => {
      setMessage("");
      setFile(null);
      toast({ kind: "ok", title: "Committed locally" });
      refresh();
    },
    onError: fail("Commit failed"),
  });
  const sync = useMutation({
    mutationFn: (op: "fetch" | "pull" | "push") => api.gitSync(repo.path, op),
    onSuccess: (out, op) => {
      setConfirmPush(false);
      setOutput(out.trim() || null);
      toast({ kind: "ok", title: op === "fetch" ? "Fetched" : op === "pull" ? "Pulled" : "Pushed" });
      refresh();
    },
    onError: (e, op) => {
      setConfirmPush(false);
      const err = asAppError(e);
      setOutput(err.message);
      const hint = err.code === "diverged" ? (op === "push" ? "The remote has commits you do not have. Pull first." : "Your branch and the remote have diverged. Merge or rebase in a terminal.") : err.code === "auth_failed" ? "Authentication failed. Check your SSH key and agent." : err.code === "offline" ? "The remote could not be reached." : undefined;
      toast({ kind: "error", title: `${op[0].toUpperCase()}${op.slice(1)} failed`, detail: hint ?? err.message });
      refresh();
    },
  });
  const switchBranch = useMutation({ mutationFn: (name: string) => api.gitSwitchBranch(repo.path, name), onSuccess: refresh, onError: fail("Could not switch branch") });
  const createBranch = useMutation({
    mutationFn: (name: string) => api.gitCreateBranch(repo.path, name),
    onSuccess: () => {
      setNewBranch(null);
      refresh();
    },
    onError: fail("Could not create the branch"),
  });
  // Start working: get the remote state first, then open the workspace.
  const start = useMutation({
    mutationFn: async () => {
      if (repo.remoteUrl) await api.gitSync(repo.path, "fetch").catch(() => undefined);
      const d = await api.gitDetail(repo.path);
      await api.openWorkspace(repo.path);
      return d;
    },
    onSuccess: (d) => {
      if (d.status.behind > 0) toast({ kind: "info", title: `${d.status.behind} commit${d.status.behind === 1 ? "" : "s"} to pull`, detail: "The remote moved since your last sync." });
      refresh();
    },
    onError: fail("Could not open the workspace"),
  });

  if (detail.isLoading) {
    return (
      <p className="flex items-center gap-2 py-10 text-muted">
        <Spinner /> Reading the repository…
      </p>
    );
  }
  if (detail.error || !detail.data) return <ErrorNote title="Could not read this repository">{asAppError(detail.error).message}</ErrorNote>;

  const d: GitDetail = detail.data;
  const st = d.status;
  const staged = d.changes.filter((c) => c.staged !== null);
  const unstaged = d.changes.filter((c) => c.unstaged !== null || c.untracked || c.conflicted);
  const busy = sync.isPending;
  const canPush = !!repo.remoteUrl && st.branch !== null && !st.unborn && (st.upstream === null || st.ahead > 0);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <h2 className="display mr-1 truncate text-lg font-semibold">{displayName(repo)}</h2>
          {repo.epitech && (
            <Badge tone="accent" mono>
              {repo.epitech.module}
            </Badge>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" icon={<Play className="size-3.5" />} busy={start.isPending} title="Fetch, then open IDE and terminal" onClick={() => start.mutate()}>
              Start working
            </Button>
            <Button size="sm" icon={<RefreshCw className="size-3.5" />} disabled={!repo.remoteUrl || busy} busy={sync.isPending && sync.variables === "fetch"} onClick={() => sync.mutate("fetch")}>
              Fetch
            </Button>
            <Button size="sm" icon={<ArrowDown className="size-3.5" />} disabled={!st.upstream || st.behind === 0 || busy} busy={sync.isPending && sync.variables === "pull"} title="Fast-forward only: never creates a merge" onClick={() => sync.mutate("pull")}>
              Pull{st.behind > 0 ? ` ${st.behind}` : ""}
            </Button>
            <Button size="sm" title="Clone this repository into a fresh folder and build it there" disabled={busy} onClick={() => useUi.getState().openTesting(repo.path)}>
              TestRepo
            </Button>
            <Button size="sm" variant={canPush ? "primary" : "secondary"} icon={<ArrowUp className="size-3.5" />} disabled={!canPush || busy} onClick={() => setConfirmPush(true)}>
              Push{st.ahead > 0 ? ` ${st.ahead}` : ""}
            </Button>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-white/6 px-4 py-2.5">
          <GitBranch className="size-3.5 text-faint" />
          {st.branch === null ? (
            <span className="font-mono text-xs text-warn">detached HEAD</span>
          ) : (
            <Select className="h-7 w-52 font-mono text-xs" value={st.branch} aria-label="Branch" disabled={switchBranch.isPending || st.unborn} onChange={(e) => switchBranch.mutate(e.target.value)}>
              {!d.branches.some((b) => b.name === st.branch) && <option value={st.branch}>{st.branch}</option>}
              {d.branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
          {newBranch === null ? (
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} disabled={st.unborn} onClick={() => setNewBranch("")}>
              New branch
            </Button>
          ) : (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (newBranch.trim()) createBranch.mutate(newBranch);
              }}
            >
              <Input autoFocus className="h-7 w-44 font-mono text-xs" placeholder="feature/name" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNewBranch(null)} />
              <Button size="sm" type="submit" busy={createBranch.isPending} disabled={!newBranch.trim()}>
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNewBranch(null)}>
                Cancel
              </Button>
            </form>
          )}
          <span className="ml-auto text-xs text-faint">
            {!repo.remoteUrl ? "No remote" : st.upstream ? `tracks ${st.upstream}` : st.unborn ? "No commit yet" : "Not published yet"}
            {st.upstream && st.ahead === 0 && st.behind === 0 && " · in sync as of last fetch"}
          </span>
        </div>

        {confirmPush && (
          <div className="border-t border-white/6 bg-raised/50 px-4 py-3">
            <p className="text-[13px] font-medium">{st.upstream ? `Push ${d.outgoing.length} commit${d.outgoing.length === 1 ? "" : "s"} to ${st.upstream}?` : `Publish branch “${st.branch}” to origin?`}</p>
            <p className="mt-0.5 text-xs text-muted">A normal push: if the remote has newer commits it is refused, never forced.</p>
            {d.outgoing.length > 0 && (
              <ul className="mt-2 max-h-32 overflow-y-auto rounded-md border border-line bg-bg py-1">
                {d.outgoing.map((c) => (
                  <li key={c.hash} className="selectable flex h-6 items-center gap-2 px-2.5 text-xs">
                    <span className="font-mono text-faint">{c.hash.slice(0, 7)}</span>
                    <span className="truncate">{c.subject}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2.5 flex items-center gap-2">
              <Button size="sm" variant="primary" icon={<ArrowUp className="size-3.5" />} busy={sync.isPending} onClick={() => sync.mutate("push")}>
                Push
              </Button>
              <Button size="sm" variant="ghost" disabled={sync.isPending} onClick={() => setConfirmPush(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {output && (
          <pre className="selectable max-h-28 overflow-auto border-t border-white/6 bg-bg px-4 py-2 font-mono text-xs whitespace-pre-wrap text-muted" onDoubleClick={() => setOutput(null)}>
            {output}
          </pre>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <Card className="self-start">
          <ChangeList
            title="Staged"
            empty="Nothing staged"
            changes={staged}
            letter={(c) => c.staged ?? "?"}
            selected={file?.staged ? file.path : null}
            onSelect={(c) => setFile({ path: c.path, staged: true, untracked: false })}
            action={{ label: "Unstage", icon: <Minus className="size-3.5" />, run: (paths) => unstage.mutate(paths) }}
          />
          <div className="border-t border-white/6">
            <ChangeList
              title="Changes"
              empty="Working tree clean"
              changes={unstaged}
              letter={(c) => (c.conflicted ? "!" : c.untracked ? "?" : (c.unstaged ?? "?"))}
              selected={file && !file.staged ? file.path : null}
              onSelect={(c) => setFile({ path: c.path, staged: false, untracked: c.untracked })}
              action={{ label: "Stage", icon: <Plus className="size-3.5" />, run: (paths) => stage.mutate(paths) }}
            />
          </div>
          <form
            className="flex flex-col gap-2 border-t border-white/6 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (staged.length > 0 && message.trim()) commit.mutate();
            }}
          >
            <Input placeholder="Commit message" value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Commit message" />
            <Button type="submit" variant="primary" icon={<GitCommitHorizontal className="size-3.5" />} busy={commit.isPending} disabled={staged.length === 0 || !message.trim()}>
              Commit {staged.length > 0 ? `${staged.length} file${staged.length === 1 ? "" : "s"}` : ""}
            </Button>
            <p className="text-xs text-faint">Commits stay on this machine until you push.</p>
          </form>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          {file && <DiffCard repo={repo.path} file={file} />}
          <Card>
            <CardTitle right={d.incoming.length > 0 ? <Badge tone="info">{d.incoming.length} on the remote</Badge> : undefined}>History</CardTitle>
            {d.log.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">No commit yet.</p>
            ) : (
              <ul className="py-1">
                {d.log.map((c, i) => (
                  <li key={c.hash} className="flex h-8 items-center gap-2.5 px-4 text-[13px]" title={`${c.hash}\n${c.author}`}>
                    <span className={cn("size-1.5 shrink-0 rounded-full", i < st.ahead ? "bg-accent" : "bg-line-strong")} />
                    <span className="selectable shrink-0 font-mono text-xs text-faint">{c.hash.slice(0, 7)}</span>
                    <span className="selectable min-w-0 flex-1 truncate">{c.subject}</span>
                    {i < st.ahead && <Badge tone="accent">not pushed</Badge>}
                    <span className="hidden w-28 shrink-0 truncate text-right text-xs text-faint lg:block">{c.author}</span>
                    <span className="w-20 shrink-0 text-right text-xs text-faint">{timeAgo(c.date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

const LETTER_TONE: Record<string, string> = { M: "text-warn", A: "text-ok", D: "text-danger", R: "text-info", "?": "text-ok", "!": "text-danger" };

function ChangeList({ title, empty, changes, letter, selected, onSelect, action }: { title: string; empty: string; changes: Change[]; letter: (c: Change) => string; selected: string | null; onSelect: (c: Change) => void; action: { label: string; icon: React.ReactNode; run: (paths: string[]) => void } }) {
  return (
    <div>
      <div className="flex h-9 items-center justify-between px-3">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
          {title} <span className="ml-1 font-normal">{changes.length}</span>
        </span>
        {changes.length > 1 && (
          <Button size="sm" variant="ghost" onClick={() => action.run(changes.map((c) => c.path))}>
            {action.label} all
          </Button>
        )}
      </div>
      {changes.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-faint">{empty}</p>
      ) : (
        <ul className="max-h-56 overflow-y-auto pb-1">
          {changes.map((c) => (
            <li key={c.path} className={cn("group flex h-7 items-center gap-2 pr-1 pl-3", selected === c.path ? "bg-raised" : "hover:bg-hover")}>
              <span className={cn("w-3 shrink-0 text-center font-mono text-xs font-semibold", LETTER_TONE[letter(c)] ?? "text-muted")} title={c.conflicted ? "Conflict" : c.untracked ? "New file" : undefined}>
                {letter(c)}
              </span>
              <button type="button" onClick={() => onSelect(c)} className="min-w-0 flex-1 truncate text-left font-mono text-xs" title={c.path} dir="rtl">
                <bdi>{c.path}</bdi>
              </button>
              <IconButton label={`${action.label} ${c.path}`} className="size-6 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" onClick={() => action.run([c.path])}>
                {action.icon}
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DiffCard({ repo, file }: { repo: string; file: { path: string; staged: boolean; untracked: boolean } }) {
  const diff = useQuery({ queryKey: ["git-diff", repo, file.path, file.staged, file.untracked], queryFn: () => api.gitDiff(repo, file.path, file.staged, file.untracked), staleTime: 0 });
  return (
    <Card className="min-w-0">
      <CardTitle right={<span className="text-xs text-faint">{file.staged ? "staged" : file.untracked ? "new file" : "not staged"}</span>}>
        <span className="font-mono tracking-normal normal-case">{file.path}</span>
      </CardTitle>
      {diff.isLoading ? (
        <p className="flex items-center gap-2 px-4 py-4 text-xs text-muted">
          <Spinner /> Loading…
        </p>
      ) : diff.error ? (
        <div className="p-3">
          <ErrorNote>{asAppError(diff.error).message}</ErrorNote>
        </div>
      ) : (diff.data ?? "").trim() === "" ? (
        <p className="px-4 py-4 text-xs text-muted">No textual difference (mode change, or the change is on the other side: staged vs not staged).</p>
      ) : (
        <pre className="selectable max-h-[420px] overflow-auto bg-bg py-2 font-mono text-xs leading-[1.55]" style={{ tabSize: 4 }}>
          {diff.data!.split("\n").map((line, i) => (
            <div key={i} className={cn("px-4 whitespace-pre", line.startsWith("+") && !line.startsWith("+++") ? "bg-ok/10 text-ok" : line.startsWith("-") && !line.startsWith("---") ? "bg-danger/10 text-danger" : line.startsWith("@@") ? "text-info" : "text-muted")}>
              {line || " "}
            </div>
          ))}
        </pre>
      )}
    </Card>
  );
}
