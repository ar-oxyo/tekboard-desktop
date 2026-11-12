import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, ChevronDown, ChevronRight, CloudDownload, FolderGit2, GitCommitHorizontal, Play, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, CardTitle, Code, EmptyState, ErrorNote, PageHeader, Spinner } from "../../components/ui";
import { asAppError, type Activity, type BoardItem, type Candidate, type RepoInfo } from "../../lib/api";
import { greeting, timeAgo, tildify } from "../../lib/format";
import { keys, useActivity, useBoard, useCandidates, useEnv, useHome, useNow, useProjectActions, useRepos, useSettings } from "../../lib/hooks";
import { attention, currentFocus, displayName, due } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { BranchLabel, DueBadge, ProgressPicker, RepoMenu, StatusChips } from "../projects/RepoBits";
import { Onboarding } from "../settings/Onboarding";

export function OverviewPage() {
  const settings = useSettings();
  const hasRoots = (settings.data?.roots.length ?? 0) > 0;
  const repos = useRepos(hasRoots);
  const qc = useQueryClient();
  const openLauncher = useUi((s) => s.openLauncher);

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  if (settings.isLoading) return <Loading />;
  if (settings.error) return <ErrorNote title="TekBoard could not read its settings">{asAppError(settings.error).message}</ErrorNote>;

  return (
    <>
      <PageHeader
        title={greeting()}
        subtitle={today}
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
                Refresh
              </Button>
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openLauncher({ mode: "new" })}>
                New project
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
        <ErrorNote title="Could not scan your projects">{asAppError(repos.error).message}</ErrorNote>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <FocusCard repo={currentFocus(repos.data ?? [])} />
            <AttentionCard repos={repos.data ?? []} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <DeadlinesCard />
            <NextProjectCard />
            <ActivityCard repos={repos.data ?? []} />
          </div>
        </div>
      )}
    </>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-16 text-muted">
      <Spinner /> Reading your projects…
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
        <CardTitle>Current focus</CardTitle>
        <EmptyState icon={<FolderGit2 className="size-6" />} title="No repository found in your projects folders">
          Clone a project to get started, or add another folder in Settings.
        </EmptyState>
      </Card>
    );
  }
  return (
    <Card hero>
      <CardTitle right={repo.meta.lastOpenedAt ? <span className="text-xs text-faint">opened {timeAgo(repo.meta.lastOpenedAt)}</span> : <span className="text-xs text-faint">most recent commit</span>}>
        Current focus
      </CardTitle>
      <div className="px-5 pt-5 pb-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="display selectable truncate text-[26px] leading-tight font-semibold">{displayName(repo)}</h3>
          {(repo.my?.unitCode ?? repo.epitech?.module) && (
            <Badge tone="accent" mono>
              {repo.my?.unitCode ?? repo.epitech?.module}
            </Badge>
          )}
          <DueBadge repo={repo} />
        </div>
        <p className="selectable mt-0.5 truncate font-mono text-xs text-faint">{tildify(repo.path, home)}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <BranchLabel repo={repo} />
          <StatusChips repo={repo} max={4} />
        </div>

        {repo.lastCommit ? (
          <p className="mt-3 flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
            <GitCommitHorizontal className="size-3.5 shrink-0 text-faint" />
            <span className="selectable truncate">{repo.lastCommit.subject}</span>
            <span className="shrink-0 text-faint">· {timeAgo(repo.lastCommit.date)}</span>
          </p>
        ) : (
          <p className="mt-3 text-[13px] text-faint">No commit yet</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={<Play className="size-3.5" />} busy={act.workspace.isPending} onClick={() => act.workspace.mutate(repo)}>
            Continue working
          </Button>
          <Button onClick={() => openSheet(repo.path)}>Project sheet</Button>
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
        Needs attention
      </CardTitle>
      {shown.length === 0 ? (
        <p className="px-4 py-5 text-[13px] text-muted">Everything is committed and in sync with its remote.</p>
      ) : (
        <ul>
          {shown.map((repo) => (
            <li key={repo.path} className="group flex h-11 items-center gap-3 border-b border-white/6 px-4 last:border-b-0 row-hover">
              <button type="button" onClick={() => openSheet(repo.path)} className="min-w-0 flex-1 truncate text-left text-[13px] font-medium hover:text-accent-strong">
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
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "";
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
        className="flex min-h-9 w-full items-center gap-2 px-4 py-1 text-left text-[13px] row-hover"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium">{i.title}</span>
            {!i.cloned && i.repoExpected && (
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-info">
                <CloudDownload className="size-3" /> not cloned
              </span>
            )}
          </span>
          {i.module && <span className="block truncate font-mono text-[11px] text-faint">{i.module}{i.starts ? ` · starts ${dayText(i.starts.slice(0, 10))}` : ""}</span>}
        </span>
        {i.day && <span className="shrink-0 text-xs text-faint">{dayText(i.day)}</span>}
        {d.state !== "unknown" && <Badge tone={d.tone}>{d.label}</Badge>}
      </button>
    </li>
  );
  return (
    <Card>
      <CardTitle right={board.isFetching ? <Spinner /> : overdue.length + coming.length > 0 ? <span className="text-xs text-faint">{coming.length} to come{overdue.length > 0 ? ` · ${overdue.length} late` : ""}</span> : undefined}>Deadlines</CardTitle>
      {board.error ? (
        <div className="p-3">
          <ErrorNote title="Deadlines could not be read">{asAppError(board.error).message}</ErrorNote>
        </div>
      ) : board.isLoading ? (
        <p className="flex items-center gap-2 px-4 py-4 text-[13px] text-muted">
          <Spinner /> Reading hand-in dates…
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
              <p className="px-4 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-[0.12em] text-danger uppercase">Late</p>
              <ul>{overdue.map(row)}</ul>
            </>
          )}
          {coming.length > 0 && (
            <>
              {overdue.length > 0 && <p className="px-4 pt-2 pb-0.5 text-[10px] font-semibold tracking-[0.12em] text-faint uppercase">To come</p>}
              <ul>{shownComing.map(row)}</ul>
              {coming.length > shownComing.length && (
                <button type="button" onClick={() => setShowAll(true)} className="flex h-8 w-full items-center gap-1 px-4 text-xs text-muted hover:text-fg">
                  <ChevronRight className="size-3.5" /> {coming.length - shownComing.length} more
                </button>
              )}
            </>
          )}
          {overdue.length + coming.length === 0 && <p className="px-4 py-2 text-[13px] text-muted">Nothing is due.</p>}
          {unknown.length > 0 && (
            <>
              <button type="button" aria-expanded={showUnknown} onClick={() => setShowUnknown(!showUnknown)} className="mt-1 flex h-8 w-full items-center gap-1 border-t border-white/6 px-4 text-xs text-muted hover:text-fg" title="School projects that are not finished and have no hand-in date, neither typed nor reported by MY Epitech.">
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

  let body;
  if (!gh) {
    body = (
      <p className="flex items-center gap-2 px-4 py-5 text-[13px] text-muted">
        <Spinner /> Checking GitHub…
      </p>
    );
  } else if (gh.state === "missing") {
    body = (
      <Hint>
        Install GitHub CLI to see the repositories waiting for you: <Code>sudo apt install gh</Code> then <Code>gh auth login</Code>. Cloning from a URL works without it.
      </Hint>
    );
  } else if (gh.state === "loggedOut") {
    body = (
      <Hint>
        GitHub CLI is installed but not logged in. Run <Code>gh auth login</Code> in a terminal, then refresh.
      </Hint>
    );
  } else if (gh.state === "error") {
    body = <Hint>GitHub could not be reached: {gh.message}</Hint>;
  } else if (candidates.isLoading) {
    body = (
      <p className="flex items-center gap-2 px-4 py-5 text-[13px] text-muted">
        <Spinner /> Looking for repositories you have not cloned…
      </p>
    );
  } else if (candidates.error) {
    body = <Hint>Could not list your repositories: {asAppError(candidates.error).message}</Hint>;
  } else if (!top) {
    body = <p className="px-4 py-5 text-[13px] text-muted">Every repository you can access is already cloned here.</p>;
  } else {
    body = (
      <div className="px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="display selectable truncate text-lg font-semibold">{top.epitech?.project ?? top.repo.name}</h3>
          {top.epitech && (
            <Badge tone="accent" mono>
              {top.epitech.module}
            </Badge>
          )}
        </div>
        <p className="selectable mt-0.5 truncate font-mono text-xs text-faint">{top.repo.fullName}</p>
        <div className="mt-2.5">
          <Badge tone={confidenceTone[top.confidence]} title={`Score ${top.score}/100`}>
            {confidenceLabel[top.confidence]}
          </Badge>
        </div>
        <ul className="mt-2 space-y-0.5 text-xs text-muted">
          {top.reasons.slice(0, 3).map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
        <div className="mt-3.5 flex items-center gap-2">
          <Button variant="primary" icon={<Play className="size-3.5" />} onClick={() => openLauncher({ mode: "new", url: top.repo.sshUrl })}>
            Initialize
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
      <CardTitle>Next project</CardTitle>
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
  const byPath = new Map(repos.map((r) => [r.path, r]));
  const label = (a: Activity) => {
    const repo = a.repoPath ? byPath.get(a.repoPath) : undefined;
    const name = repo ? displayName(repo) : (a.repoPath?.split("/").pop() ?? a.detail ?? "");
    return { verb: ACTIVITY_LABEL[a.kind] ?? a.kind, name };
  };
  return (
    <Card>
      <CardTitle>Recent activity</CardTitle>
      {activity.error ? (
        <div className="p-3">
          <ErrorNote>{asAppError(activity.error).message}</ErrorNote>
        </div>
      ) : (activity.data?.length ?? 0) === 0 ? (
        <p className="px-4 py-5 text-[13px] text-muted">What you do from TekBoard will show up here.</p>
      ) : (
        <ul className="py-1.5">
          {activity.data!.map((a) => {
            const { verb, name } = label(a);
            return (
              <li key={a.id} className="flex h-8 items-center gap-2 px-4 text-[13px]">
                <span className="shrink-0 text-muted">{verb}</span>
                <span className="selectable min-w-0 flex-1 truncate font-medium">{name}</span>
                <span className="shrink-0 text-xs text-faint">{timeAgo(a.ts)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
