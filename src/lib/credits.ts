// Credit simulator: a barème (teaching units, their modules, credits, minimums), the real
// results from MY Epitech, and a scenario of what the student expects. Pure and tested.
//
// Rules kept on purpose:
// - credits belong to a MODULE (a MY unit); a project gives none of its own, it only helps
//   the module it belongs to;
// - an official result (acquired or failed) is never changed by a scenario;
// - everything simulated is an estimate, kept apart from official figures;
// - what the barème does not say is listed in `notes`, never guessed.
import type { SkillNode, SkillStatus } from "./api";

export interface CreditModule {
  id: string;
  name: string;
  max: number;
  /** MY code prefixes (CPE, PSU…) or words that identify the matching unit. */
  hints?: string[];
  /** Semester the module belongs to, to tell apart two modules with the same code. */
  semester?: number;
  /** Track (specialisation) it belongs to; only the chosen track counts. */
  track?: string;
}

export interface CreditUe {
  id: string;
  name: string;
  /** Credits to obtain in this teaching unit. */
  min: number;
  modules: CreditModule[];
  tracks?: Array<{ id: string; name: string }>;
}

export interface Bareme {
  id: string;
  name: string;
  /** Where it comes from (a file, a school document…). */
  source: string;
  /** Credits required for the year. */
  required: number;
  ues: CreditUe[];
  /** What the source does not say (shown to the user, never filled in). */
  notes: string[];
}

export interface ScenarioData {
  version: 1;
  bareme: Bareme;
  objective: number;
  /** Credits expected per module (for modules without an official result). */
  choices: Record<string, number>;
  /** Module → MY unit id chosen by hand (`null`: no unit). Absent: automatic match. */
  links: Record<string, string | null>;
  /** UE → chosen track. */
  tracks: Record<string, string>;
}

/** What the simulator needs from a MY unit (a Skill Tree unit node). */
export interface UnitInfo {
  id: string;
  label: string;
  code: string | null;
  credits: number | null;
  grade: string | null;
  status: SkillStatus;
  semester: number | null;
}

export const unitsOf = (nodes: SkillNode[]): UnitInfo[] =>
  nodes.filter((n) => n.kind === "unit").map((n) => ({ id: n.id, label: n.label, code: n.unitCode, credits: n.credits, grade: n.grade, status: n.status, semester: n.semester }));

const m = (id: string, name: string, max: number, extra: Partial<CreditModule> = {}): CreditModule => ({ id, name, max, ...extra });

/**
 * First year (PGE1) 2026, from the structure of the planning sheet "PLANNING_PGE1_2026.xlsx"
 * (sheet "UE"): modules, maximum credits, credits to obtain per teaching unit, 60 required.
 * The student's own targets in that sheet are not copied.
 */
