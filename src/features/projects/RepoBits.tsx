// Pieces used wherever a repository is shown: status chips and the action buttons.
import { Code2, Copy, FolderOpen, GitBranch, Star, SquareTerminal } from "lucide-react";
import { Badge, cn, IconButton } from "../../components/ui";
import type { RepoInfo } from "../../lib/api";
import { useProjectActions } from "../../lib/hooks";
import { attention } from "../../lib/repos";

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

export function RepoActions({ repo, className }: { repo: RepoInfo; className?: string }) {
  const act = useProjectActions();
  return (
    <span className={cn("flex items-center", className)}>
      <IconButton label="Open in IDE" onClick={() => act.ide.mutate(repo)}>
        <Code2 className="size-4" />
      </IconButton>
      <IconButton label="Open terminal here" onClick={() => act.terminal.mutate(repo)}>
        <SquareTerminal className="size-4" />
      </IconButton>
      <IconButton label="Show in Files" onClick={() => act.files.mutate(repo)}>
        <FolderOpen className="size-4" />
      </IconButton>
      <IconButton label={repo.remoteUrl ? "Copy remote URL" : "No remote"} disabled={!repo.remoteUrl} onClick={() => act.copyUrl(repo)}>
        <Copy className="size-4" />
      </IconButton>
    </span>
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
