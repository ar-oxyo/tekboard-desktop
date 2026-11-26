// The host of a TekSpace: keeps the one true state and applies what participants ask, within
// the rules (no walking through walls, no teleporting, one person per seat, reserved tables).
// It only talks through a `Transport`, so the same code could run on a standalone server.
import { free, H, seatById, SPAWN, TABLES, W } from "./map";
import { MOVE_EVERY, SPACE_VERSION, type ClientMsg, type HostMsg, type Player, type PlayerTick, type SpaceState, type TableState } from "./protocol";
import { check, refusal } from "../../lib/moderation";

export interface Transport {
  send(fp: string, msg: HostMsg): void;
  /** To every participant except `except`. */
  broadcast(msg: HostMsg, except?: string): void;
}

/** Tiles per second a walker can cover (with some slack for network jitter). */
const MAX_SPEED = 9;
const MAX_PLAYERS = 40;

export function emptyTable(id: string): TableState {
  return { id, owner: null, privacy: "open", members: [], topic: "", goals: {}, focus: null, ambience: null, jam: null, pins: [], board: null, chat: [], music: null };
}

/** Lines of chat kept per table, and the shortest gaps between messages and reactions (ms). */
const CHAT_KEEP = 50;
const CHAT_EVERY = 700;
const REACT_EVERY = 2000;

export class SpaceHost {
  state: SpaceState;
  private lastMove = new Map<string, number>();
  private dirtyTicks = new Set<string>();

  constructor(
    id: string,
    name: string,
    host: Player,
    private transport: Transport,
    private now: () => number = Date.now,
  ) {
    this.state = { v: SPACE_VERSION, id, name, host: host.fp, players: { [host.fp]: { ...host, x: SPAWN.x, y: SPAWN.y } }, tables: Object.fromEntries(TABLES.map((t) => [t.id, emptyTable(t.id)])) };
  }

  get count(): number {
    return Object.keys(this.state.players).length;
  }

  private changed(except?: string) {
    this.transport.broadcast({ t: "space.state", state: this.state }, except);
  }

  /** Positions that moved since the last call, as one message (sent at most every MOVE_EVERY ms by the caller). */
  flushTicks(): PlayerTick[] {
    const out: PlayerTick[] = [];
    for (const fp of this.dirtyTicks) {
      const p = this.state.players[fp];
      if (p) out.push([fp, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, p.dir, p.moving, p.seat]);
    }
    this.dirtyTicks.clear();
    if (out.length) this.transport.broadcast({ t: "space.ticks", space: this.state.id, players: out });
    return out;
  }

  private canUse(table: TableState, fp: string): boolean {
    return table.privacy === "open" || table.owner === fp || table.members.includes(fp) || fp === this.state.host;
  }

  private standUp(p: Player) {
    if (!p.seat) return;
    const found = seatById(p.seat);
    p.seat = null;
    if (!found) return;
    const t = this.state.tables[found.table.id];
    delete t.goals[p.fp];
    const seated = Object.values(this.state.players).some((o) => o.seat && seatById(o.seat)?.table.id === t.id);
    if (!seated) {
      // Last one out: the table is free again.
      this.state.tables[t.id] = emptyTable(t.id);
    }
  }

  /** Someone left (or their connection did). */
  remove(fp: string) {
    const p = this.state.players[fp];
    if (!p || fp === this.state.host) return;
    this.standUp(p);
    // Their board session ends with them.
    for (const table of Object.values(this.state.tables)) if (table.board?.host === fp) table.board = null;
    delete this.state.players[fp];
    this.lastMove.delete(fp);
    this.changed();
  }

  /** A public text that fails moderation: its author is told why, nobody else sees it. */
  private refuse(fp: string, ...texts: string[]): boolean {
    for (const text of texts) {
      const v = check(text);
      if (!v.ok) {
        this.transport.send(fp, { t: "space.refused", space: this.state.id, reason: refusal(v) ?? "" });
        return true;
      }
    }
    return false;
  }

