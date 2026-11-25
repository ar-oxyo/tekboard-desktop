// A character, in a compact text form carried by Connect profiles: `s1h2c3o0p4a1`
// (skin, hair style, hair colour, outfit, outfit colour, accessory).

export interface Look {
  skin: number;
  hair: number;
  hairColor: number;
  outfit: number;
  outfitColor: number;
  accessory: number;
}

export const SKINS = ["#f6d7c3", "#e8b896", "#c98e66", "#9a6644", "#6b4430"];
export const HAIR_STYLES = ["Court", "Long", "Chignon", "Hérissé", "Rasé", "Casquette"];
export const HAIR_COLORS = ["#2b1d16", "#5a3a22", "#a86b32", "#e0c06a", "#c4442e", "#7a7f8c", "#3b5ccf", "#d65fa0"];
export const OUTFITS = ["T-shirt", "Sweat", "Chemise", "Veste", "Robe"];
export const OUTFIT_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#8a63d2", "#2f3542", "#e5e5e5", "#c0392b"];
export const ACCESSORIES = ["Aucun", "Lunettes", "Casque audio", "Écharpe", "Bonnet"];

const KEYS: Array<[keyof Look, string, number]> = [
  ["skin", "s", SKINS.length],
  ["hair", "h", HAIR_STYLES.length],
  ["hairColor", "c", HAIR_COLORS.length],
  ["outfit", "o", OUTFITS.length],
  ["outfitColor", "p", OUTFIT_COLORS.length],
  ["accessory", "a", ACCESSORIES.length],
];

/** A stable look for someone who never chose one: derived from their fingerprint. */
export function lookFromSeed(seed: string): Look {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const pick = (n: number) => {
    h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0;
    return h % n;
  };
  return { skin: pick(SKINS.length), hair: pick(HAIR_STYLES.length), hairColor: pick(HAIR_COLORS.length), outfit: pick(OUTFITS.length), outfitColor: pick(OUTFIT_COLORS.length), accessory: pick(ACCESSORIES.length) };
}

export function encodeLook(l: Look): string {
  return KEYS.map(([k, c]) => `${c}${l[k]}`).join("");
}

export function decodeLook(text: string, seed = ""): Look {
  const base = lookFromSeed(seed);
  for (const [k, c, n] of KEYS) {
    const m = new RegExp(`${c}(\\d+)`).exec(text);
    if (m) {
      const v = Number(m[1]);
      if (v >= 0 && v < n) base[k] = v;
    }
  }
  return base;
}
