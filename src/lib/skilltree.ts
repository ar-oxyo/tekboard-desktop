// Skill Tree: filtering, galaxy layout and camera maths, kept apart from the drawing so they can
// be tested. Each competency block is a constellation around the credits core; its units are
// stars, their skills and projects satellites shown once you get close.
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

/** A point in galaxy coordinates (world units; the screen is world × zoom + offset). */
export interface Placed {
  x: number;
  y: number;
}

/** A unit drawn as a star: `r` is its mark's radius in screen pixels (it does not scale). */
export interface StarPlace extends Placed {
  r: number;
  system: string;
}

/** A competency block drawn as a constellation: a disc holding its units' stars. */
export interface SystemPlace extends Placed {
  id: string;
  name: string;
  color: string | null;
  /** Radius of its disc, in world units. */
  r: number;
  units: string[];
  /** The constellation's figure: the shortest lines joining all its stars. */
  figure: Array<[string, string]>;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GalaxyLayout {
  stars: Map<string, StarPlace>;
  systems: SystemPlace[];
  bounds: Box;
  /** Background specks, fixed so the sky does not change between renders. */
  dust: Array<Placed & { s: number }>;
}

/** Distances of the galaxy (world units), shared by the drawing and the tests. */
export const SPACE = {
  /** Spacing of stars inside a constellation (the phyllotaxis step). */
  step: 120,
  /** Room around the outermost star of a constellation, for its label and satellites. */
  pad: 80,
  /** Least gap between two constellations. */
  gap: 90,
  /** Least distance from the core (credits) to a constellation's disc. */
  core: 170,
} as const;

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const unitOrder = (byId: Map<string, SkillNode>) => (x: string, y: string) =>
  ((byId.get(x)?.semester ?? 0) - (byId.get(y)?.semester ?? 0)) || (byId.get(x)?.label ?? "").localeCompare(byId.get(y)?.label ?? "");

/** Star size from the unit's credits, in screen pixels. */
export const starRadius = (credits: number | null) => Math.min(15, 7 + 1.8 * Math.sqrt(Math.max(1, credits ?? 1)));

/** Shortest lines joining all points (Prim): a constellation figure without crossings. */
function figureOf(pts: Array<Placed & { id: string }>): Array<[string, string]> {
  if (pts.length < 2) return [];
  const inTree = new Set([0]);
  const out: Array<[string, string]> = [];
  while (inTree.size < pts.length) {
    let best: [number, number, number] | null = null;
    for (const i of inTree)
      for (let j = 0; j < pts.length; j++) {
        if (inTree.has(j)) continue;
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        if (!best || d < best[2]) best = [i, j, d];
      }
    inTree.add(best![1]);
    out.push([pts[best![0]].id, pts[best![1]].id]);
  }
  return out;
}

/** A small seeded generator: the same sky every time. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The Skill Tree as a galaxy: the credits at the core, one constellation per competency block
 * on a ring around it (equal angles, never overlapping), its units as stars spread by
 * phyllotaxis (the golden angle), so a block of any size stays round and evenly spaced.
 */
export function galaxy(t: SkillTree, shown: Set<string>): GalaxyLayout {
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  const groups = t.branches
    .map((b) => ({ b, units: b.units.filter((u) => shown.has(u) && byId.get(u)?.kind === "unit").sort(unitOrder(byId)) }))
    .filter((g) => g.units.length > 0)
    .map((g) => {
      const pts = g.units.map((id, i) => {
        const d = g.units.length === 1 ? 0 : SPACE.step * Math.sqrt(i + 0.5);
        return { id, x: Math.cos(i * GOLDEN) * d, y: Math.sin(i * GOLDEN) * d };
      });
      return { ...g, pts, r: Math.max(...pts.map((p) => Math.hypot(p.x, p.y))) + SPACE.pad };
    });
  const stars = new Map<string, StarPlace>();
  const systems: SystemPlace[] = [];
  const n = groups.length;
  const maxR = Math.max(0, ...groups.map((g) => g.r));
  const ring = n <= 1 ? maxR + SPACE.core : Math.max(maxR + SPACE.core, (2 * maxR + SPACE.gap) / (2 * Math.sin(Math.PI / n)));
  groups.forEach((g, i) => {
    const a = n === 1 ? 0 : -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const cx = Math.cos(a) * ring;
    const cy = Math.sin(a) * ring;
    for (const p of g.pts) stars.set(p.id, { x: cx + p.x, y: cy + p.y, r: starRadius(byId.get(p.id)?.credits ?? null), system: g.b.id });
    systems.push({ id: g.b.id, name: g.b.name, color: g.b.color, x: cx, y: cy, r: g.r, units: g.units, figure: figureOf(g.pts) });
  });
  const core = 60;
  const x0 = Math.min(-core, ...systems.map((s) => s.x - s.r));
  const y0 = Math.min(-core, ...systems.map((s) => s.y - s.r));
  const x1 = Math.max(core, ...systems.map((s) => s.x + s.r));
  const y1 = Math.max(core, ...systems.map((s) => s.y + s.r));
  const bounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const rand = seeded(7);
  const dust = Array.from({ length: 140 }, () => ({ x: x0 - 200 + rand() * (bounds.w + 400), y: y0 - 200 + rand() * (bounds.h + 400), s: rand() }));
  return { stars, systems, bounds, dust };
}

/** The box of a constellation's disc. */
export const systemBox = (s: SystemPlace): Box => ({ x: s.x - s.r, y: s.y - s.r, w: s.r * 2, h: s.r * 2 });

export interface View {
  x: number;
  y: number;
  k: number;
}

export const ZOOM = { min: 0.08, max: 6 } as const;

const clampK = (k: number) => Math.min(ZOOM.max, Math.max(ZOOM.min, k));

/** Zoom and offset that show `box` whole and centred in a `w`×`h` viewport. */
export function fitBox(box: Box, w: number, h: number, margin = 32, maxK: number = ZOOM.max): View {
  if (box.w <= 0 || box.h <= 0 || w <= 0 || h <= 0) return { x: w / 2, y: h / 2, k: 1 };
  const k = clampK(Math.min(maxK, (w - margin * 2) / box.w, (h - margin * 2) / box.h));
  return { k, x: w / 2 - (box.x + box.w / 2) * k, y: h / 2 - (box.y + box.h / 2) * k };
}

/** A star brought close: its nearest neighbour pushed `spread` px away, centred at (cx, cy). */
export function starView(g: GalaxyLayout, id: string, cx: number, cy: number, spread = 340): View {
  const s = g.stars.get(id);
  if (!s) return { x: cx, y: cy, k: 1 };
  let d = Infinity;
  for (const [o, p] of g.stars) if (o !== id) d = Math.min(d, Math.hypot(p.x - s.x, p.y - s.y));
  const k = clampK(Number.isFinite(d) ? spread / d : 2);
  return { k, x: cx - s.x * k, y: cy - s.y * k };
}

/** Zoom by `factor` keeping the screen point (px, py) still. */
export function zoomAt(v: View, factor: number, px: number, py: number): View {
  const k = clampK(v.k * factor);
  const r = k / v.k;
  return { k, x: px - (px - v.x) * r, y: py - (py - v.y) * r };
}

/** The view `p` of the way from `a` to `b` (0…1): the centre glides, the zoom changes evenly. */
export function between(a: View, b: View, p: number, w: number, h: number): View {
  const ca = { x: (w / 2 - a.x) / a.k, y: (h / 2 - a.y) / a.k };
  const cb = { x: (w / 2 - b.x) / b.k, y: (h / 2 - b.y) / b.k };
  const k = a.k * Math.pow(b.k / a.k, p);
  const cx = ca.x + (cb.x - ca.x) * p;
  const cy = ca.y + (cb.y - ca.y) * p;
  return { k, x: w / 2 - cx * k, y: h / 2 - cy * k };
}

/**
 * What a wheel event means. A pinch (ctrl+wheel) zooms; a two-finger swipe sideways or
 * shift+wheel pans; a plain wheel is left to the page, which keeps scrolling.
 */
export function wheelAction(e: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; shiftKey: boolean }): { kind: "zoom"; factor: number } | { kind: "pan"; dx: number; dy: number } | { kind: "none" } {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const dx = e.deltaX * unit;
  const dy = e.deltaY * unit;
  if (e.ctrlKey) return { kind: "zoom", factor: Math.exp(-Math.max(-120, Math.min(120, dy)) * 0.01) };
  if (e.shiftKey) return { kind: "pan", dx: -(dx || dy), dy: 0 };
  if (dx !== 0) return { kind: "pan", dx: -dx, dy: -dy };
  return { kind: "none" };
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
