// Playground dialogs: history (closed drafts, past runs), importing functions from a
// TekBoard library, exporting a draft as a real project.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderPlus, LibraryBig, RotateCcw, Trash2 } from "lucide-react";
import { api, asAppError, type Draft, type DraftFile, type DraftSettings, type Run } from "../../lib/api";
import { Modal } from "../../components/Modal";
import { Select } from "../../components/Select";
import { CodeView } from "../../components/DiffView";
import { Badge, Button, cn, EmptyState, ErrorNote, Field, IconButton, Input, Spinner } from "../../components/ui";
import { useHome, useSettings } from "../../lib/hooks";
import { timeAgo, tildify } from "../../lib/format";
import { STATUS_LABEL, STATUS_TONE } from "../testing/Report";
import { t } from "../../lib/i18n";

export function HistoryDialog({ open, onClose, drafts, current, onReopen, onRestore, onDelete }: { open: boolean; onClose: () => void; drafts: Draft[]; current: number | null; onReopen: (d: Draft) => void; onRestore: (title: string, files: DraftFile[], settings: DraftSettings) => void; onDelete: (d: Draft) => void }) {
  const runs = useQuery({ queryKey: ["runs", "playground"], queryFn: () => api.runsList(null, "playground", 60), enabled: open, staleTime: 0 });
  const [onlyThis, setOnlyThis] = useState(true);
  const closed = drafts.filter((d) => !d.open);
  const shown = (runs.data ?? []).filter((r) => !onlyThis || current === null || (r.summary as Record<string, unknown> | null)?.draftId === current);
  return (
    <Modal open={open} onClose={onClose} title={t("Historique des expérimentations")} width="w-[720px]">
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-xs text-faint">{t("Brouillons fermés")}</h3>
          {closed.length === 0 ? (
            <p className="text-sm text-muted">{t("Aucun : un onglet fermé arrive ici, avec son code.")}</p>
          ) : (
            <ul className="max-h-56 space-y-0.5 overflow-y-auto">
              {closed.map((d) => (
                <li key={d.id} className="row-hover flex items-center gap-2 rounded-md px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">{d.title}</span>
                  <span className="text-xs text-faint">{t("{n} fichier(s)", { n: d.files.length })} · {timeAgo(d.updatedAt)}</span>
                  <Button size="sm" onClick={() => onReopen(d)}>
                    {t("Rouvrir")}
                  </Button>
                  <IconButton label={t("Supprimer définitivement")} onClick={() => onDelete(d)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <div className="mb-2 flex items-center gap-3">
            <h3 className="text-xs text-faint">{t("Exécutions")}</h3>
            {current !== null && (
              <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" className="accent-(--color-accent)" checked={onlyThis} onChange={(e) => setOnlyThis(e.target.checked)} />
                {t("Ce brouillon seulement")}
              </label>
            )}
          </div>
          {runs.isLoading ? (
            <Spinner />
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted">{t("Aucune exécution enregistrée.")}</p>
          ) : (
            <ul className="max-h-72 space-y-0.5 overflow-y-auto">
              {shown.map((r) => (
                <RunRow key={r.id} run={r} onRestore={onRestore} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}

function RunRow({ run, onRestore }: { run: Run; onRestore: (title: string, files: DraftFile[], settings: DraftSettings) => void }) {
  const snap = (run.summary as { snapshot?: { files: DraftFile[]; settings: DraftSettings } } | null)?.snapshot;
  return (
    <li className="row-hover flex items-center gap-2 rounded-md px-2 py-1.5">
      <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>{STATUS_LABEL[run.status] ?? run.status}</Badge>
      <span className="min-w-0 flex-1 truncate text-sm text-fg">{run.title.replace(/^Playground · /, "")}</span>
      <span className="text-xs text-faint">{timeAgo(run.startedAt)}</span>
      <Button size="sm" icon={<RotateCcw className="size-3.5" />} disabled={!snap} disabledReason={t("Cette exécution n'a pas gardé le code")} onClick={() => snap && onRestore(`${run.title.replace(/^Playground · /, "")} (${t("restauré")})`, snap.files, snap.settings)}>
        {t("Restaurer")}
      </Button>
    </li>
  );
}

export function LibraryImportDialog({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: (files: DraftFile[]) => void }) {
  const libs = useQuery({ queryKey: ["libraries"], queryFn: api.libraryList, enabled: open });
  const [lib, setLib] = useState<number | null>(null);
  const libId = lib ?? libs.data?.[0]?.id ?? null;
  const catalog = useQuery({ queryKey: ["lib-catalog", libId], queryFn: () => api.libraryCatalog(libId!), enabled: open && libId !== null });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const files = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (catalog.data?.files ?? []).filter((f) => !f.isHeader && (!q || f.rel.toLowerCase().includes(q) || f.functions.some((fn) => fn.name.toLowerCase().includes(q))));
  }, [catalog.data, query]);
  const toggle = (rel: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(rel)) n.delete(rel);
    else n.add(rel);
    return n;
  });
  const run = async () => {
    if (libId === null) return;
    setBusy(true);
    setError(null);
    try {
      onImport(await api.playgroundImportLibrary(libId, [...picked]));
      setPicked(new Set());
      onClose();
    } catch (e) {
      setError(asAppError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Importer depuis une bibliothèque")}
      description={t("Les fichiers choisis et ceux dont ils ont besoin sont copiés dans le brouillon, sous lib/. La bibliothèque n'est pas modifiée.")}
      width="w-[720px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Annuler")}
          </Button>
          <Button variant="primary" icon={<LibraryBig className="size-3.5" />} busy={busy} disabled={picked.size === 0} disabledReason={t("Coche au moins un fichier")} onClick={() => void run()}>
            {t("Importer {n} fichier(s)", { n: picked.size })}
          </Button>
        </>
      }
    >
      {libs.data && libs.data.length === 0 ? (
        <EmptyState icon={<LibraryBig className="size-6" />} title={t("Aucune bibliothèque")}>
          {t("Ajoute une bibliothèque C dans Projets → Bibliothèques pour pouvoir en importer des fonctions ici.")}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Select className="w-56" label={t("Bibliothèque")} value={libId !== null ? String(libId) : null} onChange={(v) => { setLib(Number(v)); setPicked(new Set()); }} options={(libs.data ?? []).map((l) => ({ value: String(l.id), label: l.name }))} />
            <Input placeholder={t("Chercher une fonction ou un fichier")} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto">
            {catalog.isLoading && <Spinner />}
            {files.map((f) => (
              <li key={f.rel}>
                <label className={cn("row-hover flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5", picked.has(f.rel) && "bg-accent-soft/40")}>
                  <input type="checkbox" className="mt-1 accent-(--color-accent)" checked={picked.has(f.rel)} onChange={() => toggle(f.rel)} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-xs text-fg">{f.rel}</span>
                    <span className="block truncate font-mono text-2xs text-faint">{f.functions.map((fn) => fn.name).join(", ") || t("(aucune fonction publique)")}</span>
                  </span>
                  {f.deps.length > 0 && <Badge>{t("+{n} dépendance(s)", { n: f.deps.length })}</Badge>}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

export function ExportDialog({ open, onClose, draft, onDone }: { open: boolean; onClose: () => void; draft: Draft; onDone: (path: string) => void }) {
  const roots = useSettings().data?.roots ?? [];
  const home = useHome();
  const [root, setRoot] = useState<string | null>(null);
  const parent = root ?? roots[0] ?? null;
  const [name, setName] = useState(() => draft.title.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "experience");
  const [git, setGit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useQuery({ queryKey: ["playground-export", draft.id, name, draft.updatedAt], queryFn: () => api.playgroundExportPreview(draft.id, name), enabled: open && /^[A-Za-z0-9_-]+$/.test(name), retry: false });
  const makefile = preview.data?.find((f) => f.name === "Makefile")?.content ?? "";
  const run = async () => {
    if (!parent) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await api.playgroundExport(draft.id, parent, name, git));
    } catch (e) {
      setError(asAppError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Exporter en projet")}
      description={t("Crée un dossier avec les fichiers du brouillon, un Makefile et un .gitignore. Rien n'est écrasé.")}
      width="w-[720px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Annuler")}
          </Button>
          <Button variant="primary" icon={<FolderPlus className="size-3.5" />} busy={busy} disabled={!parent || !preview.data} disabledReason={!parent ? t("Ajoute un dossier de projets dans Réglages") : (preview.error ? asAppError(preview.error).message : t("Nom invalide"))} onClick={() => void run()}>
            {t("Créer le projet")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Dans")}>
            <Select value={parent} onChange={setRoot} options={roots.map((r) => ({ value: r, label: tildify(r, home) }))} placeholder={t("Aucun dossier de projets")} />
          </Field>
          <Field label={t("Nom du dossier")} hint={parent ? `${tildify(parent, home)}/${name}` : undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" className="accent-(--color-accent)" checked={git} onChange={(e) => setGit(e.target.checked)} />
          {t("Initialiser un dépôt git (git init)")}
        </label>
        {preview.error && <ErrorNote>{asAppError(preview.error).message}</ErrorNote>}
        {error && <ErrorNote>{error}</ErrorNote>}
        {preview.data && (
          <>
            <p className="text-xs text-faint">{preview.data.map((f) => f.name).join(" · ")}</p>
            <CodeView text={makefile} numbered className="max-h-64 rounded-md" />
          </>
        )}
      </div>
    </Modal>
  );
}
