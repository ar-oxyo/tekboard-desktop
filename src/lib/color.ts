// A personal accent colour on top of a design: only the accent family changes (action,
// selection, focus, links, progress); urgency (accent-2, warn) and status colours stay the
// design's. The colour is adjusted in OKLCH lightness, keeping its hue, until it reads on the
// page in the current mode: 3:1 for marks and fills, 4.5:1 for accent text. Pure and tested.

export const ACCENT_KEY = "tekboard.accent";

/** Inks offered first: they sit well on paper and on black stock. */
export const ACCENT_PRESETS: Array<{ id: string; hex: string; name: string }> = [
  { id: "riso", hex: "#006bab", name: "Bleu Riso" },
  { id: "teal", hex: "#00838f", name: "Sarcelle" },
  { id: "green", hex: "#2e7d32", name: "Vert" },
  { id: "violet", hex: "#6a4bc4", name: "Violet" },
  { id: "pink", hex: "#c2185b", name: "Framboise" },
  { id: "red", hex: "#c62828", name: "Rouge" },
  { id: "amber", hex: "#a66300", name: "Ambre" },
  { id: "slate", hex: "#4a5a70", name: "Ardoise" },
];

export type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

export const toHex = (c: Rgb) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const unlin = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export function toOklch([r, g, b]: Rgb): [number, number, number] {
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

export function fromOklch([L, C, H]: [number, number, number]): Rgb {
  const A = C * Math.cos(H);
  const B = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [unlin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), unlin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), unlin(-0.0041960863 * l - 0.7034186147 * m + 1.707619956 * s)].map((v) => Math.max(0, Math.min(255, v))) as Rgb;
}

/**
 * The colour, moved in lightness only (same hue, chroma eased if out of gamut) until it has
 * `min` contrast against `bg`: darker on a light page, lighter on a dark one.
 */
export function readableOn(c: Rgb, bg: Rgb, min: number): Rgb {
  if (contrast(c, bg) >= min) return c;
  const [L0, C, H] = toOklch(c);
  const darkPage = luminance(bg) < 0.2;
  let best = c;
  for (let i = 1; i <= 60; i++) {
    const L = darkPage ? Math.min(0.98, L0 + i * 0.01) : Math.max(0.05, L0 - i * 0.01);
    const cand = fromOklch([L, C * Math.max(0.6, 1 - i * 0.005), H]);
    best = cand;
    if (contrast(cand, bg) >= min) return cand;
  }
  return best;
}

export interface AccentTokens {
  accent: string;
  strong: string;
  soft: string;
  onAccent: string;
}

/** The accent family for a page background: marks (3:1), text (4.5:1), a soft film, and
 * the text colour that reads on an accent fill. */
export function accentTokens(hex: string, bgHex: string): AccentTokens | null {
  const c = parseHex(hex);
  const bg = parseHex(bgHex);
  if (!c || !bg) return null;
  const accent = readableOn(c, bg, 3);
  const strong = readableOn(accent, bg, 4.5);
  const [r, g, b] = accent;
  const white: Rgb = [255, 255, 255];
  const ink: Rgb = [24, 23, 21];
  return { accent: toHex(accent), strong: toHex(strong), soft: `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)} / ${luminance(bg) < 0.2 ? 0.2 : 0.13})`, onAccent: contrast(white, accent) >= contrast(ink, accent) ? "#ffffff" : toHex(ink) };
}

/** Reads a CSS colour value (`#rrggbb`, `rgb(r g b)`, `rgb(r, g, b)`) into hex. */
export function cssToHex(v: string): string | null {
  const t = v.trim();
  if (parseHex(t)) return toHex(parseHex(t)!);
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(t);
  return m ? toHex([Number(m[1]), Number(m[2]), Number(m[3])]) : null;
}

const PROPS = ["--color-accent", "--color-accent-strong", "--color-accent-soft", "--color-on-accent"] as const;

/** Applies (or removes, with `null`) the personal accent on the page, against its current background. */
export function applyAccent(hex: string | null, root: HTMLElement = document.documentElement) {
  for (const p of PROPS) root.style.removeProperty(p);
  if (!hex) return;
  const bg = cssToHex(getComputedStyle(root).getPropertyValue("--color-bg")) ?? "#f3efe6";
  const t = accentTokens(hex, bg);
  if (!t) return;
  root.style.setProperty("--color-accent", t.accent);
  root.style.setProperty("--color-accent-strong", t.strong);
  root.style.setProperty("--color-accent-soft", t.soft);
  root.style.setProperty("--color-on-accent", t.onAccent);
}
