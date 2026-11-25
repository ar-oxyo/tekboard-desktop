// Always loaded (tiny): invitations to someone's whiteboard, and the hand-over of the other
// board messages to the collaboration code once a board is open.
import { create } from "zustand";
import { onSession } from "../../lib/sessionBus";
import { useUi } from "../../lib/store";
import { t } from "../../lib/i18n";

export interface BoardInvite {
  host: string;
  session: string;
  name: string;
  hostNick: string;
  at: number;
}

interface Bus {
  invites: BoardInvite[];
  /** A remote board to open (set by "join"). */
  open: BoardInvite | null;
  handler: ((from: string, msg: Record<string, unknown>) => void) | null;
  /** A board to share as soon as it opens (a TekSpace table's): who may join, and what to do once shared. */
  autoHost: { board: string; mayJoin: (fp: string) => boolean; started: (session: string, name: string) => void; stopped: () => void } | null;
}

export const useBoardBus = create<Bus>(() => ({ invites: [], open: null, handler: null, autoHost: null }));

export function joinBoard(inv: BoardInvite) {
  useBoardBus.setState((s) => ({ open: inv, invites: s.invites.filter((i) => i.session !== inv.session) }));
  useUi.getState().setPage("boards");
}

onSession("board.", (from, msg) => {
  if (msg.t === "board.invite") {
    const inv: BoardInvite = { host: from, session: String(msg.session ?? "").slice(0, 120), name: String(msg.name ?? "").slice(0, 80), hostNick: String(msg.hostNick ?? "").slice(0, 24), at: Date.now() };
    if (!inv.session) return;
    useBoardBus.setState((s) => ({ invites: [...s.invites.filter((i) => i.session !== inv.session), inv] }));
    useUi.getState().toast({ kind: "info", title: t("{n} t'invite sur son tableau « {b} »", { n: inv.hostNick, b: inv.name }), action: { label: t("Rejoindre"), run: () => joinBoard(inv) } });
    return;
  }
  useBoardBus.getState().handler?.(from, msg);
});
