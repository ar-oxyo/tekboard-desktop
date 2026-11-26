import { describe, expect, it } from "vitest";
import type { HubFacts, HubItem, HubProject } from "./api";
import { checklistDone, creditTotals, nextSteps, pitchPrompt, summaryMarkdown } from "./hub";

const facts: HubFacts = { milestones: 0, milestonesDone: 0, tasks: 0, tasksDone: 0, minutesWorked: 0, minutesPlanned: 0, nextMilestone: null, nextDue: null, resources: 0, journal: 0, members: 0 };
const project = (over: Partial<HubProject> = {}): HubProject => ({ id: 1, name: "Covoit", stage: "idea", fields: {}, repoPath: null, repoUrl: null, creditsMin: null, creditsMax: null, estimateMin: null, owner: null, ownerNick: null, role: "owner", remoteId: null, createdAt: 0, updatedAt: 0, ...over });
const item = (over: Partial<HubItem>): HubItem => ({ id: 1, projectId: 1, kind: "milestone", title: "x", body: "", url: null, path: null, dueDay: null, done: false, assignee: null, role: null, author: null, createdAt: 0, ...over });

describe("Projet HUB", () => {
  it("suggests the next steps from what is missing, three at most", () => {
    expect(nextSteps(project(), [], facts).map((s) => s.id)).toEqual(["pitch"]);
    const dev = project({ stage: "dev", fields: { pitch: "Un covoiturage" } });
    expect(nextSteps(dev, [], facts).map((s) => s.id)).toEqual(["milestones", "repo"]);
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const f = { ...facts, milestones: 2, milestonesDone: 0, tasks: 1, tasksDone: 0, nextMilestone: "Prototype", nextDue: soon };
    expect(nextSteps({ ...dev, repoUrl: "https://github.com/x/y" }, [], f).map((s) => s.id)).toEqual(["plan"]);
    expect(nextSteps(project({ role: "viewer" }), [], facts)).toEqual([]);
  });

  it("sees a written pitch and kept slides in the checklist", () => {
    const done = checklistDone(project({ fields: { pitch: "x", checklist: ["demo"] } }), [item({ kind: "file", title: "soutenance.pdf" })]);
    expect([...done].sort()).toEqual(["demo", "pitch", "slides"]);
  });

  it("adds up the student's estimates, never the archived ones", () => {
    const totals = creditTotals([project({ creditsMin: 2, creditsMax: 4 }), project({ creditsMax: 3, stage: "done" }), project({ creditsMin: 10, creditsMax: 10, stage: "archived" }), project()]);
    expect(totals).toEqual({ low: 5, high: 7, likely: 6, finished: 3, estimated: 2, unestimated: 1 });
  });

  it("exports only what is recorded and says the credits are an estimate", () => {
    const md = summaryMarkdown(project({ fields: { pitch: "Un covoiturage", technologies: ["Rust", "React"] }, creditsMin: 2, creditsMax: 3 }), [item({ title: "Maquette", done: true, dueDay: "2026-11-10" })], { ...facts, milestones: 1, milestonesDone: 1, minutesWorked: 90 });
    expect(md).toContain("> Un covoiturage");
    expect(md).toContain("- Rust");
    expect(md).toContain("- [x] Maquette (2026-11-10)");
    expect(md).toContain("estimation personnelle");
    expect(md).not.toContain("Problématique");
  });

  it("asks Artix to structure without inventing", () => {
    const prompt = pitchPrompt(project({ fields: { problem: "Trop de voitures vides" } }), []);
    expect(prompt).toContain("n'invente");
    expect(prompt).toContain("Trop de voitures vides");
  });
});
