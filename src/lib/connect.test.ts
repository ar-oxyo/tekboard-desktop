import { describe, expect, it } from "vitest";
import type { PeerView } from "./api";
import { groupPeople, looksLikeTarget } from "./connect";

const peer = (nick: string, p: Partial<PeerView>): PeerView => ({ fp: nick.padEnd(64, "0"), short: "", profile: { nick, avatar: "", status: "available" }, online: false, discovered: false, trusted: false, blocked: false, addr: null, app: null, since: null, lastSeen: null, ...p });

describe("connect helpers", () => {
  it("groups people the way the page shows them", () => {
    const g = groupPeople([
      peer("Zoé", { trusted: true, online: true }),
      peer("Ana", { trusted: true, online: true }),
      peer("Hidden", { trusted: true, online: true, profile: { nick: "Hidden", avatar: "", status: "invisible" } }),
      peer("Near", { discovered: true }),
      peer("Away", { trusted: true }),
      peer("Bad", { blocked: true, discovered: true }),
    ]);
    expect(g.online.map((p) => p.profile.nick)).toEqual(["Ana", "Zoé"]);
    expect(g.nearby.map((p) => p.profile.nick)).toEqual(["Near"]);
    expect(g.offline.map((p) => p.profile.nick).sort()).toEqual(["Away", "Hidden"]);
    expect(g.blocked).toHaveLength(1);
  });

  it("recognises invitation codes and addresses", () => {
    expect(looksLikeTarget(`tb1:10.0.0.5:41234:${"ab".repeat(32)}`)).toBe(true);
    expect(looksLikeTarget("192.168.1.20:5000")).toBe(true);
    expect(looksLikeTarget("hello")).toBe(false);
    expect(looksLikeTarget("tb1:10.0.0.5:41234:short")).toBe(false);
  });
});
