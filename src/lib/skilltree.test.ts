import { describe, expect, it } from "vitest";
import type { SkillNode, SkillTree } from "./api";
import { between, fitBox, galaxy, NO_FILTER, neighbours, SPACE, starView, systemBox, visible, wheelAction, zoomAt } from "./skilltree";

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

  it("draws each block as a constellation of its units, around the core", () => {
    const g = galaxy(tree, visible(tree, NO_FILTER));
    expect(g.systems.map((x) => x.id)).toEqual(["c:1", "c:2"]);
    expect(g.systems[0].units.sort()).toEqual(["u:1", "u:3"]);
    // Every star sits inside its constellation's disc, and the figure joins them all.
    for (const sys of g.systems) for (const u of sys.units) expect(Math.hypot(g.stars.get(u)!.x - sys.x, g.stars.get(u)!.y - sys.y)).toBeLessThan(sys.r);
    expect(g.systems[0].figure).toHaveLength(1);
    // Skills and projects are not stars.
    expect(g.stars.has("s:1") || g.stars.has("p:1")).toBe(false);
    // The core stays clear.
    for (const sys of g.systems) expect(Math.hypot(sys.x, sys.y) - sys.r).toBeGreaterThanOrEqual(SPACE.core - 1);
  });

  it("never overlaps two constellations nor two stars", () => {
    const branches = Array.from({ length: 6 }, (_, b) => ({ ...tree.branches[0], id: `c:${b}`, units: Array.from({ length: 3 + b * 2 }, (_, i) => `u:${b}:${i}`) }));
    const many: SkillTree = { ...tree, branches, nodes: branches.flatMap((b) => b.units.map((u) => node(u, "unit", { credits: 5 }))), links: [] };
    const g = galaxy(many, visible(many, NO_FILTER));
    expect(g.stars.size).toBe(branches.reduce((a, b) => a + b.units.length, 0));
    for (let i = 0; i < g.systems.length; i++)
      for (let j = i + 1; j < g.systems.length; j++) {
        const [p, q] = [g.systems[i], g.systems[j]];
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(p.r + q.r);
      }
    const pts = [...g.stars.values()];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(80);
    // The bounds hold every disc, and the same tree gives the same sky.
    for (const sys of g.systems) expect(sys.x - sys.r).toBeGreaterThanOrEqual(g.bounds.x);
    expect(galaxy(many, visible(many, NO_FILTER)).dust).toEqual(g.dust);
  });

  it("frames the galaxy, a constellation or a star, and glides between views", () => {
    const g = galaxy(tree, visible(tree, NO_FILTER));
    const all = fitBox(g.bounds, 800, 600);
    expect(g.bounds.w * all.k).toBeLessThanOrEqual(800);
    // A framed box is centred.
    const box = systemBox(g.systems[0]);
    const v = fitBox(box, 800, 600);
    expect((box.x + box.w / 2) * v.k + v.x).toBeCloseTo(400);
    expect((box.y + box.h / 2) * v.k + v.y).toBeCloseTo(300);
    // Close to a star: it is centred and its nearest neighbour is pushed away.
    const s = starView(g, "u:1", 400, 300);
    const p = g.stars.get("u:1")!;
    expect(p.x * s.k + s.x).toBeCloseTo(400);
    expect(between(all, s, 0, 800, 600).k).toBeCloseTo(all.k);
    expect(between(all, s, 1, 800, 600).x).toBeCloseTo(s.x);
    const z = zoomAt({ x: 10, y: 20, k: 1 }, 2, 110, 120);
    // The point under the cursor stays under the cursor.
    expect((110 - z.x) / z.k).toBeCloseTo((110 - 10) / 1);
    expect((120 - z.y) / z.k).toBeCloseTo((120 - 20) / 1);
  });

  it("leaves the plain wheel to the page; pinch zooms, a sideways swipe pans", () => {
    expect(wheelAction({ deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false, shiftKey: false }).kind).toBe("none");
    expect(wheelAction({ deltaX: 4, deltaY: 2, deltaMode: 0, ctrlKey: false, shiftKey: false }).kind).toBe("pan");
    const pinch = wheelAction({ deltaX: 0, deltaY: -10, deltaMode: 0, ctrlKey: true, shiftKey: false });
    expect(pinch.kind === "zoom" && pinch.factor > 1).toBe(true);
  });

  it("highlights what is tied to a unit", () => {
    expect([...neighbours(tree, "u:1")].sort()).toEqual(["p:1", "s:1", "s:2", "u:1"]);
  });
});
