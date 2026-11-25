// Project Launcher: clone → preview the template → apply, stage and open.
// Two clicks on the happy path; nothing is overwritten, committed or pushed without an explicit choice.
import { useQueryClient } from "@tanstack/react-query";
import { Check, CircleCheck, GitCommitHorizontal, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../../components/Modal";
import { Select } from "../../components/Select";
import { Badge, Button, cn, ErrorNote, Field, Input, Spinner } from "../../components/ui";
import { api, asAppError, type ApplyReport, type Candidate, type PlanEntry, type Vars } from "../../lib/api";
import { looksLikeEpitech, repoNameFromUrl, tildify } from "../../lib/format";
import { keys, useCandidates, useEnv, useHome, useRepos, useSettings, useTemplates } from "../../lib/hooks";
import { cloneTargets, preferredCloneDir } from "../../lib/repos";
import { useUi, type LaunchRequest } from "../../lib/store";
import { t } from "../../lib/i18n";

type Phase = "source" | "working" | "preview" | "done";

interface Done {
  path: string;
  alreadyPresent: boolean;
  report: ApplyReport | null;
  staged: number;
  workspaceIssue: string | null;
  committed: boolean;
}

const VAR_LABELS: Record<string, string> = {
  PROJECT_NAME: "Project name",
  BINARY_NAME: "Binary name",
  PROJECT_NAME_UPPER: "Include guard prefix",
  AUTHOR: "Author",
  YEAR: "Year",
  MODULE: "Module",
  CREATION_DATE: "Date",
  REPO_NAME: "Repository",
};

export function LauncherDialog({ request }: { request: LaunchRequest }) {
  const close = useUi((s) => s.closeLauncher);
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const home = useHome();
  const settings = useSettings();
  const repos = useRepos(true, { all: true });
  const templates = useTemplates();
  const env = useEnv();
  const candidates = useCandidates(request.mode === "new" && env.data?.github.state === "ready");

  const isNew = request.mode === "new";
  const [phase, setPhase] = useState<Phase>("source");
  const [working, setWorking] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [url, setUrl] = useState(request.mode === "new" ? (request.url ?? "") : "");
  const [parent, setParent] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(request.mode === "existing" ? (request.templateId ?? null) : null);
  const [target, setTarget] = useState<string | null>(request.mode === "existing" ? request.path : null);
  const [alreadyPresent, setAlreadyPresent] = useState(false);

  const [vars, setVars] = useState<Vars>({});
  const [plan, setPlan] = useState<PlanEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [planError, setPlanError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [message, setMessage] = useState("Initial project structure");
  const [committing, setCommitting] = useState(false);

  const targets = useMemo(() => cloneTargets(repos.data ?? [], settings.data?.roots ?? []), [repos.data, settings.data]);
  const repoName = repoNameFromUrl(url);

  // Default destination: the configured clone folder, else where similar repositories already live.
  const suggestedParent = useMemo(() => {
    const s = settings.data;
    if (!s) return null;
    return s.cloneDir ?? preferredCloneDir(repos.data ?? [], looksLikeEpitech(repoName)) ?? s.roots[0] ?? null;
  }, [settings.data, repos.data, repoName]);
  const effectiveParent = parent ?? suggestedParent;

  // `undefined` = not chosen yet → fall back to the default template from Settings.
  const chosenTemplate = templateId === null ? (settings.data?.defaultTemplate ?? "") : templateId;
  const template = templates.data?.find((t) => t.id === chosenTemplate) ?? null;

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: keys.repos });
    void qc.invalidateQueries({ queryKey: keys.activity });
    void qc.invalidateQueries({ queryKey: keys.candidates });
  };

  async function loadPlan(dir: string, id: string, v: Vars, resetSelection: boolean) {
    const entries = await api.templatePlan(id, dir, v);
    setPlan(entries);
    setPlanError(null);
    if (resetSelection) setSelected(new Set(entries.filter((e) => e.action === "add").map((e) => e.dest)));
    else setSelected((prev) => new Set(entries.filter((e) => (e.action === "add" || e.action === "conflict") && prev.has(e.dest)).map((e) => e.dest)));
  }

  async function start() {
    setError(null);
    setPhase("working");
    try {
      let dir = target;
      let present = false;
      if (isNew) {
        if (!effectiveParent) throw new Error("Choose a destination folder first");
        setWorking(`Cloning ${repoName}…`);
        const outcome = await api.cloneProject(url, effectiveParent);
        dir = outcome.path;
        present = outcome.alreadyPresent;
        setTarget(dir);
        setAlreadyPresent(present);
        refreshAll();
      }
      if (!dir) throw new Error("No project folder");
      if (!chosenTemplate) {
        await finish(dir, present, null);
        return;
      }
      setWorking("Preparing the template preview…");
      const v = await api.defaultVars(dir);
      setVars(v);
      await loadPlan(dir, chosenTemplate, v, true);
      setPhase("preview");
    } catch (e) {
      setError(asAppError(e).message);
      setPhase("source");
    }
  }

  // Re-plan shortly after a variable changes, keeping the user's selection.
  // (Runs only on `vars` changes: the initial plan is loaded by `start`, while the phase is still "working".)
  useEffect(() => {
    if (phase !== "preview" || !target || !chosenTemplate) return;
    const timer = window.setTimeout(() => {
      loadPlan(target, chosenTemplate, vars, false).catch((e) => setPlanError(asAppError(e).message));
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vars]);

  async function finish(dir: string, present: boolean, report: ApplyReport | null) {
    let staged = 0;
    if (isNew && report && report.written.length > 0) {
      setWorking("Staging the new files…");
      await api.stageFiles(dir, report.written);
      staged = report.written.length;
    }
    let workspaceIssue: string | null = null;
    if (isNew) {
      setWorking("Opening your workspace…");
      try {
        const ws = await api.openWorkspace(dir);
        workspaceIssue = ws.ide ?? ws.terminal;
      } catch (e) {
        workspaceIssue = asAppError(e).message;
      }
    }
    refreshAll();
    setDone({ path: dir, alreadyPresent: present, report, staged, workspaceIssue, committed: false });
    setPhase("done");
  }

  async function apply() {
    if (!target || !chosenTemplate) return;
    setError(null);
    setPhase("working");
    setWorking("Writing files…");
    try {
      const sel = [...selected];
      const overwrite = plan.filter((e) => e.action === "conflict" && selected.has(e.dest)).map((e) => e.dest);
      const report = await api.templateApply(chosenTemplate, target, vars, sel, overwrite);
      await finish(target, alreadyPresent, report);
    } catch (e) {
      setError(asAppError(e).message);
      setPhase("preview");
    }
  }

  async function commit() {
    if (!done) return;
    setCommitting(true);
    try {
      await api.commitStaged(done.path, message);
      setDone({ ...done, committed: true });
      refreshAll();
    } catch (e) {
      toast({ kind: "error", title: t("Commit échoué"), detail: asAppError(e).message });
    } finally {
      setCommitting(false);
    }
  }

  const toggle = (dest: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(dest)) next.delete(dest);
      else next.add(dest);
      return next;
    });

  const conflictsSelected = plan.filter((e) => e.action === "conflict" && selected.has(e.dest)).length;
  const canStart = isNew ? url.trim().length > 0 && !!effectiveParent : !!chosenTemplate;

  const title = isNew ? t("Nouveau projet") : "Apply a template";
  const description =
    phase === "preview"
      ? `Review what will be written to ${tildify(target ?? "", home)}`
      : phase === "done"
        ? undefined
        : isNew
          ? "Clone a repository, add your template and open it."
          : tildify(target ?? "", home);

  let footer;
  if (phase === "source") {
    footer = (
      <>
        <Button variant="ghost" onClick={close}>
          {t("Annuler")}
        </Button>
        <Button variant="primary" icon={<Play className="size-3.5" />} disabled={!canStart} onClick={() => void start()}>
          {isNew ? "Initialize" : "Preview"}
        </Button>
      </>
    );
  } else if (phase === "preview") {
    footer = (
      <>
        <span className="mr-auto text-xs text-faint">
          {selected.size} file{selected.size === 1 ? "" : "s"} to write
          {conflictsSelected > 0 && <span className="text-warn"> · {conflictsSelected} replaced (backup kept)</span>}
        </span>
        <Button variant="ghost" onClick={() => (isNew && target ? void skipTemplate() : close())}>
          {isNew ? "Skip template" : t("Annuler")}
        </Button>
        <Button variant="primary" icon={<Check className="size-3.5" />} disabled={selected.size === 0 || !!planError} onClick={() => void apply()}>
          {isNew ? "Apply & open" : t("Appliquer")}
        </Button>
      </>
    );
  } else if (phase === "done") {
    footer = (
      <Button variant="primary" onClick={close}>
        {t("Terminé")}
      </Button>
    );
  }

  async function skipTemplate() {
    if (!target) return;
    setPhase("working");
    try {
      await finish(target, alreadyPresent, null);
    } catch (e) {
      setError(asAppError(e).message);
      setPhase("preview");
    }
  }

  return (
    <Modal open onClose={phase === "working" ? () => undefined : close} title={title} description={description} footer={footer} width="w-[680px]">
      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {phase === "source" && (
        <div className="flex flex-col gap-4">
          {isNew && (
            <>
              <CandidateList state={env.data?.github.state} loading={candidates.isLoading} error={candidates.error} items={candidates.data ?? []} selectedUrl={url} onPick={(c) => setUrl(c.repo.sshUrl)} />
              <Field label={t("URL du dépôt")} hint={t("SSH ou HTTPS. Le dossier prend le nom du dépôt.")}>
                <Input autoFocus={!request.url} className="font-mono text-xs" placeholder="git@github.com:Organisation/G-XXX-000-CITY-0-0-project-0.git" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && canStart && void start()} />
              </Field>
              <Field label={t("Cloner dans")} hint={repoName && effectiveParent ? `→ ${tildify(effectiveParent, home)}/${repoName}` : undefined}>
                <Select label={t("Dossier parent")} mono value={effectiveParent ?? null} onChange={setParent} options={targets.map((t) => ({ value: t, label: tildify(t, home) }))} />
              </Field>
            </>
          )}
          <Field label="Modèle" hint={template ? template.description : isNew ? "The repository is cloned and opened as is." : "Pick the template to apply."}>
            <Select label="Modèle" value={chosenTemplate} onChange={setTemplateId} options={[{ value: "", label: isNew ? "No template" : "Choose…" }, ...(templates.data ?? []).map((t) => ({ value: t.id, label: t.name, hint: `${t.fileCount} file${t.fileCount === 1 ? "" : "s"}` }))]} />
          </Field>
        </div>
      )}

      {phase === "working" && (
        <p className="flex items-center gap-2.5 py-10 text-sm text-muted">
          <Spinner className="size-4 text-accent" /> {working}
        </p>
      )}

      {phase === "preview" && template && (
        <div className="flex flex-col gap-4">
          {alreadyPresent && <p className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-muted">{t("Ce dépôt était déjà cloné ici. Rien n'a été téléchargé.")}</p>}
          {template.variables.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {template.variables
                .filter((name) => name in vars)
                .map((name) => (
                  <Field key={name} label={VAR_LABELS[name] ?? name}>
                    <Input className="font-mono text-xs" value={vars[name]} onChange={(e) => setVars({ ...vars, [name]: e.target.value })} />
                  </Field>
                ))}
            </div>
          )}
          {planError ? <ErrorNote title={t("Ce modèle ne peut pas être appliqué avec ces valeurs")}>{planError}</ErrorNote> : <PlanList plan={plan} selected={selected} onToggle={toggle} />}
        </div>
      )}

      {phase === "done" && done && (
        <div className="flex flex-col gap-3 py-1">
          <p className="flex items-center gap-2 text-md font-medium">
            <CircleCheck className="size-5 text-ok" /> {isNew ? "Project ready" : "Template applied"}
          </p>
          <p className="selectable font-mono text-xs text-muted">{tildify(done.path, home)}</p>
          <ul className="space-y-1 text-sm text-muted">
            {isNew && <li>· {done.alreadyPresent ? "Already cloned — nothing downloaded" : "Repository cloned"}</li>}
            {done.report && (
              <li>
                · {done.report.written.length} file{done.report.written.length === 1 ? "" : "s"} written
                {done.report.skipped.length > 0 && `, ${done.report.skipped.length} left untouched`}
              </li>
            )}
            {done.report?.backupDir && <li className="selectable">· Replaced files saved in {tildify(done.report.backupDir, home)}</li>}
            {isNew && !done.workspaceIssue && <li>{t("· IDE et terminal ouverts")}</li>}
          </ul>
          {done.workspaceIssue && <ErrorNote title={t("L'espace de travail ne s'est pas entièrement ouvert")}>{done.workspaceIssue}</ErrorNote>}

          {done.staged > 0 && (
            <div className="mt-1 rounded-lg border border-line bg-surface p-3">
              {done.committed ? (
                <p className="flex items-center gap-2 text-sm text-ok">
                  <Check className="size-4" /> Commité localement. Rien n'a été envoyé.
                </p>
              ) : (
                <>
                  <p className="mb-2 text-sm text-muted">
                    {done.staged} file{done.staged === 1 ? " is" : "s are"} staged. Commit now, or do it later yourself — TekBoard never pushes.
                  </p>
                  <div className="flex items-center gap-2">
                    <Input value={message} onChange={(e) => setMessage(e.target.value)} aria-label={t("Message de commit")} />
                    <Button icon={<GitCommitHorizontal className="size-3.5" />} busy={committing} disabled={!message.trim()} onClick={() => void commit()}>
                      Commiter
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

const ACTION_BADGE = {
  add: { tone: "ok", label: "new" },
  identical: { tone: "neutral", label: "same" },
  conflict: { tone: "warn", label: "exists" },
  blocked: { tone: "danger", label: "blocked" },
} as const;

function PlanList({ plan, selected, onToggle }: { plan: PlanEntry[]; selected: Set<string>; onToggle: (dest: string) => void }) {
  const conflicts = plan.filter((e) => e.action === "conflict").length;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-muted">Fichiers</span>
        {conflicts > 0 && <span className="text-xs text-warn">{conflicts} already exist — tick one to replace it</span>}
      </div>
      <ul className="max-h-[300px] overflow-y-auto rounded-lg border border-line bg-bg py-1">
        {plan.map((e) => {
          const selectable = e.action === "add" || e.action === "conflict";
          const badge = ACTION_BADGE[e.action];
          return (
            <li key={e.dest}>
              <label className={cn("flex h-7 items-center gap-2.5 px-3 text-xs", selectable ? "hover:bg-raised" : "opacity-55")}>
                <input type="checkbox" className="accent-(--color-accent)" disabled={!selectable} checked={selectable && selected.has(e.dest)} onChange={() => onToggle(e.dest)} />
                <span className="selectable min-w-0 flex-1 truncate font-mono">{e.dest}</span>
                <Badge tone={badge.tone} title={e.action === "identical" ? "Already there with the same content" : e.action === "blocked" ? "Something that is not a regular file is in the way" : undefined}>
                  {badge.label}
                </Badge>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const CONF_TONE = { high: "ok", medium: "warn", low: "neutral" } as const;

function CandidateList({ state, loading, error, items, selectedUrl, onPick }: { state: string | undefined; loading: boolean; error: unknown; items: Candidate[]; selectedUrl: string; onPick: (c: Candidate) => void }) {
  if (state !== "ready") return null;
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> {t("Recherche des dépôts pas encore clonés…")}
      </p>
    );
  }
  if (error) return <p className="text-sm text-muted">GitHub list unavailable ({asAppError(error).message}). Paste a URL below.</p>;
  if (items.length === 0) return <p className="text-sm text-muted">{t("Tous tes dépôts sont déjà clonés. Colle une URL ci-dessous pour un autre.")}</p>;
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-muted">{t("Pas encore clonés")}</span>
      <ul className="max-h-[188px] overflow-y-auto rounded-lg border border-line bg-bg py-1">
        {items.slice(0, 40).map((c) => {
          const active = c.repo.sshUrl === selectedUrl;
          return (
            <li key={c.repo.fullName}>
              <button type="button" onClick={() => onPick(c)} title={c.reasons.join("\n")} className={cn("flex h-9 w-full items-center gap-2.5 px-3 text-left text-sm", active ? "bg-accent-soft" : "hover:bg-raised")}>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{c.epitech?.project ?? c.repo.name}</span>
                  <span className="ml-2 font-mono text-xs text-faint">{c.repo.owner}</span>
                </span>
                {c.epitech && (
                  <Badge tone="accent" mono>
                    {c.epitech.module}
                  </Badge>
                )}
                <Badge tone={CONF_TONE[c.confidence]} title={`Score ${c.score}/100`}>
                  {c.confidence}
                </Badge>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