export const PGE1_2026: Bareme = {
  id: "pge1-2026",
  name: "PGE1 · 2026",
  source: "PLANNING_PGE1_2026.xlsx (feuille UE)",
  required: 60,
  notes: [
    "La feuille ne dit pas quelle unité de MY Epitech correspond à chaque module : TekBoard les rapproche par nom et par code. Vérifie les liens.",
    "Aucune règle de compensation entre unités d'enseignement n'est donnée : chacune est comparée à son minimum, sans plus.",
    "La spécialisation compte une seule piste (I et II) : la feuille additionne une cellule vide à cet endroit, ce calcul ne la reprend pas.",
  ],
  ues: [
    {
      id: "fond",
      name: "Fondamentaux technologiques",
      min: 20,
      modules: [m("piscine-1", "Piscine partie 1", 4, { hints: ["piscine", "pool"] }), m("piscine-2", "Piscine partie 2", 3, { hints: ["piscine", "pool"] }), m("algo", "Fondamentaux de l'algorithmique", 5, { hints: ["algorithmique", "algo"] }), m("psu", "Programmation système Unix", 5, { hints: ["PSU", "unix", "système"] }), m("cpe", "Programmation élémentaire", 8, { hints: ["CPE", "élémentaire"] }), m("shell", "Programmation Shell", 8, { hints: ["shell"] })],
    },
    {
      id: "supp",
      name: "Suppléments technologiques",
      min: 6,
      modules: [m("mat-1", "Maths 1er semestre", 2, { hints: ["MAT", "maths", "mathématiques"], semester: 1 }), m("mul", "Programmation graphique", 4, { hints: ["MUL", "graphique"] }), m("nsa-1", "AdminSys", 2, { hints: ["NSA", "adminsys", "administration"], semester: 1 }), m("web", "Introduction au développement Web", 3, { hints: ["WEB", "web"] }), m("dop", "DevOps", 2, { hints: ["DOP", "devops"] }), m("mat-2", "Maths 2e semestre", 2, { hints: ["MAT", "maths", "mathématiques"], semester: 2 }), m("nsa-2", "AdminSys Sécu 2e semestre", 2, { hints: ["NSA", "sécu", "sécurité"], semester: 2 })],
    },
    {
      id: "inno",
      name: "Innovation et Acculturation",
      min: 3,
      modules: [m("kyt-fond", "Culture informatique · Fondamentaux de l'informatique", 1, { hints: ["KYT", "CAT", "fondamentaux de l'informatique"] }), m("kyt-pro", "Culture informatique · Comportement professionnel", 1, { hints: ["comportement"] }), m("conf", "Conférences tech", 1, { hints: ["conférences", "keynote"] }), m("hack-1", "Hackathon I", 1, { hints: ["hackathon"], semester: 1 }), m("hack-2", "Hackathon II", 1, { hints: ["hackathon"], semester: 2 }), m("kyt-ia", "Culture informatique · I.A.", 1, { hints: ["I.A", "intelligence artificielle"] }), m("kyt-cyber", "Culture informatique · Cybersécurité", 1, { hints: ["cybersécurité"] }), m("hub-1", "Projet encadré I (hub)", 2, { hints: ["HUB", "projet encadré"], semester: 1 }), m("hub-2", "Projet encadré II (hub)", 2, { hints: ["HUB", "projet encadré"], semester: 2 }), m("ug-1", "User Group I", 2, { hints: ["user group"], semester: 1 }), m("ug-2", "User Group II", 2, { hints: ["user group"], semester: 2 })],
    },
    {
      id: "perso",
      name: "Développement personnel et collectif",
      min: 6,
      modules: [m("pro-1", "Communication professionnelle", 2, { hints: ["PRO", "communication professionnelle"], semester: 1 }), m("gp-1", "Introduction à la gestion de projet I", 1, { hints: ["gestion de projet"], semester: 1 }), m("intl", "Communication internationale", 2, { hints: ["internationale"] }), m("net", "Networking & Cohésion (obligatoire)", 2, { hints: ["networking", "cohésion"] }), m("pro-2", "Communication professionnelle II", 2, { hints: ["PRO", "communication professionnelle"], semester: 2 }), m("gp-2", "Introduction à la gestion de projet II", 2, { hints: ["gestion de projet"], semester: 2 }), m("pcp", "Développement personnel (skill booster)", 2, { hints: ["PCP", "skill booster", "développement personnel"] }), m("eng", "Anglais", 2, { hints: ["anglais", "english"] })],
    },
    {
      id: "spe",
      name: "Maîtrise technologique · Spécialisation",
      min: 6,
      tracks: [
        { id: "ing", name: "Ingénierie logicielle" },
        { id: "aia", name: "Intelligence artificielle" },
        { id: "sec", name: "Cybersécurité" },
      ],
      modules: [m("ing-1", "Ingénierie logicielle I", 2, { hints: ["ING", "ingénierie"], track: "ing", semester: 1 }), m("aia-1", "Intelligence artificielle I", 2, { hints: ["AIA"], track: "aia", semester: 1 }), m("sec-1", "Cybersécurité I", 2, { hints: ["SEC", "cybersec"], track: "sec", semester: 1 }), m("ing-2", "Ingénierie logicielle II", 4, { hints: ["ING", "ingénierie"], track: "ing", semester: 2 }), m("aia-2", "Intelligence artificielle II", 4, { hints: ["AIA"], track: "aia", semester: 2 }), m("sec-2", "Cybersécurité II", 4, { hints: ["SEC", "cybersec"], track: "sec", semester: 2 })],
    },
  ],
};

export const BAREMES: Bareme[] = [PGE1_2026];

export function newScenario(bareme: Bareme = PGE1_2026): ScenarioData {
  return { version: 1, bareme: structuredClone(bareme), objective: bareme.required, choices: {}, links: {}, tracks: {} };
}

/** Reads a stored scenario defensively: an unknown or broken shape gives a fresh one. */
export function readScenario(v: unknown): ScenarioData {
  const s = v as Partial<ScenarioData> | null;
  if (!s || s.version !== 1 || !s.bareme || !Array.isArray(s.bareme.ues)) return newScenario();
  return { version: 1, bareme: s.bareme, objective: typeof s.objective === "number" ? s.objective : s.bareme.required, choices: s.choices ?? {}, links: s.links ?? {}, tracks: s.tracks ?? {} };
}

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** How well a unit fits a module (0: not at all). */
function score(mod: CreditModule, u: UnitInfo): number {
  const label = norm(u.label);
  const code = (u.code ?? "").toUpperCase();
  let s = 0;
  if (norm(u.label) === norm(mod.name)) s += 10;
  for (const h of mod.hints ?? []) {
    if (/^[A-Z]{2,4}$/.test(h)) {
      if (code.includes(`-${h}-`) || code.startsWith(`${h}-`) || code.includes(h)) s += 3;
    } else if (label.includes(norm(h))) s += 2;
  }
  if (s > 0 && mod.semester !== undefined && u.semester !== null) s += u.semester === mod.semester ? 2 : -4;
  return s;
}

/**
 * The MY unit of each module: the one chosen by hand, otherwise the best match when it is
 * clear (no tie, each unit used once). Unclear matches stay empty for the user to set.
 */
