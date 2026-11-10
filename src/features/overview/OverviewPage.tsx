import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, Code2, FolderGit2, GitCommitHorizontal, Play, Plus, RefreshCw, SquareTerminal } from "lucide-react";
import { Badge, Button, Card, CardTitle, Code, EmptyState, ErrorNote, PageHeader, Spinner } from "../../components/ui";
import { asAppError, type Activity, type Candidate, type RepoInfo } from "../../lib/api";
import { greeting, timeAgo, tildify } from "../../lib/format";
import { keys, useActivity, useCandidates, useEnv, useHome, useProjectActions, useRepos, useSettings } from "../../lib/hooks";
import { attention, currentFocus, deadlineLabel, deadlines, displayName } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { BranchLabel, RepoActions, StatusChips } from "../projects/RepoBits";
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
            <DeadlinesCard repos={repos.data ?? []} />
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
          {repo.epitech && (
            <Badge tone="accent" mono>
              {repo.epitech.module}
            </Badge>
          )}
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
          <Button onClick={() => openSheet(repo.path)}>Notes &amp; deadline</Button>
          <Button icon={<Code2 className="size-3.5" />} onClick={() => act.ide.mutate(repo)}>
            IDE
          </Button>
          <Button icon={<SquareTerminal className="size-3.5" />} onClick={() => act.terminal.mutate(repo)}>
            Terminal
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AttentionCard({ repos }: { repos: RepoInfo[] }) {
  const setPage = useUi((s) => s.setPage);
  const openSheet = useUi((s) => s.openSheet);
  const flagged = repos.filter((r) => !r.meta.archived && attention(r).length > 0);
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
              <RepoActions repo={repo} className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DeadlinesCard({ repos }: { repos: RepoInfo[] }) {
  const openSheet = useUi((s) => s.openSheet);
  const list = deadlines(repos);
  return (
    <Card>
      <CardTitle>Deadlines</CardTitle>
      {list.length === 0 ? (
        <p className="flex items-start gap-2 px-4 py-4 text-[13px] text-muted">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-faint" />
          No deadline set. Click a project to add its due date — TekBoard never guesses one.
        </p>
      ) : (
        <ul className="py-1">
          {list.slice(0, 6).map(({ repo, days }) => (
            <li key={repo.path}>
              <button type="button" onClick={() => openSheet(repo.path)} className="flex h-9 w-full items-center gap-2 px-4 text-left text-[13px] row-hover">
                <span className="min-w-0 flex-1 truncate font-medium">{displayName(repo)}</span>
                <span className="shrink-0 text-xs text-faint">{repo.meta.deadline}</span>
                <Badge tone={days < 0 ? "danger" : days <= 2 ? "warn" : "neutral"}>{deadlineLabel(days)}</Badge>
              </button>
            </li>
          ))}
        </ul>
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
