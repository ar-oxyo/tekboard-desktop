import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownUp, FolderGit2, GraduationCap, Play, Plus, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Menu, MenuChoice, MenuLabel } from "../../components/Menu";
import { Select } from "../../components/Select";
import { Button, Card, cn, EmptyState, ErrorNote, IconButton, Input, PageHeader, Spinner, Tag } from "../../components/ui";
import { asAppError, type RepoInfo } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { keys, useNow, usePref, useProjectActions, useRepos, useSettings } from "../../lib/hooks";
import { attention, displayName, filterRepos, lastActivity, moduleOf, modulesOf, SORTS, sortRepos, type RepoFilter, type SortKey } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { BranchLabel, DueBadge, FavoriteButton, ProgressPicker, RepoMenu, StatusChips } from "./RepoBits";

const FILTERS: Array<{ id: RepoFilter; label: string; title: string }> = [
  { id: "active", label: "Actifs", title: "Tout ce qui n'est pas terminé" },
  { id: "in_progress", label: "En cours", title: "En travail" },
  { id: "todo", label: "À faire", title: "Pas commencé" },
  { id: "done", label: "Terminé", title: "Projets terminés. Leur statut peut être changé ici." },
  { id: "changes", label: "À regarder", title: "Travail non commité, commits à envoyer ou à récupérer, conflits" },
  { id: "favorites", label: "Favoris", title: "Marqués d'une étoile" },
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
        title="Projets"
        subtitle={hasRoots ? `${all.length} repositor${all.length === 1 ? "y" : "ies"} · ${school} Epitech` : undefined}
        actions={
          hasRoots && (
            <>
              <Button variant="ghost" icon={<RefreshCw className="size-3.5" />} busy={repos.isFetching} onClick={() => void qc.invalidateQueries({ queryKey: keys.repos })}>
                Relire
              </Button>
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openLauncher({ mode: "new" })}>
                Nouveau projet
              </Button>
            </>
          )
        }
      />
      {!hasRoots ? (
        <Card>
          <EmptyState icon={<FolderGit2 className="size-6" />} title="Pas encore de dossier de projets" action={<Button onClick={() => setPage("overview")}>Configurer</Button>}>
            Dis à TekBoard où sont tes dépôts.
          </EmptyState>
        </Card>
      ) : repos.isLoading ? (
        <p className="flex items-center gap-2 py-16 text-muted">
          <Spinner /> Lecture…
        </p>
      ) : repos.error ? (
        <ErrorNote title="Impossible de parcourir tes projets">{asAppError(repos.error).message}</ErrorNote>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="relative w-56">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
              <Input autoFocus className="pl-8" aria-label="Chercher par nom, module ou branche" placeholder="Rechercher" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="flex items-center gap-0.5" role="tablist" aria-label="Filtre de statut">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  title={f.title}
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn("flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] transition-colors duration-150", filter === f.id ? "bg-raised text-fg" : "text-muted hover:text-fg")}
                >
                  {f.label}
                  <span className="font-mono text-[11px] text-faint">{counts[f.id]}</span>
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={epitechOnly}
                title="Masque les dépôts personnels et ce qui n'est pas du cursus. Le classement d'un dépôt se corrige depuis son menu ⋯."
                onClick={() => setEpitechOnly(!epitechOnly)}
                className={cn("flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors duration-150", epitechOnly ? "border-transparent bg-accent-soft text-accent-strong" : "border-white/8 text-muted hover:border-line-strong hover:text-fg")}
              >
                <GraduationCap className="size-3.5" />
                Epitech seulement
              </button>
              {modules.length > 1 && (
                <Select
                  size="sm"
                  mono
                  className="w-36"
                  label="Module"
                  value={activeModule}
                  onChange={setModule}
                  options={[{ value: "", label: "Tous les modules" }, ...modules.map((m) => ({ value: m.code, label: m.code, hint: m.name ? `${m.name} · ${m.count}` : String(m.count) }))]}
                />
              )}
              <Menu
                trigger={
                  <button type="button" title="Ordre de tri" className="flex h-7 items-center gap-1.5 rounded-md border border-white/8 px-2.5 text-xs text-muted transition-colors duration-150 hover:border-line-strong hover:text-fg">
                    <ArrowDownUp className="size-3.5" />
                    {sortLabel}
                  </button>
                }
              >
                <MenuLabel>Trier par</MenuLabel>
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
                  <RepoRow key={repo.path} repo={repo} now={now} showStatus={filter !== "todo" && filter !== "in_progress" && filter !== "done"} />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  );
}

/** One line per repository. Only what differs from row to row is written out: the default branch, a clean tree and the status the list is already filtered on stay silent. */
function RepoRow({ repo, now, showStatus }: { repo: RepoInfo; now: Date; showStatus: boolean }) {
  const act = useProjectActions();
  const openSheet = useUi((s) => s.openSheet);
  const mod = moduleOf(repo);
  const active = lastActivity(repo);
  const clean = !repo.error && attention(repo).length === 0;
  return (
    <li className={cn("group row-hover flex h-11 items-center gap-3 border-b border-white/6 pr-2 pl-2 last:border-b-0", repo.progress === "done" && "text-muted")}>
      <FavoriteButton repo={repo} />
      <button type="button" onClick={() => openSheet(repo.path)} className="flex min-w-0 flex-[2] items-baseline gap-2.5 text-left" title={`${repo.path}\n${repo.kind === "epitech" ? "Epitech" : "Personal"}: ${repo.kindReason}${repo.status?.branch ? `\nBranch ${repo.status.branch}` : ""}`}>
        <span className="truncate text-[13px] font-medium">{displayName(repo)}</span>
        {mod ? <Tag title={repo.my?.unitName ?? undefined}>{mod}</Tag> : repo.group && <span className="shrink-0 text-xs text-faint">{repo.group}</span>}
      </button>
      <span className="flex w-32 shrink-0">
        <DueBadge repo={repo} now={now} />
      </span>
      <span className="flex min-w-0 flex-[1.6] items-center gap-3">
        <BranchLabel repo={repo} quiet />
        {!clean && <StatusChips repo={repo} max={2} />}
      </span>
      <span className={cn("flex shrink-0", showStatus ? "w-28" : "w-6")}>
        <ProgressPicker repo={repo} compact={!showStatus} />
      </span>
      <span className="hidden w-24 shrink-0 text-right text-xs text-faint lg:block" title={repo.lastCommit?.subject}>
        {active > 0 ? timeAgo(Math.floor(active / 1000)) : "no commit"}
      </span>
      <span className="flex shrink-0 items-center">
        <IconButton label="Ouvrir l'espace de travail (IDE + terminal)" className="hover:text-accent-strong" onClick={() => act.workspace.mutate(repo)}>
          <Play className="size-4" />
        </IconButton>
        <RepoMenu repo={repo} />
      </span>
    </li>
  );
}
