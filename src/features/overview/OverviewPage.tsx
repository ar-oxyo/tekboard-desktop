import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, CalendarDays, ChevronDown, ChevronRight, CloudDownload, FolderGit2, FolderPlus, GitCommitHorizontal, PenLine, Play, Plus, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Code, cn, Dot, EmptyState, ErrorNote, IconButton, Section, SectionLabel, Spinner, Tag } from "../../components/ui";
import { asAppError, type Activity, type BoardItem, type Candidate, type RepoInfo } from "../../lib/api";
import { timeAgo, tildify } from "../../lib/format";
import { keys, useActivity, useBoard, useCandidates, useEnv, useHome, useNow, usePref, useProjectActions, useRepos, useSettings } from "../../lib/hooks";
import { QuickActions, WorkloadBlock } from "./Today";
import { GettingStarted, HeroNow, ProjectTabs, StatTiles, TimelineBlock, useTodayLayout } from "./Dashboard";
import { WidgetGrid } from "./WidgetGrid";
import { CreditsWidget, InboxWidget, SkillWidget } from "./NewWidgets";
import type { WidgetId } from "./layout";
import { Menu, MenuItem } from "../../components/Menu";
import { attention, currentFocus, displayName, due } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { BranchLabel, DueBadge, ProgressPicker, RepoMenu, StatusChips } from "../projects/RepoBits";
import { Onboarding } from "../settings/Onboarding";
import { locale, plural, t } from "../../lib/i18n";

export function OverviewPage() {
  const settings = useSettings();
  const hasRoots = (settings.data?.roots.length ?? 0) > 0;
  const repos = useRepos(hasRoots);
  const qc = useQueryClient();

  const now = new Date();
  const today = now.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
  const greeting = now.getHours() < 18 ? t("Bonjour") : t("Bonsoir");
  const [layout, setLayout] = useTodayLayout();
  // Edit mode of the widgets (the header button, or Settings → Appearance).
  const [customize, setCustomize] = useState(false);
  useEffect(() => {
    const on = () => setCustomize(true);
    window.addEventListener("tekboard:customize-today", on);
    return () => window.removeEventListener("tekboard:customize-today", on);
  }, []);
  const widget = (id: WidgetId) => {
    const list = repos.data ?? [];
    switch (id) {
      case "hero": return <HeroNow />;
      case "tile.logtime": return <StatTiles only="logtime" />;
      case "tile.credits": return <StatTiles only="credits" />;
      case "tile.work": return <StatTiles only="work" />;
      case "tile.due": return <StatTiles only="due" />;
      case "timeline": return <TimelineBlock />;
      case "projects": return <ProjectTabs />;
      case "more": return <MoreSection repos={list} />;
      case "deadlines": return <DeadlinesBlock />;
      case "workload": return <WorkloadBlock />;
      case "quick": return <QuickActions />;
      case "activity": return <ActivityCard repos={list} />;
      case "credits": return <CreditsWidget />;
      case "skilltree": return <SkillWidget />;
      case "inbox": return <InboxWidget />;
    }
  };
  const firstName = useEnv().data?.identity.name?.trim().split(/\s+/)[0] ?? "";

  if (settings.isLoading) return <Loading />;
  if (settings.error) return <ErrorNote title={t("TekBoard n'a pas pu lire ses réglages")}>{asAppError(settings.error).message}</ErrorNote>;

  return (
    <>
      <header className="mb-6 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted first-letter:uppercase">{today}</p>
          <h1 className="display mt-1 truncate text-2xl leading-tight font-(--title-weight) tracking-[-0.02em]">{firstName ? `${greeting} ${firstName}` : greeting}</h1>
        </div>
        {hasRoots && (
          <div className="flex shrink-0 items-center gap-2">
            <IconButton label={t("Personnaliser Aujourd'hui")} active={customize} onClick={() => setCustomize(!customize)}>
              <SlidersHorizontal className="size-4" />
            </IconButton>
            <IconButton
              label={t("Relire les dépôts et les dates de rendu")}
              onClick={() => {
                void qc.invalidateQueries({ queryKey: keys.repos });
                void qc.invalidateQueries({ queryKey: keys.candidates });
              }}
            >
              <RefreshCw className={cn("size-4", repos.isFetching && "anim-spin")} />
            </IconButton>
            <Menu
              trigger={
                <Button icon={<Plus className="size-4" />} className="h-[34px]">
                  {t("Nouveau")}
                </Button>
              }
            >
              <MenuItem icon={<FolderPlus className="size-4" />} hint="Ctrl N" onSelect={() => useUi.getState().openLauncher({ mode: "new" })}>
                {t("Projet")}
              </MenuItem>
              <MenuItem icon={<PenLine className="size-4" />} hint="Ctrl I" onSelect={() => useUi.getState().setCaptureOpen(true)}>
                {t("Tâche ou idée")}
              </MenuItem>
              <MenuItem icon={<CalendarDays className="size-4" />} onSelect={() => useUi.getState().openPlanning(Date.now())}>
                {t("Session au planning")}
              </MenuItem>
            </Menu>
          </div>
        )}
      </header>

      {!hasRoots ? (
        <Onboarding />
      ) : repos.isLoading ? (
        <Loading />
      ) : repos.error ? (
        <ErrorNote title={t("Impossible de parcourir tes projets")}>{asAppError(repos.error).message}</ErrorNote>
      ) : (
        <div className="stagger flex flex-col gap-7">
          {layout.checklist && !customize && <GettingStarted />}
          <WidgetGrid layout={layout} onChange={setLayout} edit={customize} onDone={() => setCustomize(false)} render={widget} />
        </div>
      )}
    </>
  );
}

