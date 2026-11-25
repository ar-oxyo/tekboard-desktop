import { describe, expect, it } from "vitest";
import { aiGate } from "./ai";
import type { AiProviderStatus } from "./api";

const all = { text: true, chat: true, readFiles: true, agents: true };
const noAgents = { ...all, agents: false };

describe("aiGate", () => {
  it("says why nothing works without an AI", () => {
    const g = aiGate({ provider: "none", configured: false, model: null, caps: { text: false, chat: false, readFiles: false, agents: false }, detail: null });
    expect(g.ready || g.text || g.read || g.agents).toBe(false);
    expect(g.why).toContain("Réglages");
    expect(g.agentWhy).toBe(g.why);
  });

  it("keeps the agents for Claude Code", () => {
    const s: AiProviderStatus = { provider: "openrouter", configured: true, model: "qwen/qwen3-coder:free", caps: noAgents, detail: null };
    const g = aiGate(s);
    expect([g.ready, g.text, g.read, g.agents]).toEqual([true, true, true, false]);
    expect(g.agentWhy).toContain("Claude Code");
    expect(g.name).toBe("OpenRouter · qwen/qwen3-coder:free");
    expect(g.sendsTo).toContain("OpenRouter");
  });

  it("a provider that is not set up gives its own reason", () => {
    const g = aiGate({ provider: "ollama", configured: false, model: null, caps: noAgents, detail: "Aucun modèle local choisi" });
    expect(g.read).toBe(false);
    expect(g.why).toBe("Aucun modèle local choisi");
  });

  it("Claude Code ready allows everything; a local model sends nothing away", () => {
    expect(aiGate({ provider: "claude", configured: true, model: "sonnet", caps: all, detail: null })).toMatchObject({ agents: true, agentWhy: null, name: "Claude Code", sendsTo: "Anthropic" });
    expect(aiGate({ provider: "ollama", configured: true, model: "qwen2.5:7b", caps: noAgents, detail: null }).sendsTo).toBeNull();
  });
});
