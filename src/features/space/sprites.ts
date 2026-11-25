// Pixel art drawn by code (no image files): floors, walls, furniture, plants and characters,
// at 16 px per tile. Warm room colours, accents taken from the active TekBoard theme.
import { DECO, H, MAP, TABLES, TILE, W, type Dir, type Floor } from "./map";
import { ACCESSORIES, HAIR_COLORS, OUTFIT_COLORS, SKINS, type Look } from "./avatar";

export interface Palette {
  accent: string;
  accentSoft: string;
  wall: string;
  wallTop: string;
  wood: [string, string];
  carpet: [string, string];
  tile: [string, string];
  library: [string, string];
  focus: [string, string];
  meeting: [string, string];
}

/** Colours read from the theme's CSS variables (falls back on the default theme's). */
export function paletteFromTheme(): Palette {
  const css = typeof window !== "undefined" ? getComputedStyle(document.documentElement) : null;
  const v = (name: string, fb: string) => css?.getPropertyValue(name).trim() || fb;
  const accent = v("--color-accent", "#9486ff");
  return {
    accent,
    accentSoft: v("--color-accent-soft", "#2c2848"),
    wall: "#2a2633",
    wallTop: "#3a3446",
    wood: ["#8a5f3c", "#7c5434"],
    carpet: ["#4d5468", "#475063"],
    tile: ["#d8d0c2", "#c9c0b0"],
    library: ["#6b4d38", "#614532"],
    focus: ["#3f5e57", "#3a5751"],
    meeting: ["#5a5470", "#544e69"],
  };
}

function floorColors(p: Palette, f: Floor): [string, string] {
  return f === "wood" ? p.wood : f === "carpet" ? p.carpet : f === "tile" ? p.tile : f === "library" ? p.library : f === "focus" ? p.focus : f === "meeting" ? p.meeting : [p.wall, p.wall];
}

function rect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
}

