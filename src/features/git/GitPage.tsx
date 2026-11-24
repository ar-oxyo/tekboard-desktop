// Git command center: the everyday operations, nothing destructive.
// No reset, no branch deletion, no force push exist in this screen or in the backend.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GitBranch, GitCommitHorizontal, Minus, Play, Plus, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Select } from "../../components/Select";
import { Button, Card, CardTitle, cn, Dot, EmptyState, ErrorNote, IconButton, Input, PageHeader, SectionLabel, Spinner, Tag } from "../../components/ui";
import { api, asAppError, type Change, type GitDetail, type RepoInfo } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { keys, useRepos, useSettings } from "../../lib/hooks";
import { attention, displayName, matchesQuery } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { t } from "../../lib/i18n";

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
      <PageHeader title="Git" subtitle={t("Commiter, synchroniser, brancher. Rien ici ne peut réécrire ni effacer l'historique.")} />
      {repos.isLoading ? (
        <p className="flex items-center gap-2 py-16 text-muted">
          <Spinner /> {t("Lecture…")}
        </p>
      ) : repos.error ? (
        <ErrorNote>{asAppError(repos.error).message}</ErrorNote>
      ) : (repos.data?.length ?? 0) === 0 ? (
        <Card>
          <EmptyState icon={<GitBranch className="size-6" />} title={t("Aucun dépôt")}>
            Ajoute d'abord un dossier de projets dans Réglages, ou clone un projet.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-[264px_minmax(0,1fr)] items-start gap-4">
          <div>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
              <Input className="pl-8" aria-label={t("Filtrer les dépôts")} placeholder="Filtrer" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <ul className="card flex max-h-[calc(100vh-196px)] flex-col gap-0.5 overflow-y-auto p-1.5">
              {list.map((r) => {
                const a = attention(r);
                return (
                  <li key={r.path}>
                    <button
                      type="button"
                      onClick={() => openGit(r.path)}
                      aria-current={selected?.path === r.path}
                      className={cn("flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors duration-150", selected?.path === r.path ? "bg-raised text-fg" : "text-muted hover:bg-white/4 hover:text-fg")}
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
      toast({ kind: "ok", title: t("Commité localement") });
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
      if (d.status.behind > 0) toast({ kind: "info", title: `${d.status.behind} commit${d.status.behind === 1 ? "" : "s"} à récupérer`, detail: "Le dépôt distant a bougé depuis ta dernière synchronisation." });
      refresh();
    },
    onError: fail("Could not open the workspace"),
  });

  if (detail.isLoading) {
    return (
      <p className="flex items-center gap-2 py-10 text-muted">
        <Spinner /> Lecture du dépôt…
      </p>
    );
  }
  if (detail.error || !detail.data) return <ErrorNote title={t("Impossible de lire ce dépôt")}>{asAppError(detail.error).message}</ErrorNote>;

  const d: GitDetail = detail.data;
  const st = d.status;
  const staged = d.changes.filter((c) => c.staged !== null);
  const unstaged = d.changes.filter((c) => c.unstaged !== null || c.untracked || c.conflicted);
  const busy = sync.isPending;
  // The usual author is in each row's tooltip; only someone else's name is written out.
  const authors = new Map<string, number>();
  for (const c of d.log) authors.set(c.author, (authors.get(c.author) ?? 0) + 1);
  const mainAuthor = [...authors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const canPush = !!repo.remoteUrl && st.branch !== null && !st.unborn && (st.upstream === null || st.ahead > 0);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-2 px-4 py-3">
          <h2 className="display truncate text-base font-medium">{displayName(repo)}</h2>
          {repo.epitech && <Tag>{repo.epitech.module}</Tag>}
          <span className="ml-auto flex flex-wrap items-center gap-2 self-center">
            <Button size="sm" variant="ghost" icon={<Play className="size-3.5" />} busy={start.isPending} title={t("Récupère, puis ouvre l'IDE et le terminal")} onClick={() => start.mutate()}>
              Se mettre au travail
            </Button>
            <Button size="sm" icon={<RefreshCw className="size-3.5" />} disabled={!repo.remoteUrl || busy} disabledReason={!repo.remoteUrl ? "Ce dépôt n'a pas de dépôt distant (origin)" : "Une opération git est en cours"} busy={sync.isPending && sync.variables === "fetch"} onClick={() => sync.mutate("fetch")}>
              Récupérer
            </Button>
            <Button size="sm" icon={<ArrowDown className="size-3.5" />} disabled={!st.upstream || st.behind === 0 || busy} disabledReason={!st.upstream ? "La branche ne suit aucune branche distante" : st.behind === 0 ? "Rien à récupérer : tu es à jour" : "Une opération git est en cours"} busy={sync.isPending && sync.variables === "pull"} title="Avance rapide seulement : ne crée jamais de fusion" onClick={() => sync.mutate("pull")}>
              Pull{st.behind > 0 ? ` ${st.behind}` : ""}
            </Button>
            <Button size="sm" title={t("Ouvrir les tests de ce projet (moulinette, tests, simulation de rendu)")} onClick={() => useUi.getState().openTesting(repo.path)}>
              Tests
            </Button>
            <Button size="sm" variant={canPush ? "primary" : "secondary"} icon={<ArrowUp className="size-3.5" />} disabled={!canPush || busy} disabledReason={busy ? "Une opération git est en cours" : st.ahead === 0 ? "Aucun commit à envoyer" : "Impossible d'envoyer depuis cet état (branche sans suivi ou en retard)"} onClick={() => setConfirmPush(true)}>
              Envoyer{st.ahead > 0 ? ` ${st.ahead}` : ""}
            </Button>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-white/6 px-4 py-2.5">
          <GitBranch className="size-3.5 text-faint" />
          {st.branch === null ? (
            <span className="font-mono text-xs text-warn">detached HEAD</span>
          ) : (
            <Select
              size="sm"
              mono
              className="w-52"
              label="Branche"
              value={st.branch}
              disabled={switchBranch.isPending || st.unborn}
              disabledReason={st.unborn ? "Aucun commit encore : fais un premier commit pour créer la branche" : "Changement de branche en cours…"}
              showReason={st.unborn}
              onChange={(v) => v !== st.branch && switchBranch.mutate(v)}
              options={[...(d.branches.some((b) => b.name === st.branch) ? [] : [{ value: st.branch, label: st.branch }]), ...d.branches.map((b) => ({ value: b.name, label: b.name, hint: b.upstream ?? undefined }))]}
            />
          )}
          {newBranch === null ? (
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} disabled={st.unborn} disabledReason="Fais d'abord un premier commit" onClick={() => setNewBranch("")}>
              Nouvelle branche
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
                Créer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNewBranch(null)}>
                {t("Annuler")}
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
            <p className="mt-0.5 text-xs text-muted">{t("Un push normal : si le dépôt distant a des commits plus récents, il est refusé, jamais forcé.")}</p>
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
                Envoyer
              </Button>
              <Button size="sm" variant="ghost" disabled={sync.isPending} onClick={() => setConfirmPush(false)}>
                {t("Annuler")}
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
            title="Indexé"
            empty={t("Rien d'indexé")}
            changes={staged}
            letter={(c) => c.staged ?? "?"}
            selected={file?.staged ? file.path : null}
            onSelect={(c) => setFile({ path: c.path, staged: true, untracked: false })}
            action={{ label: "Désindexer", icon: <Minus className="size-3.5" />, run: (paths) => unstage.mutate(paths) }}
          />
          <div className="border-t border-white/6">
            <ChangeList
              title="Modifications"
              empty={t("Rien à commiter")}
              changes={unstaged}
              letter={(c) => (c.conflicted ? "!" : c.untracked ? "?" : (c.unstaged ?? "?"))}
              selected={file && !file.staged ? file.path : null}
              onSelect={(c) => setFile({ path: c.path, staged: false, untracked: c.untracked })}
              action={{ label: "Indexer", icon: <Plus className="size-3.5" />, run: (paths) => stage.mutate(paths) }}
            />
          </div>
          <form
            className="flex flex-col gap-2 border-t border-white/6 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (staged.length > 0 && message.trim()) commit.mutate();
            }}
          >
            <Input placeholder={t("Message de commit")} value={message} onChange={(e) => setMessage(e.target.value)} aria-label={t("Message de commit")} />
            <Button type="submit" variant="primary" icon={<GitCommitHorizontal className="size-3.5" />} busy={commit.isPending} disabled={staged.length === 0 || !message.trim()}>
              Commit {staged.length > 0 ? `${staged.length} file${staged.length === 1 ? "" : "s"}` : ""}
            </Button>
            <p className="text-xs text-faint">{t("Les commits restent sur cette machine tant que tu n'envoies pas.")}</p>
          </form>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          {file && <DiffCard repo={repo.path} file={file} />}
          <Card>
            <CardTitle right={d.incoming.length > 0 ? <Dot tone="info">{d.incoming.length} on the remote</Dot> : undefined}>Historique</CardTitle>
            {d.log.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">{t("Aucun commit.")}</p>
            ) : (
              <ul className="py-1">
                {d.log.map((c, i) => (
                  <li key={c.hash} className="flex h-8 items-center gap-2.5 px-4 text-[13px]" title={`${c.hash}\n${c.author}`}>
                    <span className={cn("size-1.5 shrink-0 rounded-full", i < st.ahead ? "bg-accent" : "bg-line-strong")} />
                    <span className="selectable shrink-0 font-mono text-xs text-faint">{c.hash.slice(0, 7)}</span>
                    <span className="selectable min-w-0 flex-1 truncate">{c.subject}</span>
                    {i < st.ahead && <span className="shrink-0 text-xs text-accent-strong">{t("pas envoyé")}</span>}
                    {c.author !== mainAuthor && <span className="hidden max-w-28 shrink-0 truncate text-right text-xs text-faint lg:block">{c.author}</span>}
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
        <SectionLabel>
          {title} <span className="ml-1 font-mono text-[11px]">{changes.length}</span>
        </SectionLabel>
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
              <span className={cn("w-3 shrink-0 text-center font-mono text-xs", LETTER_TONE[letter(c)] ?? "text-muted")} title={c.conflicted ? "Conflict" : c.untracked ? "New file" : undefined}>
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
        <span className="truncate font-mono text-xs font-normal">{file.path}</span>
      </CardTitle>
      {diff.isLoading ? (
        <p className="flex items-center gap-2 px-4 py-4 text-xs text-muted">
          <Spinner /> {t("Chargement…")}
        </p>
      ) : diff.error ? (
        <div className="p-3">
          <ErrorNote>{asAppError(diff.error).message}</ErrorNote>
        </div>
      ) : (diff.data ?? "").trim() === "" ? (
        <p className="px-4 py-4 text-xs text-muted">{t("Aucune différence de texte (changement de mode, ou la modification est de l'autre côté : indexée ou non).")}</p>
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
