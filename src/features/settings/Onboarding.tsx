// First run: pick the folders that hold your repositories. Suggestions come from a scan of the home folder.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderPlus, FolderSearch } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, ErrorNote, Spinner } from "../../components/ui";
import { api, asAppError } from "../../lib/api";
import { tildify } from "../../lib/format";
import { keys, useHome, useSettings } from "../../lib/hooks";

export function Onboarding() {
  const qc = useQueryClient();
  const home = useHome();
  const settings = useSettings();
  const suggestions = useQuery({ queryKey: ["root-suggestions"], queryFn: api.suggestRoots, staleTime: Infinity });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (picked === null && suggestions.data) setPicked(new Set(suggestions.data.filter((s) => s.recommended).map((s) => s.path)));
  }, [suggestions.data, picked]);

  const chosen = [...(picked ?? []), ...extra];

  async function browse() {
    const dir = await open({ directory: true, multiple: false, title: "Choisir un dossier de projets" });
    if (typeof dir === "string" && !chosen.includes(dir)) setExtra([...extra, dir]);
  }

  async function save() {
    if (!settings.data) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveSettings({ ...settings.data, roots: chosen, onboarded: true });
      qc.setQueryData(keys.settings, saved);
      void qc.invalidateQueries({ queryKey: keys.repos });
    } catch (e) {
      setError(asAppError(e).message);
    } finally {
      setSaving(false);
    }
  }

  const toggle = (path: string) => {
    const next = new Set(picked ?? []);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setPicked(next);
  };

  return (
    <Card hero className="mx-auto max-w-[640px]">
      <div className="px-6 pt-6 pb-5">
        <div className="mb-1 flex items-center gap-2 text-accent">
          <FolderSearch className="size-5" />
          <h2 className="display text-lg font-medium text-fg">Où sont tes projets ?</h2>
        </div>
        <p className="text-[13px] text-muted">TekBoard lit seulement ces dossiers pour lister tes dépôts. Rien n'est déplacé ni modifié.</p>

        <div className="mt-4">
          {suggestions.isLoading ? (
            <p className="flex items-center gap-2 py-4 text-[13px] text-muted">
              <Spinner /> Recherche de dépôts dans ton dossier personnel…
            </p>
          ) : (suggestions.data?.length ?? 0) === 0 && extra.length === 0 ? (
            <p className="py-3 text-[13px] text-muted">Aucun dossier contenant plusieurs dépôts n'a été trouvé. Choisis-en un toi-même.</p>
          ) : (
            <ul className="rounded-lg border border-line bg-bg py-1">
              {(suggestions.data ?? []).map((s) => (
                <li key={s.path}>
                  <label className="flex h-9 items-center gap-3 px-3 hover:bg-raised">
                    <input type="checkbox" className="accent-(--color-accent)" checked={picked?.has(s.path) ?? false} onChange={() => toggle(s.path)} />
                    <span className="selectable min-w-0 flex-1 truncate font-mono text-xs">{tildify(s.path, home)}</span>
                    {s.recommended && <Badge tone="accent">suggéré</Badge>}
                    <span className="w-16 shrink-0 text-right text-xs text-faint">{s.repoCount} repos</span>
                  </label>
                </li>
              ))}
              {extra.map((path) => (
                <li key={path}>
                  <label className="flex h-9 items-center gap-3 px-3 hover:bg-raised">
                    <input type="checkbox" className="accent-(--color-accent)" checked onChange={() => setExtra(extra.filter((p) => p !== path))} />
                    <span className="selectable min-w-0 flex-1 truncate font-mono text-xs">{tildify(path, home)}</span>
                    <Badge>added</Badge>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <Button variant="ghost" icon={<FolderPlus className="size-3.5" />} onClick={() => void browse()}>
            Choisir un autre dossier…
          </Button>
          <Button variant="primary" disabled={chosen.length === 0} busy={saving} onClick={() => void save()}>
            {chosen.length === 1 ? "Utiliser ce dossier" : `Utiliser ces ${chosen.length || ""} dossiers`}
          </Button>
        </div>
      </div>
    </Card>
  );
}
