// Project sheet, organisation side: where the project stands, what comes next, and the tabs
// that hold everything else (Git, Advanced). Each action has one place.
import { CalendarClock, CalendarPlus, Code2, Copy, FolderOpen, GitBranch, GitCommitHorizontal, Globe, GraduationCap, LayoutTemplate, ListTree, Play, SquareTerminal, Trash2, User, Wand2 } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Button, cn, Dot, DoneCheck, IconButton, Input, SectionLabel } from "../../components/ui";
import type { RepoInfo } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { useNow, useProjectActions } from "../../lib/hooks";
import { durInput, fmtDur, hhmm, parseDur, PRIORITY, taskProgress } from "../../lib/plan";
import { suggestPlan } from "../artix/suggest";
import { useUi } from "../../lib/store";
import { startFocus } from "../planning/Focus";
import { useLoads, usePlanActions, usePlanData } from "../planning/usePlan";
import { BranchLabel, StatusChips } from "./RepoBits";
import { locale, t as tr } from "../../lib/i18n";

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
    if (estimate.trim() !== "" && m === null) return useUi.getState().toast({ kind: "error", title: tr("Écris le travail restant comme 12h, 1h30 ou 45m") });
    act.setProject.mutate({ key, estimateMin: m });
    setEstimate(null);
  };
  const planSessions = () => {
    if (!project) return;
    if (project.estimateMin === null) return useUi.getState().toast({ kind: "info", title: tr("Indique d'abord le travail restant") });
    void suggestPlan("two_weeks", key);
  };

  return (
    <div className="grid grid-cols-2 divide-x divide-line">
      <section className="flex flex-col gap-3 pr-6">
        <SectionLabel>{tr("Où tu en es")}</SectionLabel>
        {(my?.tooManyAbsences || my?.nonCompliant) && (
          <p className="-mt-1 rounded-md border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-xs text-warn">
            MY Epitech flags this group: {[my.tooManyAbsences && "too many absences", my.nonCompliant && "non compliant"].filter(Boolean).join(", ")}. Check with the module's staff.
          </p>
        )}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span>{progress ? tr("{d} tâche(s) faite(s) sur {n}", { d: progress.done, n: progress.total }) : tr("Pas encore de tâche")}</span>
            {load && load.risk !== "unknown" && <Dot tone={RISK_TONE[load.risk]}>{load.why}</Dot>}
          </div>
          <span className="block h-1.5 overflow-hidden rounded-full bg-ink/6">
            <span className="block h-full rounded-full transition-all duration-300" style={{ width: `${progress ? (progress.done / progress.total) * 100 : 0}%`, background: project?.color ?? "var(--color-accent)" } as CSSProperties} />
          </span>
        </div>
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted">{tr("Travail restant")}</dt>
          <dd>
            {estimate === null ? (
              <button type="button" className="rounded px-1 -mx-1 hover:bg-hover" onClick={() => setEstimate(durInput(project?.estimateMin ?? null))} title={tr("Ton estimation. Le temps enregistré en session en est déduit.")}>
                {project?.estimateMin != null ? fmtDur(project.estimateMin) : <span className="text-faint">{tr("donner une estimation")}</span>}
              </button>
            ) : (
              <Input autoFocus className="h-7 w-28" placeholder="12h" value={estimate} onChange={(e) => setEstimate(e.target.value)} onBlur={saveEstimate} onKeyDown={(e) => e.key === "Enter" && saveEstimate()} />
            )}
          </dd>
          <dt className="text-muted">Planifié</dt>
          <dd>{tr("{d} au planning", { d: fmtDur(load?.planned ?? 0) })}</dd>
          <dt className="text-muted">{tr("Temps passé")}</dt>
          <dd>{logged > 0 ? fmtDur(logged) : <span className="text-faint">{tr("rien d'enregistré")}</span>}</dd>
          <dt className="text-muted">{tr("Priorité")}</dt>
          <dd className="flex gap-1">
            {PRIORITY.map((label, i) => (
              <button key={label} type="button" aria-pressed={(project?.priority ?? 0) === i} onClick={() => act.setProject.mutate({ key, priority: i })} className={cn("h-6 rounded-md px-2 text-xs transition-colors duration-150", (project?.priority ?? 0) === i ? "bg-raised text-fg" : "text-faint hover:text-fg")}>
                {i === 0 ? tr("Aucune") : label}
              </button>
            ))}
          </dd>
          {my?.quota && (
            <>
              <dt className="text-muted">Moulinette</dt>
              <dd className={cn(my.quota[1] <= 1 && "text-warn")} title={tr("Exécutions de tests automatiques que ton groupe peut encore demander, d'après MY Epitech")}>
                {my.quota[1]} of {my.quota[0]} runs left
              </dd>
            </>
          )}
          {my?.delivery && (
            <>
              <dt className="text-muted">{tr("Rendu")}</dt>
              <dd className="flex min-w-0 items-center gap-2" title={tr("La dernière révision poussée par ton groupe : ce que la moulinette teste")}>
                <span className="font-mono text-xs">{my.delivery.commit.slice(0, 7)}</span>
                <span className="truncate text-xs text-faint">
                  {my.delivery.branch ?? ""}
                  {my.delivery.pushedAt ? ` · ${timeAgo(my.delivery.pushedAt)}` : ""}
                </span>
                {undelivered && <Dot tone="warn">{tr("ton dernier commit n'est pas rendu")}</Dot>}
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

      <section className="flex flex-col gap-2 pl-6">
        <SectionLabel>{tr("Ensuite")}</SectionLabel>
        <div className="flex items-center gap-2 text-sm">
          <CalendarClock className="size-4 shrink-0 text-faint" />
          {next ? (
            <>
              <span className="min-w-0 flex-1 truncate">
                {new Date(next.start * 1000).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "short" })}, {hhmm(next.start * 1000)} – {hhmm(next.end * 1000)}
              </span>
              <IconButton label={tr("Démarrer cette session maintenant")} onClick={() => startFocus({ title: next.title, project: key, taskId: next.taskId, eventId: next.id, plannedMin: Math.round((next.end - next.start) / 60) })}>
                <Play className="size-3.5" />
              </IconButton>
            </>
          ) : (
            <span className="text-muted">{tr("Aucune session prévue")}</span>
          )}
        </div>
        <ul className="flex flex-col">
          {open.slice(0, 6).map((t) => (
            <li key={t.id} className="group flex h-8 items-center gap-2 text-sm">
              <DoneCheck label={tr("Fait")} checked={false} onChange={() => act.toggleTask(t)} />
              <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-accent-strong" onClick={() => useUi.getState().editTask(t)}>
                {t.title}
              </button>
              {t.estimateMin !== null && <span className="shrink-0 text-xs text-faint">{fmtDur(t.estimateMin)}</span>}
              {tasks.some((s) => s.parentId === t.id) && <span className="shrink-0 text-xs text-faint">{tasks.filter((s) => s.parentId === t.id && s.doneAt !== null).length}/{tasks.filter((s) => s.parentId === t.id).length}</span>}
              <IconButton label={tr("Supprimer la tâche")} className="opacity-0 group-hover:opacity-100" onClick={() => act.removeTask.mutate(t.id)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </li>
          ))}
          {open.length > 6 && <li className="text-xs text-faint">{open.length - 6} more in Planning → Inbox</li>}
        </ul>
        <Input
          placeholder={tr("Ajoute une tâche puis Entrée")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !title.trim()) return;
            act.saveTask.mutate({ title: title.trim(), project: key });
            setTitle("");
          }}
        />
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          <Button size="sm" icon={<CalendarPlus className="size-3.5" />} onClick={planSessions} title={tr("Répartit le travail restant sur ton temps libre avant le rendu, avec pauses et marge. À valider avant tout enregistrement.")}>
            {tr("Planifier des sessions")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<ListTree className="size-3.5" />}
            onClick={() => {
              useUi.getState().closeSheet();
              useUi.getState().openAssistant({ text: "#breakdown", project: key });
            }}
            title={tr("Artix propose des tâches et des sessions ; tu valides d'abord")}
          >
            {tr("Décomposer avec Artix")}
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
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <BranchLabel repo={repo} />
        <StatusChips repo={repo} max={4} />
        {s && s.upstream && (
          <span className="text-xs text-muted">
            {s.ahead} ahead · {s.behind} behind {s.upstream}
          </span>
        )}
      </div>
      {repo.lastCommit && (
        <p className="flex min-w-0 items-center gap-2 text-sm text-muted">
          <GitCommitHorizontal className="size-4 shrink-0 text-faint" />
          <span className="selectable truncate">{repo.lastCommit.subject}</span>
          <span className="shrink-0 text-faint">{timeAgo(repo.lastCommit.date)}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<GitBranch className="size-3.5" />} onClick={() => openGit(repo.path)}>
          Indexer, commiter et synchroniser
        </Button>
        <Button icon={<Globe className="size-3.5" />} disabled={!repo.remoteUrl} onClick={() => act.remote.mutate(repo)} title={repo.remoteUrl ?? tr("Ce dépôt n'a pas de dépôt distant")}>
          {tr("Ouvrir sur GitHub")}
        </Button>
        <Button variant="ghost" icon={<Copy className="size-3.5" />} disabled={!repo.remoteUrl} onClick={() => act.copyUrl(repo)}>
          {tr("Copier l'URL distante")}
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
      <button type="button" onClick={onClick} className={cn("row-hover flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm", active && "text-accent-strong")}>
        <span className="flex w-4 justify-center text-faint">{icon}</span>
        <span className="flex-1">{label}</span>
        <span className="text-xs text-faint">{hint}</span>
      </button>
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y divide-line border-y border-line">
        {row(<Code2 className="size-4" />, tr("Ouvrir dans l'IDE seulement"), tr("sans le terminal"), () => act.ide.mutate(repo))}
        {row(<SquareTerminal className="size-4" />, tr("Ouvrir un terminal ici"), "", () => act.terminal.mutate(repo))}
        {row(<FolderOpen className="size-4" />, tr("Afficher dans Fichiers"), "", () => act.files.mutate(repo))}
        {row(<LayoutTemplate className="size-4" />, tr("Appliquer un modèle…"), tr("ajoute des fichiers, demande d'abord"), () => openLauncher({ mode: "existing", path: repo.path }))}
      </ul>
      <div>
        <SectionLabel className="mb-1.5">{tr("Classement")} · {repo.kindReason}</SectionLabel>
        <ul className="divide-y divide-line border-y border-line">
          {row(<GraduationCap className="size-4" />, tr("Projet Epitech"), repo.meta.kindOverride === "epitech" ? tr("choisi") : "", () => act.kind.mutate({ repo, kind: "epitech" }), repo.meta.kindOverride === "epitech")}
          {row(<User className="size-4" />, tr("Projet personnel"), repo.meta.kindOverride === "personal" ? tr("choisi") : "", () => act.kind.mutate({ repo, kind: "personal" }), repo.meta.kindOverride === "personal")}
          {row(<Wand2 className="size-4" />, tr("Automatique"), repo.meta.kindOverride === null ? tr("actuellement : {k}", { k: repo.kind === "epitech" ? "Epitech" : tr("personnel") }) : "", () => act.kind.mutate({ repo, kind: null }), repo.meta.kindOverride === null)}
        </ul>
      </div>
    </div>
  );
}
