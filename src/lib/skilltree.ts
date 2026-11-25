// Skill Tree: filtering and radial layout, kept apart from the drawing so they can be tested.
// Branches (competency blocks) share the circle by size; units sit on the first ring inside
// their branch, their skills on the second ring under them, and projects on the outer ring,
// at the mean angle of the skills they train.
import type { SkillNode, SkillStatus, SkillTree } from "./api";

export interface Filters {
  year: number | null;
  semester: number | null;
  domain: string | null;
  status: SkillStatus | "todo" | null;
  /** Projects not open yet (MY Epitech's "unavailable"). */
  locked: boolean;
}

export const NO_FILTER: Filters = { year: null, semester: null, domain: null, status: null, locked: false };

function statusOk(n: SkillNode, f: Filters): boolean {
  if (!f.status) return true;
  if (f.status === "todo") return n.status === "available" || n.status === "in_progress";
  return n.status === f.status;
}

/** Ids of the nodes shown with these filters. */
export function visible(t: SkillTree, f: Filters): Set<string> {
  const out = new Set<string>();
  const units = t.nodes.filter((n) => n.kind === "unit" && (f.year === null || n.schoolYear === f.year) && (f.semester === null || n.semester === f.semester) && (f.domain === null || n.domain === f.domain));
  for (const u of units) if (statusOk(u, f) || t.nodes.some((s) => s.parent === u.id && statusOk(s, f))) out.add(u.id);
  for (const s of t.nodes) if (s.kind === "skill" && s.parent && out.has(s.parent) && statusOk(s, f)) out.add(s.id);
  const trains = new Map<string, string[]>();
  for (const l of t.links) if (l.kind === "project_skill") trains.set(l.source, [...(trains.get(l.source) ?? []), l.target]);
  for (const p of t.nodes) {
    if (p.kind !== "project" || (p.status === "locked" && !f.locked) || !statusOk(p, f)) continue;
    if (f.year !== null && p.schoolYear !== null && p.schoolYear !== f.year) continue;
    if (f.domain !== null && p.domain !== f.domain) continue;
    const skills = trains.get(p.id) ?? [];
    // A project linked to no skill is shown only with "not open yet" (it has nowhere to sit otherwise).
    if (skills.length > 0 ? skills.some((s) => out.has(s)) : f.locked && f.semester === null) out.add(p.id);
  }
  return out;
}

export interface Placed {
  x: number;
  y: number;
  angle: number;
}

export const RADIUS = { branch: 165, unit: 300, skill: 480, project: 660, loose: 810 } as const;

const at = (r: number, a: number): Placed => ({ x: Math.cos(a) * r, y: Math.sin(a) * r, angle: a });

/** Positions of the visible nodes and of the branch labels. */
export function layout(t: SkillTree, shown: Set<string>): { nodes: Map<string, Placed>; branches: Map<string, Placed & { from: number; to: number }> } {
  const nodes = new Map<string, Placed>();
  const branches = new Map<string, Placed & { from: number; to: number }>();
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  const live = t.branches.map((b) => ({ b, units: b.units.filter((u) => shown.has(u)) })).filter((x) => x.units.length > 0);
  // A unit takes the room of its skills (two at least), a branch five skills' worth at least.
  const unitWeight = (u: string) => Math.max(2, t.nodes.filter((n) => n.parent === u && shown.has(n.id)).length);
  const weight = (units: string[]) => Math.max(5, units.reduce((s, u) => s + unitWeight(u), 0));
  const total = live.reduce((s, x) => s + weight(x.units), 0) || 1;
  let a = -Math.PI / 2;
  live.forEach(({ b, units }, bi) => {
    const span = (2 * Math.PI * weight(units)) / total;
    // Neighbouring labels alternate between two radii so they do not collide.
    // With an odd count the last one meets the first: it gets a third radius.
    const ring = live.length % 2 === 1 && bi === live.length - 1 && bi > 0 ? 2 : bi % 2;
    branches.set(b.id, { ...at(RADIUS.branch + ring * 45, a + span / 2), from: a, to: a + span });
    const sorted = [...units].sort((x, y) => ((byId.get(x)?.semester ?? 0) - (byId.get(y)?.semester ?? 0)) || (byId.get(x)?.label ?? "").localeCompare(byId.get(y)?.label ?? ""));
    let u0 = a + span * 0.04;
    const usable = span * 0.92;
    const unitTotal = sorted.reduce((s, u) => s + unitWeight(u), 0) || 1;
    for (const u of sorted) {
      const skills = t.nodes.filter((n) => n.parent === u && shown.has(n.id));
      const slot = (usable * unitWeight(u)) / unitTotal;
      nodes.set(u, at(RADIUS.unit, u0 + slot / 2));
      skills.forEach((s, i) => {
        const angle = u0 + (slot * (i + 0.5)) / skills.length;
        nodes.set(s.id, at(RADIUS.skill + (skills.length > 4 && i % 2 ? 40 : 0), angle));
      });
      u0 += slot;
    }
    a += span;
  });
  // Projects: at the circular mean of their skills, then spread so they do not overlap.
  const trains = new Map<string, string[]>();
  for (const l of t.links) if (l.kind === "project_skill") trains.set(l.source, [...(trains.get(l.source) ?? []), l.target]);
  const projects = t.nodes.filter((n) => n.kind === "project" && shown.has(n.id));
  const linked: Array<{ id: string; angle: number }> = [];
  const loose: string[] = [];
  for (const p of projects) {
    const pts = (trains.get(p.id) ?? []).map((s) => nodes.get(s)).filter((x): x is Placed => !!x);
    if (pts.length === 0) loose.push(p.id);
    else linked.push({ id: p.id, angle: Math.atan2(pts.reduce((s, q) => s + Math.sin(q.angle), 0), pts.reduce((s, q) => s + Math.cos(q.angle), 0)) });
  }
  linked.sort((x, y) => x.angle - y.angle);
  const gap = (2.4 * Math.PI) / 180;
  for (let i = 1; i < linked.length; i++) if (linked[i].angle - linked[i - 1].angle < gap) linked[i].angle = linked[i - 1].angle + gap;
  linked.forEach((p, i) => nodes.set(p.id, at(RADIUS.project + (i % 2) * 45, p.angle)));
  loose.forEach((id, i) => nodes.set(id, at(RADIUS.loose, -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, loose.length))));
  return { nodes, branches };
}

/** Everything directly tied to a node (for highlighting). */
export function neighbours(t: SkillTree, id: string): Set<string> {
  const out = new Set<string>([id]);
  for (const l of t.links) {
    if (l.source === id) out.add(l.target);
    if (l.target === id) out.add(l.source);
  }
  const n = t.nodes.find((x) => x.id === id);
  if (n?.parent) out.add(n.parent);
  // A unit lights its skills and the projects that train them.
  if (n?.kind === "unit") for (const s of t.nodes) if (s.parent === id) for (const l of t.links) if (l.target === s.id) out.add(l.source);
  return out;
}
