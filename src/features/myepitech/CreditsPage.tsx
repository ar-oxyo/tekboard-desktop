// Credits: the year's credits as MY Epitech has them (official, never changed here), what is
// still at stake, and scenarios the student builds on top ("if I validate this, and drop
// that…"), checked against the barème's minimums. Every simulated figure says it is one.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Lock, Minus, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Menu, MenuItem } from "../../components/Menu";
import { Select } from "../../components/Select";
import { Button, cn, Dot, IconButton, Input, Meter, Notice, PageHeader, Section } from "../../components/ui";
import { api, asAppError, type CreditScenarioRow, type SkillTree } from "../../lib/api";
import { evaluate, graded, newScenario, readScenario, trackKey, trackSemesters, unitsOf, type CreditModule, type CreditUe, type ModuleRow, type ScenarioData } from "../../lib/credits";
import { usePref } from "../../lib/hooks";
import { t } from "../../lib/i18n";
import { useUi } from "../../lib/store";

const KEY = ["credit-scenarios"] as const;

export function CreditsPage() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const tree = useQuery({ queryKey: ["my", "skill-tree"], queryFn: api.mySkillTree, staleTime: 60_000 });
  const list = useQuery({ queryKey: KEY, queryFn: api.creditScenarios });
  const [currentId, setCurrentId] = usePref<number | null>("credits.current", null);
  const rows = list.data ?? [];
  const current = rows.find((r) => r.id === currentId) ?? rows[0] ?? null;
  const [data, setData] = useState<ScenarioData>(() => readScenario(current?.data));
  const [edit, setEdit] = useState(false);
  // The scenario shown follows the one picked; edits are saved shortly after the last change.
  useEffect(() => setData(readScenario(current?.data)), [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const timer = useRef<number | null>(null);
  const saving = useRef<Promise<CreditScenarioRow | null> | null>(null);

  const persist = (next: ScenarioData, name?: string, id: number | null = current?.id ?? null) =>
    (saving.current = api
      .creditScenarioSave(id, name ?? current?.name ?? t("Mon parcours"), next)
      .then((row) => {
        qc.setQueryData<CreditScenarioRow[]>(KEY, (old) => [row, ...(old ?? []).filter((x) => x.id !== row.id)]);
        if (row.id !== currentId) setCurrentId(row.id);
        return row;
      })
      .catch((e) => {
        toast({ kind: "error", title: t("Scénario non enregistré"), detail: asAppError(e).message });
        return null;
      }));
  const change = (next: ScenarioData) => {
    setData(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void persist(next), 500);
  };
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  const units = useMemo(() => unitsOf(tree.data?.nodes ?? []), [tree.data]);
  const r = useMemo(() => evaluate(data, units), [data, units]);
  const noMy = !tree.isLoading && units.length === 0;

  const ask = (label: string, value: string) => window.prompt(label, value)?.trim() || null;
  const actions = (
    <div className="flex items-center gap-1.5">
      <Select size="sm" className="w-48" label={t("Scénario")} value={current ? String(current.id) : null} placeholder={t("Mon parcours")} onChange={(v) => setCurrentId(Number(v))} options={rows.map((s) => ({ value: String(s.id), label: s.name }))} emptyState={{ text: t("Aucun scénario enregistré") }} />
      <Menu label={t("Scénarios")}>
        <MenuItem icon={<Plus className="size-4" />} onSelect={() => { const n = ask(t("Nom du nouveau scénario"), t("Nouveau scénario")); if (n) { const fresh = newScenario(); setData(fresh); void persist(fresh, n, null); } }}>{t("Nouveau scénario")}</MenuItem>
        <MenuItem icon={<Copy className="size-4" />} onSelect={() => { const n = ask(t("Nom de la copie"), t("{n} (copie)", { n: current?.name ?? t("Mon parcours") })); if (n) void persist(structuredClone(data), n, null); }}>{t("Dupliquer")}</MenuItem>
        <MenuItem icon={<Pencil className="size-4" />} disabled={!current} onSelect={() => { const n = current && ask(t("Nouveau nom"), current.name); if (n) void persist(data, n); }}>{t("Renommer")}</MenuItem>
        <MenuItem icon={<Trash2 className="size-4" />} danger disabled={!current} onSelect={() => { if (current && window.confirm(t("Supprimer le scénario « {n} » ? Tes résultats MY Epitech ne changent pas.", { n: current.name }))) void api.creditScenarioDelete(current.id).then(() => { setCurrentId(null); void qc.invalidateQueries({ queryKey: KEY }); }); }}>{t("Supprimer")}</MenuItem>
      </Menu>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("Crédits")} subtitle={t("Barème {b} · simulation, pas un résultat officiel", { b: data.bareme.name })} actions={actions} />
      {noMy && <Notice tone="info" action={<Button size="sm" onClick={() => useUi.getState().setPage("myepitech")}>{t("Connecter MY Epitech")}</Button>}>{t("Sans MY Epitech, aucun résultat officiel : tu peux simuler, rien ne sera compté comme acquis.")}</Notice>}
      <Summary r={r} my={tree.data?.credits ?? null} objective={data.objective} onObjective={(objective) => change({ ...data, objective })} />
      {data.bareme.ues.map((ue, ui) => {
        const res = r.ues[ui];
        return (
          <Section
            key={ue.id}
            className="rounded-lg border border-line px-4 pt-2.5 pb-1.5"
            title={ue.name}
            meta={
              <span className="flex items-center gap-2">
                <Meter className="w-24" value={res.projected} max={ue.min} tone={res.ok ? "accent" : "warn"} label={t("{p} sur {m} crédits", { p: res.projected, m: ue.min })} />
                <span className={cn("font-mono text-2xs", res.ok ? "text-muted" : "text-warn")} title={t("Crédits prévus dans ce scénario, face au minimum de l'unité")}>{res.projected} / {ue.min}</span>
              </span>
            }
            action={edit ? <MinField value={ue.min} onChange={(min) => change(editUe(data, ui, { min }))} /> : undefined}
          >
            {ue.tracks && ue.tracks.length > 0 && <TrackPicker ue={ue} picks={data.tracks} onChange={(tracks) => change({ ...data, tracks })} />}
            <ul>
              {res.rows.map((row, mi) => (
                <ModuleLine key={row.module.id} row={row} units={units} edit={edit} onPlan={(n) => change({ ...data, choices: { ...data.choices, [row.module.id]: n } })} onReset={() => { const { [row.module.id]: _, ...rest } = data.choices; change({ ...data, choices: rest }); }} onLink={(id) => change({ ...data, links: { ...data.links, [row.module.id]: id } })} onEdit={(p) => change(editModule(data, ui, mi, p))} onRemove={() => change(removeModule(data, ui, mi))} chosen={row.module.id in data.choices} />
              ))}
            </ul>
            {edit && (
              <button type="button" className="mt-1 flex items-center gap-1.5 px-1 py-1 text-xs text-accent hover:underline" onClick={() => change(addModule(data, ui))}>
                <Plus className="size-3.5" /> {t("Ajouter un module")}
              </button>
            )}
          </Section>
        );
      })}
      <footer className="space-y-2 border-t border-line pt-3 text-xs text-muted">
        <div className="flex items-center gap-2">
          <span>{t("Barème : {n} · source : {s}", { n: data.bareme.name, s: data.bareme.source })}</span>
          <span className="flex-1" />
          {edit && (
            <label className="flex items-center gap-1.5">
              {t("Crédits requis")}
              <Input type="number" min={1} max={300} className="h-7 w-16 text-xs" value={data.bareme.required} onChange={(e) => change({ ...data, bareme: { ...data.bareme, required: Math.max(1, Math.min(300, Number(e.target.value) || data.bareme.required)) } })} />
            </label>
          )}
          <Button size="sm" variant="ghost" icon={edit ? <X className="size-3.5" /> : <Pencil className="size-3.5" />} onClick={() => setEdit(!edit)}>
            {edit ? t("Terminer") : t("Modifier le barème et les liens")}
          </Button>
        </div>
        {data.bareme.notes.length > 0 && (
          <details>
            <summary className="cursor-pointer text-faint hover:text-fg">{t("Ce que le barème ne précise pas ({n})", { n: data.bareme.notes.length })}</summary>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">{data.bareme.notes.map((n) => <li key={n}>{t(n)}</li>)}</ul>
          </details>
        )}
      </footer>
    </div>
  );
}

