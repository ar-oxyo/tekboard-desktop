// Pieces used wherever a repository is shown: status chips, the progress picker and the action menu.
import { CircleCheck, CircleDashed, CircleDot, Code2, Copy, FlaskConical, FolderOpen, GitBranch, Globe, GraduationCap, LayoutTemplate, NotebookPen, Rocket, Star, SquareTerminal, User, Wand2 } from "lucide-react";
import type { ReactNode } from "react";
import { Menu, MenuChoice, MenuItem, MenuLabel, MenuSeparator, SubMenu } from "../../components/Menu";
import { Badge, cn, IconButton } from "../../components/ui";
import type { Progress, RepoInfo } from "../../lib/api";
import { useProjectActions } from "../../lib/hooks";
import { attention, dueOf } from "../../lib/repos";
import { useUi } from "../../lib/store";

export function BranchLabel({ repo }: { repo: RepoInfo }) {
  const s = repo.status;
  if (!s) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 font-mono text-xs text-muted" title={s.upstream ? `Tracks ${s.upstream}` : "No upstream"}>
      <GitBranch className="size-3 shrink-0 text-faint" />
      <span className="truncate">{s.branch ?? "detached"}</span>
    </span>
  );
}

export function StatusChips({ repo, max = 3 }: { repo: RepoInfo; max?: number }) {
  const items = attention(repo);
  if (repo.error) {
    return (
      <Badge tone="danger" title={repo.error}>
        Unreadable
      </Badge>
    );
  }
  if (items.length === 0) return <span className="text-xs text-faint">Clean</span>;
  return (
    <span className="flex items-center gap-1">
      {items.slice(0, max).map((a) => (
        <Badge key={a.label} tone={a.level}>
          {a.label}
        </Badge>
      ))}
    </span>
  );
}

/** Hand-in badge: "in 9 days", "today 19:42", "3 h late". Nothing when no date is known. */
export function DueBadge({ repo, now }: { repo: RepoInfo; now?: Date }) {
  if (repo.progress === "done" || !repo.meta.deadline) return null;
  const d = dueOf(repo, now);
  if (d.state === "unknown") return null;
  const origin = repo.meta.deadlineSource === "my" ? "from MY Epitech" : repo.meta.deadlineSource === "manual" ? "typed by you" : "saved earlier";
  return (
    <Badge tone={d.tone} title={`Hand-in ${repo.meta.deadline}${d.time ? ` at ${d.time}` : ""} (${origin})`}>
      {d.label}
    </Badge>
  );
}

export const PROGRESS: Array<{ id: Progress; label: string; icon: ReactNode; tone: string }> = [
  { id: "todo", label: "To do", icon: <CircleDashed className="size-3.5" />, tone: "text-muted" },
  { id: "in_progress", label: "In progress", icon: <CircleDot className="size-3.5" />, tone: "text-info" },
  { id: "done", label: "Done", icon: <CircleCheck className="size-3.5" />, tone: "text-ok" },
];

/** To do / In progress / Done. Applied at once and reversible from anywhere, a finished project included. */
export function ProgressPicker({ repo, compact }: { repo: RepoInfo; compact?: boolean }) {
  const act = useProjectActions();
  const cur = PROGRESS.find((p) => p.id === repo.progress) ?? PROGRESS[0];
  const title = repo.progressInferred ? `${cur.label} — not set by you: follows the hand-in date and recent activity. Click to choose.` : `${cur.label} — click to change`;
  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          title={title}
          aria-label={`Status: ${cur.label}. Change`}
          className={cn(
            "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs transition-colors hover:border-line-strong hover:bg-hover focus-visible:border-accent focus-visible:outline-none",
            repo.progressInferred ? "border-dashed border-white/12" : "border-white/12",
            cur.tone,
          )}
        >
          {cur.icon}
          {!compact && <span className={repo.progressInferred ? "opacity-80" : ""}>{cur.label}</span>}
        </button>
      }
    >
      <MenuLabel>Status</MenuLabel>
      {PROGRESS.map((p) => (
        <MenuChoice key={p.id} checked={p.id === repo.progress && !repo.progressInferred} icon={<span className={p.tone}>{p.icon}</span>} onSelect={() => act.progress.mutate({ repo, status: p.id })} hint={p.id === repo.progress && repo.progressInferred ? "current" : undefined}>
          {p.label}
        </MenuChoice>
      ))}
    </Menu>
  );
}

