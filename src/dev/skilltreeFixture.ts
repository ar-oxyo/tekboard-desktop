// Development only: a plausible first-year Skill Tree for the browser mock.
import type { SkillNode, SkillStatus, SkillTree } from "../lib/api";

const now = Math.floor(Date.now() / 1000);

const base = (id: string, kind: SkillNode["kind"], label: string, status: SkillStatus, extra: Partial<SkillNode> = {}): SkillNode => ({
  id, kind, label, status, statusFrom: "validations", branch: null, parent: null, semester: 1, schoolYear: 2026, upcoming: false, credits: null, grade: null,
  validated: null, total: null, levelPercent: null, mandatory: null, unitCode: null, domain: null, domainEstimated: false, ...extra,
});

type U = [code: string, label: string, credits: number, status: SkillStatus, skills: Array<[string, SkillStatus, number?]>];
const blocks: Array<{ id: string; name: string; color: string; threshold: number; secure: number; units: U[] }> = [
  {
    id: "c:tech", name: "Fondamentaux technologiques", color: "var(--color-accent)", threshold: 20, secure: 7,
    units: [
      ["B-CPE-100", "Piscine C", 4, "acquired", [["Écrire du C structuré", "acquired"], ["Pointeurs et mémoire", "acquired"], ["Respecter la norme", "acquired"]]],
      ["B-CPE-110", "Programmation élémentaire", 8, "in_progress", [["Allocation dynamique", "acquired"], ["Structures chaînées", "in_progress", 60], ["Tests unitaires", "in_progress", 35], ["Makefile", "acquired"]]],
      ["B-PSU-100", "Programmation système Unix", 5, "in_progress", [["Appels système", "in_progress", 40], ["Fichiers et droits", "available"], ["Processus", "available"]]],
      ["B-CPE-200", "Fondamentaux de l'algorithmique", 5, "available", [["Complexité", "available"], ["Tri et recherche", "available"]]],
      ["B-PSU-200", "Programmation Shell", 8, "locked", [["Parsing", "locked"], ["Pipes et redirections", "locked"]]],
    ],
  },
  {
    id: "c:supp", name: "Suppléments technologiques", color: "var(--color-info)", threshold: 6, secure: 2,
    units: [
      ["B-MAT-100", "Maths 1er semestre", 2, "acquired", [["Algèbre linéaire", "acquired"], ["Probabilités", "acquired"]]],
      ["B-MUL-100", "Programmation graphique", 4, "in_progress", [["Boucle de jeu", "acquired"], ["Sprites et animations", "in_progress", 70]]],
      ["B-WEB-100", "Introduction au développement Web", 3, "available", [["HTTP et REST", "available"]]],
    ],
  },
  {
    id: "c:soft", name: "Développement personnel et collectif", color: "var(--color-ok)", threshold: 6, secure: 3,
    units: [
      ["B-PRO-100", "Communication professionnelle", 2, "acquired", [["Écrit professionnel", "acquired"]]],
      ["B-PRO-110", "Gestion de projet I", 1, "in_progress", [["Planifier un projet", "in_progress", 50]]],
      ["B-ANG-100", "Anglais", 2, "failed", [["Compréhension écrite", "failed"]]],
    ],
  },
];

const nodes: SkillNode[] = [];
const links: SkillTree["links"] = [];
for (const b of blocks) {
  for (const [code, label, credits, status, skills] of b.units) {
    const done = skills.filter((s) => s[1] === "acquired").length;
    nodes.push(base(`u:${code}`, "unit", label, status, { branch: b.id, unitCode: code, credits, validated: done, total: skills.length, grade: status === "failed" ? "E" : "in progress" }));
    skills.forEach(([s, st, pct], i) => {
      nodes.push(base(`s:${code}:${i}`, "skill", s, st, { branch: b.id, parent: `u:${code}`, levelPercent: pct ?? (st === "acquired" ? 100 : null) }));
      links.push({ source: `s:${code}:${i}`, target: `u:${code}`, kind: "skill_unit" });
    });
  }
}
const projects: Array<[string, SkillStatus, string[]]> = [
  ["Organized", "acquired", ["s:B-CPE-110:0", "s:B-CPE-110:1"]],
  ["Setting Up", "acquired", ["s:B-CPE-110:3"]],
  ["Secured", "in_progress", ["s:B-CPE-110:1", "s:B-CPE-110:2"]],
  ["my_ls", "in_progress", ["s:B-PSU-100:0", "s:B-PSU-100:1"]],
  ["my_sudo", "available", ["s:B-PSU-100:1"]],
  ["MyHunter", "acquired", ["s:B-MUL-100:0", "s:B-MUL-100:1"]],
  ["101pong", "acquired", ["s:B-MAT-100:0"]],
  ["minishell1", "locked", ["s:B-PSU-200:0"]],
];
for (const [label, status, skills] of projects) {
  const id = `p:${label}`;
  nodes.push(base(id, "project", label, status, { semester: null, validated: status === "acquired" ? 18 : 7, total: 20 }));
  for (const s of skills) links.push({ source: id, target: s, kind: "project_skill" });
}

export const skillTree: SkillTree = {
  syncedAt: now - 40 * 60,
  credits: { acquired: 0, prior: 0, thisSemester: 0, threshold: 20, secure: 27, reachable: 27, lost: 2, atRisk: 0 },
  semester: 1,
  semesters: [{ num: 1, schoolYear: 2026, current: true, future: false }],
  branches: blocks.map((b) => ({ id: b.id, name: b.name, color: b.color, threshold: b.threshold, secure: b.secure, reachable: b.threshold, available: b.threshold, alert: null, units: b.units.map((u) => `u:${u[0]}`) })),
  nodes,
  links,
  history: [{ at: now - 20 * 86400, label: "Piscine C", kind: "project" }],
  notes: [],
};
