import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, ChevronDown, ChevronRight, CloudDownload, FolderGit2, GitCommitHorizontal, Play, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button, Card, CardTitle, Code, Dot, EmptyState, ErrorNote, PageHeader, SectionLabel, Spinner, Tag } from "../../components/ui";
import { asAppError, type Activity, type BoardItem, type Candidate, type RepoInfo } from "../../lib/api";
import { timeAgo, tildify } from "../../lib/format";
import { keys, useActivity, useBoard, useCandidates, useEnv, useHome, useNow, usePref, useProjectActions, useRepos, useSettings } from "../../lib/hooks";
import { QuickActionsCard, TodayCard, WorkloadCard } from "./Today";
import { attention, currentFocus, displayName, due } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { BranchLabel, Countdown, DueBadge, ProgressPicker, RepoMenu, StatusChips } from "../projects/RepoBits";
import { Onboarding } from "../settings/Onboarding";

export function OverviewPage() {
  const settings = useSettings();
  const hasRoots = (settings.data?.roots.length ?? 0) > 0;
  const repos = useRepos(hasRoots);
  const qc = useQueryClient();

  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  if (settings.isLoading) return <Loading />;
  if (settings.error) return <ErrorNote title="TekBoard n'a pas pu lire ses réglages">{asAppError(settings.error).message}</ErrorNote>;

  return (
    <>
      <PageHeader
        title={today.charAt(0).toUpperCase() + today.slice(1)}
        actions={
          hasRoots && (
            <>
              <Button
                variant="ghost"
                icon={<RefreshCw className="size-3.5" />}
                busy={repos.isFetching}
                onClick={() => {
                  void qc.invalidateQueries({ queryKey: keys.repos });
                  void qc.invalidateQueries({ queryKey: keys.candidates });
                }}
              >
                Actualiser
              </Button>

            </>
          )
        }
      />

      {!hasRoots ? (
        <Onboarding />
      ) : repos.isLoading ? (
        <Loading />
      ) : repos.error ? (
        <ErrorNote title="Impossible de parcourir tes projets">{asAppError(repos.error).message}</ErrorNote>
      ) : (
        <>
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <TodayCard />
              <WorkloadCard />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <DeadlinesCard />
              <QuickActionsCard />
            </div>
          </div>
          <MoreSection repos={repos.data ?? []} />
        </>
      )}
    </>
  );
}

