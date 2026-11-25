import { describe, expect, it } from "vitest";
import type { SkillNode, SkillTree } from "./api";
import { layout, NO_FILTER, neighbours, RADIUS, visible } from "./skilltree";

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

  it("places each ring at its radius and projects next to their skills", () => {
    const { nodes, branches } = layout(tree, visible(tree, NO_FILTER));
    const r = (id: string) => Math.hypot(nodes.get(id)!.x, nodes.get(id)!.y);
    expect(Math.round(r("u:1"))).toBe(RADIUS.unit);
    expect(Math.round(r("s:1"))).toBe(RADIUS.skill);
    expect(Math.abs(nodes.get("p:1")!.angle - nodes.get("s:1")!.angle)).toBeLessThan(0.01);
    expect(branches.size).toBe(2);
    const b1 = branches.get("c:1")!;
    expect(nodes.get("u:3")!.angle).toBeGreaterThan(b1.from);
    expect(nodes.get("u:3")!.angle).toBeLessThan(b1.to);
  });

  it("highlights what is tied to a unit", () => {
    expect([...neighbours(tree, "u:1")].sort()).toEqual(["p:1", "s:1", "s:2", "u:1"]);
  });
});
