import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownUp, ChevronRight, Eye, EyeOff, FolderGit2, GraduationCap, Play, Plus, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Menu, MenuChoice, MenuLabel } from "../../components/Menu";
import { Select } from "../../components/Select";
import { Button, cn, EmptyState, ErrorNote, IconButton, Input, PageHeader, Spinner, Tag } from "../../components/ui";
import { api, asAppError, type RepoInfo } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { keys, useNow, usePref, useProjectActions, useRepos, useSettings } from "../../lib/hooks";
import { attention, displayName, filterRepos, groupRepos, lastActivity, moduleOf, modulesOf, SORTS, sortRepos, type RepoFilter, type RepoGroup, type SortKey } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { BranchLabel, DueBadge, FavoriteButton, ProgressPicker, RepoMenu, StatusChips } from "./RepoBits";
import { plural, t } from "../../lib/i18n";

const FILTERS: Array<{ id: RepoFilter; label: string; title: string }> = [
  { id: "active", label: t("Actifs"), title: t("Tout ce qui n'est pas terminé") },
  { id: "in_progress", label: t("En cours"), title: t("En travail") },
  { id: "todo", label: t("À faire"), title: t("Pas commencé") },
  { id: "done", label: t("Terminé"), title: t("Projets terminés. Leur statut peut être changé ici.") },
  { id: "changes", label: t("À regarder"), title: t("Travail non commité, commits à envoyer ou à récupérer, conflits") },
  { id: "favorites", label: t("Favoris"), title: t("Marqués d'une étoile") },
  { id: "archived", label: t("Archivés"), title: t("Sortis des listes de tous les jours. Leur dossier n'a pas bougé.") },
];

