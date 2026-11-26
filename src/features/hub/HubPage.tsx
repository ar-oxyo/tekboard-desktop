// Projects → HUB: the student's HUB projects, from the first idea to the presentation. A
// project is created with a name; the rest is added when it exists (HubDetail). Progress is
// shown as facts, credits as the student's own estimate, never an official figure.
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Plus, Rocket, Users, X } from "lucide-react";
import { useState } from "react";
import { Detail, Hint, useLite } from "../../components/lite";
import { Button, cn, EmptyState, ErrorNote, IconButton, Input, Meter, PageHeader, Spinner } from "../../components/ui";
import { api, asAppError, type HubFacts, type HubProject } from "../../lib/api";
import { usePref } from "../../lib/hooks";
import { creditTotals, STAGES, stageIndex, stageLabel } from "../../lib/hub";
import { locale, plural, t } from "../../lib/i18n";
import { fmtDur } from "../../lib/plan";
import { useUi } from "../../lib/store";
import { accept, useHubInvites } from "./collab";
import { HubDetail } from "./HubDetail";

export const HUB_KEY = ["hub"] as const;

export default function HubPage() {
  const [open, setOpen] = usePref<number | null>("hub.open", null);
  const rows = useQuery({ queryKey: [...HUB_KEY, "list"], queryFn: api.hubList });
  const exists = open !== null && (rows.data?.some((r) => r.project.id === open) ?? true);
  if (open !== null && exists) return <HubDetail id={open} onBack={() => setOpen(null)} />;
  return <HubList rows={rows.data} loading={rows.isLoading} error={rows.error} onOpen={setOpen} />;
}

