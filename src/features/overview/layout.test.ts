import { describe, expect, it } from "vitest";
import { addWidget, available, DEFAULT_LAYOUT, dropIndex, migrate, moveTo, nextSize, readLayout, removeWidget } from "./layout";

describe("Today widgets", () => {
  it("starts from the classic Today", () => {
    expect(readLayout(undefined)).toEqual(DEFAULT_LAYOUT);
    expect(DEFAULT_LAYOUT.items.map((i) => i.id)).toEqual(["hero", "tile.logtime", "tile.credits", "tile.work", "tile.due", "timeline", "projects", "more"]);
    // A full row of tiles, then the day beside the projects: 12 columns each.
    expect(DEFAULT_LAYOUT.items.slice(1, 5).reduce((a, i) => a + i.size, 0)).toBe(12);
    expect(DEFAULT_LAYOUT.items[5].size + DEFAULT_LAYOUT.items[6].size).toBe(12);
  });

  it("migrates a 0.9 layout without losing the student's choices", () => {
    const old = { order: ["day", "hero", "tiles", "more"], hidden: ["tile.credits", "projects", "checklist"] };
    const l = readLayout(old);
    expect(l.items.map((i) => i.id)).toEqual(["timeline", "hero", "tile.logtime", "tile.work", "tile.due", "more"]);
    // The timeline alone takes the whole row; three tiles share it.
    expect(l.items[0].size).toBe(12);
    expect(l.items.filter((i) => i.id.startsWith("tile.")).map((i) => i.size)).toEqual([4, 4, 4]);
    expect(l.checklist).toBe(false);
    expect(migrate(["hero", "tiles", "day", "more"], [])).toEqual(DEFAULT_LAYOUT);
  });

  it("keeps a saved layout as it is, cleaning only what it cannot read", () => {
    const saved = { version: 2, checklist: true, items: [{ id: "inbox", size: 6 }, { id: "ghost", size: 4 }, { id: "hero", size: 5 }, { id: "inbox", size: 4 }] };
    const l = readLayout(saved);
    expect(l.items).toEqual([{ id: "inbox", size: 6 }, { id: "hero", size: 12 }]);
    // A widget added in a later version is offered, not imposed.
    expect(available(l).some((w) => w.id === "skilltree")).toBe(true);
  });

  it("moves, resizes, adds and removes", () => {
    let l = moveTo(DEFAULT_LAYOUT, "more", 0);
    expect(l.items[0].id).toBe("more");
    l = nextSize(l, "timeline");
    expect(l.items.find((i) => i.id === "timeline")!.size).toBe(6);
    l = nextSize(nextSize(l, "timeline"), "timeline");
    expect(l.items.find((i) => i.id === "timeline")!.size).toBe(4);
    l = addWidget(l, "inbox");
    expect(l.items.at(-1)).toEqual({ id: "inbox", size: 4 });
    expect(addWidget(l, "inbox")).toBe(l);
    l = removeWidget(l, "hero");
    expect(l.items.some((i) => i.id === "hero")).toBe(false);
    // The default is never changed in place.
    expect(DEFAULT_LAYOUT.items[0].id).toBe("hero");
  });

  it("drops before the nearest widget, or after it on its right half", () => {
    const rects = [
      { id: "hero" as const, x: 0, y: 0, w: 300, h: 100 },
      { id: "inbox" as const, x: 0, y: 120, w: 100, h: 100 },
      { id: "credits" as const, x: 110, y: 120, w: 100, h: 100 },
    ];
    expect(dropIndex(rects, 20, 150)).toBe(1);
    expect(dropIndex(rects, 90, 170)).toBe(2);
    expect(dropIndex(rects, 200, 170)).toBe(3);
  });
});
