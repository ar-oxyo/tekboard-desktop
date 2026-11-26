import { describe, expect, it } from "vitest";
import { evaluate, matchUnits, newScenario, PGE1_2026, readScenario, type UnitInfo } from "./credits";

const unit = (id: string, label: string, code: string | null, credits: number | null, status: UnitInfo["status"], semester: number | null = 1, grade: string | null = null): UnitInfo => ({ id, label, code, credits, grade, status, semester });

const units: UnitInfo[] = [
  unit("u1", "Programmation élémentaire", "B-CPE-110", 8, "acquired", 1, "A"),
  unit("u2", "Programmation système Unix", "B-PSU-100", 5, "in_progress"),
  unit("u3", "Mathématiques", "B-MAT-100", 2, "failed", 1, "E"),
  unit("u4", "Mathématiques", "B-MAT-200", 2, "in_progress", 2),
  unit("u5", "Anglais", "B-ANG-100", null, "in_progress"),
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

  it("counts only the chosen track and checks each teaching unit against its minimum", () => {
    const s = newScenario();
    const none = evaluate({ ...s, choices: { "ing-1": 2, "ing-2": 4 } }, units);
    expect(none.ues.find((u) => u.ue.id === "spe")!.projected).toBe(0);
    const ing = evaluate({ ...s, tracks: { spe: "ing" }, choices: { "ing-1": 2, "ing-2": 4, "aia-1": 2 } }, units);
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

  it("matches the sheet: 5 teaching units, minimums 20/6/3/6/6, 60 required", () => {
    expect(PGE1_2026.ues.map((u) => u.min)).toEqual([20, 6, 3, 6, 6]);
    expect(PGE1_2026.required).toBe(60);
    expect(PGE1_2026.ues[0].modules.reduce((a, m) => a + m.max, 0)).toBe(33);
  });
});
