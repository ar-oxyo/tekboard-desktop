// The TekSpace campus: a 40×24 grid of 16-px tiles, rooms carved out of walls, furniture
// placed on top. Tables have seats; everything solid blocks movement. Pure data and rules.

export const W = 40;
export const H = 24;
export const TILE = 16;

export type Floor = "wall" | "wood" | "carpet" | "tile" | "library" | "focus" | "meeting";
export type Dir = "down" | "up" | "left" | "right";
export type Zone = "coworking" | "library" | "corridor" | "cafe" | "focus" | "meeting";

export interface Seat {
  id: string;
  x: number;
  y: number;
  dir: Dir;
}

export interface TableDef {
  id: string;
  name: string;
  zone: Zone;
  x: number;
  y: number;
  w: number;
  h: number;
  seats: Seat[];
}

export type DecoKind = "plant" | "shelf" | "counter" | "sofa" | "rug" | "board" | "lamp";
export interface Deco {
  kind: DecoKind;
  x: number;
  y: number;
  w: number;
  h: number;
  solid: boolean;
}

interface Room {
  zone: Zone;
  name: string;
  floor: Floor;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const ROOMS: Room[] = [
  { zone: "coworking", name: "Coworking", floor: "carpet", x0: 1, y0: 1, x1: 22, y1: 9 },
  { zone: "library", name: "Bibliothèque", floor: "library", x0: 24, y0: 1, x1: 38, y1: 9 },
  { zone: "corridor", name: "Couloir", floor: "wood", x0: 1, y0: 11, x1: 38, y1: 12 },
  { zone: "cafe", name: "Café", floor: "tile", x0: 1, y0: 14, x1: 12, y1: 22 },
  { zone: "focus", name: "Salle de concentration", floor: "focus", x0: 14, y0: 14, x1: 23, y1: 22 },
  { zone: "meeting", name: "Réunion 1", floor: "meeting", x0: 25, y0: 14, x1: 31, y1: 22 },
  { zone: "meeting", name: "Réunion 2", floor: "meeting", x0: 33, y0: 14, x1: 38, y1: 22 },
];

/** Doorways in the walls between rooms and the corridor. */
const DOORS: Array<[number, number]> = [
  [10, 10], [11, 10], [30, 10], [31, 10],
  [6, 13], [7, 13], [18, 13], [19, 13], [31, 13], [38, 13],
];

function seats(prefix: string, list: Array<[number, number, Dir]>): Seat[] {
  return list.map(([x, y, dir], i) => ({ id: `${prefix}:${i}`, x, y, dir }));
}

export const TABLES: TableDef[] = [
  { id: "cowork-a", name: "Table 1", zone: "coworking", x: 3, y: 3, w: 4, h: 2, seats: seats("cowork-a", [[3, 2, "down"], [5, 2, "down"], [3, 5, "up"], [5, 5, "up"]]) },
  { id: "cowork-b", name: "Table 2", zone: "coworking", x: 10, y: 3, w: 4, h: 2, seats: seats("cowork-b", [[10, 2, "down"], [12, 2, "down"], [10, 5, "up"], [12, 5, "up"]]) },
  { id: "cowork-c", name: "Table 3", zone: "coworking", x: 17, y: 3, w: 4, h: 2, seats: seats("cowork-c", [[17, 2, "down"], [19, 2, "down"], [17, 5, "up"], [19, 5, "up"]]) },
  { id: "library-a", name: "Table calme", zone: "library", x: 29, y: 5, w: 4, h: 2, seats: seats("library-a", [[29, 4, "down"], [31, 4, "down"], [29, 7, "up"], [31, 7, "up"]]) },
  { id: "cafe-a", name: "Café · gauche", zone: "cafe", x: 3, y: 17, w: 2, h: 2, seats: seats("cafe-a", [[2, 17, "right"], [5, 17, "left"], [2, 18, "right"], [5, 18, "left"]]) },
  { id: "cafe-b", name: "Café · droite", zone: "cafe", x: 8, y: 17, w: 2, h: 2, seats: seats("cafe-b", [[7, 17, "right"], [10, 17, "left"], [7, 18, "right"], [10, 18, "left"]]) },
  { id: "focus-a", name: "Grande table", zone: "focus", x: 16, y: 17, w: 6, h: 2, seats: seats("focus-a", [[16, 16, "down"], [18, 16, "down"], [20, 16, "down"], [16, 19, "up"], [18, 19, "up"], [20, 19, "up"]]) },
  { id: "meet-1", name: "Réunion 1", zone: "meeting", x: 26, y: 17, w: 4, h: 2, seats: seats("meet-1", [[26, 16, "down"], [28, 16, "down"], [26, 19, "up"], [28, 19, "up"]]) },
  { id: "meet-2", name: "Réunion 2", zone: "meeting", x: 34, y: 17, w: 3, h: 2, seats: seats("meet-2", [[34, 16, "down"], [36, 16, "down"], [34, 19, "up"], [36, 19, "up"]]) },
];

export const DECO: Deco[] = [
  { kind: "plant", x: 1, y: 1, w: 1, h: 1, solid: true },
  { kind: "plant", x: 22, y: 1, w: 1, h: 1, solid: true },
  { kind: "plant", x: 1, y: 9, w: 1, h: 1, solid: true },
  { kind: "plant", x: 22, y: 9, w: 1, h: 1, solid: true },
  { kind: "rug", x: 8, y: 7, w: 7, h: 2, solid: false },
  { kind: "shelf", x: 25, y: 1, w: 13, h: 1, solid: true },
  { kind: "shelf", x: 24, y: 9, w: 4, h: 1, solid: true },
  { kind: "shelf", x: 35, y: 9, w: 4, h: 1, solid: true },
  { kind: "lamp", x: 24, y: 1, w: 1, h: 1, solid: true },
  { kind: "counter", x: 1, y: 14, w: 5, h: 1, solid: true },
  { kind: "sofa", x: 2, y: 21, w: 4, h: 1, solid: true },
  { kind: "sofa", x: 7, y: 21, w: 4, h: 1, solid: true },
  { kind: "plant", x: 12, y: 22, w: 1, h: 1, solid: true },
  { kind: "plant", x: 14, y: 22, w: 1, h: 1, solid: true },
  { kind: "plant", x: 23, y: 22, w: 1, h: 1, solid: true },
  { kind: "rug", x: 15, y: 15, w: 8, h: 6, solid: false },
  { kind: "board", x: 26, y: 14, w: 4, h: 1, solid: true },
  { kind: "board", x: 34, y: 14, w: 3, h: 1, solid: true },
  { kind: "plant", x: 12, y: 11, w: 1, h: 1, solid: true },
  { kind: "plant", x: 26, y: 11, w: 1, h: 1, solid: true },
];

export const SPAWN = { x: 20, y: 12 };

function build(): { floor: Floor[][]; solid: boolean[][]; zone: (Zone | null)[][] } {
  const floor: Floor[][] = Array.from({ length: H }, () => Array<Floor>(W).fill("wall"));
  const zone: (Zone | null)[][] = Array.from({ length: H }, () => Array<Zone | null>(W).fill(null));
  for (const r of ROOMS)
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        floor[y][x] = r.floor;
        zone[y][x] = r.zone;
      }
  for (const [x, y] of DOORS) {
    floor[y][x] = "wood";
    zone[y][x] = "corridor";
  }
  const solid = floor.map((row) => row.map((f) => f === "wall"));
  for (const d of DECO) if (d.solid) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) solid[y][x] = true;
  for (const t of TABLES) for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) solid[y][x] = true;
  return { floor, solid, zone };
}

