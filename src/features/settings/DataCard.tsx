// Settings → Données: where Tekboard keeps its files, a backup to carry elsewhere and its
// restoration, the cache, the resets, and how to uninstall. Repositories are never touched:
// only Tekboard's own folders are.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Archive, FolderOpen, HardDriveDownload, RotateCcw, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { Modal } from "../../components/Modal";
import { Button, Card, CardTitle, Code, ErrorNote, Input } from "../../components/ui";
import { api, asAppError, type BackupManifest } from "../../lib/api";
import { tildify } from "../../lib/format";
import { keys, useHome } from "../../lib/hooks";
import { locale, t } from "../../lib/i18n";
import { useUi } from "../../lib/store";

export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString(locale(), { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}

const LABEL: Record<string, string> = {
  data: t("Données et réglages"),
  session: t("Session MY Epitech (sensible, jamais exportée)"),
  cache: t("Cache (fichiers temporaires)"),
};

export function DataCard() {
  const qc = useQueryClient();
  const home = useHome();
  const toast = useUi((s) => s.toast);
  const where = useQuery({ queryKey: ["data-locations"], queryFn: api.dataLocations, staleTime: 0 });
  const [restore, setRestore] = useState<{ path: string; manifest: BackupManifest } | null>(null);
  const [confirm, setConfirm] = useState<"settings" | "all" | null>(null);
  const [word, setWord] = useState("");
  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["data-locations"] });

  const exportIt = useMutation({
    mutationFn: async () => {
      const day = new Date().toISOString().slice(0, 10);
      const dest = await save({ title: t("Enregistrer la sauvegarde"), defaultPath: `tekboard-${day}.zip`, filters: [{ name: t("Sauvegarde Tekboard"), extensions: ["zip"] }] });
      return dest ? api.dataExport(dest) : null;
    },
    onSuccess: (r) => r && toast({ kind: "ok", title: t("Sauvegarde enregistrée"), detail: `${tildify(r.path, home)} · ${size(r.bytes)}` }),
    onError: fail(t("Sauvegarde impossible")),
  });
  const pick = useMutation({
    mutationFn: async () => {
      const path = await open({ title: t("Choisir une sauvegarde Tekboard"), multiple: false, directory: false, filters: [{ name: t("Sauvegarde Tekboard"), extensions: ["zip"] }] });
      if (typeof path !== "string") return null;
      return { path, manifest: await api.dataInspect(path) };
    },
    onSuccess: (r) => r && setRestore(r),
    onError: fail(t("Sauvegarde refusée")),
  });
  const importIt = useMutation({
    mutationFn: (path: string) => api.dataImport(path),
    onSuccess: (before) => {
      toast({ kind: "ok", title: t("Sauvegarde restaurée"), detail: t("Tes données d'avant sont gardées dans {path}.", { path: tildify(before, home) }) });
      // Everything on screen comes from the restored data.
      window.setTimeout(() => window.location.reload(), 900);
    },
    onError: fail(t("Restauration impossible")),
  });
  const cache = useMutation({
    mutationFn: api.dataClearCache,
    onSuccess: (freed) => {
      toast({ kind: "ok", title: t("Cache vidé"), detail: t("{s} libérés", { s: size(freed) }) });
      refresh();
    },
    onError: fail(t("Cache non vidé")),
  });
  const resetSettings = useMutation({
    mutationFn: api.settingsReset,
    onSuccess: (s) => {
      qc.setQueryData(keys.settings, s);
      setConfirm(null);
    },
    onError: fail(t("Réglages non réinitialisés")),
  });
  const resetAll = useMutation({ mutationFn: () => api.appResetAll(word), onError: fail(t("Rien n'a été effacé")) });

  const dataDir = where.data?.find((l) => l.kind === "data")?.path;
  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <Card className="xl:col-span-2">
        <CardTitle>{t("Emplacement des données")}</CardTitle>
        <ul className="py-1">
          {(where.data ?? []).map((l) => (
            <li key={l.kind} className="flex min-h-11 items-center gap-3 px-4 text-sm">
              <span className="w-72 shrink-0 text-muted">{LABEL[l.kind]}</span>
              <span className="selectable min-w-0 flex-1 truncate font-mono text-xs">{tildify(l.path, home)}</span>
              <span className="w-16 shrink-0 text-right text-xs text-faint tabular-nums">{size(l.bytes)}</span>
              {l.kind !== "session" ? (
                <Button size="sm" variant="ghost" icon={<FolderOpen className="size-3.5" />} onClick={() => void api.dataOpen(l.kind as "data" | "cache").catch(fail(t("Dossier non ouvert")))}>
                  {t("Ouvrir")}
                </Button>
              ) : (
                <span className="w-[74px]" />
              )}
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-4 py-3 text-xs text-faint">{t("Tes dépôts restent où ils sont : Tekboard ne fait que les lire. Aucun mot de passe n'est enregistré ; le jeton MY Epitech reste en mémoire.")}</p>
      </Card>

      <Card>
        <CardTitle>{t("Sauvegarde")}</CardTitle>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm text-muted">{t("Un fichier .zip avec tes réglages, projets suivis, planning, tâches, notes, sujets et modèles. Sans la session MY Epitech ni le cache.")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<HardDriveDownload className="size-3.5" />} busy={exportIt.isPending} onClick={() => exportIt.mutate()}>
              {t("Exporter mes données…")}
            </Button>
            <Button icon={<Upload className="size-3.5" />} busy={pick.isPending} onClick={() => pick.mutate()}>
              {t("Restaurer une sauvegarde…")}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>{t("Nettoyage")}</CardTitle>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-muted">{t("Le cache contient des copies de test et des fichiers temporaires. Le vider ne fait rien perdre.")}</p>
            <Button size="sm" icon={<Archive className="size-3.5" />} busy={cache.isPending} onClick={() => cache.mutate()}>
              {t("Vider le cache")}
            </Button>
          </div>
          <div className="flex items-start justify-between gap-3 border-t border-line pt-3">
            <p className="text-sm text-muted">{t("Remet les réglages par défaut (dossiers, apparence, langue, Artix). Tes projets, ton planning et tes notes restent.")}</p>
            <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => setConfirm("settings")}>
              {t("Réinitialiser les réglages…")}
            </Button>
          </div>
          <div className="flex items-start justify-between gap-3 border-t border-line pt-3">
            <p className="text-sm text-muted">{t("Efface toutes les données de Tekboard sur cet ordinateur et le relance comme au premier jour. Tes dépôts ne sont pas touchés.")}</p>
            <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirm("all")}>
              {t("Tout réinitialiser…")}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="xl:col-span-2">
        <CardTitle>{t("Désinstaller Tekboard")}</CardTitle>
        <div className="grid grid-cols-1 gap-4 p-4 text-sm md:grid-cols-3">
          <div>
            <p className="font-medium">{t("1. Enlever l'application")}</p>
            <p className="mt-1 text-xs text-muted">{t("Paquet .deb : ouvre l'App Center (ou Logiciels), cherche TekBoard, puis Désinstaller. AppImage : supprime simplement le fichier.")}</p>
          </div>
          <div>
            <p className="font-medium">{t("2. Garder ou non les données")}</p>
            <p className="mt-1 text-xs text-muted">{t("Désinstaller laisse tes données en place : une réinstallation retrouve tout. Exporte une sauvegarde si tu changes d'ordinateur.")}</p>
          </div>
          <div>
            <p className="font-medium">{t("3. Tout effacer")}</p>
            <p className="mt-1 text-xs text-muted">{t("Pour ne rien laisser, clique d'abord sur « Tout réinitialiser… » ci-dessus, puis désinstalle.")}</p>
          </div>
        </div>
      </Card>

      {restore && (
        <Modal
          open
          onClose={() => !importIt.isPending && setRestore(null)}
          title={t("Restaurer cette sauvegarde ?")}
          footer={
            <>
              <Button variant="ghost" disabled={importIt.isPending} onClick={() => setRestore(null)}>
                {t("Annuler")}
              </Button>
              <Button variant="primary" busy={importIt.isPending} onClick={() => importIt.mutate(restore.path)}>
                {t("Restaurer")}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {t("Sauvegarde du {date}, faite avec Tekboard {v}.", { date: new Date(restore.manifest.createdAt * 1000).toLocaleString(locale(), { dateStyle: "long", timeStyle: "short" }), v: restore.manifest.version })}
          </p>
          <p className="mt-2 text-sm text-muted">{t("Elle remplace tes données actuelles. Celles-ci sont d'abord sauvegardées dans le dossier backups, pour pouvoir revenir en arrière.")}</p>
          {dataDir && <p className="mt-2 text-xs text-faint"><Code>{tildify(`${dataDir}/backups`, home)}</Code></p>}
        </Modal>
      )}

      {confirm === "settings" && (
        <Modal
          open
          onClose={() => setConfirm(null)}
          title={t("Réinitialiser les réglages ?")}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                {t("Annuler")}
              </Button>
              <Button variant="primary" busy={resetSettings.isPending} onClick={() => resetSettings.mutate()}>
                {t("Réinitialiser")}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">{t("Les réglages reviennent à leur valeur par défaut et l'assistant de démarrage s'ouvre. Projets suivis, planning, tâches, notes, sujets et modèles sont gardés.")}</p>
        </Modal>
      )}

      {confirm === "all" && (
        <Modal
          open
          onClose={() => !resetAll.isPending && setConfirm(null)}
          title={t("Tout réinitialiser ?")}
          footer={
            <>
              <Button variant="ghost" disabled={resetAll.isPending} onClick={() => setConfirm(null)}>
                {t("Annuler")}
              </Button>
              <Button variant="danger" busy={resetAll.isPending} disabled={!["RÉINITIALISER", "REINITIALISER", "RESET"].includes(word.trim().toUpperCase())} onClick={() => resetAll.mutate()}>
                {t("Tout effacer et redémarrer")}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-sm">
            <p>{t("Sont effacés : réglages, planning, tâches, notes, historique, sujets téléchargés, modèles, session MY Epitech et cache.")}</p>
            <p className="text-muted">{t("Ne sont jamais touchés : tes dépôts, tes dossiers de projets et tout fichier hors des dossiers de Tekboard.")}</p>
            <Button size="sm" className="self-start" icon={<HardDriveDownload className="size-3.5" />} busy={exportIt.isPending} onClick={() => exportIt.mutate()}>
              {t("Exporter d'abord mes données…")}
            </Button>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted">{t("Tape RÉINITIALISER pour confirmer")}</span>
              <Input value={word} onChange={(e) => setWord(e.target.value)} autoFocus aria-label={t("Confirmation")} />
            </label>
            {resetAll.error ? <ErrorNote>{asAppError(resetAll.error).message}</ErrorNote> : null}
          </div>
        </Modal>
      )}
    </div>
  );
}
