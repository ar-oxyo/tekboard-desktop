import { describe, expect, it } from "vitest";
import type { PeerView, Transfer } from "./api";
import { percent, recipients } from "./share";

const peer = (nick: string, p: Partial<PeerView>): PeerView => ({ fp: nick, short: "", profile: { nick, avatar: "", status: "available" }, online: true, discovered: true, trusted: true, blocked: false, addr: null, app: null, since: null, lastSeen: null, ...p });

describe("share helpers", () => {
  it("only paired, connected, unblocked people can receive", () => {
    const r = recipients([peer("Zed", {}), peer("Busy", { profile: { nick: "Busy", avatar: "", status: "dnd" } }), peer("Ann", {}), peer("Off", { online: false }), peer("Stranger", { trusted: false }), peer("Bad", { blocked: true })]);
    expect(r.map((p) => p.profile.nick)).toEqual(["Ann", "Zed", "Busy"]);
  });
  it("progress never passes 100 %", () => {
    expect(percent({ size: 200, progress: 50 } as Transfer)).toBe(25);
    expect(percent({ size: 0, progress: 0 } as Transfer)).toBe(0);
    expect(percent({ size: 10, progress: 30 } as Transfer)).toBe(100);
  });
});