/** The year at a glance: one bar (official, at stake, simulated) against the objective. */
function Summary({ r, my, objective, onObjective }: { r: ReturnType<typeof evaluate>; my: SkillTree["credits"] | null; objective: number; onObjective: (n: number) => void }) {
  const scale = Math.max(objective, r.required, r.projected, 1);
  const pct = (n: number) => `${(Math.max(0, n) / scale) * 100}%`;
  const fromPending = Math.min(r.simulated, r.pending);
  const fromPlan = r.simulated - fromPending;
  const got = r.official + r.secured;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
        <p className="leading-none">
          <span className="display text-3xl font-bold tabular-nums">{r.projected}</span>
          <span className="ml-1.5 text-lg text-muted tabular-nums">/ {objective}</span>
          <span className="ml-2 text-sm text-muted">{t("crédits prévus")}</span>
        </p>
        <Figure label={t("Obtenus (officiel)")} value={r.official} title={t("Unités notées par MY Epitech : les crédits sont attribués en fin de semestre")} />
        <Figure label={t("Validés, note à venir")} value={r.secured} title={t("Tous les acquis d'apprentissage sont validés, MY Epitech n'a pas encore donné la note")} />
        <Figure label={t("En attente")} value={r.pending} title={t("Crédits des unités en cours, pas encore décidés")} />
        <Figure label={t("Simulés")} value={r.simulated} title={t("Ce que ce scénario ajoute : une estimation")} />
        <Figure label={t("Manquants pour l'objectif")} value={r.missing} warn={r.missing > 0} />
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          {t("Objectif")}
          <Input type="number" min={1} max={300} className="h-7 w-16 text-xs" value={objective} onChange={(e) => onObjective(Math.max(1, Math.min(300, Number(e.target.value) || objective)))} />
        </label>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-ink/8" role="img" aria-label={t("{o} obtenus, {s} simulés, objectif {g}", { o: r.official, s: r.simulated, g: objective })}>
        <span className="absolute inset-y-0 left-0 bg-fg" style={{ width: pct(r.official) }} />
        <span className="absolute inset-y-0 bg-ok" style={{ left: pct(r.official), width: pct(r.secured) }} />
        <span className="absolute inset-y-0 bg-accent" style={{ left: pct(got), width: pct(fromPending) }} />
        <span className="credit-planned absolute inset-y-0" style={{ left: pct(got + fromPending), width: pct(fromPlan) }} />
        <span className="absolute inset-y-0 w-0.5 bg-accent-2" style={{ left: `calc(${pct(r.required)} - 1px)` }} title={t("{n} crédits requis", { n: r.required })} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-fg" />{t("officiel")}</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-ok" />{t("validé, note à venir")}</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-accent" />{t("en cours, attendu")}</span>
        <span className="flex items-center gap-1.5"><span className="credit-planned size-2 rounded-sm" />{t("à venir, simulé")}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-0.5 bg-accent-2" />{t("{n} requis", { n: r.required })}</span>
        {r.short.length > 0 && <span className="text-warn">{t("Sous le minimum : {u}", { u: r.short.join(", ") })}</span>}
        {r.unmatched > 0 && <span>{t("{n} module(s) sans unité MY", { n: r.unmatched })}</span>}
      </div>
      {my && (my.acquired !== null || my.secure !== null) && (
        <p className="text-xs text-muted" title={t("Les totaux de MY Epitech, tels quels : les mêmes que dans le Skill Tree")}>
          {t("Selon MY Epitech")} : <span className="font-medium text-fg tabular-nums">{my.acquired ?? 0}</span> {t("obtenus")}
          {my.secure !== null && <> · <span className="font-medium text-fg tabular-nums">{my.secure}</span> {t("assurés")}</>}
          {my.threshold !== null && <> · {t("seuil {n}", { n: my.threshold })}</>}
          {my.lost > 0 && <span className="text-warn"> · {t("{n} perdus", { n: my.lost })}</span>}
        </p>
      )}
    </section>
  );
}

