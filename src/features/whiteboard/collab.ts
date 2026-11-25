// Drawing on a board together over TekBoard Connect. The person whose board it is hosts the
// session: they invite people, decide who may draw (edit) or only watch (view), and their
// copy is the one kept. Only changed elements travel (never a picture of the board), in
// bounded messages; images are fetched when missing. Remote changes are applied without
// entering your undo history, so Ctrl+Z only undoes your own strokes.
import { api, type BoardFile } from "../../lib/api";
import { changedSince, sanitizeRemote } from "../../lib/boards";
import { SERIES_COLORS } from "../../lib/charts";
import { useBoardBus, type BoardInvite } from "./bus";

export type Mode = "edit" | "view";

export interface Participant {
  fp: string;
  nick: string;
  color: string;
  mode: Mode;
}

export interface Pointer {
  fp: string;
  x: number;
  y: number;
  tool: "pointer" | "laser";
  selected: string[];
  at: number;
}

/** What the session needs from the editor (Excalidraw behind it). */
export interface SceneAdapter {
  elements(): ReadonlyArray<{ id: string; version: number; type: string; fileId?: string | null; isDeleted?: boolean; customData?: Record<string, unknown> }>;
  /** Merges remote elements (newer versions win) without touching the local undo history. */
  apply(elements: Array<Record<string, unknown>>): void;
  files(): Record<string, BoardFile>;
  addFiles(files: BoardFile[]): void;
  /** Moves the view to what a presenter shows. */
  setView(v: { scrollX: number; scrollY: number; zoom: number }): void;
}

export interface SessionState {
  role: "host" | "guest";
  session: string;
  name: string;
  host: string;
  mode: Mode;
  participants: Participant[];
  pointers: Pointer[];
  presenter: string | null;
  following: string | null;
  /** Guest: joined, the host has not answered yet. */
  waiting: boolean;
  lost: boolean;
  error: string | null;
}

// Connect refuses text messages over 256 KiB (in bytes): stay well under it.
const CHUNK = 180 * 1024;
const utf8 = new TextEncoder();
const FILE_CHUNK = 180 * 1024;
const MAX_FILE = 4 * 1024 * 1024 * 1.4;
const JOIN_TIMEOUT = 10_000;

function send(fp: string, msg: Record<string, unknown>) {
  return api.sessionSend(fp, msg).catch(() => undefined);
}

