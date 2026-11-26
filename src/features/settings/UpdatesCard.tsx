// Settings → Mises à jour. Checks the latest official release on GitHub and installs it the way
// this copy was installed (AppImage replaced in place; .deb through the system password
// prompt). A copy built by hand only checks and links to the releases page.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { CircleCheck, Download, ExternalLink, RefreshCw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, CardTitle, ErrorNote, Spinner } from "../../components/ui";
import { api, asAppError, type Settings, type UpdateAvailable } from "../../lib/api";
import { keys } from "../../lib/hooks";
import { t } from "../../lib/i18n";
import { useUi } from "../../lib/store";
import { Markdown } from "../artix/Markdown";

const KIND: Record<string, string> = { appimage: "AppImage", deb: t("Paquet .deb"), manual: t("Compilé à la main") };

export function UpdatesCard({ settings }: { settings: Settings }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const info = useQuery({ queryKey: ["update-info"], queryFn: api.updateInfo, staleTime: Infinity });
  const [found, setFound] = useState<UpdateAvailable | null | undefined>(undefined);
  const [progress, setProgress] = useState<{ downloaded: number; total: number | null } | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const off = listen<{ phase: string; downloaded: number; total: number | null }>("update-progress", (e) => setProgress({ downloaded: e.payload.downloaded, total: e.payload.total }));
    return () => void off.then((f) => f());
  }, []);

  const check = useMutation({
    mutationFn: api.updateCheck,
    onSuccess: (r) => {
      setFound(r);
      try {
        localStorage.setItem("tekboard.update.lastCheck", String(Date.now()));
      } catch {
        /* not remembered */
      }
    },
  });
  const install = useMutation({
    mutationFn: api.updateInstall,
    onMutate: () => setProgress({ downloaded: 0, total: null }),
    onSuccess: () => setInstalled(true),
    onSettled: () => setProgress(null),
  });
  const savePkg = useMutation({
    mutationFn: api.updateSavePackage,
    onSuccess: (path) => toast({ kind: "ok", title: t("Paquet téléchargé et vérifié"), detail: t("{path} s'ouvre dans l'installateur de logiciels.", { path }) }),
    onError: (e) => toast({ kind: "error", title: t("Téléchargement impossible"), detail: asAppError(e).message }),
  });
  const autoCheck = useMutation({
    mutationFn: (on: boolean) => api.saveSettings({ ...settings, updateCheck: on }),
    onSuccess: (saved) => qc.setQueryData(keys.settings, saved),
  });

  // `tekboard --run update`: once the install kind is known, check and install.
  const [auto] = useState(() => {
    const on = useUi.getState().updateAuto;
    if (on) useUi.setState({ updateAuto: false });
    return on;
  });
  const ready = info.data !== undefined;
  useEffect(() => {
    if (!auto || !ready) return;
    void check.mutateAsync().then((r) => {
      if (r && info.data?.canInstall) install.mutate();
    }, () => undefined);
    // Once, when the info arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, ready]);

  const i = info.data;
  const pct = progress?.total ? Math.round((progress.downloaded / progress.total) * 100) : null;
  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardTitle right={i && <Badge>{KIND[i.install]}</Badge>}>{t("Mises à jour")}</CardTitle>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted">{t("Version installée")}</p>
              <p className="display text-xl font-medium tabular-nums">{i ? i.version : "…"}</p>
            </div>
            <Button variant="primary" icon={<RefreshCw className={check.isPending ? "size-3.5 anim-spin" : "size-3.5"} />} busy={check.isPending} disabled={install.isPending} onClick={() => check.mutate()}>
              {t("Rechercher des mises à jour")}
            </Button>
          </div>

          {check.error && <ErrorNote title={t("Recherche impossible")}>{asAppError(check.error).message}</ErrorNote>}
          {found === null && !check.isPending && (
            <p className="flex items-center gap-2 text-sm text-ok">
              <CircleCheck className="size-4" /> {t("Tekboard est à jour.")}
            </p>
          )}
          {found && (
            <div className="rounded-lg border border-accent/30 bg-accent-soft p-4">
              <p className="text-sm font-medium">{t("Tekboard {v} est disponible", { v: found.version })}</p>
              {found.notes && (
                <div className="mt-2 max-h-56 overflow-y-auto text-sm text-muted">
                  <Markdown text={found.notes} />
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {installed ? (
                  <>
                    <span className="text-sm text-ok">{t("Mise à jour installée.")}</span>
                    <Button variant="primary" icon={<RotateCw className="size-3.5" />} onClick={() => void api.appRestart()}>
                      {t("Redémarrer Tekboard")}
                    </Button>
                  </>
                ) : i?.canInstall ? (
                  <Button variant="primary" icon={<Download className="size-3.5" />} busy={install.isPending} onClick={() => install.mutate()}>
                    {install.isPending ? (pct !== null ? t("Téléchargement… {p} %", { p: pct }) : t("Installation…")) : t("Installer la mise à jour")}
                  </Button>
                ) : i?.install === "deb" ? (
                  <Button variant="primary" icon={<Download className="size-3.5" />} busy={savePkg.isPending} onClick={() => savePkg.mutate()}>
                    {t("Télécharger le paquet")}
                  </Button>
                ) : null}
                <button type="button" onClick={() => void api.updateOpenReleases()} className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
                  {t("Page des versions")} <ExternalLink className="size-3" />
                </button>
              </div>
              {!installed && i?.canInstall && i.needsPassword && <p className="mt-2 text-xs text-faint">{t("Tekboard est installé comme paquet système : ton mot de passe sera demandé une fois, par le système.")}</p>}
              {!installed && i?.install === "manual" && <p className="mt-2 text-xs text-faint">{t("Cette copie a été compilée à la main : récupère la nouvelle version depuis GitHub (git pull, puis npm run app:build).")}</p>}
              {install.error && (
                <div className="mt-3">
                  <ErrorNote title={t("Mise à jour non installée")}>{asAppError(install.error).message}</ErrorNote>
                </div>
              )}
            </div>
          )}
          {check.isPending && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner /> {t("Recherche sur GitHub…")}
            </p>
          )}
          <label className="flex items-start gap-3 border-t border-line pt-4">
            <input type="checkbox" className="mt-0.5 accent-(--color-accent)" checked={settings.updateCheck} disabled={autoCheck.isPending} onChange={(e) => autoCheck.mutate(e.target.checked)} />
            <span>
              <span className="block text-sm">{t("Vérifier automatiquement")}</span>
              <span className="block text-xs text-faint">{t("Une fois par jour au plus, sans rien installer : une notification discrète si une version sort.")}</span>
            </span>
          </label>
        </div>
      </Card>
      <Card>
        <CardTitle>{t("Comment ça marche")}</CardTitle>
        <ul className="flex list-disc flex-col gap-2 py-4 pr-4 pl-8 text-xs text-muted">
          <li>{t("Les versions viennent uniquement des releases officielles du dépôt GitHub.")}</li>
          <li>{t("Chaque paquet est signé : Tekboard refuse d'installer un fichier dont la signature ne correspond pas.")}</li>
          <li>{t("Tes données (projets, planning, réglages) sont hors de l'application : une mise à jour ne les touche pas.")}</li>
          <li>{t("AppImage : le fichier est remplacé sans mot de passe. Paquet .deb : le système demande ton mot de passe.")}</li>
        </ul>
      </Card>
    </div>
  );
}
