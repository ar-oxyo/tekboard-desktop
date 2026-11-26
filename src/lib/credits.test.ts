import { describe, expect, it } from "vitest";
import { evaluate, graded, matchUnits, newScenario, PGE1_2026, readScenario, type UnitInfo } from "./credits";

const unit = (id: string, label: string, code: string | null, credits: number | null, status: UnitInfo["status"], semester: number | null = 1, grade: string | null = null): UnitInfo => ({ id, label, code, credits, grade, status, semester });

const units: UnitInfo[] = [
  unit("u1", "Programmation élémentaire", "B-CPE-110", 8, "acquired", 1, "A"),
  unit("u2", "Programmation système Unix", "B-PSU-100", 5, "in_progress"),
  unit("u3", "Mathématiques", "B-MAT-100", 2, "failed", 1, "E"),
  unit("u4", "Mathématiques", "B-MAT-200", 2, "in_progress", 2),
  unit("u5", "Anglais", "B-ANG-100", null, "in_progress"),
];

// MY Epitech's first semester (titles, codes and credits), every grade still to come.
const real: UnitInfo[] = [
  unit("u:275", "Mathématiques Appliquées I", null, 2, "available", 1, "in progress"),
  unit("u:282", "Culture informatique - Fondamentaux de l'informatique", null, 1, "available", 1, "in progress"),
  unit("u:281", "Culture informatique - Comportement professionnel", null, 1, "available", 1, "in progress"),
  unit("u:240", "Anglais", null, 2, "available", 1, "in progress"),
  unit("u:273", "Fondamentaux de l'algorithmique", "G-CPE-110", 5, "in_progress", 1, "in progress"),
  unit("u:197", "Fondamentaux de la programmation C en environnement Unix", "G-CPE-100", 4, "acquired", 1, "in progress"),
  unit("u:283", "Fondamentaux de la programmation C en environnement Unix II", "G-CPE-101", 3, "in_progress", 1, "in progress"),
  unit("u:626", "Fondamentaux de l'analyse numérique", null, 2, "available", 1, "in progress"),
  unit("u:277", "Fondamentaux de l'administration système et réseau", "G-NSA-100", 2, "available", 1, "in progress"),
  unit("u:276", "Programmation graphique", "G-MUL-100", 4, "in_progress", 1, "in progress"),
  unit("u:278", "Communication professionnelle I", "G-PRO-100", 2, "acquired", 1, "in progress"),
  unit("u:285", "Skill Booster : Organisation & Communication", null, 2, "available", 1, "in progress"),
  unit("u:274", "Programmation système UNIX", "G-PSU-100", 5, "in_progress", 1, "in progress"),
  unit("u:317", "Esprit critique et analyse technique", null, 2, "locked", 2, "in progress"),
  unit("u:610", "Anglais II", null, 2, "locked", 2, "in progress"),
  unit("u:304", "HUB - Hackathon I", null, 1, "locked", 2, "in progress"),
  unit("u:311", "HUB - Hackathon II", null, 1, "locked", 2, "in progress"),
  unit("u:305", "HUB - Projet encadré I", null, 2, "locked", 2, "in progress"),
  unit("u:306", "HUB - Projet encadré II", null, 2, "locked", 2, "in progress"),
  unit("u:303", "HUB - Conférences Tech", null, 1, "locked", 2, "in progress"),
  unit("u:307", "HUB - User Group I", null, 2, "locked", 2, "in progress"),
  unit("u:308", "HUB - User Group II", null, 2, "locked", 2, "in progress"),
  unit("u:299", "Networking & Cohesion", null, 2, "locked", 2, "in progress"),
  unit("u:301", "Pilotage et communication de projet", null, 3, "locked", 2, "in progress"),
];

