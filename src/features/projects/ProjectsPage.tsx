import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownUp, FolderGit2, GraduationCap, Play, Plus, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Menu, MenuChoice, MenuLabel } from "../../components/Menu";
import { Select } from "../../components/Select";
import { Badge, Button, Card, cn, EmptyState, ErrorNote, IconButton, Input, PageHeader, Spinner } from "../../components/ui";
import { asAppError, type RepoInfo } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { keys, useNow, usePref, useProjectActions, useRepos, useSettings } from "../../lib/hooks";
import { displayName, filterRepos, lastActivity, moduleOf, modulesOf, SORTS, sortRepos, type RepoFilter, type SortKey } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { BranchLabel, DueBadge, FavoriteButton, ProgressPicker, RepoMenu, StatusChips } from "./RepoBits";

const FILTERS: Array<{ id: RepoFilter; label: string; title: string }> = [
  { id: "active", label: "Active", title: "Everything that is not finished" },
  { id: "in_progress", label: "In progress", title: "Being worked on" },
  { id: "todo", label: "To do", title: "Not started" },
  { id: "done", label: "Done", title: "Finished projects. Their status can be changed back from here." },
  { id: "changes", label: "Needs attention", title: "Uncommitted work, commits to push or pull, conflicts" },
  { id: "favorites", label: "Favorites", title: "Starred" },
];

export function ProjectsPage() {
  const settings = useSettings();
  const hasRoots = (settings.data?.roots.length ?? 0) > 0;
  const repos = useRepos(hasRoots);
  const qc = useQueryClient();
  const openLauncher = useUi((s) => s.openLauncher);
  const setPage = useUi((s) => s.setPage);
  const now = useNow();
  const [query, setQuery] = useState("");
  // Remembered between sessions.
  const [filter, setFilter] = usePref<RepoFilter>("projects.filter", "active");
  const [sort, setSort] = usePref<SortKey>("projects.sort", "smart");
  const [epitechOnly, setEpitechOnly] = usePref<boolean>("projects.epitechOnly", false);
  const [module, setModule] = usePref<string>("projects.module", "");

  const all = repos.data ?? [];
  const modules = useMemo(() => modulesOf(all), [all]);
  // A remembered module that no longer exists must not hide everything.
  const activeModule = modules.some((m) => m.code === module) ? module : "";
  const options = { epitechOnly, module: activeModule || null };
  const shown = useMemo(() => sortRepos(filterRepos(all, query, filter, options), sort, now), [all, query, filter, epitechOnly, activeModule, sort, now]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, filterRepos(all, "", f.id, options).length])), [all, epitechOnly, activeModule]);
  const school = all.filter((r) => r.kind === "epitech").length;
  const sortLabel = SORTS.find((s) => s.id === sort)?.label ?? "Smart";

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={hasRoots ? `${all.length} repositor${all.length === 1 ? "y" : "ies"} · ${school} Epitech` : undefined}
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
          <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="relative w-56">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
              <Input autoFocus className="pl-8" placeholder="Name, module, branch…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="flex items-center gap-0.5" role="tablist" aria-label="Status filter">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  title={f.title}
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors", filter === f.id ? "bg-raised font-medium text-fg" : "text-muted hover:bg-hover hover:text-fg")}
                >
                  {f.label}
                  <span className="text-faint">{counts[f.id]}</span>
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={epitechOnly}
                title="Hide personal repositories and anything unrelated to the curriculum. A repository's classification can be corrected from its ⋯ menu."
                onClick={() => setEpitechOnly(!epitechOnly)}
                className={cn("flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors", epitechOnly ? "border-accent/40 bg-accent-soft text-accent-strong" : "border-white/8 text-muted hover:border-line-strong hover:text-fg")}
              >
                <GraduationCap className="size-3.5" />
                Epitech only
              </button>
              {modules.length > 1 && (
                <Select
                  size="sm"
                  mono
                  className="w-36"
                  label="Module"
                  value={activeModule}
                  onChange={setModule}
                  options={[{ value: "", label: "All modules" }, ...modules.map((m) => ({ value: m.code, label: m.code, hint: m.name ? `${m.name} · ${m.count}` : String(m.count) }))]}
                />
              )}
              <Menu
                trigger={
                  <button type="button" title="Sort order" className="flex h-7 items-center gap-1.5 rounded-md border border-white/8 px-2.5 text-xs text-muted transition-colors hover:border-line-strong hover:text-fg">
                    <ArrowDownUp className="size-3.5" />
                    {sortLabel}
                  </button>
                }
              >
                <MenuLabel>Sort by</MenuLabel>
                {SORTS.map((s) => (
                  <MenuChoice key={s.id} checked={sort === s.id} onSelect={() => setSort(s.id)} hint={s.hint}>
                    {s.label}
                  </MenuChoice>
                ))}
              </Menu>
            </div>
          </div>
          <Card>
            {shown.length === 0 ? (
              <EmptyState title={all.length === 0 ? "No repository found" : "Nothing matches"}>
                {all.length === 0 ? "Your projects folders contain no git repository yet." : epitechOnly || activeModule ? "Try another search, or turn off “Epitech only” and the module filter." : "Try another search or filter."}
              </EmptyState>
            ) : (
              <ul>
                {shown.map((repo) => (
                  <RepoRow key={repo.path} repo={repo} now={now} />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function RepoRow({ repo, now }: { repo: RepoInfo; now: Date }) {
  const act = useProjectActions();
  const openSheet = useUi((s) => s.openSheet);
  const mod = moduleOf(repo);
  const active = lastActivity(repo);
  return (
    <li className={cn("group flex h-11 items-center gap-2 border-b border-white/6 pr-1.5 pl-1.5 last:border-b-0 row-hover", repo.progress === "done" && "text-muted")}>
      <FavoriteButton repo={repo} />
      <button type="button" onClick={() => openSheet(repo.path)} className="flex min-w-0 flex-[2.2] items-center gap-2 text-left" title={`${repo.path}\n${repo.kind === "epitech" ? "Epitech" : "Personal"}: ${repo.kindReason}`}>
        <span className="truncate text-[13px] font-medium">{displayName(repo)}</span>
        {mod ? (
          <Badge tone={repo.kind === "epitech" ? "accent" : "neutral"} mono title={repo.my?.unitName ?? undefined}>
            {mod}
          </Badge>
        ) : (
          repo.group && <span className="shrink-0 text-xs text-faint">{repo.group}</span>
        )}
        <DueBadge repo={repo} now={now} />
      </button>
      <span className="flex w-[104px] shrink-0">
        <ProgressPicker repo={repo} />
      </span>
      <span className="hidden min-w-0 flex-1 md:block">
        <BranchLabel repo={repo} />
      </span>
      <span className="flex min-w-0 flex-[1.3] justify-start">
        <StatusChips repo={repo} max={2} />
      </span>
      <span className="hidden w-24 shrink-0 text-right text-xs text-faint lg:block" title={repo.lastCommit?.subject}>
        {active > 0 ? timeAgo(Math.floor(active / 1000)) : "no commit"}
      </span>
      <span className="flex shrink-0 items-center">
        <IconButton label="Open workspace (IDE + terminal)" className="text-accent opacity-60 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-accent-strong" onClick={() => act.workspace.mutate(repo)}>
          <Play className="size-4" />
        </IconButton>
        <RepoMenu repo={repo} />
      </span>
    </li>
  );
}
