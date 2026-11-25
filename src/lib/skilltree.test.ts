import { describe, expect, it } from "vitest";
import type { SkillNode, SkillTree } from "./api";
import { fit, GRID, layout, NO_FILTER, neighbours, visible, wheelAction, zoomAt } from "./skilltree";

const node = (id: string, kind: SkillNode["kind"], extra: Partial<SkillNode> = {}): SkillNode => ({ id, kind, label: id, status: "available", statusFrom: "validations", branch: null, parent: null, semester: 1, schoolYear: 2026, upcoming: false, credits: null, grade: null, validated: null, total: null, levelPercent: null, mandatory: null, unitCode: null, domain: null, domainEstimated: false, ...extra });

const tree: SkillTree = {
  syncedAt: 1,
  credits: { acquired: 4, prior: 0, thisSemester: 4, threshold: 60, secure: 8, reachable: 30, lost: 0, atRisk: 0 },
  semester: 1,
  semesters: [],
  branches: [
    { id: "c:1", name: "Tech", color: "#38f", threshold: 10, secure: 4, reachable: 9, available: 9, alert: null, units: ["u:1", "u:3"] },
    { id: "c:2", name: "Soft", color: null, threshold: null, secure: null, reachable: null, available: null, alert: null, units: ["u:2"] },
  ],
  nodes: [
    node("u:1", "unit", { status: "in_progress", domain: "Système", domainEstimated: true }),
    node("s:1", "skill", { parent: "u:1", status: "acquired" }),
    node("s:2", "skill", { parent: "u:1" }),
    node("u:2", "unit", { semester: 2, upcoming: true, status: "locked" }),
    node("u:3", "unit", { status: "acquired" }),
    node("p:1", "project", { status: "acquired", semester: null }),
    node("p:2", "project", { status: "locked", semester: null }),
  ],
  links: [
    { source: "s:1", target: "u:1", kind: "skill_unit" },
    { source: "s:2", target: "u:1", kind: "skill_unit" },
    { source: "p:1", target: "s:1", kind: "project_skill" },
  ],
  history: [],
  notes: [],
};

describe("Skill Tree", () => {
  it("hides projects not open yet unless asked", () => {
    const v = visible(tree, NO_FILTER);
    expect([...v].sort()).toEqual(["p:1", "s:1", "s:2", "u:1", "u:2", "u:3"]);
    expect(visible(tree, { ...NO_FILTER, locked: true }).has("p:2")).toBe(true);
  });

  it("filters by semester, domain and status", () => {
    expect([...visible(tree, { ...NO_FILTER, semester: 2 })]).toEqual(["u:2"]);
    expect(visible(tree, { ...NO_FILTER, domain: "Système" }).has("u:3")).toBe(false);
    const acquired = visible(tree, { ...NO_FILTER, status: "acquired" });
    expect(acquired.has("u:1") && acquired.has("s:1") && !acquired.has("s:2")).toBe(true);
  });

  it("gives each block a lane, units as columns and skills under their unit", () => {
    const l = layout(tree, visible(tree, NO_FILTER));
    expect(l.lanes.map((x) => x.id)).toEqual(["c:1", "c:2", "projects"]);
    const [tech] = l.lanes;
    for (const id of ["u:1", "u:3", "s:1", "s:2"]) {
      const p = l.nodes.get(id)!;
      expect(p.y).toBeGreaterThan(tech.y);
      expect(p.y).toBeLessThan(tech.y + tech.h);
    }
    // Skills hang under their unit, in its column.
    expect(l.nodes.get("s:1")!.y).toBeGreaterThan(l.nodes.get("u:1")!.y);
    expect(l.nodes.get("s:2")!.y).toBeGreaterThan(l.nodes.get("s:1")!.y);
    expect(l.nodes.get("s:1")!.x - l.nodes.get("u:1")!.x).toBeLessThan(GRID.col);
    expect(l.edges.map((e) => `${e.from}>${e.to}`)).toEqual(["u:1>s:1", "u:1>s:2"]);
  });

  it("never overlaps two marks nor two lanes", () => {
    const many: SkillTree = {
      ...tree,
      branches: [{ ...tree.branches[0], units: Array.from({ length: 9 }, (_, i) => `u:${i}`) }],
      nodes: [
        ...Array.from({ length: 9 }, (_, i) => node(`u:${i}`, "unit")),
        ...Array.from({ length: 40 }, (_, i) => node(`s:${i}`, "skill", { parent: `u:${i % 9}` })),
        ...Array.from({ length: 14 }, (_, i) => node(`p:${i}`, "project")),
      ],
      links: Array.from({ length: 14 }, (_, i) => ({ source: `p:${i}`, target: `s:${i}`, kind: "project_skill" as const })),
    };
    const l = layout(many, visible(many, NO_FILTER));
    const pts = [...l.nodes.values()];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.abs(pts[i].x - pts[j].x) >= 20 || Math.abs(pts[i].y - pts[j].y) >= 20).toBe(true);
    for (let i = 1; i < l.lanes.length; i++) expect(l.lanes[i].y).toBeGreaterThanOrEqual(l.lanes[i - 1].y + l.lanes[i - 1].h);
    // Nine units wrap after six columns.
    expect(l.lanes[0].w).toBeLessThanOrEqual(GRID.pad * 2 + GRID.wrap * (GRID.col + GRID.gap));
    expect(l.height).toBeGreaterThan(0);
  });

  it("fits the tree in the viewport and zooms around the pointer", () => {
    const v = fit(1000, 500, 500, 400);
    expect(1000 * v.k).toBeLessThanOrEqual(500);
    const z = zoomAt({ x: 10, y: 20, k: 1 }, 2, 110, 120);
    // The point under the cursor stays under the cursor.
    expect((110 - z.x) / z.k).toBeCloseTo((110 - 10) / 1);
    expect((120 - z.y) / z.k).toBeCloseTo((120 - 20) / 1);
    expect(zoomAt({ x: 0, y: 0, k: 3 }, 4, 0, 0).k).toBe(3);
  });

  it("tells a wheel zoom from a trackpad pan", () => {
    expect(wheelAction({ deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false, shiftKey: false }).kind).toBe("zoom");
    expect(wheelAction({ deltaX: 4, deltaY: 2, deltaMode: 0, ctrlKey: false, shiftKey: false }).kind).toBe("pan");
    const pinch = wheelAction({ deltaX: 0, deltaY: -10, deltaMode: 0, ctrlKey: true, shiftKey: false });
    expect(pinch.kind === "zoom" && pinch.factor > 1).toBe(true);
  });

  it("highlights what is tied to a unit", () => {
    expect([...neighbours(tree, "u:1")].sort()).toEqual(["p:1", "s:1", "s:2", "u:1"]);
  });
});