/** Splits elements into messages that each stay under the Connect size limit (UTF-8 bytes). */
export function chunks(elements: Array<Record<string, unknown>>, limit = CHUNK): Array<Array<Record<string, unknown>>> {
  const out: Array<Array<Record<string, unknown>>> = [];
  let cur: Array<Record<string, unknown>> = [];
  let size = 0;
  for (const e of elements) {
    const n = utf8.encode(JSON.stringify(e)).length;
    if (n > limit) continue;
    if (size + n > limit && cur.length) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(e);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

export class BoardSession {
  state: SessionState;
  private known = new Map<string, number>();
  private sentFiles = new Set<string>();
  private asked = new Set<string>();
  private incomingFiles = new Map<string, { mimeType: string; parts: string[]; got: number }>();
  private allowed = new Set<string>();
  private lastPointer = 0;
  private lastView = 0;
  private flushTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private joinTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor(
    role: "host" | "guest",
    session: string,
    name: string,
    host: string,
    private me: { fp: string; nick: string },
    private scene: SceneAdapter,
    private onState: (s: SessionState) => void,
    /** Host only: may this device join without an invitation (a TekSpace table member)? */
    private mayJoin: (fp: string) => boolean = () => false,
  ) {
    this.state = { role, session, name, host, mode: "edit", participants: role === "host" ? [{ fp: me.fp, nick: me.nick, color: SERIES_COLORS[0], mode: "edit" }] : [], pointers: [], presenter: null, following: null, waiting: role === "guest", lost: false, error: null };
    useBoardBus.setState({ handler: (from, msg) => this.incoming(from, msg) });
  }

  static host(boardId: string, name: string, me: { fp: string; nick: string }, scene: SceneAdapter, onState: (s: SessionState) => void, mayJoin?: (fp: string) => boolean): BoardSession {
    const s = new BoardSession("host", `${boardId}@${me.fp.slice(0, 12)}`, name, me.fp, me, scene, onState, mayJoin);
    for (const e of scene.elements()) s.known.set(e.id, e.version);
    return s;
  }

  static join(inv: BoardInvite, me: { fp: string; nick: string }, scene: SceneAdapter, onState: (s: SessionState) => void): BoardSession {
    const s = new BoardSession("guest", inv.session, inv.name, inv.host, me, scene, onState);
    s.state.mode = "view";
    s.rejoin();
    return s;
  }

  private changed() {
    this.onState({ ...this.state, participants: [...this.state.participants], pointers: [...this.state.pointers] });
  }

  private others(): string[] {
    return this.state.participants.map((p) => p.fp).filter((fp) => fp !== this.me.fp);
  }

  private toAll(msg: Record<string, unknown>, except?: string) {
    const to = this.others().filter((fp) => fp !== except);
    if (to.length) void api.sessionBroadcast(to, msg).catch(() => undefined);
  }

  // ── host
  invite(fp: string, hostNick: string) {
    this.allowed.add(fp);
    void send(fp, { t: "board.invite", session: this.state.session, name: this.state.name, hostNick });
  }

  setMode(fp: string, mode: Mode) {
    const p = this.state.participants.find((x) => x.fp === fp);
    if (!p || this.state.role !== "host") return;
    p.mode = mode;
    void send(fp, { t: "board.perm", session: this.state.session, mode });
    this.toAll({ t: "board.people", session: this.state.session, participants: this.state.participants });
    this.changed();
  }

  remove(fp: string) {
    if (this.state.role !== "host") return;
    this.state.participants = this.state.participants.filter((p) => p.fp !== fp);
    this.state.pointers = this.state.pointers.filter((p) => p.fp !== fp);
    this.allowed.delete(fp);
    void send(fp, { t: "board.bye", session: this.state.session, reason: "retiré par l'hôte" });
    this.toAll({ t: "board.people", session: this.state.session, participants: this.state.participants });
    this.changed();
  }

  private sendAll(fp: string) {
    const all = this.scene.elements().map((e) => e as unknown as Record<string, unknown>);
    for (const part of chunks(all)) void send(fp, { t: "board.ops", session: this.state.session, elements: part });
  }

  private sendFile(fp: string, f: BoardFile) {
    const parts = Math.max(1, Math.ceil(f.dataURL.length / FILE_CHUNK));
    for (let i = 0; i < parts; i++) void send(fp, { t: "board.file", session: this.state.session, id: f.id, mimeType: f.mimeType, part: i, parts, data: f.dataURL.slice(i * FILE_CHUNK, (i + 1) * FILE_CHUNK) });
  }

  // ── both
  /** The local scene changed: send what is new (coalesced, at most every 100 ms). */
  localChanged() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = 0;
      this.flush();
    }, 100);
  }

  private flush() {
    if (this.state.role === "guest" && (this.state.mode !== "edit" || this.state.lost)) return;
    // An Artix proposal stays local until it is kept.
    const changed = changedSince(this.scene.elements(), this.known).filter((e) => !e.customData?.tekPreview);
    if (!changed.length) return;
    for (const e of changed) this.known.set(e.id, e.version);
    const payload = changed as unknown as Array<Record<string, unknown>>;
    for (const part of chunks(payload)) {
      const msg = { t: "board.ops", session: this.state.session, elements: part };
      if (this.state.role === "host") this.toAll(msg);
      else void send(this.state.host, msg);
    }
    // Images a guest added go to the host (who keeps the board).
    if (this.state.role === "guest") {
      const files = this.scene.files();
      for (const e of changed) {
        const fid = e.fileId;
        if (fid && files[fid] && !this.sentFiles.has(fid)) {
          this.sentFiles.add(fid);
          this.sendFile(this.state.host, files[fid]);
        }
      }
    }
  }

  pointer(x: number, y: number, tool: "pointer" | "laser", selected: string[]) {
    const now = Date.now();
    if (now - this.lastPointer < 50) return;
    this.lastPointer = now;
    const msg = { t: "board.cursor", session: this.state.session, x: Math.round(x), y: Math.round(y), tool, selected: selected.slice(0, 50) };
    if (this.state.role === "host") this.toAll({ ...msg, fp: this.me.fp });
    else void send(this.state.host, msg);
  }

  /** Presenting: others who follow you see what you see. */
  present(on: boolean) {
    const msg = { t: "board.present", session: this.state.session, fp: this.me.fp, on };
    this.state.presenter = on ? this.me.fp : this.state.presenter === this.me.fp ? null : this.state.presenter;
    if (this.state.role === "host") this.toAll(msg);
    else void send(this.state.host, msg);
    this.changed();
  }

  view(v: { scrollX: number; scrollY: number; zoom: number }) {
    if (this.state.presenter !== this.me.fp) return;
    const now = Date.now();
    if (now - this.lastView < 120) return;
    this.lastView = now;
    const msg = { t: "board.view", session: this.state.session, fp: this.me.fp, ...v };
    if (this.state.role === "host") this.toAll(msg);
    else void send(this.state.host, msg);
  }

  follow(fp: string | null) {
    this.state.following = fp;
    this.changed();
  }

  rejoin() {
    if (this.state.role !== "guest") return;
    this.state.lost = false;
    this.state.waiting = true;
    this.state.error = null;
    clearTimeout(this.joinTimer);
    this.joinTimer = setTimeout(() => {
      if (!this.state.waiting) return;
      this.state.waiting = false;
      this.state.lost = true;
      this.state.error = "L'hôte ne répond pas : il a peut-être fermé le tableau.";
      this.changed();
    }, JOIN_TIMEOUT);
    void send(this.state.host, { t: "board.join", session: this.state.session, nick: this.me.nick });
    this.changed();
  }

  leave() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    clearTimeout(this.joinTimer);
    if (this.state.role === "host") this.toAll({ t: "board.bye", session: this.state.session, reason: "l'hôte a fermé le tableau" });
    else void send(this.state.host, { t: "board.leave", session: this.state.session });
    if (useBoardBus.getState().handler) useBoardBus.setState({ handler: null });
  }

  private requestMissing(elements: Array<Record<string, unknown>>) {
    const files = this.scene.files();
    const missing = elements.map((e) => e.fileId).filter((id): id is string => typeof id === "string" && !files[id] && !this.asked.has(id));
    if (!missing.length) return;
    missing.forEach((id) => this.asked.add(id));
    void send(this.state.host, { t: "board.file.request", session: this.state.session, ids: missing.slice(0, 50) });
  }

  private receiveFile(msg: Record<string, unknown>): BoardFile | null {
    const id = String(msg.id ?? "");
    const mimeType = String(msg.mimeType ?? "");
    const parts = Number(msg.parts ?? 0);
    const part = Number(msg.part ?? -1);
    if (!/^[\w-]{1,80}$/.test(id) || !["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"].includes(mimeType) || !(parts >= 1 && parts <= 40) || !(part >= 0 && part < parts) || typeof msg.data !== "string") return null;
    const cur = this.incomingFiles.get(id) ?? { mimeType, parts: Array<string>(parts).fill(""), got: 0 };
    if (!cur.parts[part]) {
      cur.parts[part] = msg.data;
      cur.got++;
    }
    this.incomingFiles.set(id, cur);
    if (cur.got < parts) return null;
    this.incomingFiles.delete(id);
    const dataURL = cur.parts.join("");
    if (!dataURL.startsWith(`data:${mimeType};base64,`) || dataURL.length > MAX_FILE) return null;
    return { id, mimeType, dataURL, created: Date.now() };
  }

  incoming(from: string, msg: Record<string, unknown>) {
    const t = String(msg.t ?? "");
    if (t === "connect.gone") {
      if (this.state.role === "host" && this.state.participants.some((p) => p.fp === from)) {
        this.state.participants = this.state.participants.filter((p) => p.fp !== from);
        this.state.pointers = this.state.pointers.filter((p) => p.fp !== from);
        this.toAll({ t: "board.people", session: this.state.session, participants: this.state.participants });
        this.changed();
      } else if (this.state.role === "guest" && from === this.state.host) {
        this.state.lost = true;
        this.changed();
      }
      return;
    }
    if (msg.session !== this.state.session) return;
    if (this.state.role === "host") return this.hostIncoming(from, t, msg);
    if (from !== this.state.host) return;
    switch (t) {
      case "board.welcome":
        this.state.name = String(msg.name ?? this.state.name);
        this.state.mode = msg.mode === "edit" ? "edit" : "view";
        this.state.participants = Array.isArray(msg.participants) ? (msg.participants as Participant[]) : [];
        this.state.lost = false;
        this.state.waiting = false;
        clearTimeout(this.joinTimer);
        this.changed();
        break;
      case "board.ops": {
        const els = sanitizeRemote(msg.elements);
        for (const e of els) this.known.set(String(e.id), Number(e.version));
        this.scene.apply(els);
        this.requestMissing(els);
        break;
      }
      case "board.file": {
        const f = this.receiveFile(msg);
        if (f) this.scene.addFiles([f]);
        break;
      }
      case "board.cursor":
        this.cursor(String(msg.fp ?? ""), msg);
        break;
      case "board.people":
        if (Array.isArray(msg.participants)) this.state.participants = msg.participants as Participant[];
        this.changed();
        break;
      case "board.perm":
        this.state.mode = msg.mode === "edit" ? "edit" : "view";
        this.changed();
        break;
      case "board.present":
        this.state.presenter = msg.on ? String(msg.fp) : this.state.presenter === msg.fp ? null : this.state.presenter;
        this.changed();
        break;
      case "board.view":
        if (this.state.following && msg.fp === this.state.following) this.scene.setView({ scrollX: Number(msg.scrollX) || 0, scrollY: Number(msg.scrollY) || 0, zoom: Number(msg.zoom) || 1 });
        break;
      case "board.bye":
        clearTimeout(this.joinTimer);
        this.state.waiting = false;
        this.state.lost = true;
        this.state.error = String(msg.reason ?? "");
        this.changed();
        break;
    }
  }

  private cursor(fp: string, msg: Record<string, unknown>) {
    if (!fp || fp === this.me.fp) return;
    const p: Pointer = { fp, x: Number(msg.x) || 0, y: Number(msg.y) || 0, tool: msg.tool === "laser" ? "laser" : "pointer", selected: Array.isArray(msg.selected) ? (msg.selected as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 50) : [], at: Date.now() };
    this.state.pointers = [...this.state.pointers.filter((x) => x.fp !== fp), p];
    this.changed();
  }

  private hostIncoming(from: string, t: string, msg: Record<string, unknown>) {
    const p = this.state.participants.find((x) => x.fp === from);
    switch (t) {
      case "board.join": {
        if (!p && !this.allowed.has(from) && !this.mayJoin(from)) {
          void send(from, { t: "board.bye", session: this.state.session, reason: "pas invité sur ce tableau" });
          return;
        }
        const nick = String(msg.nick ?? "?").slice(0, 24);
        const color = SERIES_COLORS[this.state.participants.length % SERIES_COLORS.length];
        const me = p ?? { fp: from, nick, color, mode: "edit" as Mode };
        if (!p) this.state.participants.push(me);
        void send(from, { t: "board.welcome", session: this.state.session, name: this.state.name, mode: me.mode, participants: this.state.participants });
        this.sendAll(from);
        if (this.state.presenter) void send(from, { t: "board.present", session: this.state.session, fp: this.state.presenter, on: true });
        this.toAll({ t: "board.people", session: this.state.session, participants: this.state.participants }, from);
        this.changed();
        break;
      }
      case "board.leave":
        if (p) {
          this.state.participants = this.state.participants.filter((x) => x.fp !== from);
          this.state.pointers = this.state.pointers.filter((x) => x.fp !== from);
          this.toAll({ t: "board.people", session: this.state.session, participants: this.state.participants });
          this.changed();
        }
        break;
      case "board.ops": {
        if (!p) return;
        if (p.mode !== "edit") {
          void send(from, { t: "board.perm", session: this.state.session, mode: "view" });
          return;
        }
        const els = sanitizeRemote(msg.elements, 2000);
        for (const e of els) this.known.set(String(e.id), Number(e.version));
        this.scene.apply(els);
        this.toAll({ t: "board.ops", session: this.state.session, elements: els }, from);
        this.requestMissing(els);
        break;
      }
      case "board.file": {
        if (!p || p.mode !== "edit") return;
        const f = this.receiveFile(msg);
        if (f) this.scene.addFiles([f]);
        break;
      }
      case "board.file.request": {
        if (!p) return;
        const files = this.scene.files();
        const ids = Array.isArray(msg.ids) ? (msg.ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 50) : [];
        for (const id of ids) if (files[id]) this.sendFile(from, files[id]);
        break;
      }
      case "board.cursor":
        if (!p) return;
        this.cursor(from, msg);
        this.toAll({ ...msg, fp: from }, from);
        break;
      case "board.present":
        if (!p) return;
        this.state.presenter = msg.on ? from : this.state.presenter === from ? null : this.state.presenter;
        this.toAll({ t: "board.present", session: this.state.session, fp: from, on: !!msg.on }, from);
        this.changed();
        break;
      case "board.view":
        if (!p || this.state.presenter !== from) return;
        if (this.state.following === from) this.scene.setView({ scrollX: Number(msg.scrollX) || 0, scrollY: Number(msg.scrollY) || 0, zoom: Number(msg.zoom) || 1 });
        this.toAll({ ...msg, fp: from }, from);
        break;
    }
  }
}
