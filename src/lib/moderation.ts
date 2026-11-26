// Moderation of public text (nicknames, statuses, chat, table topics, goals, pins, names):
// local, cheap, without any outside service. It refuses slurs (racist, homophobic and other
// discriminating ones), threats and targeted harassment; it lets ordinary swearing through.
// Words are matched whole, after normalising what is used to get around a filter (case,
// accents, look-alike digits and symbols, repeated letters, spaced letters), so a slur is
// caught in "N 3 g r e" but "Niger" or "pdf" are not. The same list and rules run in Rust
// for Connect profiles (src-tauri/src/moderation.rs). Pure and tested.
import data from "./moderation.json";
import { t } from "./i18n";

export type Category = "racisme" | "homophobie" | "discrimination" | "menace" | "harcelement";

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", $: "s", "€": "e", "!": "i", "|": "i", "£": "l" };

/** Lower case, no accents, look-alikes replaced, runs of 3+ identical letters made one. */
export function normalize(text: string): string {
  const base = text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  let out = "";
  for (const ch of base) out += LEET[ch] ?? ch;
  return out.replace(/(.)\1{2,}/g, "$1");
}

/** Words of a text; letters typed one by one with separators ("n.e.g.r.e") are joined. */
export function words(text: string): string[] {
  const raw = normalize(text).split(/[^a-z]+/).filter(Boolean);
  const out: string[] = [];
  let run = "";
  for (const w of raw) {
    if (w.length === 1) {
      run += w;
      continue;
    }
    if (run.length > 1) out.push(run);
    else if (run) out.push(run);
    run = "";
    out.push(w);
  }
  if (run) out.push(run);
  return out;
}

const TERMS: Array<{ cat: Category; words: string[] }> = Object.entries(data.categories as Record<Category, string[]>).flatMap(([cat, list]) => list.map((term) => ({ cat: cat as Category, words: words(term) })));
const ALLOW = new Set(data.allow.map((a) => words(a).join(" ")));

export interface Verdict {
  ok: boolean;
  category?: Category;
}

/** Whether a public text may be shown to others. */
export function check(text: string): Verdict {
  const w = words(text).filter((x) => !ALLOW.has(x));
  for (const term of TERMS) {
    const n = term.words.length;
    if (n === 0) continue;
    for (let i = 0; i + n <= w.length; i++) {
      let hit = true;
      for (let j = 0; j < n; j++) if (w[i + j] !== term.words[j]) { hit = false; break; }
      if (hit) return { ok: false, category: term.cat };
    }
  }
  return { ok: true };
}

const REASON: Record<Category, string> = {
  racisme: t("Ce texte contient une insulte raciste."),
  homophobie: t("Ce texte contient une insulte homophobe ou transphobe."),
  discrimination: t("Ce texte contient une attaque discriminatoire."),
  menace: t("Ce texte contient une menace."),
  harcelement: t("Ce texte ressemble à du harcèlement."),
};

/** The refusal shown to the author: what is refused, and that they can rephrase. */
export function refusal(v: Verdict): string | null {
  return v.ok || !v.category ? null : `${REASON[v.category]} ${t("Reformule : les gros mots ordinaires passent, les propos haineux non.")}`;
}
