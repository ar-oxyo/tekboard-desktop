// One listener for the TekSpace and whiteboard messages Connect carries (`connect-session`),
// handing each to the module that registered its prefix. Modules register when they load.
import { listen } from "@tauri-apps/api/event";

type Handler = (from: string, msg: Record<string, unknown>) => void;

const handlers = new Map<string, Handler>();

/** `prefix` is `space.` or `board.`; `connect.gone` (a device left) reaches every handler. */
export function onSession(prefix: string, h: Handler) {
  handlers.set(prefix, h);
}

export function dispatch(from: string, msg: Record<string, unknown>) {
  const t = String(msg.t ?? "");
  for (const [prefix, h] of handlers) if (t === "connect.gone" || t.startsWith(prefix)) h(from, msg);
}

export function listenSessions() {
  return listen<{ from: string; msg: Record<string, unknown> }>("connect-session", (e) => dispatch(e.payload.from, e.payload.msg));
}
