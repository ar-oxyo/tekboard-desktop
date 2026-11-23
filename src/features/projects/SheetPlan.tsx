// Project sheet, organisation side: where the project stands, what comes next, and the tabs
// that hold everything else (Git, Advanced). Each action has one place.
import { CalendarClock, CalendarPlus, Code2, Copy, FolderOpen, GitBranch, GitCommitHorizontal, Globe, GraduationCap, LayoutTemplate, ListTree, Play, SquareTerminal, Trash2, User, Wand2 } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Button, cn, Dot, IconButton, Input, SectionLabel } from "../../components/ui";
import type { RepoInfo } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { useNow, useProjectActions } from "../../lib/hooks";
import { durInput, fmtDur, hhmm, parseDur, PRIORITY, taskProgress } from "../../lib/plan";
import { suggestPlan } from "../tika/suggest";
import { useUi } from "../../lib/store";
import { startFocus } from "../planning/Focus";
import { useLoads, usePlanActions, usePlanData } from "../planning/usePlan";
import { BranchLabel, StatusChips } from "./RepoBits";

const RISK_TONE = { late: "danger", risk: "warn", ok: "ok", unknown: "neutral" } as const;

/** Where am I, what do I do next. */
export function PlanOverview({ repo }: { repo: RepoInfo }) {
  const data = usePlanData();
  const act = usePlanActions();
  const now = useNow().getTime();
  const loads = useLoads(data, now);
  const key = repo.path;
  const project = data.projects.find((p) => p.key === key);
  const load = loads.get(key);
  const tasks = data.state.tasks.filter((t) => t.project === key && t.kind === "task");
  const open = tasks.filter((t) => t.doneAt === null && t.parentId === null).sort((a, b) => b.priority - a.priority || (a.dueDay ?? "9").localeCompare(b.dueDay ?? "9"));
  const progress = taskProgress(data.state.tasks, key);
  const [title, setTitle] = useState("");
  const [estimate, setEstimate] = useState<string | null>(null);
  const logged = data.state.log.filter((l) => l.project === key).reduce((s, l) => s + l.seconds / 60, 0);
  const next = load?.next;
  const my = repo.my;
  const head = repo.lastCommit?.hash ?? "";
  const undelivered = !!my?.delivery && head !== "" && !head.startsWith(my.delivery.commit) && !my.delivery.commit.startsWith(head);

  const saveEstimate = () => {
    if (estimate === null) return;
    const m = estimate.trim() === "" ? null : parseDur(estimate);
    if (estimate.trim() !== "" && m === null) return useUi.getState().toast({ kind: "error", title: "Écris le travail restant comme 12h, 1h30 ou 45m" });
    act.setProject.mutate({ key, estimateMin: m });
    setEstimate(null);
  };
  const planSessions = () => {
    if (!project) return;
    if (project.estimateMin === null) return useUi.getState().toast({ kind: "info", title: "Indique d'abord le travail restant" });
    void suggestPlan("two_weeks", key);
  };

  return (
    <div className="grid grid-cols-2 gap-4">
      <section className="flex flex-col gap-3 rounded-lg border border-white/7 p-4">
        <SectionLabel>Où tu en es</SectionLabel>
        {(my?.tooManyAbsences || my?.nonCompliant) && (
          <p className="-mt-1 rounded-md border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-xs text-warn">
            MY Epitech flags this group: {[my.tooManyAbsences && "too many absences", my.nonCompliant && "non compliant"].filter(Boolean).join(", ")}. Check with the module's staff.
          </p>
        )}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
            <span>{progress ? `${progress.done} of ${progress.total} tasks done` : "No task yet"}</span>
            {load && load.risk !== "unknown" && <Dot tone={RISK_TONE[load.risk]}>{load.why}</Dot>}
          </div>
          <span className="block h-1.5 overflow-hidden rounded-full bg-white/6">
            <span className="block h-full rounded-full transition-all duration-300" style={{ width: `${progress ? (progress.done / progress.total) * 100 : 0}%`, background: project?.color ?? "var(--color-accent)" } as CSSProperties} />
          </span>
        </div>
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-[13px]">
          <dt className="text-muted">Travail restant</dt>
          <dd>
            {estimate === null ? (
              <button type="button" className="rounded px-1 -mx-1 hover:bg-hover" onClick={() => setEstimate(durInput(project?.estimateMin ?? null))} title="Ton estimation. Le temps enregistré en session en est déduit.">
                {project?.estimateMin != null ? fmtDur(project.estimateMin) : <span className="text-faint">donner une estimation</span>}
              </button>
            ) : (
              <Input autoFocus className="h-7 w-28" placeholder="12h" value={estimate} onChange={(e) => setEstimate(e.target.value)} onBlur={saveEstimate} onKeyDown={(e) => e.key === "Enter" && saveEstimate()} />
            )}
          </dd>
          <dt className="text-muted">Planifié</dt>
          <dd>{fmtDur(load?.planned ?? 0)} in the calendar</dd>
          <dt className="text-muted">Temps passé</dt>
          <dd>{logged > 0 ? fmtDur(logged) : <span className="text-faint">rien d'enregistré</span>}</dd>
          <dt className="text-muted">Priorité</dt>
          <dd className="flex gap-1">
            {PRIORITY.map((label, i) => (
              <button key={label} type="button" aria-pressed={(project?.priority ?? 0) === i} onClick={() => act.setProject.mutate({ key, priority: i })} className={cn("h-6 rounded-md px-2 text-xs transition-colors duration-150", (project?.priority ?? 0) === i ? "bg-raised text-fg" : "text-faint hover:text-fg")}>
                {i === 0 ? "None" : label}
              </button>
            ))}
          </dd>
          {my?.quota && (
            <>
              <dt className="text-muted">Moulinette</dt>
              <dd className={cn(my.quota[1] <= 1 && "text-warn")} title="Exécutions de tests automatiques que ton groupe peut encore demander, d'après MY Epitech">
                {my.quota[1]} of {my.quota[0]} runs left
              </dd>
            </>
          )}
          {my?.delivery && (
            <>
              <dt className="text-muted">Rendu</dt>
              <dd className="flex min-w-0 items-center gap-2" title="La dernière révision poussée par ton groupe : ce que la moulinette teste">
                <span className="font-mono text-xs">{my.delivery.commit.slice(0, 7)}</span>
                <span className="truncate text-xs text-faint">
                  {my.delivery.branch ?? ""}
                  {my.delivery.pushedAt ? ` · ${timeAgo(my.delivery.pushedAt)}` : ""}
                </span>
                {undelivered && <Dot tone="warn">ton dernier commit n'est pas rendu</Dot>}
              </dd>
            </>
          )}
          <dt className="text-muted">Code</dt>
          <dd className="flex min-w-0 items-center gap-3">
            <BranchLabel repo={repo} quiet />
            <StatusChips repo={repo} max={2} />
          </dd>
        </dl>
        {repo.lastCommit && (
          <p className="flex min-w-0 items-center gap-2 text-xs text-muted">
            <GitCommitHorizontal className="size-3.5 shrink-0 text-faint" />
            <span className="selectable truncate">{repo.lastCommit.subject}</span>
            <span className="shrink-0 text-faint">{timeAgo(repo.lastCommit.date)}</span>
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-white/7 p-4">
        <SectionLabel>Ensuite</SectionLabel>
        <div className="flex items-center gap-2 text-[13px]">
          <CalendarClock className="size-4 shrink-0 text-faint" />
          {next ? (
            <>
              <span className="min-w-0 flex-1 truncate">
                {new Date(next.start * 1000).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" })}, {hhmm(next.start * 1000)} – {hhmm(next.end * 1000)}
              </span>
              <IconButton label="Démarrer cette session maintenant" onClick={() => startFocus({ title: next.title, project: key, taskId: next.taskId, eventId: next.id, plannedMin: Math.round((next.end - next.start) / 60) })}>
                <Play className="size-3.5" />
              </IconButton>
            </>
          ) : (
            <span className="text-muted">Aucune session prévue</span>
          )}
        </div>
        <ul className="flex flex-col">
          {open.slice(0, 6).map((t) => (
            <li key={t.id} className="group flex h-8 items-center gap-2 text-[13px]">
              <input type="checkbox" aria-label="Fait" className="accent-(--color-accent)" checked={false} onChange={() => act.toggleTask(t)} />
              <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-accent-strong" onClick={() => useUi.getState().editTask(t)}>
                {t.title}
              </button>
              {t.estimateMin !== null && <span className="shrink-0 text-xs text-faint">{fmtDur(t.estimateMin)}</span>}
              {tasks.some((s) => s.parentId === t.id) && <span className="shrink-0 text-xs text-faint">{tasks.filter((s) => s.parentId === t.id && s.doneAt !== null).length}/{tasks.filter((s) => s.parentId === t.id).length}</span>}
              <IconButton label="Supprimer la tâche" className="opacity-0 group-hover:opacity-100" onClick={() => act.removeTask.mutate(t.id)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </li>
          ))}
          {open.length > 6 && <li className="text-xs text-faint">{open.length - 6} more in Planning → Inbox</li>}
        </ul>
        <Input
          placeholder="Ajoute une tâche puis Entrée"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !title.trim()) return;
            act.saveTask.mutate({ title: title.trim(), project: key });
            setTitle("");
          }}
        />
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          <Button size="sm" icon={<CalendarPlus className="size-3.5" />} onClick={planSessions} title="Répartit le travail restant sur ton temps libre avant le rendu, avec pauses et marge. À valider avant tout enregistrement.">
            Planifier des sessions
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<ListTree className="size-3.5" />}
            onClick={() => {
              useUi.getState().closeSheet();
              useUi.getState().openAssistant({ text: "#breakdown", project: key });
            }}
            title="Tika propose des tâches et des sessions ; tu valides d'abord"
          >
            Décomposer avec Tika
          </Button>
        </div>
      </section>
    </div>
  );
}

export function GitTab({ repo }: { repo: RepoInfo }) {
  const act = useProjectActions();
  const openGit = useUi((s) => s.openGit);
  const s = repo.status;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
        <BranchLabel repo={repo} />
        <StatusChips repo={repo} max={4} />
        {s && s.upstream && (
          <span className="text-xs text-muted">
            {s.ahead} ahead · {s.behind} behind {s.upstream}
          </span>
        )}
      </div>
      {repo.lastCommit && (
        <p className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
          <GitCommitHorizontal className="size-4 shrink-0 text-faint" />
          <span className="selectable truncate">{repo.lastCommit.subject}</span>
          <span className="shrink-0 text-faint">{timeAgo(repo.lastCommit.date)}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<GitBranch className="size-3.5" />} onClick={() => openGit(repo.path)}>
          Indexer, commiter et synchroniser
        </Button>
        <Button icon={<Globe className="size-3.5" />} disabled={!repo.remoteUrl} onClick={() => act.remote.mutate(repo)} title={repo.remoteUrl ?? "This repository has no remote"}>
          Ouvrir sur GitHub
        </Button>
        <Button variant="ghost" icon={<Copy className="size-3.5" />} disabled={!repo.remoteUrl} onClick={() => act.copyUrl(repo)}>
          Copier l'URL distante
        </Button>
      </div>
    </div>
  );
}

/** Rarely needed actions, each described, in one list. */
export function AdvancedTab({ repo }: { repo: RepoInfo }) {
  const act = useProjectActions();
  const openLauncher = useUi((s) => s.openLauncher);
  const row = (icon: ReactNode, label: string, hint: string, onClick: () => void, active?: boolean) => (
    <li>
      <button type="button" onClick={onClick} className={cn("row-hover flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-[13px]", active && "text-accent-strong")}>
        <span className="flex w-4 justify-center text-faint">{icon}</span>
        <span className="flex-1">{label}</span>
        <span className="text-xs text-faint">{hint}</span>
      </button>
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      <ul className="rounded-lg border border-line bg-bg py-1">
        {row(<Code2 className="size-4" />, "Open in the IDE only", "without the terminal", () => act.ide.mutate(repo))}
        {row(<SquareTerminal className="size-4" />, "Open a terminal here", "", () => act.terminal.mutate(repo))}
        {row(<FolderOpen className="size-4" />, "Show in Files", "", () => act.files.mutate(repo))}
        {row(<LayoutTemplate className="size-4" />, "Apply a template…", "adds files, asks first", () => openLauncher({ mode: "existing", path: repo.path }))}
      </ul>
      <div>
        <SectionLabel className="mb-1.5">Classification — {repo.kindReason}</SectionLabel>
        <ul className="rounded-lg border border-line bg-bg py-1">
          {row(<GraduationCap className="size-4" />, "Epitech project", repo.meta.kindOverride === "epitech" ? "chosen" : "", () => act.kind.mutate({ repo, kind: "epitech" }), repo.meta.kindOverride === "epitech")}
          {row(<User className="size-4" />, "Personal project", repo.meta.kindOverride === "personal" ? "chosen" : "", () => act.kind.mutate({ repo, kind: "personal" }), repo.meta.kindOverride === "personal")}
          {row(<Wand2 className="size-4" />, "Automatic", repo.meta.kindOverride === null ? `now: ${repo.kind}` : "", () => act.kind.mutate({ repo, kind: null }), repo.meta.kindOverride === null)}
        </ul>
      </div>
    </div>
  );
}
