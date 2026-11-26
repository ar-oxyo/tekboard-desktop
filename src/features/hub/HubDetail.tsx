// One HUB project: what it is (overview), how the work is organised (milestones, tasks in the
// planning, time), what it rests on (repository, links, files), what was decided (journal),
// how it will be presented (pitch, checklist, export), and who works on it (team). Fields
// appear when they are filled or asked for: a new project shows its name and one next step.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, CalendarCheck, Download, ExternalLink, FileText, FolderGit2, Image as ImageIcon, Lightbulb, Link2, PenTool, Plus, RefreshCw, Sparkles, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Detail, Hint, useLite } from "../../components/lite";
import { Menu, MenuItem, MenuSeparator } from "../../components/Menu";
import { ProjectPicker } from "../../components/ProjectPicker";
import { Select } from "../../components/Select";
import { Button, cn, Dot, DoneCheck, EmptyState, ErrorNote, IconButton, Input, Notice, Section, Spinner } from "../../components/ui";
import { api, asAppError, type HubFacts, type HubItem, type HubProject, type HubStage, type PlanTask } from "../../lib/api";
import { CONNECT_KEY } from "../../lib/connect";
import { timeAgo } from "../../lib/format";
import { CHECKLIST, checklistDone, list, nextSteps, PITCH_FIELDS, pitchPrompt, STAGES, summaryMarkdown, TEXT_FIELDS, text, type NextStep } from "../../lib/hub";
import { locale, plural, t } from "../../lib/i18n";
import { fmtDur } from "../../lib/plan";
import { useUi } from "../../lib/store";
import { BulkPlanDialog } from "../planning/BulkPlan";
import { usePlanActions, usePlanData } from "../planning/usePlan";
import { broadcast, invite, propose, refresh, type HubOp } from "./collab";

type Tab = NextStep["tab"];
const TABS: Array<[Tab, string]> = [
  ["overview", t("Aperçu")],
  ["work", t("Organisation")],
  ["resources", t("Ressources")],
  ["journal", t("Journal")],
  ["pitch", t("Présentation")],
  ["team", t("Équipe")],
];

