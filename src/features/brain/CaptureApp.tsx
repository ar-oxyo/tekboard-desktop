// The floating capture window (`tekboard capture`, the global shortcut, the tray icon). It
// loads only the editor: no sidebar, no page. Saving hides it at once; the draft is kept.
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { Check, Inbox, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAutoAmbiance, useColorMode, useMotionPref, useSettings } from "../../lib/hooks";
import { listenData, setQueryClient } from "../../lib/sync";
import { t } from "../../lib/i18n";
import { IconButton } from "../../components/ui";
import { CaptureEditor } from "./CaptureEditor";

export function CaptureApp() {
  const qc = useQueryClient();
  const settings = useSettings();
  const auto = useAutoAmbiance();
  const [shown, setShown] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    setQueryClient(qc);
    const off = listenData(qc);
    const again = listen("capture-shown", () => {
      setSaved(null);
      setShown((n) => n + 1);
    });
    return () => {
      void off.then((f) => f());
      void again.then((f) => f());
    };
  }, [qc]);
  useEffect(() => {
    document.documentElement.dataset.theme = auto?.theme ?? settings.data?.theme ?? "aurora";
    document.documentElement.dataset.glass = "off";
  }, [settings.data?.theme, auto?.theme]);
  useColorMode(auto?.theme ?? settings.data?.theme, auto?.mode);
  useMotionPref();

  const hide = (then: string | null = null) => void api.captureClose(then);

  return (
    <div className="flex h-screen flex-col gap-2 overflow-hidden border border-ink/10 bg-bg p-3 select-none">
      <header data-tauri-drag-region className="flex items-center gap-2">
        <span data-tauri-drag-region className="flex-1 text-xs font-medium text-muted">
          {t("Capture rapide")}
        </span>
        <IconButton label={t("Ouvrir l'Inbox")} onClick={() => hide("inbox")}>
          <Inbox className="size-3.5" />
        </IconButton>
        <IconButton label={t("Fermer (le brouillon est gardé)")} onClick={() => hide()}>
          <X className="size-3.5" />
        </IconButton>
      </header>
      {saved ? (
        <p className="flex flex-1 items-center justify-center gap-2 text-sm text-ok">
          <Check className="size-4" /> {t("Ajouté à l'Inbox")}
        </p>
      ) : (
        <CaptureEditor
          floating
          autoFocusKey={shown}
          onClose={() => hide()}
          onSaved={(c, keep) => {
            if (keep) return;
            setSaved(c.title);
            window.setTimeout(() => hide(), 450);
          }}
        />
      )}
    </div>
  );
}
