// Draws the campus and moves your character. Light by design: the static campus is drawn
// once; a frame is drawn only when something moves (at most 30 per second); the loop stops
// when nothing does, and whenever the window or the screen is hidden.
import { free, TABLES, tableNear, TILE, W, H, type Dir, type Seat, type TableDef } from "./map";
import { findPath } from "./path";
import { decodeLook } from "./avatar";
import { drawAvatar, drawCampus, paletteFromTheme } from "./sprites";
import { REACTIONS, type Player, type SpaceState } from "./protocol";

const SPEED = 4; // tiles per second
const FRAME_MS = 33;

export interface EngineHooks {
  me: string;
  state: () => SpaceState | null;
  onMove: (x: number, y: number, dir: Dir, moving: boolean) => void;
  /** Reached a seat after a click on a table. */
  onSit: (seat: Seat) => void;
  onStand: () => void;
  onTable: (table: TableDef | null) => void;
}

interface Shown {
  x: number;
  y: number;
}

export class SpaceEngine {
  private ctx: CanvasRenderingContext2D;
  private campus: HTMLCanvasElement;
  private raf = 0;
  private last = 0;
  private keys = new Set<string>();
  private path: Array<{ x: number; y: number }> = [];
  private goal: Seat | null = null;
  private shown = new Map<string, Shown>();
  private step = 0;
  private stepClock = 0;
  private hover: TableDef | null = null;
  private zoom = 3;
  private cam = { x: 0, y: 0 };
  private wasMoving = false;
  private cleanup: Array<() => void> = [];

