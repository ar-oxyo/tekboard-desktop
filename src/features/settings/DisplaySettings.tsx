// Settings → Appearance → Reading: the size of the whole interface and the light mode.
import { RotateCcw } from "lucide-react";
import { Button, cn } from "../../components/ui";
import { suggestedScale, UI_SCALES, useLitePref, useUiScale } from "../../lib/hooks";
import { t } from "../../lib/i18n";

const pct = (s: number) => `${Math.round(s * 100)} %`;

export function DisplaySettings() {
  const [scale, setScale] = useUiScale();
  const [lite, setLite] = useLitePref();
  const suggested = suggestedScale();
  return (
    <>
      <div className="space-y-2.5 px-4 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm">{t("Taille de l'interface")}</p>
          {scale !== 1 && (
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setScale(1)}>
              {t("Taille par défaut")}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("Taille de l'interface")}>
          {UI_SCALES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={scale === s}
              onClick={() => scale !== s && setScale(s)}
              className={cn("h-8 min-w-14 rounded-(--btn-radius) border px-2.5 text-sm tabular-nums transition-colors duration-(--dur-fast)", scale === s ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:text-fg")}
            >
              {pct(s)}
            </button>
          ))}
        </div>
        <p className="text-xs text-faint">
          {t("Tout change de taille ensemble : textes, boutons, menus, panneaux. S'ajoute à l'échelle de ton écran réglée par le système.")}
          {suggested !== 1 && scale === 1 && (
            <>
              {" "}
              <button type="button" className="text-accent-strong hover:underline" onClick={() => setScale(suggested)}>
                {t("Essayer {p} pour cet écran", { p: pct(suggested) })}
              </button>
            </>
          )}
        </p>
      </div>
      <label className="flex items-start gap-3 border-t border-line px-4 py-3.5">
        <input type="checkbox" className="mt-0.5 accent-(--color-accent)" checked={lite} onChange={(e) => setLite(e.target.checked)} />
        <span>
          <span className="block text-sm">{t("Mode allégé")}</span>
          <span className="block text-xs text-faint">{t("Seul l'essentiel reste à l'écran : moins de textes d'aide, de badges et de boutons secondaires. Tout reste accessible depuis « Plus ».")}</span>
        </span>
      </label>
    </>
  );
}
