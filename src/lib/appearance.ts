// Light, dark or follow the system. Stored with the UI preferences (so it follows a data
// export) and mirrored in localStorage, so the right ground is painted before React starts.
// Pure, without imports: main.tsx calls it before anything else loads (the hook is in hooks.ts).
export type ColorMode = "dark" | "light" | "system";
export const COLOR_MODES: ColorMode[] = ["system", "light", "dark"];

export const MODE_KEY = "tekboard.colorMode";
export const THEME_KEY = "tekboard.theme";
/** Riso and its ambiances exist in light and dark; the older designs stay dark. */
export const LIGHT_DESIGNS = ["aurora", "sauge", "ardoise", "prune", "sumi"];
export const designHasLight = (theme: string | undefined) => LIGHT_DESIGNS.includes(theme ?? "aurora");

export function storedMode(): ColorMode {
  const v = localStorage.getItem(MODE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "dark";
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Resolves the mode and sets `data-mode` on <html>; safe to call before the first render. */
export function applyMode(mode: ColorMode, theme?: string) {
  const resolved = !designHasLight(theme) ? "dark" : mode === "system" ? (systemDark() ? "dark" : "light") : mode;
  const root = document.documentElement;
  root.dataset.mode = resolved;
  root.style.colorScheme = resolved;
}

/** Lets the colours cross-fade while the mode or the design changes (not at start-up). */
export function crossFade() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "off") return;
  const root = document.documentElement;
  root.classList.add("switching-theme");
  window.setTimeout(() => root.classList.remove("switching-theme"), 260);
}