/** The static campus (floors, walls, furniture), drawn once at 1 px per pixel. */
export function drawCampus(p: Palette): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = W * TILE;
  cv.height = H * TILE;
  const c = cv.getContext("2d")!;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const f = MAP.floor[y][x];
      const px = x * TILE;
      const py = y * TILE;
      if (f === "wall") {
        rect(c, px, py, TILE, TILE, p.wall);
        // The wall face shows where a floor lies below it.
        if (y + 1 < H && MAP.floor[y + 1][x] !== "wall") {
          rect(c, px, py + 6, TILE, 10, p.wallTop);
          rect(c, px, py + 14, TILE, 2, "#00000040");
        }
        continue;
      }
      const [a, b] = floorColors(p, f);
      rect(c, px, py, TILE, TILE, a);
      if (f === "wood" || f === "library") {
        // Planks.
        rect(c, px, py + ((x % 2) * 8), TILE, 1, b);
        rect(c, px + ((y % 3) * 5), py, 1, TILE, b);
      } else if (f === "tile") {
        if ((x + y) % 2) rect(c, px, py, TILE, TILE, b);
      } else {
        for (let i = 0; i < 4; i++) rect(c, px + ((i * 5 + y * 3) % 15), py + ((i * 7 + x * 5) % 15), 1, 1, b);
      }
    }
  for (const d of DECO) {
    const px = d.x * TILE;
    const py = d.y * TILE;
    const w = d.w * TILE;
    const h = d.h * TILE;
    switch (d.kind) {
      case "rug":
        rect(c, px + 2, py + 2, w - 4, h - 4, p.accentSoft);
        c.strokeStyle = p.accent;
        c.globalAlpha = 0.5;
        c.strokeRect(px + 4.5, py + 4.5, w - 9, h - 9);
        c.globalAlpha = 1;
        break;
      case "plant":
        rect(c, px + 5, py + 10, 6, 5, "#a0522d");
        rect(c, px + 4, py + 9, 8, 2, "#8b4513");
        for (const [lx, ly, lw, lh] of [[3, 3, 4, 6], [8, 1, 4, 8], [5, 0, 3, 5], [10, 4, 3, 5]]) rect(c, px + lx, py + ly, lw, lh, "#2f8f4e");
        rect(c, px + 7, py + 2, 2, 3, "#3fb36a");
        break;
      case "shelf":
        rect(c, px, py, w, h, "#5a3a22");
        for (let i = 0; i < d.w; i++) {
          const colors = ["#c0392b", "#2980b9", "#27ae60", "#f1c40f", "#8e44ad", "#e67e22"];
          for (let j = 0; j < 5; j++) rect(c, px + i * TILE + 1 + j * 3, py + 2, 2, 5 + ((i + j) % 3), colors[(i * 5 + j) % colors.length]);
          for (let j = 0; j < 5; j++) rect(c, px + i * TILE + 1 + j * 3, py + 9, 2, 5 - ((i + j) % 2), colors[(i * 3 + j + 2) % colors.length]);
        }
        rect(c, px, py + 7, w, 1, "#3e2716");
        break;
      case "counter":
        rect(c, px, py + 2, w, h - 2, "#6d4c3d");
        rect(c, px, py + 2, w, 3, "#a1887f");
        rect(c, px + 4, py - 2, 6, 8, "#37474f");
        rect(c, px + 6, py, 2, 2, "#ef5350");
        for (let i = 2; i < d.w; i++) rect(c, px + i * TILE + 5, py + 4, 5, 4, "#eceff1");
        break;
      case "sofa":
        rect(c, px, py + 3, w, h - 3, p.accent);
        rect(c, px, py + 3, w, 4, "#00000030");
        rect(c, px - 1, py + 5, 3, h - 5, p.accent);
        rect(c, px + w - 2, py + 5, 3, h - 5, p.accent);
        break;
      case "board":
        rect(c, px + 1, py + 2, w - 2, h - 4, "#f5f5f5");
        c.strokeStyle = "#90a4ae";
        c.strokeRect(px + 1.5, py + 2.5, w - 3, h - 5);
        rect(c, px + 5, py + 6, 10, 1, "#1e88e5");
        rect(c, px + 18, py + 8, 8, 1, "#e53935");
        break;
      case "lamp":
        rect(c, px + 7, py + 4, 2, 11, "#455a64");
        rect(c, px + 4, py + 1, 8, 4, "#ffd54f");
        break;
    }
  }
  for (const t of TABLES) {
    const px = t.x * TILE;
    const py = t.y * TILE;
    const w = t.w * TILE;
    const h = t.h * TILE;
    const round = t.zone === "cafe";
    rect(c, px + 1, py + 3, w - 2, h - 3, "#00000035");
    rect(c, px + 1, py + 1, w - 2, h - 4, round ? "#d7ccc8" : "#a1887f");
    rect(c, px + 1, py + 1, w - 2, 2, round ? "#efebe9" : "#bcaaa4");
    if (!round) {
      // A laptop or two on desks and meeting tables.
      for (let i = 0; i < Math.floor(t.w / 2); i++) {
        rect(c, px + 4 + i * 2 * TILE, py + 5, 9, 6, "#263238");
        rect(c, px + 5 + i * 2 * TILE, py + 6, 7, 4, "#4fc3f7");
      }
    } else {
      rect(c, px + 10, py + 10, 4, 4, "#ffffff");
      rect(c, px + 11, py + 11, 2, 2, "#6d4c41");
    }
    for (const s of t.seats) rect(c, s.x * TILE + 3, s.y * TILE + 4, 10, 9, "#5d4037");
  }
  return cv;
}

const PANTS = "#2d3142";

