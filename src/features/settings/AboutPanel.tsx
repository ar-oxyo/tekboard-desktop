// Settings → About: what this copy is, its updates, and the way into the developer mode
// (seven taps on the version, like Android; see lib/devmode.ts).
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useRef, useState } from "react";
import { Logo } from "../../app/Sidebar";
import { cn } from "../../components/ui";
import { api, type Settings } from "../../lib/api";
import { NO_TAPS, showsHint, tap } from "../../lib/devmode";
import { useDevMode } from "../../lib/hooks";
import { plural, t } from "../../lib/i18n";
import { useUi } from "../../lib/store";
import { UpdatesCard } from "./UpdatesCard";

const KIND: Record<string, string> = { appimage: "AppImage", deb: t("Paquet .deb"), manual: t("Compilé à la main") };

export function AboutPanel({ settings }: { settings: Settings }) {
  const info = useQuery({ queryKey: ["update-info"], queryFn: api.updateInfo, staleTime: Infinity });
  const [dev, setDev] = useDevMode();
  const toast = useUi((s) => s.toast);
  const taps = useRef(NO_TAPS);
  const [hint, setHint] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);

  const onVersion = () => {
    if (dev) {
      setHint(t("Le mode développeur est déjà activé."));
      return;
    }
    const r = tap(taps.current, Date.now());
    taps.current = r.state;
    setPulse((p) => p + 1);
    if (r.done) {
      setHint(null);
      setDev(true);
      toast({ kind: "ok", title: t("Mode développeur activé"), detail: t("Un onglet Développeur est apparu dans les réglages."), action: { label: t("Ouvrir"), run: () => useUi.setState({ settingsTab: "developer" }) } });
    } else {
      setHint(showsHint(r) ? plural(r.remaining, "Encore {n} appui pour le mode développeur.", "Encore {n} appuis pour le mode développeur.") : null);
    }
  };

  const i = info.data;
  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <section className="flex items-center gap-5">
        <Logo className="size-16 shrink-0" />
        <div className="min-w-0">
          <p className="display text-2xl font-medium">TekBoard</p>
          <button
            key={pulse}
            type="button"
            onClick={onVersion}
            className={cn("text-sm text-muted tabular-nums hover:text-fg", pulse > 0 && "tap-pop")}
            title={dev ? t("Mode développeur activé") : undefined}
          >
            {i ? t("Version {v}", { v: i.version }) : "…"}
            {i && <span className="text-faint"> · {KIND[i.install]}</span>}
          </button>
          <p aria-live="polite" className="min-h-4 text-xs text-faint">
            {hint}
          </p>
        </div>
      </section>
      <p className="max-w-2xl text-sm text-muted">{t("Le bureau de travail de l'étudiant Epitech : projets, planning, école et entraide, sur ton ordinateur. Rien ne part ailleurs sans que tu le demandes.")}</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <button type="button" onClick={() => void api.updateOpenReleases()} className="inline-flex items-center gap-1 text-muted hover:text-fg">
          {t("Notes de version")} <ExternalLink className="size-3" />
        </button>
        <button type="button" onClick={() => void api.openHelpUrl("https://github.com/ar-oxyo/tekboard-desktop/issues/new")} className="inline-flex items-center gap-1 text-muted hover:text-fg">
          {t("Signaler un problème")} <ExternalLink className="size-3" />
        </button>
        <button type="button" onClick={() => useUi.setState({ shortcutsOpen: true })} className="text-muted hover:text-fg">
          {t("Raccourcis clavier")} <kbd className="ml-1 font-mono text-xs text-faint">Ctrl /</kbd>
        </button>
        <span className="text-faint">{t("Licence GPL v3")}</span>
      </div>
      <UpdatesCard settings={settings} />
    </div>
  );
}