export function matchUnits(bareme: Bareme, units: UnitInfo[], links: Record<string, string | null>): Map<string, UnitInfo | null> {
  const out = new Map<string, UnitInfo | null>();
  const byId = new Map(units.map((u) => [u.id, u]));
  const taken = new Set<string>();
  const mods = bareme.ues.flatMap((ue) => ue.modules);
  for (const mod of mods) {
    if (mod.id in links) {
      const u = links[mod.id] ? (byId.get(links[mod.id]!) ?? null) : null;
      out.set(mod.id, u);
      if (u) taken.add(u.id);
    }
  }
  // Best pairs first, so a strong match is not stolen by a weak one.
  const pairs: Array<{ mod: string; unit: string; s: number }> = [];
  for (const mod of mods) if (!out.has(mod.id)) for (const u of units) { const s = score(mod, u); if (s >= 3) pairs.push({ mod: mod.id, unit: u.id, s }); }
  pairs.sort((a, b) => b.s - a.s);
  for (const p of pairs) {
    if (out.has(p.mod) || taken.has(p.unit)) continue;
    // A tie with another free unit for the same module: unclear, left to the user.
    const tie = pairs.some((q) => q.mod === p.mod && q.unit !== p.unit && q.s === p.s && !taken.has(q.unit));
    if (tie) continue;
    out.set(p.mod, byId.get(p.unit)!);
    taken.add(p.unit);
  }
  for (const mod of mods) if (!out.has(mod.id)) out.set(mod.id, null);
  return out;
}

export type RowKind = "official" | "failed" | "pending" | "plan";

export interface ModuleRow {
  module: CreditModule;
  unit: UnitInfo | null;
  kind: RowKind;
  /** Credits obtained officially (acquired) — 0 when failed or not decided. */
  official: number;
  /** Credits at stake in a unit in progress. */
  pending: number;
  /** Credits the scenario expects (pending or future modules); 0 for official rows. */
  planned: number;
  /** False when the module is in a track not chosen. */
  counted: boolean;
  /** The credits shown come from the barème because MY gave none. */
  fromBareme: boolean;
}

export interface UeResult {
  ue: CreditUe;
  rows: ModuleRow[];
  official: number;
  pending: number;
  projected: number;
  ok: boolean;
}

export interface CreditResult {
  ues: UeResult[];
  official: number;
  pending: number;
  /** Credits added by the scenario on top of the official ones. */
  simulated: number;
  /** Official + simulated. */
  projected: number;
  objective: number;
  required: number;
  /** Still missing to reach the objective with this scenario. */
  missing: number;
  /** Still to obtain officially to reach the required credits. */
  toObtain: number;
  /** Teaching units below their minimum in this scenario. */
  short: string[];
  unmatched: number;
}

const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));

export function evaluate(s: ScenarioData, units: UnitInfo[]): CreditResult {
  const match = matchUnits(s.bareme, units, s.links);
  const ues: UeResult[] = s.bareme.ues.map((ue) => {
    const track = ue.tracks?.length ? (s.tracks[ue.id] ?? null) : null;
    const rows: ModuleRow[] = ue.modules.map((mod) => {
      const unit = match.get(mod.id) ?? null;
      const counted = !mod.track || mod.track === track;
      const credits = unit?.credits ?? mod.max;
      const fromBareme = unit !== null && unit.credits === null;
      if (unit?.status === "acquired") return { module: mod, unit, kind: "official", official: counted ? credits : 0, pending: 0, planned: 0, counted, fromBareme };
      if (unit?.status === "failed") return { module: mod, unit, kind: "failed", official: 0, pending: 0, planned: 0, counted, fromBareme };
      const pendingRow = unit !== null && (unit.status === "in_progress" || unit.status === "available");
      const choice = s.choices[mod.id];
      const planned = counted ? clamp(choice ?? (pendingRow ? credits : 0), Math.max(mod.max, credits)) : 0;
      return { module: mod, unit, kind: pendingRow ? "pending" : "plan", official: 0, pending: pendingRow && counted ? credits : 0, planned, counted, fromBareme };
    });
    const official = rows.reduce((a, r) => a + r.official, 0);
    const projected = official + rows.reduce((a, r) => a + r.planned, 0);
    return { ue, rows, official, pending: rows.reduce((a, r) => a + r.pending, 0), projected, ok: projected >= ue.min };
  });
  const official = ues.reduce((a, u) => a + u.official, 0);
  const projected = ues.reduce((a, u) => a + u.projected, 0);
  return {
    ues,
    official,
    pending: ues.reduce((a, u) => a + u.pending, 0),
    simulated: projected - official,
    projected,
    objective: s.objective,
    required: s.bareme.required,
    missing: Math.max(0, s.objective - projected),
    toObtain: Math.max(0, s.bareme.required - official),
    short: ues.filter((u) => !u.ok).map((u) => u.ue.name),
    unmatched: ues.reduce((a, u) => a + u.rows.filter((r) => r.unit === null && r.counted).length, 0),
  };
}