export function ProjectsPage() {
  const settings = useSettings();
  const hasRoots = (settings.data?.roots.length ?? 0) > 0;
  const repos = useRepos(hasRoots, { all: true });
  const qc = useQueryClient();
  const openLauncher = useUi((s) => s.openLauncher);
  const setPage = useUi((s) => s.setPage);
  const now = useNow();
  const [query, setQuery] = useState("");
  // Remembered between sessions.
  const [filter, setFilter] = usePref<RepoFilter>("projects.filter", "active");
  const [sort, setSort] = usePref<SortKey>("projects.sort", "smart");
  // "Epitech Projects Only" is the setting of the whole app (Settings → General), switched here too.
  const epitechOnly = settings.data?.epitechOnly ?? true;
  const setEpitechOnly = (v: boolean) => {
    if (!settings.data) return;
    void api.saveSettings({ ...settings.data, epitechOnly: v }).then((saved) => {
      qc.setQueryData(keys.settings, saved);
      void qc.invalidateQueries({ queryKey: keys.repos });
    });
  };
  const hidden = useQuery({ queryKey: ["hidden-repos"], queryFn: api.hiddenRepos, enabled: hasRoots });
  const [showHidden, setShowHidden] = useState(false);
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
  // The smart order reads as groups: what is due soon, in progress, to come, closed recently, old.
  const showStatus = filter !== "todo" && filter !== "in_progress" && filter !== "done";
  const grouped = sort === "smart" && !query && filter !== "archived" && filter !== "done";

  return (
    <>
      <PageHeader
        title={t("Projets")}
        subtitle={hasRoots ? `${plural(all.length, "{n} dépôt", "{n} dépôts")} · ${school} Epitech` : undefined}
        actions={
          hasRoots && (
            <>
              <Button variant="ghost" icon={<RefreshCw className="size-3.5" />} busy={repos.isFetching} onClick={() => void qc.invalidateQueries({ queryKey: keys.repos })}>
                {t("Relire")}
              </Button>
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openLauncher({ mode: "new" })}>
                {t("Nouveau projet")}
              </Button>
            </>
          )
        }
      />
      {!hasRoots ? (
        <EmptyState icon={<FolderGit2 className="size-6" />} title={t("Pas encore de dossier de projets")} action={<Button onClick={() => setPage("overview")}>{t("Configurer")}</Button>}>
          {t("Dis à TekBoard où sont tes dépôts.")}
        </EmptyState>
      ) : repos.isLoading ? (
        <p className="flex items-center gap-2 py-16 text-muted">
          <Spinner /> {t("Lecture…")}
        </p>
      ) : repos.error ? (
        <ErrorNote title={t("Impossible de parcourir tes projets")}>{asAppError(repos.error).message}</ErrorNote>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="relative w-44">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
              <Input autoFocus className="pl-8" aria-label={t("Chercher par nom, module ou branche")} placeholder={t("Rechercher")} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="flex items-center gap-0.5" role="tablist" aria-label={t("Filtre de statut")}>
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  title={f.title}
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn("flex h-7 items-center gap-1.5 rounded-(--btn-radius) px-2 text-sm transition-colors duration-(--dur-fast)", filter === f.id ? "bg-ink/7 font-medium text-fg" : "text-muted hover:bg-ink/4 hover:text-fg")}
                >
                  {f.label}
                  <span className="font-mono text-2xs text-faint">{counts[f.id]}</span>
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={epitechOnly}
                title={t("Masque les dépôts personnels et ce qui n'est pas du cursus. Le classement d'un dépôt se corrige depuis son menu ⋯.")}
                onClick={() => setEpitechOnly(!epitechOnly)}
                className={cn("flex h-7 items-center gap-1.5 rounded-(--btn-radius) border px-2.5 text-xs transition-colors duration-(--dur-fast)", epitechOnly ? "border-transparent bg-accent-soft text-accent-strong" : "border-line text-muted hover:border-line-strong hover:text-fg")}
              >
                <GraduationCap className="size-3.5" />
                Epitech Projects Only
              </button>
              {modules.length > 1 && (
                <Select
                  size="sm"
                  mono
                  className="w-36"
                  label={t("Module")}
                  value={activeModule}
                  onChange={setModule}
                  options={[{ value: "", label: t("Tous les modules") }, ...modules.map((m) => ({ value: m.code, label: m.code, hint: m.name ? `${m.name} · ${m.count}` : String(m.count) }))]}
                />
              )}
              <Menu
                trigger={
                  <button type="button" title={t("Trier : {s}", { s: sortLabel })} className="flex h-7 items-center gap-1.5 rounded-(--btn-radius) border border-line px-2 text-xs text-muted transition-colors duration-(--dur-fast) hover:border-line-strong hover:text-fg">
                    <ArrowDownUp className="size-3.5" />
                    <span className="hidden 2xl:inline">{sortLabel}</span>
                  </button>
                }
              >
                <MenuLabel>{t("Trier par")}</MenuLabel>
                {SORTS.map((s) => (
                  <MenuChoice key={s.id} checked={sort === s.id} onSelect={() => setSort(s.id)} hint={s.hint}>
                    {s.label}
                  </MenuChoice>
                ))}
              </Menu>
            </div>
          </div>
          <div>
            {shown.length === 0 ? (
              <EmptyState title={all.length === 0 ? t("Aucun dépôt trouvé") : t("Rien ne correspond")}>
                {all.length === 0 ? t("Tes dossiers de projets ne contiennent encore aucun dépôt git.") : epitechOnly || activeModule ? t("Essaie une autre recherche, ou désactive « Epitech Projects Only » et le filtre de module.") : t("Essaie une autre recherche ou un autre filtre.")}
              </EmptyState>
            ) : (
              <ul>
                <li aria-hidden className="flex h-7 items-center gap-3 border-b border-line pr-1 pl-1 text-2xs text-faint">
                  <span className="w-7 shrink-0" />
                  <span className="flex-[2]">{t("Projet")}</span>
                  <span className="w-32 shrink-0">{t("Rendu")}</span>
                  <span className="flex-[1.6]">Git</span>
                  <span className={cn("shrink-0", filter !== "todo" && filter !== "in_progress" && filter !== "done" ? "w-28" : "w-6")}>{filter !== "todo" && filter !== "in_progress" && filter !== "done" ? t("Statut") : ""}</span>
                  <span className="hidden w-24 shrink-0 text-right @3xl:block">{t("Activité")}</span>
                  <span className="w-14 shrink-0" />
                </li>
                {grouped ? (
                  groupRepos(shown, now).map((g) => (
                    <RepoGroupRows key={g.id} group={g} now={now} showStatus={showStatus} />
                  ))
                ) : (
                  shown.map((repo) => <RepoRow key={repo.path} repo={repo} now={now} showStatus={showStatus} />)
                )}
              </ul>
            )}
          </div>
          {(hidden.data?.length ?? 0) > 0 && (
            <div className="mt-3">
              <button type="button" onClick={() => setShowHidden(!showHidden)} className="flex items-center gap-1.5 text-xs text-faint hover:text-muted">
                <EyeOff className="size-3.5" />
                {plural(hidden.data!.length, "{n} projet masqué", "{n} projets masqués")}
              </button>
              {showHidden && (
                <ul className="mt-2 border-t border-line">
                  {hidden.data!.map((r) => (
                    <HiddenRow key={r.path} repo={r} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

/** One group of the smart order, with its heading; old work stays folded until opened. */
function RepoGroupRows({ group, now, showStatus }: { group: RepoGroup; now: Date; showStatus: boolean }) {
  const [open, setOpen] = useState(!group.folded);
  return (
    <>
      <li className="flex h-8 items-end gap-2 border-b border-line px-1 pb-1">
        {group.folded ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-1 text-xs text-faint hover:text-muted">
            <ChevronRight className={cn("size-3.5 transition-transform duration-(--dur-fast)", open && "rotate-90")} />
            {group.label}
          </button>
        ) : (
          <span className="text-xs text-faint">{group.label}</span>
        )}
        <span className="font-mono text-2xs text-faint">{group.repos.length}</span>
      </li>
      {open && group.repos.map((repo) => <RepoRow key={repo.path} repo={repo} now={now} showStatus={showStatus} />)}
    </>
  );
}

/** A hidden project: where it is, and the way back. */
function HiddenRow({ repo }: { repo: RepoInfo }) {
  const act = useProjectActions();
  return (
    <li className="flex h-10 items-center gap-3 border-b border-line px-1 text-sm">
      <span className="min-w-0 flex-1 truncate text-muted">{displayName(repo)}</span>
      <span className="selectable min-w-0 flex-[2] truncate font-mono text-2xs text-faint">{repo.path}</span>
      <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} busy={act.visibility.isPending} onClick={() => act.visibility.mutate({ repo, visibility: null })}>
        {t("Restaurer")}
      </Button>
    </li>
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
    <li className={cn("group ink-row flex h-11 items-center gap-3 rounded-none border-b border-line pr-1 pl-1", repo.progress === "done" && "text-muted")}>
      <FavoriteButton repo={repo} />
      <button type="button" onClick={() => openSheet(repo.path)} className="flex min-w-0 flex-[2] items-baseline gap-2.5 text-left" title={`${repo.path}\n${repo.kind === "epitech" ? "Epitech" : t("Personnel")} : ${repo.kindReason}${repo.status?.branch ? `\n${t("Branche {b}", { b: repo.status.branch })}` : ""}`}>
        <span className="truncate text-sm font-medium">{displayName(repo)}</span>
        {mod ? <Tag title={repo.my?.unitName ?? undefined}>{mod}</Tag> : repo.group && <span className="shrink-0 text-xs text-faint">{repo.group}</span>}
        {repo.duplicateOf && (
          <span className="shrink-0 rounded border border-warn/40 px-1.5 text-2xs text-warn" title={t("Même projet que {p}. Si ce dossier est une copie, masque-le depuis son menu ⋯ : rien n'est supprimé.", { p: repo.duplicateOf })}>
            {t("copie")}
          </span>
        )}
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
      <span className="hidden w-24 shrink-0 text-right text-xs text-faint @3xl:block" title={repo.lastCommit?.subject}>
        {active > 0 ? timeAgo(Math.floor(active / 1000)) : t("aucun commit")}
      </span>
      <span className="flex shrink-0 items-center opacity-0 transition-opacity duration-(--dur-fast) group-focus-within:opacity-100 group-hover:opacity-100">
        <IconButton label={t("Ouvrir l'espace de travail (IDE + terminal)")} className="hover:text-accent-strong" onClick={() => act.workspace.mutate(repo)}>
          <Play className="size-4" />
        </IconButton>
        <RepoMenu repo={repo} />
      </span>
    </li>
  );
}
