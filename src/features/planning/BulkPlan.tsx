// Bulk planning: several tasks chosen in "À placer" are edited together (duration, priority,
// project) or placed in the calendar in one go. The planning engine proposes; the proposal
// is shown compact and editable (each line can be left out or moved), applied in one step,
// and undone in one step.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Menu, MenuItem, SubMenu } from "../../components/Menu";
import { Modal } from "../../components/Modal";
import { Button, cn, ErrorNote, IconButton, Input, Notice, Spinner } from "../../components/ui";
import { api, asAppError, type PlanSuggestion, type PlanTask, type ScheduleAction, type TaskPatch } from "../../lib/api";
import { plural, locale, t } from "../../lib/i18n";
import { fmtDur, type PlanProject } from "../../lib/plan";
import { useUi } from "../../lib/store";

const DURATIONS = [30, 60, 90, 120, 180, 240];
const PRIORITIES: Array<[number, string]> = [
  [3, t("Haute")],
  [2, t("Moyenne")],
  [1, t("Basse")],
  [0, t("Aucune")],
];

/** The bar shown over the list while tasks are selected. */
export function BulkBar({ tasks, total, projects, onAll, onClear, onPlan }: { tasks: PlanTask[]; total: number; projects: PlanProject[]; onAll: () => void; onClear: () => void; onPlan: () => void }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const ids = tasks.map((x) => x.id);
  const patch = useMutation({
    mutationFn: (p: TaskPatch) => api.planTasksPatch(ids, p),
    onSuccess: (before) => {
      void qc.invalidateQueries({ queryKey: ["plan"] });
      toast({
        kind: "ok",
        title: plural(before.length, "{n} tâche modifiée", "{n} tâches modifiées"),
        action: { label: t("Annuler"), run: () => void api.planTasksRestore(before).then(() => qc.invalidateQueries({ queryKey: ["plan"] })) },
      });
    },
    onError: (e) => toast({ kind: "error", title: t("Tâches non modifiées"), detail: asAppError(e).message }),
  });
  return (
    <div className="anim-fade sticky top-0 z-10 -mx-3 -mt-3 mb-1 flex items-center gap-1 border-b border-line bg-surface py-1.5 pr-3 pl-1.5">
      <IconButton label={t("Tout désélectionner")} onClick={onClear}>
        <X className="size-4" />
      </IconButton>
      <span className="text-xs whitespace-nowrap text-muted tabular-nums">{plural(tasks.length, "{n} choisie", "{n} choisies")}</span>
      {tasks.length < total && (
        <button type="button" className="ml-1 text-xs text-faint hover:text-fg" onClick={onAll}>
          {t("toutes")}
        </button>
      )}
      <span className="flex-1" />
      <Menu
        label={t("Modifier la sélection")}
        trigger={
          <Button size="sm" variant="ghost" busy={patch.isPending}>
            {t("Modifier")}
          </Button>
        }
      >
        <SubMenu label={t("Durée")}>
          {DURATIONS.map((m) => (
            <MenuItem key={m} onSelect={() => patch.mutate({ estimateMin: m })}>
              {fmtDur(m)}
            </MenuItem>
          ))}
          <MenuItem onSelect={() => patch.mutate({ estimateMin: null })}>{t("Sans durée")}</MenuItem>
        </SubMenu>
        <SubMenu label={t("Priorité")}>
          {PRIORITIES.map(([p, label]) => (
            <MenuItem key={p} onSelect={() => patch.mutate({ priority: p })}>
              {label}
            </MenuItem>
          ))}
        </SubMenu>
        <SubMenu label={t("Projet")}>
          {projects.slice(0, 20).map((p) => (
            <MenuItem key={p.key} onSelect={() => patch.mutate({ project: p.key })}>
              <span className="flex items-center gap-2">
                <span className="size-1.5 rounded-full" style={{ background: p.color }} />
                {p.title}
              </span>
            </MenuItem>
          ))}
          <MenuItem onSelect={() => patch.mutate({ project: null })}>{t("Aucun projet")}</MenuItem>
        </SubMenu>
      </Menu>
      <Button size="sm" icon={<CalendarCheck className="size-3.5" />} onClick={onPlan}>
        {t("Planifier")}
      </Button>
    </div>
  );
}

const HORIZONS: Array<[number, string]> = [
  [3, t("3 jours")],
  [7, t("7 jours")],
  [14, t("2 semaines")],
];

type Line = Extract<ScheduleAction, { type: "create_session" }> & { keep: boolean };

const minutesBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 60_000);
const shiftEnd = (start: string, minutes: number) => {
  const d = new Date(Date.parse(start) + minutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** "Le ven. 27 nov." or "Du ven. 27 nov. au lun. 30 nov." for the lines proposed. */
function span(lines: Line[]): string {
  const day = (ms: number) => new Date(ms).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" });
  const a = day(Math.min(...lines.map((l) => Date.parse(l.start))));
  const b = day(Math.max(...lines.map((l) => Date.parse(l.end))));
  return a === b ? t("Le {a}", { a }) : t("Du {a} au {b}", { a, b });
}

/** The engine's proposal for the selected tasks: review, adjust, apply all or part, undo in one step. */
export function BulkPlanDialog({ tasks, projects, onClose, onApplied }: { tasks: PlanTask[]; projects: PlanProject[]; onClose: () => void; onApplied: () => void }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [days, setDays] = useState(7);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [sug, setSug] = useState<PlanSuggestion | null>(null);
  const ids = useMemo(() => tasks.map((x) => x.id), [tasks]);
  const propose = useMutation({
    mutationFn: (d: number) => api.planSuggestTasks(ids, d),
    onSuccess: (s) => {
      setSug(s);
      setLines(s.actions.filter((a): a is Extract<ScheduleAction, { type: "create_session" }> => a.type === "create_session").map((a) => ({ ...a, keep: true })));
    },
  });
  useEffect(() => {
    propose.mutate(days);
    // Recomputed when the horizon changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);
  const apply = useMutation({
    mutationFn: () => api.planApply(lines!.filter((l) => l.keep).map(({ keep: _k, ...a }) => a), "auto"),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["plan"] });
      onApplied();
      onClose();
      toast({
        kind: "ok",
        title: plural(r.created, "{n} créneau ajouté au planning", "{n} créneaux ajoutés au planning"),
        action: r.undo.length > 0 ? { label: t("Annuler"), run: () => void api.planApply(r.undo, "auto").then(() => qc.invalidateQueries({ queryKey: ["plan"] })) } : undefined,
      });
    },
  });
  const color = (key: string | null) => projects.find((p) => p.key === key)?.color ?? "var(--color-faint)";
  const kept = lines?.filter((l) => l.keep).length ?? 0;
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls!.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const askArtix = () => {
    onClose();
    useUi.getState().openAssistant({ text: t("Répartis ces tâches dans mon planning, en respectant mon rythme et les rendus : {list}", { list: tasks.map((x) => `« ${x.title} »`).join(", ") }) });
  };
  return (
    <Modal
      open
      onClose={onClose}
      width="w-[640px]"
      title={plural(tasks.length, "Planifier {n} tâche", "Planifier {n} tâches")}
      description={t("Proposé par le moteur de TekBoard selon ton rythme, tes cours et les rendus. Rien ne change avant que tu valides.")}
      footer={
        <>
          <Button variant="ghost" icon={<Sparkles className="size-3.5" />} className="mr-auto" onClick={askArtix}>
            {t("Demander à Artix")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("Fermer")}
          </Button>
          <Button variant="primary" disabled={kept === 0} disabledReason={kept === 0 ? t("Aucun créneau gardé") : null} busy={apply.isPending} onClick={() => apply.mutate()}>
            {plural(kept, "Placer {n} créneau", "Placer {n} créneaux")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label={t("Sur combien de temps")} className="flex items-center gap-1">
          <span className="mr-2 text-xs text-faint">{t("Sur")}</span>
          {HORIZONS.map(([d, label]) => (
            <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={cn("h-7 rounded-(--btn-radius) px-2.5 text-xs transition-colors duration-(--dur-fast)", days === d ? "bg-ink/7 font-medium text-fg" : "text-muted hover:text-fg")}>
              {label}
            </button>
          ))}
          {propose.isPending && <Spinner className="ml-2" />}
        </div>
        {propose.error && <ErrorNote title={t("Proposition impossible")}>{asAppError(propose.error).message}</ErrorNote>}
        {apply.error && <ErrorNote title={t("Rien n'a été placé")}>{asAppError(apply.error).message}</ErrorNote>}
        {lines && lines.length === 0 && !propose.isPending && <Notice tone="warn">{t("Aucun créneau libre ne convient sur cette période. Essaie une période plus longue, ou ajuste ton rythme.")}</Notice>}
        {lines && lines.length > 0 && (
          <ul className="max-h-[48vh] divide-y divide-line overflow-y-auto">
            {lines.map((l, i) => {
              const minutes = minutesBetween(l.start, l.end);
              return (
                <li key={`${l.taskId}-${l.start}`} className={cn("flex items-center gap-3 py-2", !l.keep && "opacity-50")}>
                  <input type="checkbox" className="accent-(--color-accent)" checked={l.keep} onChange={(e) => set(i, { keep: e.target.checked })} aria-label={t("Garder ce créneau")} />
                  <span className="size-2 shrink-0 rounded-full" style={{ background: color(l.project) }} />
                  <span className="min-w-0 flex-1 truncate text-sm">{l.title}</span>
                  <Input type="datetime-local" className="h-7 w-48 text-xs" value={l.start} disabled={!l.keep} aria-label={t("Début")} onChange={(e) => e.target.value && set(i, { start: e.target.value, end: shiftEnd(e.target.value, minutes) })} />
                  <span className="w-14 shrink-0 text-right text-xs text-faint tabular-nums">{fmtDur(minutes)}</span>
                </li>
              );
            })}
          </ul>
        )}
        {sug && sug.unplaced.length > 0 && (
          <Notice tone="warn">
            {t("Sans créneau : {list}", { list: sug.unplaced.map((u) => `${u.title} (${fmtDur(u.minutes)})`).join(", ") })}
          </Notice>
        )}
        {lines && lines.length > 0 && <p className="text-xs text-faint">{[span(lines), ...(sug?.notes ?? [])].join(" · ")}</p>}
      </div>
    </Modal>
  );
}
