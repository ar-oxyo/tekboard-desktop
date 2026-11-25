// A* on the campus grid (4 directions): the route followed when you click somewhere.
import { H, W, walkable } from "./map";

export function findPath(from: { x: number; y: number }, to: { x: number; y: number }, maxNodes = 4000): Array<{ x: number; y: number }> | null {
  const sx = Math.round(from.x);
  const sy = Math.round(from.y);
  const tx = Math.round(to.x);
  const ty = Math.round(to.y);
  if (!walkable(tx, ty)) return null;
  if (sx === tx && sy === ty) return [];
  const key = (x: number, y: number) => y * W + x;
  const g = new Map<number, number>([[key(sx, sy), 0]]);
  const came = new Map<number, number>();
  const open: Array<{ k: number; f: number }> = [{ k: key(sx, sy), f: Math.abs(tx - sx) + Math.abs(ty - sy) }];
  const closed = new Set<number>();
  let seen = 0;
  while (open.length && seen++ < maxNodes) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[best].f) best = i;
    const { k } = open.splice(best, 1)[0];
    if (closed.has(k)) continue;
    closed.add(k);
    const x = k % W;
    const y = Math.floor(k / W);
    if (x === tx && y === ty) {
      const out: Array<{ x: number; y: number }> = [];
      let c: number | undefined = k;
      while (c !== undefined && c !== key(sx, sy)) {
        out.push({ x: c % W, y: Math.floor(c / W) });
        c = came.get(c);
      }
      return out.reverse();
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !walkable(nx, ny)) continue;
      const nk = key(nx, ny);
      const ng = (g.get(k) ?? 0) + 1;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, k);
        open.push({ k: nk, f: ng + Math.abs(tx - nx) + Math.abs(ty - ny) });
      }
    }
  }
  return null;
}