export const MAP = build();

export function walkable(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < W && y < H && !MAP.solid[y][x];
}

/** Can a player (a 0.6-tile box around its centre) stand at this continuous position? */
export function free(px: number, py: number): boolean {
  const r = 0.3;
  for (const [cx, cy] of [[px - r, py - r], [px + r, py - r], [px - r, py + r], [px + r, py + r]]) {
    if (!walkable(Math.floor(cx + 0.5), Math.floor(cy + 0.5))) return false;
  }
  return true;
}

export function zoneAt(x: number, y: number): Zone | null {
  const tx = Math.round(x);
  const ty = Math.round(y);
  return tx >= 0 && ty >= 0 && tx < W && ty < H ? MAP.zone[ty][tx] : null;
}

export function roomName(x: number, y: number): string | null {
  const tx = Math.round(x);
  const ty = Math.round(y);
  return ROOMS.find((r) => tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1)?.name ?? null;
}

export function seatById(id: string): { table: TableDef; seat: Seat } | null {
  for (const table of TABLES) {
    const seat = table.seats.find((s) => s.id === id);
    if (seat) return { table, seat };
  }
  return null;
}

/** The table at or right next to a tile (for clicking on a table). */
export function tableNear(x: number, y: number): TableDef | null {
  return TABLES.find((t) => x >= t.x - 1 && x <= t.x + t.w && y >= t.y - 1 && y <= t.y + t.h) ?? null;
}