/** A character, 16×16, facing `dir`; `step` alternates the legs while walking. */
export function drawAvatar(c: CanvasRenderingContext2D, look: Look, x: number, y: number, dir: Dir, step: number, seated: boolean) {
  const skin = SKINS[look.skin];
  const hair = HAIR_COLORS[look.hairColor];
  const cloth = OUTFIT_COLORS[look.outfitColor];
  // Shadow.
  c.fillStyle = "#00000040";
  c.fillRect(x + 4, y + 14, 8, 2);
  // Legs.
  if (!seated) {
    const a = step % 2 === 0 ? 0 : 1;
    rect(c, x + 5, y + 11 + a, 2, 4 - a, PANTS);
    rect(c, x + 9, y + 11 + (1 - a), 2, 4 - (1 - a), PANTS);
  } else {
    rect(c, x + 5, y + 11, 6, 2, PANTS);
  }
  // Body.
  const dress = look.outfit === 4;
  rect(c, x + 4, y + 7, 8, dress ? 6 : 5, cloth);
  if (look.outfit === 2) rect(c, x + 7, y + 7, 2, 4, "#ffffff");
  if (look.outfit === 3) {
    rect(c, x + 4, y + 7, 2, 5, "#00000040");
    rect(c, x + 10, y + 7, 2, 5, "#00000040");
  }
  if (look.outfit === 1) rect(c, x + 5, y + 10, 6, 1, "#00000030");
  // Arms.
  rect(c, x + 3, y + 8, 1, 3, skin);
  rect(c, x + 12, y + 8, 1, 3, skin);
  // Head.
  rect(c, x + 4, y + 1, 8, 7, skin);
  // Eyes.
  c.fillStyle = "#1b1b1b";
  if (dir === "down") {
    c.fillRect(x + 6, y + 4, 1, 2);
    c.fillRect(x + 9, y + 4, 1, 2);
  } else if (dir === "left") c.fillRect(x + 5, y + 4, 1, 2);
  else if (dir === "right") c.fillRect(x + 10, y + 4, 1, 2);
  // Hair.
  switch (look.hair) {
    case 0:
      rect(c, x + 4, y, 8, 3, hair);
      break;
    case 1:
      rect(c, x + 3, y, 10, 3, hair);
      rect(c, x + 3, y + 3, 2, dir === "up" ? 6 : 5, hair);
      rect(c, x + 11, y + 3, 2, dir === "up" ? 6 : 5, hair);
      if (dir === "up") rect(c, x + 4, y + 3, 8, 5, hair);
      break;
    case 2:
      rect(c, x + 4, y, 8, 3, hair);
      rect(c, x + 6, y - 2, 4, 3, hair);
      break;
    case 3:
      for (let i = 0; i < 4; i++) rect(c, x + 4 + i * 2, y - 1 + (i % 2), 2, 3, hair);
      break;
    case 4:
      rect(c, x + 4, y + 1, 8, 1, hair);
      break;
    case 5:
      rect(c, x + 3, y, 10, 3, cloth);
      rect(c, dir === "left" ? x + 1 : x + 9, y + 2, 5, 1, cloth);
      break;
  }
  if (dir === "up" && look.hair !== 1 && look.hair !== 4) rect(c, x + 4, y + 2, 8, 4, hair);
  // Accessory.
  switch (ACCESSORIES[look.accessory] ? look.accessory : 0) {
    case 1:
      if (dir !== "up") {
        c.fillStyle = "#111111";
        c.fillRect(x + 5, y + 4, 6, 1);
      }
      break;
    case 2:
      rect(c, x + 3, y + 3, 1, 3, "#212121");
      rect(c, x + 12, y + 3, 1, 3, "#212121");
      rect(c, x + 4, y, 8, 1, "#212121");
      break;
    case 3:
      rect(c, x + 4, y + 7, 8, 2, "#e53935");
      break;
    case 4:
      rect(c, x + 3, y - 1, 10, 3, "#5e35b1");
      rect(c, x + 7, y - 2, 2, 1, "#ffffff");
      break;
  }
}
