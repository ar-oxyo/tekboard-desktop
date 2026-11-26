import { describe, expect, it } from "vitest";
import { accentTokens, contrast, cssToHex, fromOklch, parseHex, readableOn, toHex, toOklch, ACCENT_PRESETS } from "./color";

const PAPER = "#f3efe6";
const BLACK_STOCK = "#181715";

describe("personal accent colour", () => {
  it("reads and writes colours", () => {
    expect(parseHex("#0af")).toEqual([0, 170, 255]);
    expect(parseHex("nope")).toBeNull();
    expect(toHex([0, 107, 171])).toBe("#006bab");
    expect(cssToHex("rgb(24 23 21)")).toBe("#181715");
    expect(cssToHex(" #F3EFE6 ")).toBe("#f3efe6");
  });

  it("goes to OKLCH and back without drifting", () => {
    for (const hex of ["#006bab", "#c2185b", "#2e7d32", "#ffffff", "#000000"]) {
      const back = toHex(fromOklch(toOklch(parseHex(hex)!)));
      const d = parseHex(back)!.map((v, i) => Math.abs(v - parseHex(hex)![i]));
      expect(Math.max(...d)).toBeLessThanOrEqual(1);
    }
  });

  it("keeps every preset readable in both modes", () => {
    for (const p of ACCENT_PRESETS) {
      for (const bg of [PAPER, BLACK_STOCK]) {
        const t = accentTokens(p.hex, bg)!;
        expect(contrast(parseHex(t.accent)!, parseHex(bg)!)).toBeGreaterThanOrEqual(3);
        expect(contrast(parseHex(t.strong)!, parseHex(bg)!)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(parseHex(t.onAccent)!, parseHex(t.accent)!)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("fixes a pale colour on paper and a dark one on black stock, keeping the hue", () => {
    const pale = parseHex("#ffe066")!;
    const fixed = readableOn(pale, parseHex(PAPER)!, 4.5);
    expect(contrast(fixed, parseHex(PAPER)!)).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(toOklch(fixed)[2] - toOklch(pale)[2])).toBeLessThan(0.35);
    const dark = parseHex("#1a237e")!;
    expect(contrast(readableOn(dark, parseHex(BLACK_STOCK)!, 3), parseHex(BLACK_STOCK)!)).toBeGreaterThanOrEqual(3);
    // A colour that already reads is left as it is.
    expect(readableOn(parseHex("#006bab")!, parseHex(PAPER)!, 3)).toEqual(parseHex("#006bab"));
  });
});
