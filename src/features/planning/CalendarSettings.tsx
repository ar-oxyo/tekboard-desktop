// Calendar settings: event categories (the five base ones can be renamed and recoloured, yours
// added and deleted) and the projects left out of the calendar (a year-long one like Student
// Engagement). Hiding a project only stops drawing its school items: nothing is deleted.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Modal } from "../../components/Modal";
import { Button, IconButton, Input } from "../../components/ui";
import { api, asAppError, type PlanCategory } from "../../lib/api";
import { t } from "../../lib/i18n";
import { calendarHidden, PALETTE } from "../../lib/plan";
import { useUi } from "../../lib/store";
import { usePlanData } from "./usePlan";

export function CalendarSettingsDialog({ onClose }: { onClose: () => void }) {
  const data = usePlanData();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["plan"] });
  const save = useMutation({ mutationFn: (c: { id: string | null; name: string; color: string }) => api.planCategorySave(c.id, c.name, c.color), onSuccess: refresh, onError: fail(t("Catégorie non enregistrée")) });
  const remove = useMutation({ mutationFn: (id: string) => api.planCategoryDelete(id), onSuccess: refresh, onError: fail(t("Catégorie non supprimée")) });
  const hide = useMutation({ mutationFn: ({ key, hidden }: { key: string; hidden: boolean }) => api.planProjectCalendar(key, hidden), onSuccess: refresh, onError: fail(t("Non enregistré")) });
  const [name, setName] = useState("");
  const hidden = calendarHidden(data.state);
  // Every project the calendar knows, and those already hidden even if they left the list.
  const projects = [...data.projects.map((p) => ({ key: p.key, title: p.title, module: p.module })), ...[...hidden].filter((k) => !data.projects.some((p) => p.key === k)).map((k) => ({ key: k, title: k.split("/").pop() ?? k, module: null }))];
  const add = () => {
    const n = name.trim();
    if (!n) return;
    save.mutate({ id: null, name: n, color: PALETTE[data.categories.length % PALETTE.length] }, { onSuccess: () => setName("") });
  };
  return (
    <Modal open onClose={onClose} title={t("Réglages du calendrier")} width="w-[560px]" footer={<Button variant="primary" onClick={onClose}>{t("Terminé")}</Button>}>
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="mb-1 text-sm font-medium">{t("Catégories")}</h3>
          <p className="mb-2 text-xs text-faint">{t("Les catégories de base se renomment et changent de couleur ; les tiennes se suppriment (leurs entrées reviennent à leur catégorie de base).")}</p>
          <ul className="flex flex-col gap-1">
            {data.categories.map((c) => (
              <CategoryRow key={c.id} c={c} onSave={(name, color) => save.mutate({ id: c.id, name, color })} onDelete={() => remove.mutate(c.id)} />
            ))}
          </ul>
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Input className="h-8 flex-1" placeholder={t("Nouvelle catégorie (Sport, Rendez-vous…)")} value={name} onChange={(e) => setName(e.target.value)} aria-label={t("Nom de la nouvelle catégorie")} />
            <Button size="sm" icon={<Plus className="size-3.5" />} disabled={!name.trim()} busy={save.isPending} onClick={add}>
              {t("Ajouter")}
            </Button>
          </form>
        </section>
        <section>
          <h3 className="mb-1 text-sm font-medium">{t("Projets affichés")}</h3>
          <p className="mb-2 text-xs text-faint">{t("Décoche un projet qui encombre le calendrier : ses rendus et séances ne sont plus dessinés. Il reste dans Projets, et ses données ne changent pas.")}</p>
          {projects.length === 0 ? (
            <p className="text-sm text-muted">{t("Aucun projet pour l'instant.")}</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto rounded-lg border border-ink/7 py-1">
              {projects.map((p) => (
                <li key={p.key}>
                  <label className="row-hover flex h-9 cursor-pointer items-center gap-2.5 px-3 text-sm">
                    <input type="checkbox" className="accent-(--color-accent)" checked={!hidden.has(p.key)} onChange={(e) => hide.mutate({ key: p.key, hidden: !e.target.checked })} />
                    <span className="min-w-0 flex-1 truncate">{p.title}</span>
                    {p.module && <span className="shrink-0 font-mono text-2xs text-faint">{p.module}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}

function CategoryRow({ c, onSave, onDelete }: { c: PlanCategory; onSave: (name: string, color: string) => void; onDelete: () => void }) {
  const [name, setName] = useState(c.name);
  const commit = (n = name, color = c.color) => {
    const clean = n.trim();
    if (clean && (clean !== c.name || color !== c.color)) onSave(clean, color);
    else setName(c.name);
  };
  return (
    <li className="flex items-center gap-2">
      <input type="color" aria-label={t("Couleur de {name}", { name: c.name })} value={c.color} onChange={(e) => commit(name, e.target.value)} className="size-7 shrink-0 cursor-pointer rounded border border-ink/10 bg-transparent p-0.5" />
      <Input className="h-8 flex-1" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => commit()} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} aria-label={t("Nom de la catégorie")} />
      {c.builtin ? (
        <span className="w-8 shrink-0 text-center text-3xs text-faint" title={t("Catégorie de base : elle se renomme mais ne se supprime pas")}>
          {t("base")}
        </span>
      ) : (
        <IconButton label={t("Supprimer la catégorie")} onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </IconButton>
      )}
    </li>
  );
}
