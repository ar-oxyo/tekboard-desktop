// The folders that hold your repositories. Suggestions come from a scan of the home folder.
// Used by the first-run assistant (embedded) and by the dashboard when no folder is set.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderPlus, FolderSearch } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Badge, Button, Card, ErrorNote, Spinner } from "../../components/ui";
import { api, asAppError } from "../../lib/api";
import { tildify } from "../../lib/format";
import { keys, useHome, useSettings } from "../../lib/hooks";
import { t } from "../../lib/i18n";

export function Onboarding({ embedded, onSaved, extra: below }: { embedded?: boolean; onSaved?: () => void; extra?: ReactNode } = {}) {
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
    const dir = await open({ directory: true, multiple: false, title: t("Choisir un dossier de projets") });
    if (typeof dir === "string" && !chosen.includes(dir)) setExtra([...extra, dir]);
  }

  async function save() {
    if (!settings.data) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveSettings({ ...settings.data, roots: chosen, onboarded: embedded ? settings.data.onboarded : true });
      qc.setQueryData(keys.settings, saved);
      void qc.invalidateQueries({ queryKey: keys.repos });
      onSaved?.();
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

  const body = (
      <div className={embedded ? "" : "px-6 pt-6 pb-5"}>
        <div className="mb-1 flex items-center gap-2 text-accent">
          <FolderSearch className="size-5" />
          <h2 className="display text-lg font-medium text-fg">{t("Où sont tes projets ?")}</h2>
        </div>
        <p className="text-sm text-muted">{t("TekBoard lit seulement ces dossiers pour lister tes dépôts. Rien n'est déplacé ni modifié.")}</p>

        <div className="mt-4">
          {suggestions.isLoading ? (
            <p className="flex items-center gap-2 py-4 text-sm text-muted">
              <Spinner /> {t("Recherche de dépôts dans ton dossier personnel…")}
            </p>
          ) : (suggestions.data?.length ?? 0) === 0 && extra.length === 0 ? (
            <p className="py-3 text-sm text-muted">{t("Aucun dossier contenant plusieurs dépôts n'a été trouvé. Choisis-en un toi-même.")}</p>
          ) : (
            <ul className="rounded-lg border border-line bg-bg py-1">
              {(suggestions.data ?? []).map((s) => (
                <li key={s.path}>
                  <label className="flex h-9 items-center gap-3 px-3 hover:bg-raised">
                    <input type="checkbox" className="accent-(--color-accent)" checked={picked?.has(s.path) ?? false} onChange={() => toggle(s.path)} />
                    <span className="selectable min-w-0 flex-1 truncate font-mono text-xs">{tildify(s.path, home)}</span>
                    {s.recommended && <Badge tone="accent">{t("suggéré")}</Badge>}
                    <span className="w-16 shrink-0 text-right text-xs text-faint">{t("{n} dépôts", { n: s.repoCount })}</span>
                  </label>
                </li>
              ))}
              {extra.map((path) => (
                <li key={path}>
                  <label className="flex h-9 items-center gap-3 px-3 hover:bg-raised">
                    <input type="checkbox" className="accent-(--color-accent)" checked onChange={() => setExtra(extra.filter((p) => p !== path))} />
                    <span className="selectable min-w-0 flex-1 truncate font-mono text-xs">{tildify(path, home)}</span>
                    <Badge>{t("ajouté")}</Badge>
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

        {below}

        <div className="mt-4 flex items-center justify-between">
          <Button variant="ghost" icon={<FolderPlus className="size-3.5" />} onClick={() => void browse()}>
            {t("Choisir un autre dossier…")}
          </Button>
          <Button variant="primary" disabled={chosen.length === 0} disabledReason={t("Choisis au moins un dossier")} busy={saving} onClick={() => void save()}>
            {chosen.length === 1 ? t("Utiliser ce dossier") : t("Utiliser ces {n} dossiers", { n: chosen.length || "" })}
          </Button>
        </div>
      </div>
  );
  if (embedded) return body;
  return (
    <Card hero className="mx-auto max-w-[640px]">
      {body}
    </Card>
  );
}
