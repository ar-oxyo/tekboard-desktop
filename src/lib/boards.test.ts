import { describe, expect, it } from "vitest";
import { annotationShapes, changedSince, extractAnnotations, extractMermaid, generate, placeAt, sanitizeRemote, SHAPES, summary, type Skeleton } from "./boards";

const ids = (s: Skeleton[]) => new Set(s.map((x) => x.id).filter(Boolean));
const arrows = (s: Skeleton[]) => s.filter((x) => x.type === "arrow") as Array<Skeleton & { start: { id: string }; end: { id: string } }>;

describe("programming shapes", () => {
  it("every example builds, and every arrow is bound to shapes that exist", () => {
    for (const def of SHAPES) {
      const s = generate(def.kind, def.example);
      expect(s.length, def.kind).toBeGreaterThan(0);
      const known = ids(s);
      for (const a of arrows(s)) {
        expect(known.has(a.start.id), `${def.kind} start`).toBe(true);
        expect(known.has(a.end.id), `${def.kind} end`).toBe(true);
      }
    }
  });

  it("a linked list links each node to the next, then to NULL", () => {
    const s = generate("linkedList", "1, 2, 3");
    expect(arrows(s)).toHaveLength(3);
    expect(s.some((x) => (x.label as { text?: string } | undefined)?.text === "NULL")).toBe(true);
  });

  it("a tree skips empty slots and keeps parent links", () => {
    const s = generate("tree", "8, 3, 10, _, 6");
    expect(s.filter((x) => x.type === "ellipse")).toHaveLength(4);
    expect(arrows(s)).toHaveLength(3);
  });

  it("undirected graph edges have no arrowhead", () => {
    const a = arrows(generate("graph", "A-B, B>C"));
    expect(a[0].endArrowhead).toBeNull();
    expect(a[1].endArrowhead).toBeUndefined();
  });

  it("shapes are placed where asked", () => {
    const s = placeAt(generate("array", "1,2"), 500, 300);
    expect(Math.min(...s.map((x) => x.x))).toBe(500);
    expect(Math.min(...s.map((x) => x.y))).toBe(300);
  });
});

describe("Artix on boards", () => {
  const els = [
    { id: "r1", type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
    { id: "t1", type: "text", text: "malloc", containerId: "r1" },
    { id: "r2", type: "rectangle", x: 300, y: 0, width: 100, height: 50 },
    { id: "t2", type: "text", text: "free", containerId: "r2" },
    { id: "a1", type: "arrow", startBinding: { elementId: "r1" }, endBinding: { elementId: "r2" } },
    { id: "gone", type: "text", text: "deleted", isDeleted: true },
  ];

  it("summarises texts and links", () => {
    const s = summary(els);
    expect(s).toContain("malloc → free");
    expect(s).not.toContain("deleted");
  });

  it("reads Mermaid and annotations out of answers", () => {
    expect(extractMermaid("Voici :\n```mermaid\nflowchart TD\n  A --> B\n```")).toBe("flowchart TD\n  A --> B");
    expect(extractMermaid("```\nrm -rf /\n```")).toBeNull();
    const notes = extractAnnotations('```json\n[{"anchor": "malloc", "note": "vérifier le retour"}, {"x": 1}]\n```');
    expect(notes).toEqual([{ anchor: "malloc", note: "vérifier le retour" }]);
    expect(extractAnnotations("pas de json")).toEqual([]);
    const shapes = annotationShapes([...notes, { anchor: "inexistant", note: "x" }], els);
    expect(shapes.filter((x) => x.type === "rectangle")).toHaveLength(1);
    expect(arrows(shapes)[0].end.id).toBe("r1");
  });

  it("keeps only plausible remote elements", () => {
    const ok = { id: "a", type: "rectangle", version: 1 };
    expect(sanitizeRemote([ok, { id: "b", type: "embeddable", version: 1 }, { type: "text" }, "x", { id: "c", type: "text" }])).toEqual([ok]);
    expect(sanitizeRemote("nope")).toEqual([]);
    expect(changedSince([{ id: "a", version: 2 }, { id: "b", version: 1 }], new Map([["a", 1], ["b", 1]]))).toEqual([{ id: "a", version: 2 }]);
  });
});
