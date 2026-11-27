// Settings → General: how the capture window opens outside TekBoard. A global shortcut works
// under X11 only; under Wayland the system's own shortcut runs `tekboard capture`.
import { Hint } from "../../components/lite";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { api, type Settings } from "../../lib/api";
import { useUi } from "../../lib/store";
import { t } from "../../lib/i18n";
import { Button, Card, CardTitle, Field, Input } from "../../components/ui";

export function CaptureCard({ draft, set }: { draft: Settings; set: (p: Partial<Settings>) => void }) {
  const status = useQuery({ queryKey: ["desktop-status"], queryFn: api.desktopStatus, staleTime: 10_000 });
  const s = status.data;
  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => useUi.getState().toast({ kind: "ok", title: t("Commande copiée") }));
  const gnome = s?.desktop.toLowerCase().includes("gnome");
  const kde = s?.desktop.toLowerCase().includes("kde");
  return (
    <Card>
      <CardTitle>{t("Capture rapide")}</CardTitle>
      <div className="flex flex-col gap-4 p-4">
        {s?.wayland ? (
          <div className="flex flex-col gap-2 text-sm text-muted">
            <p>{t("Sous Wayland, aucune application ne peut capter un raccourci global : associe cette commande à un raccourci dans les réglages du système.")}</p>
            <div className="flex items-center gap-2">
              <code className="selectable min-w-0 flex-1 truncate rounded-md bg-well px-2 py-1.5 font-mono text-xs text-fg">{s.captureCommand}</code>
              <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => copy(s.captureCommand)}>
                {t("Copier")}
              </Button>
            </div>
            <p className="text-xs text-faint">{gnome ? t("GNOME : Paramètres → Clavier → Raccourcis personnalisés → +.") : kde ? t("KDE : Configuration du système → Raccourcis → Ajouter une commande.") : t("Dans les réglages clavier de ton environnement : nouveau raccourci personnalisé.")}</p>
          </div>
        ) : (
          <Field label={t("Raccourci global")} hint={s?.shortcutError ?? (s?.shortcutActive ? t("Actif : il ouvre la fenêtre de capture depuis n'importe quelle application.") : t("Vide = aucun raccourci. Exemples : Ctrl+Alt+Space, Super+N."))}>
            <Input className="font-mono text-xs" placeholder="Ctrl+Alt+Space" value={draft.captureShortcut} onChange={(e) => set({ captureShortcut: e.target.value })} />
          </Field>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 accent-(--color-accent)" disabled={s ? !s.trayAvailable : false} checked={draft.trayIcon} onChange={(e) => set({ trayIcon: e.target.checked })} />
          <span>
            {t("Icône dans la zone de notification")}
            <Hint as="span">{s && !s.trayAvailable ? t("Indisponible : la bibliothèque AppIndicator n'est pas installée (sudo apt install libayatana-appindicator3-1).") : t("Capture, Inbox et point de sauvegarde en un clic. Sous GNOME, l'extension AppIndicator est nécessaire.")}</Hint>
          </span>
        </label>
        <p className="text-xs text-faint">{t("Dans TekBoard : Ctrl+I, la palette (Ctrl+K) ou l'Inbox de la barre latérale.")}</p>
      </div>
    </Card>
  );
}