  constructor(private canvas: HTMLCanvasElement, private hooks: EngineHooks) {
    this.ctx = canvas.getContext("2d")!;
    this.campus = drawCampus(paletteFromTheme());
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return;
      const k = KEYMAP[e.code];
      if (!k) return;
      e.preventDefault();
      if (down) this.keys.add(k);
      else this.keys.delete(k);
      if (down) {
        this.path = [];
        this.goal = null;
        const me = this.me();
        if (me?.seat) this.hooks.onStand();
      }
      this.wake();
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => {
      this.keys.clear();
      this.wake();
    };
    const vis = () => (document.hidden ? this.stop() : this.wake());
    const click = (e: MouseEvent) => this.click(e);
    const move = (e: MouseEvent) => {
      const tile = this.tileAt(e);
      const t = tile ? tableNear(tile.x, tile.y) : null;
      if (t !== this.hover) {
        this.hover = t;
        this.canvas.style.cursor = t ? "pointer" : "default";
        this.wake();
      }
    };
    const resize = new ResizeObserver(() => this.wake());
    resize.observe(canvas);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", vis);
    canvas.addEventListener("click", click);
    canvas.addEventListener("mousemove", move);
    this.cleanup.push(() => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", vis);
      canvas.removeEventListener("click", click);
      canvas.removeEventListener("mousemove", move);
      resize.disconnect();
    });
    this.wake();
  }

  destroy() {
    this.stop();
    window.clearTimeout(this.wakeTimer);
    this.cleanup.forEach((f) => f());
  }

  /** Something changed (network, input, size): draw again, and keep going while it moves. */
  wake() {
    if (!this.raf && !document.hidden) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Walks to the nearest free seat of a table, then sits. */
  goSit(table: TableDef) {
    const st = this.hooks.state();
    const me = this.me();
    if (!st || !me) return;
    const taken = new Set(Object.values(st.players).filter((p) => p.seat && p.fp !== this.hooks.me).map((p) => p.seat));
    const options = table.seats.filter((s) => !taken.has(s.id)).map((s) => ({ s, p: findPath(me, s) })).filter((o) => o.p !== null).sort((a, b) => a.p!.length - b.p!.length);
    if (!options.length) return;
    if (me.seat) this.hooks.onStand();
    this.goal = options[0].s;
    this.path = options[0].p!;
    this.wake();
  }

  private me(): Player | null {
    return this.hooks.state()?.players[this.hooks.me] ?? null;
  }

  private tileAt(e: MouseEvent): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) / this.zoom + this.cam.x;
    const py = (e.clientY - r.top) / this.zoom + this.cam.y;
    const x = Math.floor(px / TILE);
    const y = Math.floor(py / TILE);
    return x >= 0 && y >= 0 && x < W && y < H ? { x, y } : null;
  }

  private click(e: MouseEvent) {
    const tile = this.tileAt(e);
    if (!tile) return;
    const table = tableNear(tile.x, tile.y);
    if (table) {
      this.hooks.onTable(table);
      this.goSit(table);
      return;
    }
    const me = this.me();
    if (!me) return;
    const p = findPath(me, tile);
    if (p) {
      if (me.seat) this.hooks.onStand();
      this.goal = null;
      this.path = p;
      this.wake();
    }
  }

  private frame(t: number) {
    this.raf = 0;
    if (t - this.last < FRAME_MS) {
      this.raf = requestAnimationFrame((n) => this.frame(n));
      return;
    }
    const dt = Math.min(0.1, (t - (this.last || t)) / 1000);
    this.last = t;
    const busy = this.update(dt);
    this.draw();
    if (busy) this.raf = requestAnimationFrame((n) => this.frame(n));
    else this.last = 0;
  }

  /** Returns whether anything is still moving (another frame is needed). */
  private update(dt: number): boolean {
    const me = this.me();
    let moving = false;
    if (me && !me.seat) {
      let dx = 0;
      let dy = 0;
      if (this.keys.has("left")) dx -= 1;
      if (this.keys.has("right")) dx += 1;
      if (this.keys.has("up")) dy -= 1;
      if (this.keys.has("down")) dy += 1;
      if (!dx && !dy && this.path.length) {
        const n = this.path[0];
        const ddx = n.x - me.x;
        const ddy = n.y - me.y;
        const d = Math.hypot(ddx, ddy);
        if (d < 0.08) {
          me.x = n.x;
          me.y = n.y;
          this.path.shift();
          if (!this.path.length && this.goal) {
            this.hooks.onSit(this.goal);
            this.goal = null;
          }
        } else {
          dx = ddx / d;
          dy = ddy / d;
        }
      }
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        const step = SPEED * dt;
        const nx = me.x + (dx / len) * step;
        const ny = me.y + (dy / len) * step;
        // Slide along walls: try each axis on its own.
        if (free(nx, me.y)) me.x = nx;
        if (free(me.x, ny)) me.y = ny;
        me.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        moving = true;
      }
      if (moving || this.wasMoving) this.hooks.onMove(me.x, me.y, me.dir, moving);
    }
    this.wasMoving = moving;
    if (moving) {
      this.stepClock += dt;
      if (this.stepClock > 0.18) {
        this.step++;
        this.stepClock = 0;
      }
    }
    // Others glide to where the host last put them.
    let gliding = false;
    const st = this.hooks.state();
    for (const p of Object.values(st?.players ?? {})) {
      const s = this.shown.get(p.fp) ?? { x: p.x, y: p.y };
      if (p.fp === this.hooks.me) {
        s.x = p.x;
        s.y = p.y;
      } else {
        const k = Math.min(1, dt * 12);
        s.x += (p.x - s.x) * k;
        s.y += (p.y - s.y) * k;
        if (Math.hypot(p.x - s.x, p.y - s.y) > 0.02) gliding = true;
        else {
          s.x = p.x;
          s.y = p.y;
        }
      }
      this.shown.set(p.fp, s);
    }
    for (const fp of [...this.shown.keys()]) if (!st?.players[fp]) this.shown.delete(fp);
    return moving || gliding || this.path.length > 0 || Object.values(st?.players ?? {}).some((p) => p.moving && p.fp !== this.hooks.me);
  }

  private draw() {
    const cv = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const cw = cv.clientWidth;
    const ch = cv.clientHeight;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
      cv.width = Math.round(cw * dpr);
      cv.height = Math.round(ch * dpr);
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.imageSmoothingEnabled = false;
    this.zoom = Math.max(2, Math.min(4, Math.floor(Math.min(ch / (13 * TILE), cw / (20 * TILE)))));
    const z = this.zoom;
    const me = this.me();
    const vw = cw / z;
    const vh = ch / z;
    const target = me ? { x: (me.x + 0.5) * TILE - vw / 2, y: (me.y + 0.5) * TILE - vh / 2 } : { x: 0, y: 0 };
    this.cam.x = Math.round(Math.max(Math.min(target.x, W * TILE - vw), Math.min(0, (W * TILE - vw) / 2)));
    this.cam.y = Math.round(Math.max(Math.min(target.y, H * TILE - vh), Math.min(0, (H * TILE - vh) / 2)));
    c.fillStyle = "#15141a";
    c.fillRect(0, 0, cw, ch);
    c.save();
    c.scale(z, z);
    c.translate(-this.cam.x, -this.cam.y);
    c.drawImage(this.campus, 0, 0);
    if (this.hover) {
      c.strokeStyle = "rgba(255,255,255,0.6)";
      c.lineWidth = 1;
      c.strokeRect(this.hover.x * TILE - 0.5, this.hover.y * TILE - 0.5, this.hover.w * TILE + 1, this.hover.h * TILE + 1);
    }
    const st = this.hooks.state();
    const players = Object.values(st?.players ?? {}).sort((a, b) => (this.shown.get(a.fp)?.y ?? a.y) - (this.shown.get(b.fp)?.y ?? b.y));
    for (const p of players) {
      const s = this.shown.get(p.fp) ?? p;
      drawAvatar(c, decodeLook(p.avatar, p.fp), Math.round(s.x * TILE), Math.round(s.y * TILE) - 4, p.dir, p.moving ? this.step : 0, !!p.seat);
    }
    c.restore();
    // Names, crisp at screen resolution.
    c.font = "500 11px Inter Variable, sans-serif";
    c.textAlign = "center";
    for (const p of players) {
      const s = this.shown.get(p.fp) ?? p;
      const sx = ((s.x + 0.5) * TILE - this.cam.x) * z;
      const sy = (s.y * TILE - 4 - this.cam.y) * z - 4;
      const label = p.nick;
      const w = c.measureText(label).width + 16;
      c.fillStyle = p.fp === this.hooks.me ? "rgba(148,134,255,0.85)" : "rgba(15,15,20,0.75)";
      c.beginPath();
      c.roundRect(sx - w / 2, sy - 14, w, 16, 8);
      c.fill();
      c.fillStyle = STATUS_DOT[p.status] ?? "#9e9e9e";
      if (p.status === "break") {
        // On a break: two small pause bars instead of the dot.
        c.fillRect(sx - w / 2 + 5.5, sy - 9, 2, 6);
        c.fillRect(sx - w / 2 + 8.5, sy - 9, 2, 6);
      } else {
        c.beginPath();
        c.arc(sx - w / 2 + 8, sy - 6, 3, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = "#ffffff";
      c.fillText(label, sx + 4, sy - 2);
      // A reaction floats above the name for a few seconds.
      const r = p.react;
      if (r && Date.now() - r.at < REACT_MS) {
        c.font = "18px sans-serif";
        c.fillText(REACTIONS.find((x) => x.id === r.e)?.emoji ?? "", sx, sy - 20);
        c.font = "500 11px Inter Variable, sans-serif";
        this.wakeAt(r.at + REACT_MS);
      }
    }
    this.drawTables(c, z);
  }

  /** Above each table: its shared focus and what is being listened to there, as small labels. */
  private drawTables(c: CanvasRenderingContext2D, z: number) {
    const st = this.hooks.state();
    if (!st) return;
    c.font = "500 10px Inter Variable, sans-serif";
    c.textAlign = "left";
    for (const def of TABLES) {
      const tb = st.tables[def.id];
      if (!tb) continue;
      const parts: Array<{ text: string; color: string; art?: string | null }> = [];
      if (tb.focus) parts.push({ text: tb.focus.phase === "work" ? `● Focus · ${Math.max(0, Math.ceil((tb.focus.endsAt - Date.now()) / 60_000))} min` : "● Pause", color: tb.focus.phase === "work" ? "#ffb74d" : "#81c784" });
      if (tb.jam) parts.push({ text: "♫ Jam Spotify", color: "#1ed760" });
      const m = tb.music;
      if (m && Date.now() - m.at < 120_000) parts.push({ text: `♪ ${m.title.length > 22 ? `${m.title.slice(0, 21)}…` : m.title}${m.playing ? "" : " (pause)"}`, color: "#e0e0e0", art: m.art });
      if (!parts.length) continue;
      // On the desk itself, centred: the seats around it keep their names visible.
      let y = ((def.y + def.h / 2) * TILE - this.cam.y) * z + (parts.length * 21) / 2 + 2;
      const cx = ((def.x + def.w / 2) * TILE - this.cam.x) * z;
      for (const part of parts.reverse()) {
        const img = part.art ? this.image(part.art) : null;
        const pad = img ? 22 : 8;
        const w = c.measureText(part.text).width + pad + 8;
        c.fillStyle = "rgba(15,15,20,0.8)";
        c.beginPath();
        c.roundRect(cx - w / 2, y - 16, w, 18, 9);
        c.fill();
        if (img) c.drawImage(img, cx - w / 2 + 3, y - 14, 14, 14);
        c.fillStyle = part.color;
        c.fillText(part.text, cx - w / 2 + pad, y - 3);
        y -= 21;
      }
    }
    // Focus minutes change: one redraw a minute while a timer runs.
    if (Object.values(st.tables).some((x) => x.focus)) this.wakeAt(Date.now() + 60_000);
  }

  private images = new Map<string, HTMLImageElement>();
  private image(src: string): HTMLImageElement | null {
    let img = this.images.get(src);
    if (!img) {
      if (this.images.size > 20) this.images.clear();
      img = new Image();
      img.onload = () => this.wake();
      img.src = src;
      this.images.set(src, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  private wakeTimer = 0;
  /** One more frame at `at` (a reaction fading, a minute ticking), without a running loop. */
  private wakeAt(at: number) {
    window.clearTimeout(this.wakeTimer);
    this.wakeTimer = window.setTimeout(() => this.wake(), Math.max(50, at - Date.now()));
  }
}

const REACT_MS = 3500;

const KEYMAP: Record<string, string> = {
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};

const STATUS_DOT: Record<string, string> = { available: "#4caf50", coding: "#9486ff", session: "#29b6f6", dnd: "#ef5350", helping: "#ffb300", invisible: "#9e9e9e", break: "#d7a86e" };