function Figure({ label, value, title, warn }: { label: string; value: number; title?: string; warn?: boolean }) {
  return (
    <p className="leading-tight" title={title}>
      <span className={cn("block text-lg font-semibold tabular-nums", warn && "text-warn")}>{value}</span>
      <span className="text-2xs text-faint">{label}</span>
    </p>
  );
}

const STATE: Record<ModuleRow["kind"], { tone: "ok" | "danger" | "accent" | "neutral"; label: string }> = {
  official: { tone: "ok", label: t("Acquis") },
  secured: { tone: "ok", label: t("Validé, note à venir") },
  failed: { tone: "danger", label: t("Non validé") },
  pending: { tone: "accent", label: t("En cours") },
  plan: { tone: "neutral", label: t("À venir") },
};

function ModuleLine({ row, units, edit, chosen, onPlan, onReset, onLink, onEdit, onRemove }: { row: ModuleRow; units: ReturnType<typeof unitsOf>; edit: boolean; chosen: boolean; onPlan: (n: number) => void; onReset: () => void; onLink: (id: string | null) => void; onEdit: (p: Partial<CreditModule>) => void; onRemove: () => void }) {
  const { module: m, unit, kind } = row;
  const max = Math.max(m.max, unit?.credits ?? 0);
  const locked = kind === "official" || kind === "secured" || kind === "failed";
  return (
    <li className={cn("ink-row flex min-h-9 items-center gap-3 border-b border-line/60 px-1 py-1 last:border-0", !row.counted && "opacity-45")}>
      <div className="min-w-0 flex-1">
        {edit ? (
          <div className="flex gap-2">
            <Input className="h-7 min-w-0 flex-1 text-sm" value={m.name} onChange={(e) => onEdit({ name: e.target.value })} aria-label={t("Nom du module")} />
            <Select
              size="sm"
              className="w-64"
              label={t("Unité MY Epitech")}
              value={unit?.id ?? "none"}
              onChange={(v) => onLink(v === "none" ? null : v)}
              options={[{ value: "none", label: t("Aucune unité MY liée") }, ...units.map((u) => ({ value: u.id, label: u.label, hint: u.code ?? undefined }))]}
            />
          </div>
        ) : (
          <p className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm text-fg">{m.name}</span>
            <span className="truncate text-2xs text-faint" title={t("Unité MY Epitech liée (modifiable dans « Modifier le barème »)")}>
              {unit ? (unit.label !== m.name ? unit.label : "") + (unit.code ? ` ${unit.code}` : "") : t("pas d'unité MY")}
            </span>
          </p>
        )}
      </div>
      {!row.counted ? <span className="text-2xs text-faint">{t("hors piste")}</span> : <Dot tone={STATE[kind].tone}>{STATE[kind].label}{unit?.grade && kind !== "plan" && graded(unit.grade) ? ` · ${unit.grade}` : ""}</Dot>}
      {edit ? (
        <span className="flex items-center gap-1">
          <Input type="number" min={0} max={30} className="h-7 w-14 text-xs" value={m.max} onChange={(e) => onEdit({ max: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} aria-label={t("Crédits du module")} />
          <IconButton label={t("Retirer ce module")} onClick={onRemove}><Trash2 className="size-3.5" /></IconButton>
        </span>
      ) : locked ? (
        <span className="flex w-28 items-center justify-end gap-1.5 font-mono text-xs text-muted" title={kind === "secured" ? t("Unité validée sur MY Epitech, crédits attribués avec la note : une simulation ne le change pas") : t("Résultat officiel de MY Epitech : une simulation ne le change pas")}>
          <Lock className="size-3" /> {row.official + row.secured} {t("cr.")}
        </span>
      ) : (
        <span className="flex w-28 items-center justify-end gap-0.5" title={row.fromBareme ? t("MY Epitech ne donne pas les crédits de cette unité : ceux du barème sont utilisés") : undefined}>
          {chosen && <IconButton label={t("Revenir à la valeur par défaut")} onClick={onReset}><RotateCcw className="size-3" /></IconButton>}
          <IconButton label={t("Un crédit de moins")} disabled={!row.counted || row.planned <= 0} onClick={() => onPlan(row.planned - 1)}><Minus className="size-3.5" /></IconButton>
          <span className={cn("w-10 text-center font-mono text-xs tabular-nums", row.planned > 0 ? "text-accent-strong" : "text-faint")}>{row.planned}/{max}</span>
          <IconButton label={t("Un crédit de plus")} disabled={!row.counted || row.planned >= max} onClick={() => onPlan(row.planned + 1)}><Plus className="size-3.5" /></IconButton>
        </span>
      )}
    </li>
  );
}

/** Tracks per semester: any number can be picked in each half of the year. */
function TrackPicker({ ue, picks, onChange }: { ue: CreditUe; picks: ScenarioData["tracks"]; onChange: (p: ScenarioData["tracks"]) => void }) {
  const semesters = trackSemesters(ue);
  const offered = (sem: number) => (ue.tracks ?? []).filter((tr) => ue.modules.some((x) => x.track === tr.id && (x.semester ?? 0) === sem));
  return (
    <div className="divide-y divide-line/60 border-b border-line/60">
      {semesters.map((sem) => {
        const key = trackKey(ue.id, sem);
        const on = picks[key] ?? [];
        const toggle = (id: string) => onChange({ ...picks, [key]: on.includes(id) ? on.filter((x) => x !== id) : [...on, id] });
        return (
          <div key={sem} className="flex flex-wrap items-center gap-1.5 py-2 text-xs">
            <span className="w-24 shrink-0 text-faint">{sem === 1 ? t("1er semestre") : sem === 0 ? t("Pistes") : t("{n}e semestre", { n: sem })}</span>
            {offered(sem).map((tr) => {
              const picked = on.includes(tr.id);
              return (
                <button key={tr.id} type="button" aria-pressed={picked} onClick={() => toggle(tr.id)} className={cn("flex h-7 items-center gap-1 rounded-(--btn-radius) border px-2.5 transition-colors", picked ? "border-transparent bg-accent-soft text-accent-strong" : "border-line text-muted hover:text-fg")}>
                  {picked && <Check className="size-3" />}
                  {tr.name}
                </button>
              );
            })}
            <span className="ml-1 text-faint">{on.length === 0 ? t("Aucune piste : rien ne compte") : t("{n} piste(s) comptée(s)", { n: on.length })}</span>
          </div>
        );
      })}
    </div>
  );
}

function MinField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-2xs text-faint">
      {t("Minimum")}
      <Input type="number" min={0} max={120} className="h-7 w-14 text-xs" value={value} onChange={(e) => onChange(Math.max(0, Math.min(120, Number(e.target.value) || 0)))} />
    </label>
  );
}