/** Everything that is not the main action of a row or a sheet. */
export function RepoMenu({ repo, sheet = true }: { repo: RepoInfo; sheet?: boolean }) {
  const act = useProjectActions();
  const openSheet = useUi((s) => s.openSheet);
  const openGit = useUi((s) => s.openGit);
  const openTesting = useUi((s) => s.openTesting);
  const openLauncher = useUi((s) => s.openLauncher);
  const hasRemote = repo.remoteUrl !== null;
  return (
    <Menu label={`More actions for ${repo.name}`}>
      {sheet && (
        <MenuItem icon={<NotebookPen className="size-4" />} onSelect={() => openSheet(repo.path)}>
          Project sheet
        </MenuItem>
      )}
      <MenuItem icon={<Code2 className="size-4" />} onSelect={() => act.ide.mutate(repo)}>
        Open in IDE
      </MenuItem>
      <MenuItem icon={<SquareTerminal className="size-4" />} onSelect={() => act.terminal.mutate(repo)}>
        Open terminal here
      </MenuItem>
      <MenuItem icon={<FolderOpen className="size-4" />} onSelect={() => act.files.mutate(repo)}>
        Show in Files
      </MenuItem>
      <MenuItem icon={<Rocket className="size-4" />} onSelect={() => act.launch.mutate(repo)} title="Starts the program this project builds, in a terminal">
        Launch binary
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Globe className="size-4" />} disabled={!hasRemote} onSelect={() => act.remote.mutate(repo)} hint={hasRemote ? "Firefox" : "no remote"} title={hasRemote ? (repo.remoteUrl ?? undefined) : "This repository has no remote"}>
        Open on GitHub
      </MenuItem>
      <MenuItem icon={<Copy className="size-4" />} disabled={!hasRemote} onSelect={() => act.copyUrl(repo)}>
        Copy remote URL
      </MenuItem>
      <MenuItem icon={<GitBranch className="size-4" />} onSelect={() => openGit(repo.path)}>
        Git
      </MenuItem>
      <MenuItem icon={<FlaskConical className="size-4" />} onSelect={() => openTesting(repo.path)}>
        Testing
      </MenuItem>
      <MenuItem icon={<LayoutTemplate className="size-4" />} onSelect={() => openLauncher({ mode: "existing", path: repo.path })}>
        Apply a template…
      </MenuItem>
      <MenuSeparator />
      <SubMenu icon={<CircleDot className="size-4" />} label="Status">
        {PROGRESS.map((p) => (
          <MenuChoice key={p.id} checked={p.id === repo.progress} icon={<span className={p.tone}>{p.icon}</span>} onSelect={() => act.progress.mutate({ repo, status: p.id })}>
            {p.label}
          </MenuChoice>
        ))}
      </SubMenu>
      <SubMenu icon={repo.kind === "epitech" ? <GraduationCap className="size-4" /> : <User className="size-4" />} label="Classification">
        <MenuLabel>{repo.kind === "epitech" ? "Epitech" : "Personal"} — {repo.kindReason}</MenuLabel>
        <MenuChoice checked={repo.meta.kindOverride === "epitech"} icon={<GraduationCap className="size-4" />} onSelect={() => act.kind.mutate({ repo, kind: "epitech" })}>
          Epitech
        </MenuChoice>
        <MenuChoice checked={repo.meta.kindOverride === "personal"} icon={<User className="size-4" />} onSelect={() => act.kind.mutate({ repo, kind: "personal" })}>
          Personal
        </MenuChoice>
        <MenuChoice checked={repo.meta.kindOverride === null} icon={<Wand2 className="size-4" />} onSelect={() => act.kind.mutate({ repo, kind: null })}>
          Automatic
        </MenuChoice>
      </SubMenu>
    </Menu>
  );
}

export function FavoriteButton({ repo }: { repo: RepoInfo }) {
  const act = useProjectActions();
  return (
    <IconButton label={repo.meta.favorite ? "Remove from favorites" : "Add to favorites"} active={repo.meta.favorite} onClick={() => act.favorite.mutate(repo)}>
      <Star className="size-4" fill={repo.meta.favorite ? "currentColor" : "none"} />
    </IconButton>
  );
}
