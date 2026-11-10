import { useQueryClient } from "@tanstack/react-query";
import { FolderGit2, LayoutTemplate, Play, Plus, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Card, cn, EmptyState, ErrorNote, IconButton, Input, PageHeader, Spinner } from "../../components/ui";
import { asAppError, type RepoInfo } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { keys, useProjectActions, useRepos, useSettings } from "../../lib/hooks";
import { daysLeft, deadlineLabel, displayName, filterRepos, type RepoFilter } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { BranchLabel, FavoriteButton, RepoActions, StatusChips } from "./RepoBits";

const FILTERS: Array<{ id: RepoFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "school", label: "Epitech" },
  { id: "personal", label: "Personal" },
  { id: "changes", label: "Needs attention" },
  { id: "favorites", label: "Favorites" },
  { id: "done", label: "Done" },
];

export function ProjectsPage() {
  const settings = useSettings();
  const hasRoots = (settings.data?.roots.length ?? 0) > 0;
  const repos = useRepos(hasRoots);
  const qc = useQueryClient();
  const openLauncher = useUi((s) => s.openLauncher);
  const setPage = useUi((s) => s.setPage);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RepoFilter>("all");

  const all = repos.data ?? [];
  const shown = useMemo(() => filterRepos(all, query, filter), [all, query, filter]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, filterRepos(all, "", f.id).length])), [all]);

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={hasRoots ? `${all.length} repositor${all.length === 1 ? "y" : "ies"} on this machine` : undefined}
        actions={
          hasRoots && (
            <>
              <Button variant="ghost" icon={<RefreshCw className="size-3.5" />} busy={repos.isFetching} onClick={() => void qc.invalidateQueries({ queryKey: keys.repos })}>
                Rescan
              </Button>
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openLauncher({ mode: "new" })}>
                New project
              </Button>
            </>
          )
        }
      />

      {!hasRoots ? (
        <Card>
          <EmptyState icon={<FolderGit2 className="size-6" />} title="No projects folder yet" action={<Button onClick={() => setPage("overview")}>Set up</Button>}>
            Tell TekBoard where your repositories live.
          </EmptyState>
        </Card>
      ) : repos.isLoading ? (
        <p className="flex items-center gap-2 py-16 text-muted">
          <Spinner /> Scanning…
        </p>
      ) : repos.error ? (
        <ErrorNote title="Could not scan your projects">{asAppError(repos.error).message}</ErrorNote>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="relative w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
              <Input autoFocus className="pl-8" placeholder="Filter by name, module, branch…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="flex items-center gap-1" role="tablist" aria-label="Filter">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
                    filter === f.id ? "bg-raised font-medium text-fg" : "text-muted hover:bg-hover hover:text-fg",
                  )}
                >
                  {f.label}
                  <span className="text-faint">{counts[f.id]}</span>
                </button>
              ))}
            </div>
          </div>

          <Card>
            {shown.length === 0 ? (
              <EmptyState title={all.length === 0 ? "No repository found" : "Nothing matches"}>
                {all.length === 0 ? "Your projects folders contain no git repository yet." : "Try another search or filter."}
              </EmptyState>
            ) : (
              <ul>
                {shown.map((repo) => (
                  <RepoRow key={repo.path} repo={repo} />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function RepoRow({ repo }: { repo: RepoInfo }) {
  const act = useProjectActions();
  const openLauncher = useUi((s) => s.openLauncher);
  const openSheet = useUi((s) => s.openSheet);
  const days = repo.meta.deadline && !repo.meta.archived ? daysLeft(repo.meta.deadline) : null;
  return (
    <li className="group flex h-12 items-center gap-2 border-b border-white/6 pr-2 pl-1.5 last:border-b-0 row-hover">
      <FavoriteButton repo={repo} />
      <button type="button" onClick={() => openSheet(repo.path)} className="flex min-w-0 flex-[2] items-center gap-2 text-left" title={`${repo.path}\nNotes, deadline, build`}>
        <span className="truncate text-[13px] font-medium">{displayName(repo)}</span>
        {repo.epitech ? (
          <Badge tone="accent" mono>
            {repo.epitech.module}
          </Badge>
        ) : (
          repo.group && <span className="shrink-0 text-xs text-faint">{repo.group}</span>
        )}
        {days !== null && <Badge tone={days < 0 ? "danger" : days <= 2 ? "warn" : "neutral"}>{deadlineLabel(days)}</Badge>}
      </button>
      <span className="hidden min-w-0 flex-1 md:block">
        <BranchLabel repo={repo} />
      </span>
      <span className="flex min-w-0 flex-[1.4] justify-start">
        <StatusChips repo={repo} max={2} />
      </span>
      <span className="hidden w-24 shrink-0 text-right text-xs text-faint lg:block" title={repo.lastCommit?.subject}>
        {repo.lastCommit ? timeAgo(repo.lastCommit.date) : "no commit"}
      </span>
      <span className="flex w-[184px] shrink-0 items-center justify-end opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <IconButton label="Apply a template…" onClick={() => openLauncher({ mode: "existing", path: repo.path })}>
          <LayoutTemplate className="size-4" />
        </IconButton>
        <RepoActions repo={repo} />
        <IconButton label="Open workspace (IDE + terminal)" className="text-accent hover:text-accent-strong" onClick={() => act.workspace.mutate(repo)}>
          <Play className="size-4" />
        </IconButton>
      </span>
    </li>
  );
}