// ── barème edits (immutable)

function editUe(s: ScenarioData, ui: number, p: { min: number }): ScenarioData {
  return { ...s, bareme: { ...s.bareme, ues: s.bareme.ues.map((u, i) => (i === ui ? { ...u, ...p } : u)) } };
}
function editModule(s: ScenarioData, ui: number, mi: number, p: Partial<CreditModule>): ScenarioData {
  return { ...s, bareme: { ...s.bareme, ues: s.bareme.ues.map((u, i) => (i === ui ? { ...u, modules: u.modules.map((m, j) => (j === mi ? { ...m, ...p } : m)) } : u)) } };
}
function removeModule(s: ScenarioData, ui: number, mi: number): ScenarioData {
  return { ...s, bareme: { ...s.bareme, ues: s.bareme.ues.map((u, i) => (i === ui ? { ...u, modules: u.modules.filter((_, j) => j !== mi) } : u)) } };
}
function addModule(s: ScenarioData, ui: number): ScenarioData {
  const id = `perso-${Date.now().toString(36)}`;
  return { ...s, bareme: { ...s.bareme, ues: s.bareme.ues.map((u, i) => (i === ui ? { ...u, modules: [...u.modules, { id, name: t("Nouveau module"), max: 2 }] } : u)) } };
}