/** Repositories, recent activity and new projects: useful, but not what the day is about. Folded by default. */
function MoreSection({ repos }: { repos: RepoInfo[] }) {
  const [open, setOpen] = usePref("overview.more", false);
  const flagged = repos.filter((r) => r.progress !== "done" && attention(r).length > 0).length;
  return (
    <section>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mb-4 flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        {t("Rendus, charge et activité")}
        {flagged > 0 && <span className="text-xs text-faint">· {plural(flagged, "{n} à regarder", "{n} à regarder")}</span>}
      </button>
      {open && (
        <div className="grid grid-cols-1 items-start gap-x-12 gap-y-9 @5xl:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-9">
            <DeadlinesBlock />
            <WorkloadBlock />
          </div>
          <div className="flex min-w-0 flex-col gap-9">
            <QuickActions />
            <NextProjectCard />
          </div>
          <div className="flex min-w-0 flex-col gap-9">
            <FocusCard repo={currentFocus(repos)} />
            <AttentionCard repos={repos} />
            <ActivityCard repos={repos} />
          </div>
        </div>
      )}
    </section>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-16 text-muted">
      <Spinner /> {t("Lecture de tes projets…")}
    </div>
  );
}

function FocusCard({ repo }: { repo: RepoInfo | null }) {
  const act = useProjectActions();
  const home = useHome();
  const openSheet = useUi((s) => s.openSheet);
  if (!repo) {
    return (
      <Section title={t("En cours")}>
        <EmptyState icon={<FolderGit2 className="size-6" />} title={t("Aucun dépôt dans tes dossiers de projets")}>
          {t("Clone un projet pour commencer, ou ajoute un autre dossier dans Réglages.")}
        </EmptyState>
      </Section>
    );
  }
  return (
    <Section title={t("Ouvert récemment")} meta={repo.meta.lastOpenedAt ? t("ouvert {ago}", { ago: timeAgo(repo.meta.lastOpenedAt) }) : t("dernier commit")}>
      <div className="pt-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="display selectable truncate text-xl font-(--title-weight)">{displayName(repo)}</h3>
          {(repo.my?.unitCode ?? repo.epitech?.module) && <Tag>{repo.my?.unitCode ?? repo.epitech?.module}</Tag>}
        </div>
        <p className="selectable mt-1 truncate font-mono text-xs text-faint">{tildify(repo.path, home)}</p>

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <DueBadge repo={repo} />
          <BranchLabel repo={repo} />
          <StatusChips repo={repo} max={4} />
        </div>

        {repo.lastCommit ? (
          <p className="mt-3 flex min-w-0 items-center gap-2 text-sm text-muted">
            <GitCommitHorizontal className="size-4 shrink-0 text-faint" />
            <span className="selectable truncate">{repo.lastCommit.subject}</span>
            <span className="shrink-0 text-faint">{timeAgo(repo.lastCommit.date)}</span>
          </p>
        ) : (
          <p className="mt-3 text-sm text-faint">{t("Aucun commit")}</p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button icon={<Play className="size-3.5" />} busy={act.workspace.isPending} onClick={() => act.workspace.mutate(repo)}>
            {t("Reprendre")}
          </Button>
          <Button onClick={() => openSheet(repo.path)}>{t("Fiche du projet")}</Button>
          <ProgressPicker repo={repo} />
          <span className="ml-auto">
            <RepoMenu repo={repo} />
          </span>
        </div>
      </div>
    </Section>
  );
}
function AttentionCard({ repos }: { repos: RepoInfo[] }) {
  const setPage = useUi((s) => s.setPage);
  const openSheet = useUi((s) => s.openSheet);
  const flagged = repos.filter((r) => r.progress !== "done" && attention(r).length > 0);
  const shown = flagged.slice(0, 6);
  return (
    <Section
      title={t("À regarder")}
      action={
        flagged.length > shown.length && (
          <button type="button" onClick={() => setPage("projects")} className="flex items-center gap-1 text-xs text-muted hover:text-fg">
            {t("Les {n}", { n: flagged.length })} <ArrowRight className="size-3" />
          </button>
        )
      }
    >
      {shown.length === 0 ? (
        <p className="py-4 text-sm text-muted">{t("Tout est commité et à jour avec le dépôt distant.")}</p>
      ) : (
        <ul>
          {shown.map((repo) => (
            <li key={repo.path} className="group ink-row flex h-10 items-center gap-3 border-b border-line pr-1 pl-1 last:border-b-0">
              <button type="button" onClick={() => openSheet(repo.path)} className="min-w-0 flex-1 truncate text-left text-sm">
                {displayName(repo)}
              </button>
              <StatusChips repo={repo} max={2} />
              <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                <RepoMenu repo={repo} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** "jeu. 27", with the month only when the date is more than two weeks away. */
const dayText = (day: string | null) => {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const far = Math.abs(d.getTime() - Date.now()) > 14 * 86_400_000;
  return d.toLocaleDateString(locale(), far ? { day: "numeric", month: "short" } : { weekday: "short", day: "numeric" });
};

/** Hand-ins in three groups: late, to come, and school projects whose date is not known. Nothing is ever estimated. */
function DeadlinesBlock() {
  const board = useBoard();
  const now = useNow();
  const openSheet = useUi((s) => s.openSheet);
  const openLauncher = useUi((s) => s.openLauncher);
  const setPage = useUi((s) => s.setPage);
  const [showUnknown, setShowUnknown] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const items = board.data ?? [];
  // The state is recomputed here so that it changes when the hour passes, without waiting for a rescan.
  const withDue = items.map((i) => ({ i, d: due(i.day, i.at, now) }));
  const overdue = withDue.filter((x) => x.d.state === "overdue");
  const coming = withDue.filter((x) => x.d.state === "today" || x.d.state === "upcoming");
  const unknown = withDue.filter((x) => x.d.state === "unknown");
  const shownComing = showAll ? coming : coming.slice(0, 7);
  const row = ({ i, d }: { i: BoardItem; d: ReturnType<typeof due> }) => {
    const urgent = d.tone !== "neutral";
    return (
      <li key={`${i.repoPath ?? "my"}-${i.myId ?? i.title}`} className="border-b border-line last:border-b-0">
        <button
          type="button"
          onClick={() => (i.repoPath ? openSheet(i.repoPath) : i.repoExpected ? openLauncher({ mode: "new" }) : setPage("myepitech"))}
          title={i.repoPath ? `${i.repoPath}\n${i.source === "my" ? t("Date donnée par MY Epitech") : i.source === "manual" ? t("Date saisie par toi") : t("Date enregistrée plus tôt")}${i.myDay ? `\n${t("MY Epitech indique {d}", { d: i.myDay })}` : ""}` : i.repoExpected ? t("Listé par MY Epitech, pas encore de dépôt local. Clique pour le cloner.") : t("Listé par MY Epitech. Aucun dépôt n'est attendu pour ce projet.")}
          className="ink-row grid min-h-11 w-full grid-cols-[112px_minmax(0,1fr)_auto] items-center gap-3 py-1.5 text-left text-sm"
        >
          <span className={cn("rounded-sm px-1.5 py-0.5 font-mono text-xs whitespace-nowrap", urgent ? "ink-urgent text-fg" : "text-muted")}>{i.day ? `${dayText(i.day)}${d.time ? ` ${d.time}` : ""}` : "—"}</span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium">{i.title}</span>
              {!i.cloned && i.repoExpected && (
                <span className="flex shrink-0 items-center gap-1 text-2xs text-accent-strong">
                  <CloudDownload className="size-3" /> {t("pas cloné")}
                </span>
              )}
            </span>
            {i.module && <span className="block truncate font-mono text-2xs text-faint">{i.module}{i.starts ? ` · ${t("débute {d}", { d: dayText(i.starts.slice(0, 10)) })}` : ""}</span>}
          </span>
          {d.state !== "unknown" && <span className={cn("shrink-0 pr-1 text-xs", d.tone === "danger" ? "font-medium text-danger" : d.tone === "warn" ? "text-warn" : "text-faint")}>{d.label}</span>}
        </button>
      </li>
    );
  };
  return (
    <Section
      title={t("Rendus")}
      meta={board.isFetching ? <Spinner /> : overdue.length + coming.length > 0 ? `${plural(coming.length, "{n} à venir", "{n} à venir")}${overdue.length > 0 ? ` · ${plural(overdue.length, "{n} en retard", "{n} en retard")}` : ""}` : undefined}
    >
      {board.error ? (
        <div className="py-3">
          <ErrorNote title={t("Les dates de rendu n'ont pas pu être lues")}>{asAppError(board.error).message}</ErrorNote>
        </div>
      ) : board.isLoading ? (
        <p className="flex items-center gap-2 py-4 text-sm text-muted">
          <Spinner /> {t("Lecture des dates de rendu…")}
        </p>
      ) : items.length === 0 ? (
        <p className="flex items-start gap-2 py-4 text-sm text-muted">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-faint" />
          <span>
            {t("Aucune date de rendu connue. Synchronise")}{" "}
            <button type="button" className="text-accent-strong hover:underline" onClick={() => setPage("myepitech")}>
              MY Epitech
            </button>{" "}
            {t("pour les obtenir, ou saisis-en une dans la fiche d'un projet : TekBoard ne devine jamais une date.")}
          </span>
        </p>
      ) : (
        <>
          {overdue.length > 0 && (
            <>
              <SectionLabel className="pt-3 pb-1 text-danger">{t("En retard")}</SectionLabel>
              <ul>{overdue.map(row)}</ul>
            </>
          )}
          {coming.length > 0 && (
            <>
              {overdue.length > 0 && <SectionLabel className="pt-4 pb-1">{t("À venir")}</SectionLabel>}
              <ul>{shownComing.map(row)}</ul>
              {coming.length > shownComing.length && (
                <button type="button" onClick={() => setShowAll(true)} className="flex h-8 w-full items-center gap-1 text-xs text-muted hover:text-fg">
                  <ChevronRight className="size-3.5" /> {plural(coming.length - shownComing.length, "{n} de plus", "{n} de plus")}
                </button>
              )}
            </>
          )}
          {overdue.length + coming.length === 0 && <p className="py-3 text-sm text-muted">{t("Aucun rendu prévu.")}</p>}
          {unknown.length > 0 && (
            <>
              <button type="button" aria-expanded={showUnknown} onClick={() => setShowUnknown(!showUnknown)} className="mt-1 flex h-8 w-full items-center gap-1 text-xs text-muted hover:text-fg" title={t("Projets d'école pas terminés et sans date de rendu, ni saisie ni donnée par MY Epitech.")}>
                {showUnknown ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} {plural(unknown.length, "{n} sans date connue", "{n} sans date connue")}
              </button>
              {showUnknown && <ul>{unknown.map(row)}</ul>}
            </>
          )}
        </>
      )}
    </Section>
  );
}

const confidenceTone = { high: "ok", medium: "warn", low: "neutral" } as const;
const confidenceLabel = { high: t("Sans doute ton prochain projet"), medium: t("Correspondance possible"), low: t("Incertain") } as const;

function NextProjectCard() {
  const env = useEnv();
  const gh = env.data?.github;
  const candidates = useCandidates(gh?.state === "ready");
  const openLauncher = useUi((s) => s.openLauncher);
  const top: Candidate | undefined = candidates.data?.[0];
  const [why, setWhy] = useState(false);

  let body;
  if (!gh) {
    body = (
      <p className="flex items-center gap-2 py-4 text-sm text-muted">
        <Spinner /> {t("Vérification de GitHub…")}
      </p>
    );
  } else if (gh.state === "missing") {
    body = (
      <Hint>
        {t("Installe GitHub CLI pour voir les dépôts qui t'attendent :")} <Code>sudo apt install gh</Code> {t("puis")} <Code>gh auth login</Code>. {t("Cloner depuis une URL fonctionne sans.")}
      </Hint>
    );
  } else if (gh.state === "loggedOut") {
    body = (
      <Hint>
        {t("GitHub CLI est installé mais pas connecté. Lance")} <Code>gh auth login</Code> {t("dans un terminal, puis actualise.")}
      </Hint>
    );
  } else if (gh.state === "error") {
    body = <Hint>{t("GitHub est injoignable : {m}", { m: gh.message })}</Hint>;
  } else if (candidates.isLoading) {
    body = (
      <p className="flex items-center gap-2 py-4 text-sm text-muted">
        <Spinner /> {t("Recherche des dépôts pas encore clonés…")}
      </p>
    );
  } else if (candidates.error) {
    body = <Hint>{t("Impossible de lister tes dépôts : {m}", { m: asAppError(candidates.error).message })}</Hint>;
  } else if (!top) {
    body = <p className="py-4 text-sm text-muted">{t("Tous les dépôts auxquels tu as accès sont déjà clonés ici.")}</p>;
  } else {
    body = (
      <div className="py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="selectable truncate text-base font-semibold">{top.epitech?.project ?? top.repo.name}</h3>
          {top.epitech && <Tag>{top.epitech.module}</Tag>}
        </div>
        <p className="selectable mt-0.5 truncate font-mono text-xs text-faint">{top.repo.fullName}</p>
        <button type="button" aria-expanded={why} onClick={() => setWhy(!why)} title={t("Score {s}/100. Clique pour voir pourquoi", { s: top.score })} className="mt-3 flex items-center gap-1.5 text-left hover:text-fg">
          <Dot tone={confidenceTone[top.confidence]}>{confidenceLabel[top.confidence]}</Dot>
          {why ? <ChevronDown className="size-3.5 text-faint" /> : <ChevronRight className="size-3.5 text-faint" />}
        </button>
        {why && (
          <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
            {top.reasons.slice(0, 3).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex items-center gap-2">
          <Button icon={<Play className="size-3.5" />} onClick={() => openLauncher({ mode: "new", url: top.repo.sshUrl })}>
            {t("Initialiser")}
          </Button>
          {(candidates.data?.length ?? 0) > 1 && (
            <Button variant="ghost" onClick={() => openLauncher({ mode: "new" })}>
              {plural(candidates.data!.length - 1, "{n} autre", "{n} autres")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Section title={t("Prochain projet")}>{body}</Section>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="selectable py-3 text-sm leading-relaxed text-muted">{children}</p>;
}

const ACTIVITY_LABEL: Record<string, string> = {
  open_workspace: t("Espace de travail ouvert"),
  open_ide: t("Ouvert dans l'IDE"),
  open_terminal: t("Terminal ouvert"),
  clone: t("Cloné"),
  template_apply: t("Modèle appliqué"),
  template_import: t("Modèle importé"),
  commit: t("Commit"),
  build: t("Compilé"),
  subjects_import: t("Sujets importés"),
};

function ActivityCard({ repos }: { repos: RepoInfo[] }) {
  const activity = useActivity();
  const [all, setAll] = useState(false);
  const byPath = new Map(repos.map((r) => [r.path, r]));
  const label = (a: Activity) => {
    const repo = a.repoPath ? byPath.get(a.repoPath) : undefined;
    const name = repo ? displayName(repo) : (a.repoPath?.split("/").pop() ?? a.detail ?? "");
    return { verb: ACTIVITY_LABEL[a.kind] ?? a.kind, name };
  };
  return (
    <Section title={t("Activité récente")}>
      {activity.error ? (
        <div className="py-3">
          <ErrorNote>{asAppError(activity.error).message}</ErrorNote>
        </div>
      ) : (activity.data?.length ?? 0) === 0 ? (
        <p className="py-4 text-sm text-muted">{t("Ce que tu fais depuis TekBoard apparaîtra ici.")}</p>
      ) : (
        <ul className="py-1">
          {(all ? activity.data! : activity.data!.slice(0, 5)).map((a) => {
            const { verb, name } = label(a);
            return (
              <li key={a.id} className="flex h-8 items-center gap-2 border-b border-line text-sm last:border-b-0">
                <span className="shrink-0 text-muted">{verb}</span>
                <span className="selectable min-w-0 flex-1 truncate">{name}</span>
                <span className="shrink-0 text-xs text-faint">{timeAgo(a.ts)}</span>
              </li>
            );
          })}
          {!all && activity.data!.length > 5 && (
            <li>
              <button type="button" onClick={() => setAll(true)} className="flex h-8 w-full items-center gap-1 text-xs text-muted hover:text-fg">
                <ChevronRight className="size-3.5" /> {plural(activity.data!.length - 5, "{n} de plus", "{n} de plus")}
              </button>
            </li>
          )}
        </ul>
      )}
    </Section>
  );
}
