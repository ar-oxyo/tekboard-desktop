// Avatars: a collection of ready-made characters (no personal image is ever imported), drawn
// by the TekSpace sprite engine and kept in the Connect profile in the same compact form as a
// hand-made one (`s1h2c3o0p4a1`), so every TekBoard version shows them. One picker for the
// Connect profile and TekSpace.
import { useEffect, useRef, useState } from "react";
import { cn } from "../../components/ui";
import { t } from "../../lib/i18n";
import { ACCESSORIES, decodeLook, encodeLook, HAIR_COLORS, HAIR_STYLES, OUTFIT_COLORS, OUTFITS, SKINS, type Look } from "./avatar";
import { drawAvatar } from "./sprites";

const L = (skin: number, hair: number, hairColor: number, outfit: number, outfitColor: number, accessory: number): Look => ({ skin, hair, hairColor, outfit, outfitColor, accessory });

/** 24 characters, varied in skin, hair, clothes and accessories. */
export const AVATAR_PRESETS: Look[] = [
  L(0, 0, 0, 1, 0, 2), L(1, 1, 3, 0, 2, 0), L(3, 2, 0, 3, 5, 1), L(2, 3, 4, 1, 4, 0),
  L(4, 4, 0, 2, 6, 1), L(0, 5, 1, 1, 7, 0), L(2, 1, 1, 4, 1, 3), L(3, 0, 0, 0, 3, 2),
  L(1, 2, 7, 1, 5, 0), L(4, 1, 0, 3, 2, 4), L(0, 3, 6, 0, 1, 1), L(2, 0, 2, 2, 0, 0),
  L(3, 5, 0, 1, 2, 2), L(1, 4, 5, 3, 7, 1), L(4, 2, 0, 4, 4, 0), L(0, 1, 4, 1, 3, 3),
  L(2, 2, 3, 0, 6, 4), L(3, 3, 1, 1, 0, 1), L(1, 0, 6, 2, 4, 2), L(4, 0, 0, 1, 1, 0),
  L(0, 4, 2, 3, 6, 4), L(2, 5, 5, 0, 7, 0), L(1, 3, 0, 4, 0, 1), L(3, 1, 7, 1, 3, 3),
];

/** Is this profile avatar a character (a look) rather than an older keyword? */
export const isLook = (avatar: string) => /^s\d/.test(avatar);

/** A character drawn at `size` px (pixel art, crisp). */
export function AvatarCanvas({ look, size = 32, className }: { look: Look; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.imageSmoothingEnabled = false;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, size * dpr, size * dpr);
    c.setTransform((size * dpr) / 20, 0, 0, (size * dpr) / 20, 0, 0);
    drawAvatar(c, look, 2, 3, "down", 0, false);
  }, [look, size]);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return <canvas ref={ref} width={size * dpr} height={size * dpr} className={className} style={{ width: size, height: size, imageRendering: "pixelated" }} aria-hidden />;
}

/** Ready-made characters first; building one's own stays one fold away. */
export function AvatarPicker({ value, seed, onPick }: { value: string; seed: string; onPick: (avatar: string) => void }) {
  const current = encodeLook(decodeLook(value, seed));
  const [look, setLook] = useState<Look>(() => decodeLook(value, seed));
  useEffect(() => setLook(decodeLook(value, seed)), [value, seed]);
  const row = (label: string, key: keyof Look, options: string[], swatches = false) => (
    <div>
      <p className="mb-1 text-2xs text-faint">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map((o, i) => (
          <button key={o} type="button" aria-pressed={look[key] === i} onClick={() => { const next = { ...look, [key]: i }; setLook(next); onPick(encodeLook(next)); }} className={cn("rounded-md border text-2xs", swatches ? "size-6" : "px-2 py-0.5", look[key] === i ? "border-accent" : "border-ink/10 text-muted hover:text-fg")} style={swatches ? { background: o } : undefined} title={swatches ? undefined : t(o)} aria-label={swatches ? `${label} ${i + 1}` : undefined}>
            {swatches ? "" : t(o)}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-6 gap-1.5" aria-label={t("Avatars")}>
        {AVATAR_PRESETS.map((p, i) => {
          const code = encodeLook(p);
          return (
            <li key={code}>
              <button type="button" aria-pressed={code === current} aria-label={t("Avatar {n}", { n: i + 1 })} onClick={() => onPick(code)} className={cn("flex w-full items-center justify-center rounded-(--btn-radius) border-2 bg-ink/5 py-1 transition-colors", code === current ? "border-accent bg-accent-soft" : "border-transparent hover:bg-ink/8")}>
                <AvatarCanvas look={p} size={40} />
              </button>
            </li>
          );
        })}
      </ul>
      <details>
        <summary className="cursor-pointer text-xs text-muted hover:text-fg">{t("Composer le mien")}</summary>
        <div className="mt-2 space-y-2.5">
          {row(t("Peau"), "skin", SKINS, true)}
          {row(t("Coiffure"), "hair", HAIR_STYLES)}
          {row(t("Couleur des cheveux"), "hairColor", HAIR_COLORS, true)}
          {row(t("Tenue"), "outfit", OUTFITS)}
          {row(t("Couleur de la tenue"), "outfitColor", OUTFIT_COLORS, true)}
          {row(t("Accessoire"), "accessory", ACCESSORIES)}
        </div>
      </details>
    </div>
  );
}
