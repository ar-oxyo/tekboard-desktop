// Skill Tree: filtering, lane layout and view maths, kept apart from the drawing so they can be
// tested. Each competency block is a lane; its units are columns with their skills listed under
// them, and projects are chips in a last lane whose links appear only on demand.
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

/** Centre of a node's mark, in tree coordinates (px at zoom 1). */
export interface Placed {
  x: number;
  y: number;
}

/** A competency block drawn as one lane; the projects lane has no branch. */
export interface Lane {
  id: string;
  name: string;
  color: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  projects?: boolean;
}

/** A structural connector unit → skill, an orthogonal elbow from the unit's trunk. */
export interface Edge {
  from: string;
  to: string;
  d: string;
}

/** Sizes of the lane layout (px at zoom 1), shared by the drawing and the tests. */
export const GRID = {
  /** Width of a unit column: its label and its skills' labels. */
  col: 216,
  gap: 24,
  /** Lane header: block name and gauge. */
  head: 44,
  unit: 52,
  row: 30,
  laneGap: 28,
  /** Unit columns per lane before it wraps. */
  wrap: 6,
  pad: 16,
  /** Project chips per row, at most. */
  chips: 6,
} as const;

const unitOrder = (byId: Map<string, SkillNode>) => (x: string, y: string) =>
  ((byId.get(x)?.semester ?? 0) - (byId.get(y)?.semester ?? 0)) || (byId.get(x)?.label ?? "").localeCompare(byId.get(y)?.label ?? "");

export interface TreeLayout {
  nodes: Map<string, Placed>;
  lanes: Lane[];
  edges: Edge[];
  width: number;
  height: number;
}

/**
 * One lane per competency block, its units side by side (wrapping after `GRID.wrap`), each
 * unit's skills listed under it. Every connector stays inside its own column, so none can
 * cross another. Projects come last as chips, ordered like the first skill they train.
 */
export function layout(t: SkillTree, shown: Set<string>): TreeLayout {
  const nodes = new Map<string, Placed>();
  const lanes: Lane[] = [];
  const edges: Edge[] = [];
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  const kids = new Map<string, SkillNode[]>();
  for (const n of t.nodes) if (n.kind === "skill" && n.parent && shown.has(n.id)) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const colW = GRID.col + GRID.gap;
  const order: string[] = [];
  let y = 0;
  let width = 0;
  for (const b of t.branches) {
    const units = b.units.filter((u) => shown.has(u)).sort(unitOrder(byId));
    if (units.length === 0) continue;
    const w = GRID.pad * 2 + Math.min(GRID.wrap, units.length) * colW - GRID.gap;
    let rowY = y + GRID.head;
    for (let r = 0; r * GRID.wrap < units.length; r++) {
      const line = units.slice(r * GRID.wrap, (r + 1) * GRID.wrap);
      const tallest = Math.max(0, ...line.map((u) => (kids.get(u) ?? []).length));
      line.forEach((u, i) => {
        const ux = GRID.pad + i * colW + 14;
        const uy = rowY + GRID.unit / 2;
        nodes.set(u, { x: ux, y: uy });
        order.push(u);
        (kids.get(u) ?? []).forEach((s, j) => {
          const sy = rowY + GRID.unit + j * GRID.row + GRID.row / 2;
          const sx = ux + 24;
          nodes.set(s.id, { x: sx, y: sy });
          order.push(s.id);
          edges.push({ from: u, to: s.id, d: `M${ux},${uy + 14} V${sy - 6} Q${ux},${sy} ${ux + 6},${sy} H${sx - 7}` });
        });
      });
      rowY += GRID.unit + tallest * GRID.row + 12;
    }
    const h = rowY - y + GRID.pad - 12;
    lanes.push({ id: b.id, name: b.name, color: b.color, x: 0, y, w, h });
    width = Math.max(width, w);
    y += h + GRID.laneGap;
  }
  const trains = new Map<string, string[]>();
  for (const l of t.links) if (l.kind === "project_skill") trains.set(l.source, [...(trains.get(l.source) ?? []), l.target]);
  const rank = new Map(order.map((id, i) => [id, i]));
  const projects = t.nodes
    .filter((n) => n.kind === "project" && shown.has(n.id))
    .map((p) => ({ p, at: Math.min(Infinity, ...(trains.get(p.id) ?? []).map((s) => rank.get(s) ?? Infinity)) }))
    .sort((a, b) => a.at - b.at || a.p.label.localeCompare(b.p.label));
  if (projects.length > 0) {
    const per = Math.max(1, Math.min(GRID.chips, Math.floor((Math.max(width, colW * 3) - GRID.pad * 2 + GRID.gap) / colW)));
    const rowH = GRID.row + 6;
    projects.forEach(({ p }, i) => nodes.set(p.id, { x: GRID.pad + (i % per) * colW + 10, y: y + GRID.head + Math.floor(i / per) * rowH + GRID.row / 2 }));
    const w = GRID.pad * 2 + Math.min(per, projects.length) * colW - GRID.gap;
    const h = GRID.head + Math.ceil(projects.length / per) * rowH + GRID.pad - 6;
    lanes.push({ id: "projects", name: "", color: null, x: 0, y, w, h, projects: true });
    width = Math.max(width, w);
    y += h + GRID.laneGap;
  }
  return { nodes, lanes, edges, width, height: Math.max(0, y - GRID.laneGap) };
}

export interface View {
  x: number;
  y: number;
  k: number;
}

export const ZOOM = { min: 0.25, max: 3 } as const;

/** Zoom and offset that show a `width`×`height` tree whole in a `w`×`h` viewport. */
export function fit(width: number, height: number, w: number, h: number, margin = 24): View {
  if (width <= 0 || height <= 0 || w <= 0 || h <= 0) return { x: margin, y: margin, k: 1 };
  const k = Math.min(1.2, Math.max(ZOOM.min, Math.min((w - margin * 2) / width, (h - margin * 2) / height)));
  return { k, x: (w - width * k) / 2, y: Math.max(margin, (h - height * k) / 2) };
}

/** Zoom by `factor` keeping the screen point (px, py) still. */
export function zoomAt(v: View, factor: number, px: number, py: number): View {
  const k = Math.min(ZOOM.max, Math.max(ZOOM.min, v.k * factor));
  const r = k / v.k;
  return { k, x: px - (px - v.x) * r, y: py - (py - v.y) * r };
}

/**
 * What a wheel event means: a pinch (ctrl+wheel) or a plain mouse wheel zooms, a two-finger
 * swipe (horizontal component) or shift+wheel pans. Deltas are normalised to pixels.
 */
export function wheelAction(e: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; shiftKey: boolean }): { kind: "zoom"; factor: number } | { kind: "pan"; dx: number; dy: number } {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const dx = e.deltaX * unit;
  const dy = e.deltaY * unit;
  if (e.ctrlKey) return { kind: "zoom", factor: Math.exp(-dy * 0.01) };
  if (e.shiftKey) return { kind: "pan", dx: -(dx || dy), dy: 0 };
  if (dx !== 0) return { kind: "pan", dx: -dx, dy: -dy };
  return { kind: "zoom", factor: Math.exp(-Math.max(-120, Math.min(120, dy)) * 0.0018) };
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
