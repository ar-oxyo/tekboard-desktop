// Interface language. The French text written in the code is the key; `locales/en.ts` gives
// its English version (gettext style): a string missing there simply stays in French, so a
// screen is never blank. Technical words keep their name in both languages ("test", "zone de
// test", moulinette, Banana…).
//
// The language lives in the settings (backend) and is mirrored in localStorage so the first
// paint is already in the right language. Changing it reloads the window: module-level labels
// are re-read, nothing else restarts (the backend, the MY Epitech session and timers go on).
import { en } from "../locales/en";

export type Lang = "fr" | "en";
const KEY = "tekboard.lang";

function stored(): Lang {
  try {
    return localStorage.getItem(KEY) === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}

let current: Lang = stored();

export const lang = (): Lang => current;

/** `fr-FR` or `en-GB`, for dates and numbers. */
export const locale = (): string => (current === "en" ? "en-GB" : "fr-FR");

/** The text in the interface language. `{name}` placeholders are filled from `vars`. */
export function t(fr: string, vars?: Record<string, string | number>): string {
  const s = current === "en" ? (en[fr] ?? fr) : fr;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** One form or the other depending on `n` (`{n}` is replaced by the number). */
export function plural(n: number, one: string, many: string): string {
  return t(n > 1 ? many : one, { n });
}

/** Applies a language chosen in Settings. Returns true when the window reloads to apply it. */
export function applyLang(next: string | undefined | null): boolean {
  const l: Lang = next === "en" ? "en" : "fr";
  if (l === current) return false;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* the setting still holds it */
  }
  current = l;
  document.documentElement.lang = l;
  window.location.reload();
  return true;
}

if (typeof document !== "undefined") document.documentElement.lang = current;
