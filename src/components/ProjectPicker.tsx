// The one project selector. It says why a project is missing instead of showing a greyed or
// empty list: no projects folder yet, no repository found, a project outside the folders.
import { everyday, useSettings, useRepos } from "../lib/hooks";
import { repoOptions } from "../lib/repos";
import { useUi } from "../lib/store";
import { Select } from "./Select";
import { t } from "../lib/i18n";

export function ProjectPicker({ value, onChange, includeNone, noneLabel, includeDone = true, label = t("Projet"), size, className }: { value: string | null; onChange: (path: string | null) => void; includeNone?: boolean; noneLabel?: string; includeDone?: boolean; label?: string; size?: "sm" | "md"; className?: string }) {
  const settings = useSettings();
  const repos = useRepos(true, { all: true });
  const roots = settings.data?.roots ?? [];
  const only = settings.data?.epitechOnly ?? true;
  // The chosen project stays listed even when it is personal or archived: never "not found" for it.
  const list = (repos.data ?? []).filter((r) => r.path === value || (everyday(r, only) && (includeDone || r.progress !== "done")));
  const options = [...(includeNone ? [{ value: "", label: noneLabel ?? t("Aucun projet") }] : []), ...repoOptions(list)];
  const ui = useUi.getState;
  const emptyState = repos.isError
    ? { text: t("Les projets n'ont pas pu être lus."), action: { label: t("Vérifier les réglages"), onClick: () => ui().setPage("settings") } }
    : roots.length === 0
      ? { text: t("Aucun dossier de projets configuré."), action: { label: t("Choisir mes dossiers de projets"), onClick: () => ui().setPage("settings") } }
      : { text: t("Aucun dépôt git trouvé dans tes dossiers de projets (les dépôts imbriqués dans un autre sont ignorés)."), action: { label: t("Créer un projet"), onClick: () => ui().openLauncher({ mode: "new" }) } };
  return (
    <Select
      label={label}
      size={size}
      className={className}
      search
      value={value ?? (includeNone ? "" : null)}
      onChange={(v) => onChange(v || null)}
      options={repos.isLoading ? [] : options}
      placeholder={repos.isLoading ? t("Chargement des projets…") : t("Choisir un projet")}
      emptyState={repos.isLoading ? { text: t("Chargement des projets…") } : emptyState}
    />
  );
}