describe("credit simulator", () => {
  it("links modules to MY units by code, name and semester, and leaves unclear ones empty", () => {
    const m = matchUnits(PGE1_2026, units, {});
    expect(m.get("cpe")?.id).toBe("u1");
    expect(m.get("psu")?.id).toBe("u2");
    expect(m.get("mat-1")?.id).toBe("u3");
    expect(m.get("mat-2")?.id).toBe("u4");
    expect(m.get("eng")?.id).toBe("u5");
    // Two pool modules, no pool unit: nothing invented.
    expect(m.get("piscine-1")).toBeNull();
    // A link set by hand wins, and `null` means "no unit".
    const hand = matchUnits(PGE1_2026, units, { psu: null, shell: "u2" });
    expect(hand.get("psu")).toBeNull();
    expect(hand.get("shell")?.id).toBe("u2");
  });

  it("keeps official results apart from what the scenario expects", () => {
    const s = newScenario();
    const r = evaluate(s, units);
    // Acquired: 8 official. Failed: 0 and not changeable. In progress: expected in full by default.
    expect(r.official).toBe(8);
    expect(r.pending).toBe(5 + 2 + 2);
    expect(r.projected).toBe(8 + 9);
    expect(r.simulated).toBe(9);
    const fond = r.ues.find((u) => u.ue.id === "fond")!;
    expect(fond.rows.find((x) => x.module.id === "cpe")!.kind).toBe("official");
    // Anglais has no credits in MY: the barème's are shown, and said so.
    const eng = r.ues.flatMap((u) => u.rows).find((x) => x.module.id === "eng")!;
    expect(eng.fromBareme).toBe(true);
    // A choice on an official module changes nothing.
    expect(evaluate({ ...s, choices: { cpe: 0, "mat-1": 2 } }, units).official).toBe(8);
    expect(evaluate({ ...s, choices: { "mat-1": 2 } }, units).projected).toBe(17);
  });

  it("counts only the tracks picked in each semester and checks each teaching unit against its minimum", () => {
    const s = newScenario();
    const none = evaluate({ ...s, choices: { "ing-1": 2, "ing-2": 4 } }, units);
    expect(none.ues.find((u) => u.ue.id === "spe")!.projected).toBe(0);
    // Several tracks per semester, chosen apart for each half of the year.
    const two = evaluate({ ...s, tracks: { "spe:1": ["ing", "aia"], "spe:2": ["sec"] }, choices: { "ing-1": 2, "aia-1": 2, "sec-1": 2, "ing-2": 4, "sec-2": 4 } }, units);
    expect(two.ues.find((u) => u.ue.id === "spe")!.projected).toBe(2 + 2 + 4);
    const ing = evaluate({ ...s, tracks: { "spe:1": ["ing"], "spe:2": ["ing"] }, choices: { "ing-1": 2, "ing-2": 4, "aia-1": 2 } }, units);
    const spe = ing.ues.find((u) => u.ue.id === "spe")!;
    expect(spe.projected).toBe(6);
    expect(spe.ok).toBe(true);
    expect(ing.short).toContain("Fondamentaux technologiques");
    // Choices are bounded by the module's credits.
    expect(evaluate({ ...s, choices: { shell: 99 } }, units).ues[0].rows.find((r) => r.module.id === "shell")!.planned).toBe(8);
  });

  it("says what is missing to the objective and to the required credits", () => {
    const r = evaluate({ ...newScenario(), objective: 66 }, units);
    expect(r.missing).toBe(66 - r.projected);
    expect(r.toObtain).toBe(60 - 8);
  });

  it("reads stored scenarios defensively", () => {
    expect(readScenario(null).bareme.id).toBe("pge1-2026");
    expect(readScenario({ version: 1, bareme: PGE1_2026, objective: 62 }).objective).toBe(62);
    expect(readScenario({ version: 9 }).version).toBe(1);
  });

  it("brings old scenarios up to date: one track becomes that track in each semester, matching hints are refreshed", () => {
    const old = structuredClone(PGE1_2026);
    old.ues[0].modules[0] = { ...old.ues[0].modules[0], name: "Ma piscine", hints: [], codes: undefined };
    const s = readScenario({ version: 1, bareme: old, objective: 60, tracks: { spe: "aia" } });
    expect(s.tracks).toEqual({ "spe:1": ["aia"], "spe:2": ["aia"] });
    expect(s.bareme.ues[0].modules[0].name).toBe("Ma piscine");
    expect(s.bareme.ues[0].modules[0].codes).toContain("G-CPE-100");
  });

  it("with MY Epitech's real first-semester units: validated units are secured, not official, until graded", () => {
    const m = matchUnits(PGE1_2026, real, {});
    const at = (id: string) => m.get(id)?.label ?? null;
    expect(at("piscine-1")).toBe("Fondamentaux de la programmation C en environnement Unix");
    expect(at("piscine-2")).toBe("Fondamentaux de la programmation C en environnement Unix II");
    expect(at("algo")).toBe("Fondamentaux de l'algorithmique");
    expect(at("psu")).toBe("Programmation système UNIX");
    expect(at("pro-1")).toBe("Communication professionnelle I");
    expect(at("kyt-fond")).toBe("Culture informatique - Fondamentaux de l'informatique");
    expect(at("kyt-pro")).toBe("Culture informatique - Comportement professionnel");
    expect(at("hack-1")).toBe("HUB - Hackathon I");
    expect(at("hack-2")).toBe("HUB - Hackathon II");
    expect(at("ug-2")).toBe("HUB - User Group II");
    expect(at("pcp")).toBe("Skill Booster : Organisation & Communication");
    expect(at("eng")).toBe("Anglais");
    // No unit of its own in MY yet: left empty rather than guessed.
    expect(at("cpe")).toBeNull();
    const r = evaluate(newScenario(), real);
    expect(r.official).toBe(0);
    expect(r.secured).toBe(4 + 2);
    expect(graded("in progress")).toBe(false);
    expect(graded("A")).toBe(true);
  });

  it("matches the sheet: 5 teaching units, minimums 20/6/3/6/6, 60 required", () => {
    expect(PGE1_2026.ues.map((u) => u.min)).toEqual([20, 6, 3, 6, 6]);
    expect(PGE1_2026.required).toBe(60);
    expect(PGE1_2026.ues[0].modules.reduce((a, m) => a + m.max, 0)).toBe(33);
  });
});