/** Repositories, recent activity and new projects: useful, but not what the day is about. Folded by default. */
function MoreSection({ repos }: { repos: RepoInfo[] }) {
  const [open, setOpen] = usePref("overview.more", false);
  const flagged = repos.filter((r) => r.progress !== "done" && attention(r).length > 0).length;
  return (
    <section className="mt-6">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mb-3 flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        Repositories and activity
        {flagged > 0 && <span className="text-xs text-faint">· {flagged} need attention</span>}
      </button>
      {open && (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          <FocusCard repo={currentFocus(repos)} />
          <AttentionCard repos={repos} />
          <div className="flex min-w-0 flex-col gap-4">
            <NextProjectCard />
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
      <Spinner /> Lecture de tes projets…
    </div>
  );
}

function FocusCard({ repo }: { repo: RepoInfo | null }) {
  const act = useProjectActions();
  const home = useHome();
  const openSheet = useUi((s) => s.openSheet);
  if (!repo) {
    return (
      <Card>
        <CardTitle>En cours</CardTitle>
        <EmptyState icon={<FolderGit2 className="size-6" />} title="Aucun dépôt dans tes dossiers de projets">
          Clone un projet pour commencer, ou ajoute un autre dossier dans Réglages.
        </EmptyState>
      </Card>
    );
  }
  return (
    <Card hero>
      <div className="p-6">
        <div className="flex items-center justify-between gap-3 text-xs text-faint">
          <span>Ouvert récemment</span>
          <span>{repo.meta.lastOpenedAt ? `opened ${timeAgo(repo.meta.lastOpenedAt)}` : "most recent commit"}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="display selectable truncate text-[20px] leading-[1.15] font-medium">{displayName(repo)}</h3>
          {(repo.my?.unitCode ?? repo.epitech?.module) && <Tag>{repo.my?.unitCode ?? repo.epitech?.module}</Tag>}
        </div>
        <p className="selectable mt-1 truncate font-mono text-xs text-faint">{tildify(repo.path, home)}</p>

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <DueBadge repo={repo} />
          <BranchLabel repo={repo} />
          <StatusChips repo={repo} max={4} />
        </div>

        {repo.lastCommit ? (
          <p className="mt-3 flex min-w-0 items-center gap-2 text-[13px] text-muted">
            <GitCommitHorizontal className="size-4 shrink-0 text-faint" />
            <span className="selectable truncate">{repo.lastCommit.subject}</span>
            <span className="shrink-0 text-faint">{timeAgo(repo.lastCommit.date)}</span>
          </p>
        ) : (
          <p className="mt-3 text-[13px] text-faint">Aucun commit</p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={<Play className="size-3.5" />} busy={act.workspace.isPending} onClick={() => act.workspace.mutate(repo)}>
            Reprendre
          </Button>
          <Button onClick={() => openSheet(repo.path)}>Fiche du projet</Button>
          <ProgressPicker repo={repo} />
          <span className="ml-auto">
            <RepoMenu repo={repo} />
          </span>
        </div>
      </div>
    </Card>
  );
}
function AttentionCard({ repos }: { repos: RepoInfo[] }) {
  const setPage = useUi((s) => s.setPage);
  const openSheet = useUi((s) => s.openSheet);
  const flagged = repos.filter((r) => r.progress !== "done" && attention(r).length > 0);
  const shown = flagged.slice(0, 6);
  return (
    <Card>
      <CardTitle
        right={
          flagged.length > shown.length && (
            <button type="button" onClick={() => setPage("projects")} className="flex items-center gap-1 text-xs text-muted hover:text-fg">
              All {flagged.length} <ArrowRight className="size-3" />
            </button>
          )
        }
      >
        À regarder
      </CardTitle>
      {shown.length === 0 ? (
        <p className="px-4 py-5 text-[13px] text-muted">Tout est commité et à jour avec le dépôt distant.</p>
      ) : (
        <ul>
          {shown.map((repo) => (
            <li key={repo.path} className="group row-hover flex h-10 items-center gap-3 border-b border-white/6 pr-2 pl-4 last:border-b-0">
              <button type="button" onClick={() => openSheet(repo.path)} className="min-w-0 flex-1 truncate text-left text-[13px]">
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
    </Card>
  );
}

const dayText = (day: string | null) => {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) : "";
};

/** Hand-ins in three groups: late, to come, and school projects whose date is not known. Nothing is ever estimated. */
function DeadlinesCard() {
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
  const shownComing = showAll ? coming : coming.slice(0, 6);
  const row = ({ i, d }: { i: BoardItem; d: ReturnType<typeof due> }) => (
    <li key={`${i.repoPath ?? "my"}-${i.myId ?? i.title}`}>
      <button
        type="button"
        onClick={() => (i.repoPath ? openSheet(i.repoPath) : i.repoExpected ? openLauncher({ mode: "new" }) : setPage("myepitech"))}
        title={i.repoPath ? `${i.repoPath}\n${i.source === "my" ? "Date from MY Epitech" : i.source === "manual" ? "Date typed by you" : "Date saved earlier"}${i.myDay ? `\nMY Epitech says ${i.myDay}` : ""}` : i.repoExpected ? "Listed by MY Epitech, no local repository yet. Click to clone it." : "Listed by MY Epitech. No repository is expected for it."}
        className="row-hover flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-[13px]"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate">{i.title}</span>
            {!i.cloned && i.repoExpected && (
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-info">
                <CloudDownload className="size-3" /> pas cloné
              </span>
            )}
          </span>
          {i.module && <span className="block truncate font-mono text-[11px] text-faint">{i.module}{i.starts ? ` · starts ${dayText(i.starts.slice(0, 10))}` : ""}</span>}
        </span>
        {i.day && <span className="shrink-0 text-xs text-faint">{dayText(i.day)}</span>}
        {d.state !== "unknown" && (
          <span className="flex w-24 shrink-0 justify-end">
            <Countdown tone={d.tone}>{d.label}</Countdown>
          </span>
        )}
      </button>
    </li>
  );
  return (
    <Card>
      <CardTitle right={board.isFetching ? <Spinner /> : overdue.length + coming.length > 0 ? <span className="text-xs text-faint">{coming.length} to come{overdue.length > 0 ? ` · ${overdue.length} late` : ""}</span> : undefined}>Rendus</CardTitle>
      {board.error ? (
        <div className="p-3">
          <ErrorNote title="Les dates de rendu n'ont pas pu être lues">{asAppError(board.error).message}</ErrorNote>
        </div>
      ) : board.isLoading ? (
        <p className="flex items-center gap-2 px-4 py-4 text-[13px] text-muted">
          <Spinner /> Lecture des dates de rendu…
        </p>
      ) : items.length === 0 ? (
        <p className="flex items-start gap-2 px-4 py-4 text-[13px] text-muted">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-faint" />
          <span>
            No hand-in date is known. Sync{" "}
            <button type="button" className="text-accent-strong hover:underline" onClick={() => setPage("myepitech")}>
              MY Epitech
            </button>{" "}
            to get them, or set one in a project sheet — TekBoard never guesses a date.
          </span>
        </p>
      ) : (
        <div className="py-1">
          {overdue.length > 0 && (
            <>
              <SectionLabel className="px-4 pt-2 pb-1">En retard</SectionLabel>
              <ul>{overdue.map(row)}</ul>
            </>
          )}
          {coming.length > 0 && (
            <>
              {overdue.length > 0 && <SectionLabel className="px-4 pt-3 pb-1">À venir</SectionLabel>}
              <ul>{shownComing.map(row)}</ul>
              {coming.length > shownComing.length && (
                <button type="button" onClick={() => setShowAll(true)} className="flex h-8 w-full items-center gap-1 px-4 text-xs text-muted hover:text-fg">
                  <ChevronRight className="size-3.5" /> {coming.length - shownComing.length} more
                </button>
              )}
            </>
          )}
          {overdue.length + coming.length === 0 && <p className="px-4 py-2 text-[13px] text-muted">Aucun rendu prévu.</p>}
          {unknown.length > 0 && (
            <>
              <button type="button" aria-expanded={showUnknown} onClick={() => setShowUnknown(!showUnknown)} className="mt-1 flex h-8 w-full items-center gap-1 border-t border-white/6 px-4 text-xs text-muted hover:text-fg" title="Projets d'école pas terminés et sans date de rendu, ni saisie ni donnée par MY Epitech.">
                {showUnknown ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} {unknown.length} without a known date
              </button>
              {showUnknown && <ul>{unknown.map(row)}</ul>}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

const confidenceTone = { high: "ok", medium: "warn", low: "neutral" } as const;
const confidenceLabel = { high: "Likely your next project", medium: "Possible match", low: "Uncertain" } as const;

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
      <p className="flex items-center gap-2 px-4 py-5 text-[13px] text-muted">
        <Spinner /> Vérification de GitHub…
      </p>
    );
  } else if (gh.state === "missing") {
    body = (
      <Hint>
        Installe GitHub CLI pour voir les dépôts qui t'attendent : <Code>sudo apt install gh</Code> then <Code>gh auth login</Code>. Cloner depuis une URL fonctionne sans.
      </Hint>
    );
  } else if (gh.state === "loggedOut") {
    body = (
      <Hint>
        GitHub CLI est installé mais pas connecté. Lance <Code>gh auth login</Code> dans un terminal, puis actualise.
      </Hint>
    );
  } else if (gh.state === "error") {
    body = <Hint>GitHub could not be reached: {gh.message}</Hint>;
  } else if (candidates.isLoading) {
    body = (
      <p className="flex items-center gap-2 px-4 py-5 text-[13px] text-muted">
        <Spinner /> Recherche des dépôts pas encore clonés…
      </p>
    );
  } else if (candidates.error) {
    body = <Hint>Could not list your repositories: {asAppError(candidates.error).message}</Hint>;
  } else if (!top) {
    body = <p className="px-4 py-5 text-[13px] text-muted">Tous les dépôts auxquels tu as accès sont déjà clonés ici.</p>;
  } else {
    body = (
      <div className="px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="display selectable truncate text-base font-medium">{top.epitech?.project ?? top.repo.name}</h3>
          {top.epitech && <Tag>{top.epitech.module}</Tag>}
        </div>
        <p className="selectable mt-0.5 truncate font-mono text-xs text-faint">{top.repo.fullName}</p>
        <button type="button" aria-expanded={why} onClick={() => setWhy(!why)} title={`Score ${top.score}/100. Click to see why`} className="mt-3 flex items-center gap-1.5 text-left hover:text-fg">
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
            Initialiser
          </Button>
          {(candidates.data?.length ?? 0) > 1 && (
            <Button variant="ghost" onClick={() => openLauncher({ mode: "new" })}>
              {candidates.data!.length - 1} other{candidates.data!.length > 2 ? "s" : ""}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardTitle>Prochain projet</CardTitle>
      {body}
    </Card>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="selectable px-4 py-4 text-[13px] leading-relaxed text-muted">{children}</p>;
}

const ACTIVITY_LABEL: Record<string, string> = {
  open_workspace: "Opened workspace",
  open_ide: "Opened in IDE",
  open_terminal: "Opened terminal",
  clone: "Cloned",
  template_apply: "Applied template",
  template_import: "Imported template",
  commit: "Committed",
  build: "Built",
  subjects_import: "Imported subjects",
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
    <Card>
      <CardTitle>Activité récente</CardTitle>
      {activity.error ? (
        <div className="p-3">
          <ErrorNote>{asAppError(activity.error).message}</ErrorNote>
        </div>
      ) : (activity.data?.length ?? 0) === 0 ? (
        <p className="px-4 py-5 text-[13px] text-muted">Ce que tu fais depuis TekBoard apparaîtra ici.</p>
      ) : (
        <ul className="py-1">
          {(all ? activity.data! : activity.data!.slice(0, 5)).map((a) => {
            const { verb, name } = label(a);
            return (
              <li key={a.id} className="flex h-8 items-center gap-2 px-4 text-[13px]">
                <span className="shrink-0 text-muted">{verb}</span>
                <span className="selectable min-w-0 flex-1 truncate">{name}</span>
                <span className="shrink-0 text-xs text-faint">{timeAgo(a.ts)}</span>
              </li>
            );
          })}
          {!all && activity.data!.length > 5 && (
            <li>
              <button type="button" onClick={() => setAll(true)} className="flex h-8 w-full items-center gap-1 px-4 text-xs text-muted hover:text-fg">
                <ChevronRight className="size-3.5" /> {activity.data!.length - 5} more
              </button>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}