  /** Applies a checked client message. Returns false when refused. */
  handle(fp: string, msg: ClientMsg): boolean {
    if (msg.space !== this.state.id) return false;
    const p = this.state.players[fp];
    // Every text others will see is moderated here, on the host: a client cannot skip it.
    if ((msg.t === "space.join" || msg.t === "space.profile") && this.refuse(fp, msg.nick)) msg = { ...msg, nick: "Invité" };
    if (msg.t === "space.table" && msg.topic !== undefined && this.refuse(fp, msg.topic)) return false;
    if (msg.t === "space.goal" && this.refuse(fp, msg.text)) return false;
    if (msg.t === "space.pin" && this.refuse(fp, msg.title, msg.text)) return false;
    if (msg.t === "space.board" && msg.board && this.refuse(fp, msg.board.name)) return false;
    if (msg.t === "space.say" && this.refuse(fp, msg.text)) return false;
    if (msg.t === "space.music" && msg.music && this.refuse(fp, msg.music.title, msg.music.artist)) return false;
    if (msg.t === "space.join") {
      if (msg.v !== SPACE_VERSION) {
        this.transport.send(fp, { t: "space.bye", space: this.state.id, reason: `version ${msg.v} ≠ ${SPACE_VERSION} : mettez TekBoard à jour tous les deux` });
        return false;
      }
      if (!p && this.count >= MAX_PLAYERS) {
        this.transport.send(fp, { t: "space.bye", space: this.state.id, reason: "espace complet" });
        return false;
      }
      this.state.players[fp] = { fp, nick: msg.nick, avatar: msg.avatar, status: msg.status, x: p?.x ?? SPAWN.x, y: p?.y ?? SPAWN.y, dir: "down", moving: false, seat: p?.seat ?? null };
      this.transport.send(fp, { t: "space.welcome", state: this.state });
      this.changed(fp);
      return true;
    }
    if (!p) return false;
    switch (msg.t) {
      case "space.leave":
        this.remove(fp);
        return true;
      case "space.profile":
        Object.assign(p, { nick: msg.nick, avatar: msg.avatar, status: msg.status });
        this.changed();
        return true;
      case "space.move": {
        if (p.seat) return false;
        const t = this.now();
        const last = this.lastMove.get(fp) ?? t - 1000;
        const dt = Math.max(MOVE_EVERY, t - last) / 1000;
        const dist = Math.hypot(msg.x - p.x, msg.y - p.y);
        const x = Math.min(W - 1, Math.max(0, msg.x));
        const y = Math.min(H - 1, Math.max(0, msg.y));
        if (dist > MAX_SPEED * dt + 0.5 || !free(x, y)) {
          // Refused: put them back where the host has them.
          this.transport.send(fp, { t: "space.ticks", space: this.state.id, players: [[fp, p.x, p.y, p.dir, false, p.seat]] });
          return false;
        }
        this.lastMove.set(fp, t);
        Object.assign(p, { x, y, dir: msg.dir, moving: msg.moving });
        this.dirtyTicks.add(fp);
        return true;
      }
      case "space.sit": {
        const found = seatById(msg.seat);
        if (!found) return false;
        const table = this.state.tables[found.table.id];
        if (!this.canUse(table, fp)) return false;
        if (Object.values(this.state.players).some((o) => o.seat === msg.seat && o.fp !== fp)) return false;
        if (Math.hypot(found.seat.x - p.x, found.seat.y - p.y) > 2.5) return false;
        this.standUp(p);
        p.seat = msg.seat;
        p.x = found.seat.x;
        p.y = found.seat.y;
        p.dir = found.seat.dir;
        p.moving = false;
        if (!table.owner) table.owner = fp;
        this.changed();
        return true;
      }
      case "space.stand":
        this.standUp(p);
        this.changed();
        return true;
      case "space.react": {
        const t = this.now();
        if (p.react && t - p.react.at < REACT_EVERY) return false;
        p.react = { e: msg.react, at: t };
        this.changed();
        return true;
      }
      default:
        break;
    }
    // Table actions: only for people seated at that table.
    const table = this.state.tables["table" in msg ? msg.table : ""];
    if (!table || !p.seat || seatById(p.seat)?.table.id !== table.id) return false;
    const owner = table.owner === fp || fp === this.state.host;
    switch (msg.t) {
      case "space.table":
        if (!owner) return false;
        if (msg.topic !== undefined) table.topic = msg.topic;
        if (msg.privacy) table.privacy = msg.privacy;
        if (msg.members) table.members = msg.members;
        if (msg.jam !== undefined) table.jam = msg.jam;
        break;
      case "space.goal":
        if (msg.text.trim()) table.goals[fp] = { text: msg.text, done: msg.done };
        else delete table.goals[fp];
        break;
      case "space.focus":
        table.focus = msg.action === "start" ? { phase: "work", endsAt: this.now() + (msg.workMin ?? 25) * 60_000, workMin: msg.workMin ?? 25, breakMin: msg.breakMin ?? 5, cycle: 1, by: fp } : null;
        break;
      case "space.ambience":
        table.ambience = msg.sound ? { sound: msg.sound, since: this.now() } : null;
        break;
      case "space.pin":
        if (table.pins.length >= 20) return false;
        table.pins.push({ by: fp, title: msg.title, text: msg.text, at: this.now() });
        break;
      case "space.board":
        // Anyone seated may open the table's board; only its host or the table owner closes it.
        if (msg.board) {
          if (table.board && table.board.host !== fp && !owner) return false;
          table.board = { ...msg.board, host: fp, hostNick: p.nick };
        } else {
          if (!table.board || (table.board.host !== fp && !owner)) return false;
          table.board = null;
        }
        break;
      case "space.unpin": {
        const pin = table.pins[msg.index];
        if (!pin || !(owner || pin.by === fp)) return false;
        table.pins.splice(msg.index, 1);
        break;
      }
      case "space.say": {
        const t = this.now();
        const chat = (table.chat ??= []);
        const last = chat.filter((l) => l.by === fp).at(-1);
        if (last && t - last.at < CHAT_EVERY) return false;
        chat.push({ by: fp, nick: p.nick, text: msg.text, at: t });
        if (chat.length > CHAT_KEEP) chat.splice(0, chat.length - CHAT_KEEP);
        break;
      }
      case "space.music":
        // One shared listening per table: whoever shares it, or the table owner, may stop it.
        if (!msg.music) {
          if (table.music && table.music.by !== fp && !owner) return false;
          table.music = null;
        } else {
          if (table.music && table.music.by !== fp && this.now() - table.music.at < 90_000) return false;
          // The cover travels only when the track changes: otherwise the host keeps the one it has.
          const sameTrack = table.music?.by === fp && table.music.title === msg.music.title && table.music.artist === msg.music.artist;
          table.music = { ...msg.music, art: msg.music.art ?? (sameTrack ? (table.music?.art ?? null) : null), by: fp, byNick: p.nick };
        }
        break;
      default:
        return false;
    }
    this.changed();
    return true;
  }

  /** Moves shared focus timers to their next phase. Call every second while some run. */
  tick(): boolean {
    const t = this.now();
    let any = false;
    for (const table of Object.values(this.state.tables)) {
      const f = table.focus;
      if (!f || t < f.endsAt) continue;
      any = true;
      if (f.phase === "work") table.focus = { ...f, phase: "break", endsAt: t + f.breakMin * 60_000 };
      else table.focus = { ...f, phase: "work", endsAt: t + f.workMin * 60_000, cycle: f.cycle + 1 };
    }
    if (any) this.changed();
    return Object.values(this.state.tables).some((x) => x.focus);
  }
}