export function HubDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const lite = useLite();
  const detail = useQuery({ queryKey: ["hub", "detail", id], queryFn: () => api.hubGet(id) });
  const [tab, setTab] = useState<Tab>("overview");
  const p = detail.data?.project;
  const items = useMemo(() => detail.data?.items ?? [], [detail.data]);
  const facts = detail.data?.facts;
  const owner = p?.role === "owner";
  // My changes reach the members that are online; an editor's go to the owner's device.
  const save = useMutation({
    mutationFn: (patch: Partial<HubProject>) => api.hubSave({ ...p!, ...patch }),
    onSuccess: (saved) => {
      qc.setQueryData(["hub", "detail", id], (d: typeof detail.data) => (d ? { ...d, project: saved } : d));
      if (owner && (facts?.members ?? 0) > 0) void broadcast(id);
    },
    onError: (e) => toast({ kind: "error", title: t("Non enregistré"), detail: asAppError(e).message }),
  });
  const afterItems = () => {
    if (owner && (facts?.members ?? 0) > 0) void broadcast(id);
  };
  if (detail.isLoading) return <p className="flex items-center gap-2 py-16 text-muted"><Spinner /> {t("Lecture…")}</p>;
  if (detail.error || !p || !facts) return <ErrorNote title={t("Projet introuvable")}>{detail.error ? asAppError(detail.error).message : ""}</ErrorNote>;
  const steps = nextSteps(p, items, facts);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <IconButton label={t("Tous les projets HUB")} onClick={onBack}>
            <ArrowLeft className="size-4" />
          </IconButton>
          <NameField value={p.name} disabled={!owner} onSave={(name) => save.mutate({ name })} />
          {p.owner && (
            <span className="flex shrink-0 items-center gap-1 text-xs text-faint">
              <Users className="size-3.5" />
              {t("de {who}", { who: p.ownerNick ?? "?" })} · {p.role === "editor" ? t("contributeur") : t("lecture seule")}
            </span>
          )}
          <span className="flex-1" />
          <ProjectMenu project={p} items={items} facts={facts} onDeleted={onBack} onArchive={(stage) => save.mutate({ stage })} />
        </div>
        <StageTrack stage={p.stage} disabled={!owner} onPick={(stage) => save.mutate({ stage })} />
        <FactsLine facts={facts} />
      </header>
      {steps.length > 0 && (
        <ul className="flex flex-col gap-1">
          {steps.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setTab(s.tab)} className="flex items-center gap-2 text-sm text-muted hover:text-fg">
                <Lightbulb className="size-3.5 shrink-0 text-accent" />
                {s.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div role="tablist" aria-label={t("Parties du projet")} className="flex gap-4 border-b border-line">
        {TABS.map(([tid, label]) => (
          <button key={tid} type="button" role="tab" aria-selected={tab === tid} onClick={() => setTab(tid)} className={cn("-mb-px h-9 border-b-2 text-sm transition-colors duration-(--dur-fast)", tab === tid ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
            {label}
            {!lite && tid === "journal" && facts.journal > 0 && <span className="ml-1.5 font-mono text-2xs text-faint">{facts.journal}</span>}
            {!lite && tid === "team" && facts.members > 0 && <span className="ml-1.5 font-mono text-2xs text-faint">{facts.members}</span>}
          </button>
        ))}
      </div>
      <div key={tab} className="anim-fade">
        {tab === "overview" && <Overview project={p} onSave={(patch) => save.mutate(patch)} />}
        {tab === "work" && <Work project={p} items={items} facts={facts} onChanged={afterItems} />}
        {tab === "resources" && <Resources project={p} items={items} onSave={(patch) => save.mutate(patch)} onChanged={afterItems} />}
        {tab === "journal" && <Journal project={p} items={items} onChanged={afterItems} />}
        {tab === "pitch" && <Pitch project={p} items={items} facts={facts} onSave={(patch) => save.mutate(patch)} />}
        {tab === "team" && <Team project={p} items={items} onChanged={afterItems} />}
      </div>
    </div>
  );
}

function NameField({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (disabled) return <h1 className="display truncate text-xl font-medium">{value}</h1>;
  return (
    <input
      className="display min-w-0 flex-1 truncate rounded-(--btn-radius) bg-transparent px-1 text-xl font-medium outline-none hover:bg-ink/4 focus:bg-ink/5"
      value={v}
      aria-label={t("Nom du projet")}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() && v.trim() !== value && onSave(v.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** The six working stages (Archived is in the menu): where the project is, a click moves it. */
function StageTrack({ stage, disabled, onPick }: { stage: HubStage; disabled: boolean; onPick: (s: HubStage) => void }) {
  const current = STAGES.findIndex((s) => s.id === stage);
  return (
    <div role="radiogroup" aria-label={t("Étape du projet")} className="flex flex-wrap gap-1">
      {STAGES.slice(0, 6).map((s, i) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          aria-checked={stage === s.id}
          disabled={disabled}
          onClick={() => stage !== s.id && onPick(s.id)}
          className={cn("h-7 rounded-(--btn-radius) px-2.5 text-xs transition-colors duration-(--dur-base) disabled:cursor-default", stage === s.id ? "bg-accent-soft font-medium text-accent-strong" : i < current ? "text-muted" : "text-faint", !disabled && stage !== s.id && "hover:bg-ink/5 hover:text-fg")}
        >
          {s.label}
        </button>
      ))}
      {stage === "archived" && <span className="h-7 px-2.5 text-xs leading-7 text-faint">{t("Archivé")}</span>}
    </div>
  );
}

function FactsLine({ facts: f }: { facts: HubFacts }) {
  const parts = [
    f.milestones > 0 && t("{a}/{b} jalons atteints", { a: f.milestonesDone, b: f.milestones }),
    f.tasks > 0 && t("{a}/{b} tâches faites", { a: f.tasksDone, b: f.tasks }),
    f.minutesWorked > 0 && t("{d} travaillées", { d: fmtDur(f.minutesWorked) }),
    f.minutesPlanned > 0 && t("{d} prévues", { d: fmtDur(f.minutesPlanned) }),
    f.nextDue && t("prochain jalon : {m}, {d}", { m: f.nextMilestone ?? "", d: new Date(`${f.nextDue}T12:00`).toLocaleDateString(locale(), { day: "numeric", month: "short" }) }),
  ].filter(Boolean);
  if (!parts.length) return null;
  return <p className="text-sm text-muted">{parts.join(" · ")}</p>;
}

function ProjectMenu({ project: p, items, facts, onDeleted, onArchive }: { project: HubProject; items: HubItem[]; facts: HubFacts; onDeleted: () => void; onArchive: (s: HubStage) => void }) {
  const toast = useUi((s) => s.toast);
  const [confirm, setConfirm] = useState(false);
  const del = useMutation({ mutationFn: () => api.hubDelete(p.id), onSuccess: () => (toast({ kind: "ok", title: p.owner ? t("Copie retirée de cet ordinateur") : t("Projet supprimé") }), onDeleted()) });
  return (
    <>
      <Menu label={t("Actions du projet")}>
        <MenuItem icon={<Download className="size-4" />} onSelect={() => void exportSummary(p, items, facts).then((path) => path && toast({ kind: "ok", title: t("Synthèse exportée"), detail: path }), (e) => toast({ kind: "error", title: t("Export impossible"), detail: asAppError(e).message }))}>
          {t("Exporter la synthèse…")}
        </MenuItem>
        {p.owner && (
          <MenuItem icon={<RefreshCw className="size-4" />} onSelect={() => void refresh(p).then((ok) => toast(ok ? { kind: "info", title: t("Demandé au propriétaire") } : { kind: "error", title: t("Propriétaire injoignable"), detail: t("Son TekBoard doit être ouvert, Connect activé, sur le même réseau.") }))}>
            {t("Actualiser depuis le propriétaire")}
          </MenuItem>
        )}
        {p.role === "owner" && (
          <MenuItem onSelect={() => onArchive(p.stage === "archived" ? "done" : "archived")}>{p.stage === "archived" ? t("Sortir des archives") : t("Archiver")}</MenuItem>
        )}
        <MenuSeparator />
        <MenuItem danger icon={<Trash2 className="size-4" />} onSelect={() => setConfirm(true)}>
          {p.owner ? t("Retirer cette copie…") : t("Supprimer le projet…")}
        </MenuItem>
      </Menu>
      {confirm && (
        <div className="fixed inset-x-0 bottom-6 z-40 mx-auto flex w-fit items-center gap-2 rounded-(--radius-card) border border-danger/30 bg-surface px-4 py-2.5 shadow-lg">
          <span className="text-sm text-danger">{p.owner ? t("Retirer la copie partagée de cet ordinateur ?") : t("Supprimer « {n} », ses jalons, liens, fichiers et journal ? Les tâches et sessions du planning restent.", { n: p.name })}</span>
          <Button size="sm" variant="danger" busy={del.isPending} onClick={() => del.mutate()}>
            {t("Supprimer")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            {t("Garder")}
          </Button>
        </div>
      )}
    </>
  );
}

async function exportSummary(p: HubProject, items: HubItem[], facts: HubFacts): Promise<string | null> {
  const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "projet-hub";
  const path = await saveDialog({ title: t("Exporter la synthèse"), defaultPath: `${slug}.md`, filters: [{ name: "Markdown", extensions: ["md"] }] });
  if (!path) return null;
  return api.hubExport(path, summaryMarkdown(p, items, facts));
}

// ───────────────────────────── overview ─────────────────────────────

/** A text the student fills in place; saved when leaving the field. */
function FieldEditor({ label, hint, value, list: isList, disabled, onSave, autoFocus }: { label: string; hint: string; value: string; list?: boolean; disabled: boolean; onSave: (v: string) => void; autoFocus?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onSave(v);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted" title={hint}>
        {label}
      </span>
      {isList ? (
        <Input autoFocus={autoFocus} disabled={disabled} value={v} placeholder={hint} onChange={(e) => setV(e.target.value)} onBlur={commit} />
      ) : (
        <textarea autoFocus={autoFocus} disabled={disabled} className="field min-h-16 w-full resize-y rounded-(--btn-radius) border border-line bg-transparent p-2 text-sm text-fg disabled:opacity-70" value={v} placeholder={hint} onChange={(e) => setV(e.target.value)} onBlur={commit} />
      )}
    </label>
  );
}

const fieldValue = (isList: boolean | undefined, v: string): string | string[] => (isList ? v.split(",").map((x) => x.trim()).filter(Boolean) : v);

function Overview({ project: p, onSave }: { project: HubProject; onSave: (patch: Partial<HubProject>) => void }) {
  const owner = p.role === "owner";
  const [added, setAdded] = useState<string | null>(null);
  const shown = TEXT_FIELDS.filter((f) => text(p, f.key) || f.key === added);
  const missing = TEXT_FIELDS.filter((f) => !text(p, f.key) && f.key !== added);
  const setField = (key: string, isList: boolean | undefined, v: string) => onSave({ fields: { ...p.fields, [key]: fieldValue(isList, v) } });
  return (
    <div className="grid max-w-4xl grid-cols-1 gap-8 @4xl:grid-cols-[minmax(0,1fr)_220px]">
      <div className="flex flex-col gap-4">
        <FieldEditor label={t("Pitch")} hint={t("Le projet en une ou deux phrases.")} value={text(p, "pitch")} disabled={!owner} onSave={(v) => setField("pitch", false, v)} />
        {shown.map((f) => (
          <FieldEditor key={f.key} autoFocus={f.key === added} label={f.label} hint={f.hint} value={list(p, f.key).length && f.list ? list(p, f.key).join(", ") : text(p, f.key)} list={f.list} disabled={!owner} onSave={(v) => setField(f.key, f.list, v)} />
        ))}
        {owner && missing.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-faint">{t("Ajouter")}</span>
            {missing.map((f) => (
              <button key={f.key} type="button" onClick={() => setAdded(f.key)} className="h-7 rounded-(--btn-radius) border border-line px-2 text-xs text-muted hover:border-line-strong hover:text-fg">
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <aside className="flex flex-col gap-4">
        <Estimate label={t("Crédits estimés")} hint={t("Ta propre estimation (de… à…), jamais une validation officielle.")} min={p.creditsMin} max={p.creditsMax} disabled={!owner} onSave={(creditsMin, creditsMax) => onSave({ creditsMin, creditsMax })} />
        <TimeEstimate value={p.estimateMin} disabled={!owner} onSave={(estimateMin) => onSave({ estimateMin })} />
      </aside>
    </div>
  );
}

const num = (s: string) => {
  const n = Number(s.replace(",", "."));
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
};

function Estimate({ label, hint, min, max, disabled, onSave }: { label: string; hint: string; min: number | null; max: number | null; disabled: boolean; onSave: (min: number | null, max: number | null) => void }) {
  const [a, setA] = useState(min?.toString() ?? "");
  const [b, setB] = useState(max?.toString() ?? "");
  useEffect(() => (setA(min?.toString() ?? ""), setB(max?.toString() ?? "")), [min, max]);
  const commit = () => (num(a) !== min || num(b) !== max) && onSave(num(a), num(b));
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <Input className="h-8 w-16" inputMode="decimal" disabled={disabled} value={a} onChange={(e) => setA(e.target.value)} onBlur={commit} aria-label={t("Au moins")} placeholder="2" />
        <span className="text-xs text-faint">{t("à")}</span>
        <Input className="h-8 w-16" inputMode="decimal" disabled={disabled} value={b} onChange={(e) => setB(e.target.value)} onBlur={commit} aria-label={t("Au plus")} placeholder="4" />
      </div>
      <Hint>{hint}</Hint>
    </div>
  );
}

function TimeEstimate({ value, disabled, onSave }: { value: number | null; disabled: boolean; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(value ? String(Math.round(value / 60)) : "");
  useEffect(() => setV(value ? String(Math.round(value / 60)) : ""), [value]);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted">{t("Temps estimé (heures)")}</span>
      <Input className="h-8 w-24" inputMode="numeric" disabled={disabled} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onSave(num(v) !== null ? Math.round(num(v)! * 60) : null)} placeholder="40" />
    </label>
  );
}

// ───────────────────────────── organisation ─────────────────────────────

function useItemActions(project: HubProject, onChanged: () => void) {
  const toast = useUi((s) => s.toast);
  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });
  const add = useMutation({
    mutationFn: async (item: Partial<HubItem> & { kind: HubItem["kind"]; title: string }) => {
      if (project.role === "editor") return propose(project, { add: { kind: item.kind as "milestone", title: item.title, body: item.body, url: item.url, dueDay: item.dueDay } } as HubOp).then(() => null);
      return api.hubItemSave({ projectId: project.id, ...item });
    },
    onSuccess: (r) => (r ? onChanged() : toast({ kind: "info", title: t("Envoyé au propriétaire"), detail: t("Il s'applique dès que son TekBoard le reçoit.") })),
    onError: fail(t("Non ajouté")),
  });
  const update = useMutation({
    mutationFn: async (item: HubItem) => {
      if (project.role === "editor" && item.kind === "milestone") return propose(project, { toggle: { title: item.title, done: item.done } }).then(() => null);
      return api.hubItemSave(item);
    },
    onSuccess: (r) => r && onChanged(),
    onError: fail(t("Non modifié")),
  });
  const remove = useMutation({
    mutationFn: (item: HubItem) => api.hubItemDelete(item.id),
    onSuccess: (gone) => {
      onChanged();
      if (gone.kind !== "file") toast({ kind: "ok", title: t("Retiré : {x}", { x: gone.title }), action: { label: t("Annuler"), run: () => void api.hubItemSave({ ...gone, id: 0 }).then(onChanged) } });
    },
    onError: fail(t("Non retiré")),
  });
  return { add, update, remove, readOnly: project.role === "viewer", owner: project.role === "owner" };
}

function Work({ project: p, items, facts, onChanged }: { project: HubProject; items: HubItem[]; facts: HubFacts; onChanged: () => void }) {
  const act = useItemActions(p, onChanged);
  const milestones = items.filter((i) => i.kind === "milestone");
  const members = items.filter((i) => i.kind === "member").map((m) => m.title);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [who, setWho] = useState("");
  return (
    <div className="grid max-w-5xl grid-cols-1 gap-10 @4xl:grid-cols-2">
      <Section title={t("Jalons")} meta={milestones.length ? t("{a}/{b} atteints", { a: facts.milestonesDone, b: facts.milestones }) : undefined}>
        <ul className="pt-1">
          {milestones.map((m) => (
            <li key={m.id} className="group flex min-h-10 items-center gap-2.5 border-b border-line py-1.5">
              <DoneCheck label={t("Atteint")} checked={m.done} onChange={() => !act.readOnly && act.update.mutate({ ...m, done: !m.done })} />
              <span className={cn("min-w-0 flex-1 truncate text-sm", m.done && "text-muted line-through decoration-ink/30")}>{m.title}</span>
              {m.assignee && <span className="shrink-0 text-xs text-faint">{m.assignee}</span>}
              {m.dueDay && <span className="shrink-0 text-xs text-muted tabular-nums">{new Date(`${m.dueDay}T12:00`).toLocaleDateString(locale(), { day: "numeric", month: "short" })}</span>}
              {act.owner && (
                <IconButton label={t("Retirer le jalon")} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => act.remove.mutate(m)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
        {milestones.length === 0 && <Hint className="py-2">{t("Trois à six étapes concrètes : maquette, prototype, version testée, démo…")}</Hint>}
        {!act.readOnly && (
          <form
            className="mt-2 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!title.trim()) return;
              act.add.mutate({ kind: "milestone", title: title.trim(), dueDay: due || null, assignee: who || null }, { onSuccess: () => (setTitle(""), setDue(""), setWho("")) });
            }}
          >
            <Input className="h-8 min-w-40 flex-1" placeholder={t("Nouveau jalon")} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t("Nouveau jalon")} />
            <Input className="h-8 w-36" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label={t("Date du jalon")} />
            {members.length > 0 && <Select size="sm" label={t("Responsable")} value={who} onChange={setWho} options={[{ value: "", label: t("Personne") }, ...members.map((m) => ({ value: m, label: m }))]} />}
            <Button size="sm" type="submit" icon={<Plus className="size-3.5" />} disabled={!title.trim()} disabledReason={t("Écris le jalon")}>
              {t("Ajouter")}
            </Button>
          </form>
        )}
      </Section>
      <Tasks project={p} />
      <Section title={t("Temps")} className="@4xl:col-span-2">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 pt-3 text-sm">
          <span>{t("Travaillé")} <strong className="font-medium tabular-nums">{fmtDur(facts.minutesWorked)}</strong></span>
          <span>{t("Prévu")} <strong className="font-medium tabular-nums">{fmtDur(facts.minutesPlanned)}</strong></span>
          {p.estimateMin && <span className="text-muted">{t("sur une estimation de {d}", { d: fmtDur(p.estimateMin) })}</span>}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" icon={<CalendarCheck className="size-3.5" />} onClick={() => useUi.getState().setPage("agenda")}>
            {t("Ouvrir le planning")}
          </Button>
          {p.role !== "viewer" && <BoardButton project={p} />}
        </div>
        <Hint className="mt-2">{t("Le temps travaillé vient de tes sessions de focus et des sessions du planning marquées faites, sur ce projet.")}</Hint>
      </Section>
    </div>
  );
}

/** The project's tasks are planning tasks (key `hub:<id>`): added, ticked and planned like any other. */
function Tasks({ project: p }: { project: HubProject }) {
  const key = `hub:${p.id}`;
  const data = usePlanData();
  const act = usePlanActions();
  const [title, setTitle] = useState("");
  const [planning, setPlanning] = useState(false);
  const tasks = data.state.tasks.filter((x) => x.project === key && x.kind === "task" && x.parentId === null);
  const open = tasks.filter((x) => x.doneAt === null);
  const toPlan = open.filter((x) => !data.state.events.some((e) => e.taskId === x.id && e.end * 1000 > Date.now()));
  return (
    <Section
      title={t("Tâches")}
      meta={tasks.length ? t("{a}/{b} faites", { a: tasks.length - open.length, b: tasks.length }) : undefined}
      action={
        toPlan.length > 0 && (
          <Button size="sm" variant="ghost" icon={<CalendarCheck className="size-3.5" />} onClick={() => setPlanning(true)}>
            {plural(toPlan.length, "Planifier {n} tâche", "Planifier {n} tâches")}
          </Button>
        )
      }
    >
      <ul className="pt-1">
        {tasks.map((x: PlanTask) => (
          <li key={x.id} className="flex min-h-10 items-center gap-2.5 border-b border-line py-1.5">
            <DoneCheck label={t("Fait")} checked={x.doneAt !== null} onChange={() => act.toggleTask(x)} />
            <button type="button" className={cn("min-w-0 flex-1 truncate text-left text-sm", x.doneAt !== null && "text-muted line-through decoration-ink/30")} onClick={() => useUi.getState().editTask(x)}>
              {x.title}
            </button>
            {x.estimateMin !== null && <span className="shrink-0 text-xs text-faint">{fmtDur(x.estimateMin)}</span>}
          </li>
        ))}
      </ul>
      {tasks.length === 0 && <Hint className="py-2">{t("Les tâches vont dans ton planning : tu les places, les coches et les suis comme les autres.")}</Hint>}
      {p.role !== "viewer" && (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            act.saveTask.mutate({ title: title.trim(), project: key }, { onSuccess: () => setTitle("") });
          }}
        >
          <Input className="h-8 flex-1" placeholder={t("Nouvelle tâche")} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t("Nouvelle tâche")} />
          <Button size="sm" type="submit" icon={<Plus className="size-3.5" />} disabled={!title.trim()} disabledReason={t("Écris la tâche")}>
            {t("Ajouter")}
          </Button>
        </form>
      )}
      {planning && <BulkPlanDialog tasks={toPlan} projects={data.projects} onClose={() => setPlanning(false)} onApplied={() => undefined} />}
    </Section>
  );
}

/** The project's whiteboard: opened if there is one, created with the project's key otherwise. */
function BoardButton({ project: p }: { project: HubProject }) {
  const toast = useUi((s) => s.toast);
  const boards = useQuery({ queryKey: ["boards", "hub", p.id], queryFn: () => api.boardList(`hub:${p.id}`, null) });
  const mine = boards.data?.find((b) => b.project === `hub:${p.id}`);
  const go = async () => {
    try {
      const id = mine?.id ?? (await api.boardCreate(p.name, `hub:${p.id}`)).id;
      useUi.getState().openBoard(id);
    } catch (e) {
      toast({ kind: "error", title: t("Tableau non ouvert"), detail: asAppError(e).message });
    }
  };
  return (
    <Button size="sm" variant="ghost" icon={<PenTool className="size-3.5" />} onClick={() => void go()}>
      {mine ? t("Tableau blanc") : t("Créer le tableau blanc")}
    </Button>
  );
}

// ───────────────────────────── resources ─────────────────────────────

function Resources({ project: p, items, onSave, onChanged }: { project: HubProject; items: HubItem[]; onSave: (patch: Partial<HubProject>) => void; onChanged: () => void }) {
  const act = useItemActions(p, onChanged);
  const toast = useUi((s) => s.toast);
  const links = items.filter((i) => i.kind === "link");
  const files = items.filter((i) => i.kind === "file");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [remote, setRemote] = useState(p.repoUrl ?? "");
  useEffect(() => setRemote(p.repoUrl ?? ""), [p.repoUrl]);
  const addFile = async () => {
    const path = await openDialog({ multiple: false, title: t("Ajouter un fichier au projet"), filters: [{ name: t("Images, PDF, présentations, documents"), extensions: ["png", "jpg", "jpeg", "webp", "gif", "pdf", "pptx", "odp", "key", "md", "txt", "docx", "odt", "zip"] }] });
    if (typeof path !== "string") return;
    try {
      await api.hubFileAdd(p.id, path);
      onChanged();
    } catch (e) {
      toast({ kind: "error", title: t("Fichier non ajouté"), detail: asAppError(e).message });
    }
  };
  return (
    <div className="grid max-w-5xl grid-cols-1 gap-10 @4xl:grid-cols-2">
      <Section title={t("Dépôt")} className="@4xl:col-span-2">
        <div className="grid grid-cols-1 gap-4 pt-3 @3xl:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("Dépôt sur cet ordinateur")}</span>
            {act.owner ? <ProjectPicker value={p.repoPath} onChange={(repoPath) => onSave({ repoPath })} includeNone noneLabel={t("Aucun pour l'instant")} /> : <span className="text-sm text-faint">{t("Seul le propriétaire le relie.")}</span>}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("Dépôt en ligne (GitHub…)")}</span>
            <span className="flex items-center gap-1.5">
              <Input className="h-8 flex-1" disabled={!act.owner} placeholder="https://github.com/…" value={remote} onChange={(e) => setRemote(e.target.value)} onBlur={() => remote.trim() !== (p.repoUrl ?? "") && onSave({ repoUrl: remote.trim() || null })} />
              {p.repoUrl && (
                <IconButton label={t("Ouvrir dans le navigateur")} onClick={() => void api.hubOpenLink(p.id, null)}>
                  <ExternalLink className="size-3.5" />
                </IconButton>
              )}
            </span>
          </label>
        </div>
        {p.repoPath ? <RepoActivity id={p.id} path={p.repoPath} /> : <Hint className="mt-2">{t("Pas encore de dépôt : c'est normal au début. Relie-le quand le code existe.")}</Hint>}
      </Section>
      <Section title={t("Liens")}>
        <ul className="pt-1">
          {links.map((l) => (
            <li key={l.id} className="group flex min-h-9 items-center gap-2 border-b border-line py-1">
              <Link2 className="size-3.5 shrink-0 text-faint" />
              <button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:text-accent-strong" title={l.url ?? undefined} onClick={() => void api.hubOpenLink(p.id, l.id)}>
                {l.title}
              </button>
              {act.owner && (
                <IconButton label={t("Retirer le lien")} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => act.remove.mutate(l)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
        {!act.readOnly && (
          <form
            className="mt-2 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!url.trim()) return;
              act.add.mutate({ kind: "link", title: title.trim() || url.trim(), url: url.trim() }, { onSuccess: () => (setTitle(""), setUrl("")) });
            }}
          >
            <Input className="h-8 w-36" placeholder={t("Titre")} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t("Titre du lien")} />
            <Input className="h-8 min-w-40 flex-1" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label={t("Adresse")} />
            <Button size="sm" type="submit" icon={<Plus className="size-3.5" />} disabled={!url.trim()} disabledReason={t("Colle une adresse")}>
              {t("Ajouter")}
            </Button>
          </form>
        )}
      </Section>
      <Section
        title={t("Fichiers")}
        meta={t("captures, présentations, documents")}
        action={
          act.owner && (
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => void addFile()}>
              {t("Ajouter un fichier")}
            </Button>
          )
        }
      >
        {files.length === 0 ? (
          <Hint className="py-2">{t("Une copie est gardée avec le projet (sauvegardée avec tes données) ; l'original ne bouge pas.")}</Hint>
        ) : (
          <ul className="grid grid-cols-2 gap-3 pt-3 @3xl:grid-cols-3">
            {files.map((f) => (
              <FileTile key={f.id} item={f} canRemove={act.owner} onRemove={() => act.remove.mutate(f)} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function RepoActivity({ id, path }: { id: number; path: string }) {
  const repo = useQuery({ queryKey: ["hub", "repo", id], queryFn: () => api.hubRepo(id) });
  const lite = useLite();
  if (repo.isLoading) return <p className="mt-3"><Spinner /></p>;
  if (repo.error) return <ErrorNote>{asAppError(repo.error).message}</ErrorNote>;
  const r = repo.data;
  if (!r) return null;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5">
          <FolderGit2 className="size-3.5 text-faint" />
          {r.branch ?? t("HEAD détachée")}
        </span>
        <Dot tone={r.dirty ? "warn" : "ok"}>{r.dirty ? t("modifications en cours") : t("propre")}</Dot>
        <span className="text-muted">{plural(r.week, "{n} commit cette semaine", "{n} commits cette semaine")}</span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => void api.openIde(path)}>{t("Ouvrir dans l'IDE")}</Button>
        <Button size="sm" variant="ghost" onClick={() => useUi.getState().openSheet(path)}>{t("Fiche du dépôt")}</Button>
      </div>
      {!lite && r.commits.length > 0 && (
        <ul className="mt-2">
          {r.commits.slice(0, 5).map((c) => (
            <li key={c.hash} className="flex items-center gap-3 py-1 text-xs">
              <span className="font-mono text-faint">{c.hash.slice(0, 7)}</span>
              <span className="min-w-0 flex-1 truncate">{c.subject}</span>
              <span className="shrink-0 text-faint">{timeAgo(Math.floor(Date.parse(c.date) / 1000))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileTile({ item, canRemove, onRemove }: { item: HubItem; canRemove: boolean; onRemove: () => void }) {
  const image = /\.(png|jpe?g|webp|gif)$/i.test(item.path ?? item.title);
  const preview = useQuery({ queryKey: ["hub", "file", item.id], queryFn: () => api.hubFilePreview(item.id), enabled: image, staleTime: Infinity });
  return (
    <li className="group relative">
      <button type="button" onClick={() => void api.hubFileOpen(item.id)} className="lift flex w-full flex-col gap-1.5 text-left" title={t("Ouvrir")}>
        <span className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border border-line bg-well">
          {preview.data ? <img src={preview.data} alt="" className="size-full object-cover" /> : image ? <ImageIcon className="size-5 text-faint" /> : <FileText className="size-5 text-faint" />}
        </span>
        <span className="truncate text-xs">{item.title}</span>
      </button>
      {canRemove && (
        <IconButton label={t("Retirer le fichier")} className="absolute top-1 right-1 bg-surface/90 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </IconButton>
      )}
    </li>
  );
}

// ───────────────────────────── journal ─────────────────────────────

function Journal({ project: p, items, onChanged }: { project: HubProject; items: HubItem[]; onChanged: () => void }) {
  const act = useItemActions(p, onChanged);
  const entries = items.filter((i) => i.kind === "log" || i.kind === "decision").sort((a, b) => b.createdAt - a.createdAt);
  const [kind, setKind] = useState<"log" | "decision">("log");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return (
    <div className="max-w-3xl">
      {!act.readOnly && (
        <form
          className="mb-6 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            act.add.mutate({ kind, title: title.trim(), body: body.trim() }, { onSuccess: () => (setTitle(""), setBody("")) });
          }}
        >
          <div role="radiogroup" aria-label={t("Type d'entrée")} className="flex gap-1">
            {([["log", t("Journal")], ["decision", t("Décision technique")]] as const).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn("h-7 rounded-(--btn-radius) px-2.5 text-xs", kind === k ? "bg-ink/7 font-medium text-fg" : "text-muted hover:text-fg")}>
                {label}
              </button>
            ))}
          </div>
          <Input placeholder={kind === "log" ? t("Ce qui a avancé aujourd'hui") : t("La décision, en une ligne (ex. : SQLite plutôt que PostgreSQL)")} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t("Titre de l'entrée")} />
          <textarea className="field min-h-16 w-full rounded-(--btn-radius) border border-line bg-transparent p-2 text-sm" placeholder={kind === "log" ? t("Détails, blocages, prochaine étape (facultatif)") : t("Pourquoi, et ce qui a été écarté (facultatif)")} value={body} onChange={(e) => setBody(e.target.value)} />
          <Button size="sm" type="submit" className="w-fit" icon={<Plus className="size-3.5" />} disabled={!title.trim()} disabledReason={t("Écris l'entrée")}>
            {t("Ajouter au journal")}
          </Button>
        </form>
      )}
      {entries.length === 0 ? (
        <EmptyState title={t("Journal vide")}>{t("Une ligne par séance de travail suffit : c'est ce qui permet de raconter le projet à la fin.")}</EmptyState>
      ) : (
        <ol className="flex flex-col">
          {entries.map((e) => (
            <li key={e.id} className="group border-l-2 border-line py-2.5 pl-4" style={e.kind === "decision" ? { borderColor: "var(--color-accent)" } : undefined}>
              <p className="flex items-center gap-2 text-sm">
                {e.kind === "decision" && <span className="text-2xs font-medium text-accent-strong">{t("Décision")}</span>}
                <span className="min-w-0 flex-1">{e.title}</span>
                <span className="shrink-0 text-xs text-faint">{e.author ? `${e.author} · ` : ""}{timeAgo(e.createdAt)}</span>
                {act.owner && (
                  <IconButton label={t("Retirer l'entrée")} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => act.remove.mutate(e)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                )}
              </p>
              {e.body && <p className="mt-1 text-sm whitespace-pre-wrap text-muted">{e.body}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ───────────────────────────── presentation ─────────────────────────────

function Pitch({ project: p, items, facts, onSave }: { project: HubProject; items: HubItem[]; facts: HubFacts; onSave: (patch: Partial<HubProject>) => void }) {
  const toast = useUi((s) => s.toast);
  const owner = p.role === "owner";
  const done = checklistDone(p, items);
  const ticked = list(p, "checklist");
  const toggle = (id: string) => onSave({ fields: { ...p.fields, checklist: ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id] } });
  return (
    <div className="grid max-w-5xl grid-cols-1 gap-10 @4xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex flex-col gap-4">
        {PITCH_FIELDS.map((f) => (
          <FieldEditor key={f.key} label={f.label} hint={f.hint} value={text(p, f.key)} disabled={!owner} onSave={(v) => onSave({ fields: { ...p.fields, [f.key]: v } })} />
        ))}
      </div>
      <aside className="flex flex-col gap-6">
        <Section title={t("Avant de présenter")} meta={`${done.size}/${CHECKLIST.length}`}>
          <ul className="pt-2">
            {CHECKLIST.map((c) => {
              const seen = done.has(c.id) && !ticked.includes(c.id);
              return (
                <li key={c.id}>
                  <label className="flex min-h-8 items-center gap-2.5 text-sm" title={seen ? t("Vu dans le projet") : undefined}>
                    <input type="checkbox" className="accent-(--color-accent)" checked={done.has(c.id)} disabled={!owner || seen} onChange={() => toggle(c.id)} />
                    <span className={cn(done.has(c.id) && "text-muted")}>{c.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Section>
        <div className="flex flex-col gap-2">
          <Button icon={<Sparkles className="size-3.5" />} onClick={() => useUi.getState().openAssistant({ text: pitchPrompt(p, items) })}>
            {t("Structurer avec Artix")}
          </Button>
          <Detail>
            <p className="text-xs text-faint">{t("Artix ne reçoit que ce que tu as écrit ici et tes jalons, avec la consigne de ne rien inventer.")}</p>
          </Detail>
          <Button variant="ghost" icon={<Download className="size-3.5" />} onClick={() => void exportSummary(p, items, facts).then((path) => path && toast({ kind: "ok", title: t("Synthèse exportée"), detail: path }), (e) => toast({ kind: "error", title: t("Export impossible"), detail: asAppError(e).message }))}>
            {t("Exporter la synthèse (.md)")}
          </Button>
        </div>
      </aside>
    </div>
  );
}

// ───────────────────────────── team ─────────────────────────────

function Team({ project: p, items, onChanged }: { project: HubProject; items: HubItem[]; onChanged: () => void }) {
  const toast = useUi((s) => s.toast);
  const act = useItemActions(p, onChanged);
  const connect = useQuery({ queryKey: CONNECT_KEY, queryFn: api.connectState, enabled: p.role === "owner" });
  const members = items.filter((i) => i.kind === "member");
  const [fp, setFp] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const candidates = (connect.data?.peers ?? []).filter((x) => x.trusted && !x.blocked && !members.some((m) => m.url === x.fp));
  const send = useMutation({
    mutationFn: () => {
      const peer = candidates.find((x) => x.fp === fp)!;
      return invite(p, peer.fp, peer.profile.nick || peer.short, role);
    },
    onSuccess: () => {
      setFp("");
      onChanged();
      toast({ kind: "ok", title: t("Invitation envoyée"), detail: t("La personne la voit dans Projet HUB dès que son TekBoard est ouvert.") });
    },
    onError: (e) => toast({ kind: "error", title: t("Invitation non envoyée"), detail: asAppError(e).message }),
  });
  if (p.role !== "owner") {
    return (
      <div className="max-w-2xl space-y-3 text-sm">
        <p>{t("Projet de {who}. Ton rôle : {r}.", { who: p.ownerNick ?? "?", r: p.role === "editor" ? t("contributeur (jalons, liens, journal)") : t("lecture seule") })}</p>
        <p className="text-muted">{plural(members.length, "{n} membre", "{n} membres")}{members.length ? ` : ${members.map((m) => m.title).join(", ")}` : ""}</p>
        <Hint>{t("Les changements arrivent quand le TekBoard du propriétaire est ouvert, sur le même réseau. « Actualiser » les redemande.")}</Hint>
      </div>
    );
  }
  return (
    <div className="max-w-3xl">
      <Section title={t("Membres")}>
        {members.length === 0 ? (
          <Hint className="py-3">{t("Seul toi pour l'instant.")}</Hint>
        ) : (
          <ul className="pt-1">
            {members.map((m) => (
              <li key={m.id} className="flex min-h-10 items-center gap-3 border-b border-line py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm">{m.title}</span>
                <Select<string> size="sm" label={t("Rôle de {n}", { n: m.title })} value={m.role ?? "viewer"} onChange={(r) => act.update.mutate({ ...m, role: r as "editor" })} options={[{ value: "editor", label: t("Contributeur") }, { value: "viewer", label: t("Lecture seule") }]} />
                <IconButton label={t("Retirer {n} du projet", { n: m.title })} onClick={() => act.remove.mutate(m)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t("Inviter")} className="mt-8">
        {!connect.data?.enabled ? (
          <Notice tone="info" action={<Button size="sm" variant="ghost" onClick={() => useUi.getState().setPage("connect")}>{t("Ouvrir Connect")}</Button>}>
            {t("L'invitation passe par TekBoard Connect, entre ordinateurs du même réseau : active-le d'abord.")}
          </Notice>
        ) : candidates.length === 0 ? (
          <Notice tone="info" action={<Button size="sm" variant="ghost" onClick={() => useUi.getState().setPage("connect")}>{t("Ajouter une personne")}</Button>}>
            {t("Associe d'abord la personne dans Connect (code à 6 chiffres) : seules les personnes associées peuvent être invitées.")}
          </Notice>
        ) : (
          <div className="flex flex-wrap items-center gap-2 pt-3">
            <Select<string> size="sm" label={t("Personne")} value={fp} onChange={setFp} options={[{ value: "", label: t("Choisir une personne") }, ...candidates.map((c) => ({ value: c.fp, label: c.profile.nick || c.short, hint: c.online ? t("en ligne") : t("hors ligne") }))]} />
            <Select<"editor" | "viewer"> size="sm" label={t("Rôle")} value={role} onChange={setRole} options={[{ value: "editor", label: t("Contributeur") }, { value: "viewer", label: t("Lecture seule") }]} />
            <Button size="sm" busy={send.isPending} disabled={!fp} disabledReason={t("Choisis une personne")} onClick={() => send.mutate()}>
              {t("Inviter")}
            </Button>
          </div>
        )}
        <Hint className="mt-3">{t("Ton ordinateur fait référence : il vérifie le rôle de chacun avant d'appliquer un changement. Les chemins de tes fichiers et ton dépôt local ne sont jamais envoyés.")}</Hint>
      </Section>
    </div>
  );
}