function HubList({ rows, loading, error, onOpen }: { rows?: Array<{ project: HubProject; facts: HubFacts }>; loading: boolean; error: unknown; onOpen: (id: number) => void }) {
  const toast = useUi((s) => s.toast);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const create = useMutation({
    mutationFn: () => api.hubSave({ name: name.trim() }),
    onSuccess: (p) => {
      setName("");
      setCreating(false);
      onOpen(p.id);
    },
    onError: (e) => toast({ kind: "error", title: t("Projet non créé"), detail: asAppError(e).message }),
  });
  const all = rows ?? [];
  const active = all.filter((r) => r.project.stage !== "archived");
  const archived = all.filter((r) => r.project.stage === "archived");
  return (
    <>
      <PageHeader
        title={t("Projet HUB")}
        subtitle={all.length ? plural(active.length, "{n} projet en cours", "{n} projets en cours") : undefined}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t("Nouveau projet")}
          </Button>
        }
      />
      <Invitations />
      {creating && (
        <form
          className="anim-fade mb-5 flex items-center gap-2 border-b border-line pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Input autoFocus className="max-w-md" placeholder={t("Nom du projet, même provisoire")} value={name} onChange={(e) => setName(e.target.value)} aria-label={t("Nom du projet")} />
          <Button type="submit" icon={<Check className="size-3.5" />} busy={create.isPending} disabled={!name.trim()} disabledReason={t("Donne-lui un nom")}>
            {t("Créer")}
          </Button>
          <IconButton label={t("Annuler")} onClick={() => setCreating(false)}>
            <X className="size-4" />
          </IconButton>
          <Hint className="ml-2">{t("Le reste (pitch, dépôt, équipe, crédits) s'ajoute quand tu l'as.")}</Hint>
        </form>
      )}
      {error ? (
        <ErrorNote title={t("Projets HUB illisibles")}>{asAppError(error).message}</ErrorNote>
      ) : loading ? (
        <p className="flex items-center gap-2 py-16 text-muted">
          <Spinner /> {t("Lecture…")}
        </p>
      ) : all.length === 0 && !creating ? (
        <EmptyState icon={<Rocket className="size-6" />} title={t("Aucun projet HUB")} action={<Button onClick={() => setCreating(true)}>{t("Créer un projet")}</Button>}>
          {t("Une idée suffit pour commencer : TekBoard t'accompagne jusqu'à la présentation.")}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          <Credits projects={all.map((r) => r.project)} />
          <ul>
            {(["pitch", "testing", "dev", "prep", "idea", "done"] as const).flatMap((s) => active.filter((r) => r.project.stage === s)).map((r) => (
              <HubRow key={r.project.id} project={r.project} facts={r.facts} onOpen={() => onOpen(r.project.id)} />
            ))}
          </ul>
          {archived.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowArchived(!showArchived)} className="text-xs text-faint hover:text-muted">
                {plural(archived.length, "{n} projet archivé", "{n} projets archivés")}
              </button>
              {showArchived && (
                <ul className="mt-2">
                  {archived.map((r) => (
                    <HubRow key={r.project.id} project={r.project} facts={r.facts} onOpen={() => onOpen(r.project.id)} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** One project: its stage on a small track, and the facts that matter now. */
function HubRow({ project: p, facts: f, onOpen }: { project: HubProject; facts: HubFacts; onOpen: () => void }) {
  const lite = useLite();
  const step = stageIndex(p.stage);
  const facts = [
    f.milestones > 0 ? t("{a}/{b} jalons", { a: f.milestonesDone, b: f.milestones }) : null,
    f.tasks > 0 && !lite ? t("{a}/{b} tâches", { a: f.tasksDone, b: f.tasks }) : null,
    f.minutesWorked > 0 ? t("{d} travaillées", { d: fmtDur(f.minutesWorked) }) : null,
  ].filter(Boolean);
  return (
    <li>
      <button type="button" onClick={onOpen} className="group ink-row flex min-h-14 w-full items-center gap-4 border-b border-line px-2 py-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{p.name}</span>
            {p.owner && (
              <span className="flex shrink-0 items-center gap-1 text-2xs text-faint" title={p.role === "viewer" ? t("Partagé avec toi, en lecture seule") : t("Partagé avec toi")}>
                <Users className="size-3" />
                {p.ownerNick}
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-muted">{typeof p.fields.pitch === "string" && p.fields.pitch ? p.fields.pitch : facts.join(" · ") || t("Rien d'autre pour l'instant")}</span>
        </span>
        {!lite && facts.length > 0 && typeof p.fields.pitch === "string" && p.fields.pitch && <span className="hidden shrink-0 text-xs text-faint @3xl:block">{facts.join(" · ")}</span>}
        {f.nextDue && (
          <span className="shrink-0 text-xs text-muted" title={f.nextMilestone ?? undefined}>
            {new Date(`${f.nextDue}T12:00`).toLocaleDateString(locale(), { day: "numeric", month: "short" })}
          </span>
        )}
        <span className="flex w-36 shrink-0 flex-col items-end gap-1">
          <span className="text-xs text-muted">{stageLabel(p.stage)}</span>
          {/* The stage on a track of six steps: a position, not a percentage of work. */}
          <span className="flex gap-0.5" aria-hidden>
            {STAGES.slice(0, 6).map((s, i) => (
              <span key={s.id} className={cn("h-1 w-4 rounded-full", i <= step ? "bg-accent" : "bg-ink/10")} />
            ))}
          </span>
        </span>
      </button>
    </li>
  );
}

/** The HUB credits goal and the student's estimates added up, plainly labelled as such. */
function Credits({ projects }: { projects: HubProject[] }) {
  const [goal, setGoal] = usePref<number | null>("hub.creditsGoal", null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const totals = creditTotals(projects);
  if (goal === null && totals.estimated === 0 && !editing) {
    return (
      <Detail>
        <button type="button" onClick={() => setEditing(true)} className="w-fit text-xs text-faint hover:text-muted">
          {t("Fixer un objectif de crédits HUB")}
        </button>
      </Detail>
    );
  }
  const save = () => {
    const n = Number(draft.replace(",", "."));
    setGoal(draft.trim() === "" ? null : Number.isFinite(n) && n >= 0 && n <= 60 ? n : goal);
    setEditing(false);
  };
  return (
    <section className="max-w-3xl">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span className="text-sm">
          {t("Objectif HUB")}{" "}
          {editing ? (
            <Input autoFocus className="inline-block h-7 w-20" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} aria-label={t("Objectif de crédits HUB")} />
          ) : (
            <button type="button" className="font-medium tabular-nums hover:text-accent-strong" onClick={() => (setDraft(goal?.toString() ?? ""), setEditing(true))} title={t("Changer l'objectif")}>
              {goal !== null ? plural(goal, "{n} crédit", "{n} crédits") : t("à fixer")}
            </button>
          )}
        </span>
        <span className="text-sm text-muted tabular-nums" title={t("Somme des fourchettes que tu as estimées : basse, au milieu, haute.")}>
          {t("Estimé : {lo} à {hi}", { lo: totals.low, hi: totals.high })}
          {totals.finished > 0 && <span className="text-faint"> · {t("{n} sur des projets terminés", { n: totals.finished })}</span>}
        </span>
      </div>
      {goal !== null && goal > 0 && <Meter className="mt-2" value={totals.likely} max={goal} label={t("Estimation probable par rapport à l'objectif")} />}
      <Hint className="mt-1.5">
        {t("Estimations personnelles, à partir des fourchettes de tes projets : jamais une validation officielle. Les crédits obtenus restent ceux de MY Epitech.")}
        {totals.unestimated > 0 ? ` ${plural(totals.unestimated, "{n} projet sans estimation.", "{n} projets sans estimation.")}` : ""}
      </Hint>
    </section>
  );
}

/** Invitations received from paired devices while TekBoard is open. */
function Invitations() {
  const invites = useHubInvites((s) => s.invites);
  const drop = useHubInvites((s) => s.drop);
  const toast = useUi((s) => s.toast);
  if (!invites.length) return null;
  return (
    <ul className="mb-6 flex flex-col gap-2">
      {invites.map((i) => (
        <li key={`${i.from}-${i.id}`} className="anim-rise flex flex-wrap items-center gap-3 rounded-(--radius-card) border border-line bg-surface px-4 py-3">
          <Users className="size-4 text-accent" />
          <span className="min-w-0 flex-1 text-sm">
            {t("{who} t'invite dans « {name} »", { who: i.owner, name: i.name })}
            <span className="ml-2 text-xs text-faint">{i.role === "editor" ? t("pour contribuer") : t("en lecture seule")}</span>
          </span>
          <Button size="sm" onClick={() => void accept(i).catch((e) => toast({ kind: "error", title: t("Invitation non acceptée"), detail: asAppError(e).message }))}>
            {t("Rejoindre")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => drop(i)}>
            {t("Ignorer")}
          </Button>
        </li>
      ))}
    </ul>
  );
}
