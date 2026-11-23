// The one project selector. It says why a project is missing instead of showing a greyed or
// empty list: no projects folder yet, no repository found, a project outside the folders.
import { useSettings, useRepos } from "../lib/hooks";
import { repoOptions } from "../lib/repos";
import { useUi } from "../lib/store";
import { Select } from "./Select";

export function ProjectPicker({ value, onChange, includeNone, noneLabel, includeDone = true, label = "Projet", size, className }: { value: string | null; onChange: (path: string | null) => void; includeNone?: boolean; noneLabel?: string; includeDone?: boolean; label?: string; size?: "sm" | "md"; className?: string }) {
  const settings = useSettings();
  const repos = useRepos();
  const roots = settings.data?.roots ?? [];
  const list = (repos.data ?? []).filter((r) => includeDone || r.progress !== "done" || r.path === value);
  const options = [...(includeNone ? [{ value: "", label: noneLabel ?? "Aucun projet" }] : []), ...repoOptions(list)];
  const ui = useUi.getState;
  const emptyState = repos.isError
    ? { text: "Les projets n'ont pas pu être lus.", action: { label: "Vérifier les réglages", onClick: () => ui().setPage("settings") } }
    : roots.length === 0
      ? { text: "Aucun dossier de projets configuré.", action: { label: "Choisir mes dossiers de projets", onClick: () => ui().setPage("settings") } }
      : { text: "Aucun dépôt git trouvé dans tes dossiers de projets (les dépôts imbriqués dans un autre sont ignorés).", action: { label: "Créer un projet", onClick: () => ui().openLauncher({ mode: "new" }) } };
  return (
    <Select
      label={label}
      size={size}
      className={className}
      search
      value={value ?? (includeNone ? "" : null)}
      onChange={(v) => onChange(v || null)}
      options={repos.isLoading ? [] : options}
      placeholder={repos.isLoading ? "Chargement des projets…" : "Choisir un projet"}
      emptyState={repos.isLoading ? { text: "Chargement des projets…" } : emptyState}
    />
  );
}
