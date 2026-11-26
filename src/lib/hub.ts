// Projet HUB, the logic without screens: stages, what a field holds, the next steps worth
// suggesting (from recorded facts only), the credit estimates added up, and the summary a
// student exports. Pure, tested in hub.test.ts. Nothing here invents an achievement, a skill
// or an official figure: every line comes from what the student recorded.
import type { HubFacts, HubItem, HubProject, HubStage } from "./api";
import { fmtDur } from "./plan";
import { t } from "./i18n";

export const STAGES: Array<{ id: HubStage; label: string }> = [
  { id: "idea", label: t("Idée") },
  { id: "prep", label: t("En préparation") },
  { id: "dev", label: t("En développement") },
  { id: "testing", label: t("En tests") },
  { id: "pitch", label: t("Présentation") },
  { id: "done", label: t("Terminé") },
  { id: "archived", label: t("Archivé") },
];
export const stageLabel = (s: HubStage) => STAGES.find((x) => x.id === s)?.label ?? s;
export const stageIndex = (s: HubStage) => STAGES.findIndex((x) => x.id === s);

/** The optional texts of a project, in the order they are offered. */
export const TEXT_FIELDS: Array<{ key: string; label: string; hint: string; list?: boolean }> = [
  { key: "description", label: t("Description"), hint: t("Ce que fait le projet, en quelques phrases.") },
  { key: "problem", label: t("Problématique"), hint: t("Le problème que tu résous, pour qui.") },
  { key: "solution", label: t("Solution proposée"), hint: t("Comment ton projet y répond.") },
  { key: "objectives", label: t("Objectifs"), hint: t("Ce qui doit marcher à la fin.") },
  { key: "technologies", label: t("Technologies"), hint: t("Langages, frameworks, services."), list: true },
  { key: "dependencies", label: t("Dépendances"), hint: t("Bibliothèques, API, matériel."), list: true },
  { key: "skills", label: t("Compétences développées"), hint: t("Ce que tu travailles vraiment sur ce projet."), list: true },
  { key: "personalGoals", label: t("Objectifs personnels"), hint: t("Ce que tu veux en retirer, pour toi.") },
  { key: "notes", label: t("Notes"), hint: t("Tout le reste.") },
];

/** What the presentation is prepared with. */
export const PITCH_FIELDS: Array<{ key: string; label: string; hint: string }> = [
  { key: "pitch", label: t("Pitch court"), hint: t("Le projet en une ou deux phrases.") },
  { key: "keyPoints", label: t("Points à présenter"), hint: t("Les trois ou quatre idées que le jury doit retenir.") },
  { key: "demos", label: t("Démonstrations"), hint: t("Ce que tu montres en direct, dans l'ordre.") },
  { key: "difficulties", label: t("Difficultés rencontrées"), hint: t("Et comment tu les as surmontées.") },
  { key: "learned", label: t("Compétences acquises"), hint: t("Ce que tu sais faire maintenant.") },
  { key: "nextSteps", label: t("Prochaines améliorations"), hint: t("Ce que tu ferais avec plus de temps.") },
];

/** Before presenting: what to have ready. Some are seen in the data, the others are ticked. */
export const CHECKLIST: Array<{ id: string; label: string }> = [
  { id: "pitch", label: t("Pitch écrit et dit à voix haute") },
  { id: "demo", label: t("Démo répétée de bout en bout") },
  { id: "slides", label: t("Support de présentation prêt") },
  { id: "screens", label: t("Captures d'écran à jour") },
  { id: "repo", label: t("Dépôt propre, README à jour") },
  { id: "timing", label: t("Présentation chronométrée") },
  { id: "backup", label: t("Plan B si la démo ne marche pas") },
];

export const text = (p: HubProject, key: string): string => {
  const v = p.fields[key];
  return Array.isArray(v) ? v.join(", ") : (v ?? "");
};
export const list = (p: HubProject, key: string): string[] => {
  const v = p.fields[key];
  return Array.isArray(v) ? v : v ? v.split(",").map((x) => x.trim()).filter(Boolean) : [];
};

/** Checklist items done: ticked by the student, or plainly visible in the data. */
export function checklistDone(p: HubProject, items: HubItem[]): Set<string> {
  const done = new Set(list(p, "checklist"));
  if (text(p, "pitch")) done.add("pitch");
  const files = items.filter((i) => i.kind === "file");
  if (files.some((f) => /\.(pdf|pptx|odp|key)$/i.test(f.title))) done.add("slides");
  if (files.some((f) => /\.(png|jpe?g|webp|gif)$/i.test(f.title))) done.add("screens");
  return done;
}

export interface NextStep {
  id: string;
  text: string;
  /** Where it is done: a tab of the project. */
  tab: "overview" | "work" | "resources" | "journal" | "pitch" | "team";
}

const DAY = 86_400_000;

/** At most three next steps, from what is recorded and what is missing. Never a guess about the work itself. */
export function nextSteps(p: HubProject, items: HubItem[], f: HubFacts, now = Date.now()): NextStep[] {
  const out: NextStep[] = [];
  const stage = stageIndex(p.stage);
  if (p.stage === "archived" || p.role === "viewer") return out;
  if (!text(p, "pitch")) out.push({ id: "pitch", text: t("Écris ton pitch en une phrase : tout le reste en découle."), tab: "pitch" });
  if (stage >= 1 && f.milestones === 0) out.push({ id: "milestones", text: t("Découpe le projet en quelques jalons."), tab: "work" });
  if (stage >= 2 && !p.repoPath && !p.repoUrl) out.push({ id: "repo", text: t("Relie le dépôt du code au projet."), tab: "resources" });
  if (f.milestones > f.milestonesDone && f.tasks === f.tasksDone) out.push({ id: "tasks", text: t("Décompose le prochain jalon en tâches."), tab: "work" });
  if (f.nextDue && f.minutesPlanned === 0) {
    const days = Math.round((Date.parse(`${f.nextDue}T23:59`) - now) / DAY);
    if (days >= 0 && days <= 7) out.push({ id: "plan", text: t("« {m} » arrive dans {n} j : réserve du temps dans ton planning.", { m: f.nextMilestone ?? "", n: days }), tab: "work" });
  }
  if (p.stage === "pitch" && checklistDone(p, items).size < CHECKLIST.length) out.push({ id: "checklist", text: t("Termine la checklist avant de présenter."), tab: "pitch" });
  if (p.stage === "done" && !text(p, "learned")) out.push({ id: "learned", text: t("Note ce que tu as appris : c'est ce qui reste dans ton portfolio."), tab: "pitch" });
  return out.slice(0, 3);
}

export interface CreditTotals {
  /** Sum of the low ends, of the high ends, and of the middles: the student's own estimates. */
  low: number;
  high: number;
  likely: number;
  /** Of finished projects only (high end of each). */
  finished: number;
  estimated: number;
  /** Active projects without an estimate. */
  unestimated: number;
}

/** The student's estimates added up. Archived projects do not count. */
export function creditTotals(projects: HubProject[]): CreditTotals {
  const out: CreditTotals = { low: 0, high: 0, likely: 0, finished: 0, estimated: 0, unestimated: 0 };
  for (const p of projects) {
    if (p.stage === "archived") continue;
    const lo = p.creditsMin ?? p.creditsMax;
    const hi = p.creditsMax ?? p.creditsMin;
    if (lo === null || hi === null) {
      out.unestimated += 1;
      continue;
    }
    out.estimated += 1;
    out.low += lo;
    out.high += hi;
    out.likely += (lo + hi) / 2;
    if (p.stage === "done") out.finished += hi;
  }
  return out;
}

const bullet = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => (l.startsWith("-") ? l : `- ${l}`)).join("\n");

/** The project summary, as Markdown, from what is recorded only. Empty sections are left out. */
export function summaryMarkdown(p: HubProject, items: HubItem[], f: HubFacts): string {
  const parts: string[] = [`# ${p.name}`, ""];
  const pitch = text(p, "pitch");
  if (pitch) parts.push(`> ${pitch}`, "");
  parts.push(`**${t("Étape")}** : ${stageLabel(p.stage)}`);
  if (p.creditsMin !== null || p.creditsMax !== null) parts.push(`**${t("Crédits estimés (estimation personnelle)")}** : ${p.creditsMin ?? p.creditsMax}${p.creditsMax !== null && p.creditsMax !== p.creditsMin ? `–${p.creditsMax}` : ""}`);
  if (p.repoUrl) parts.push(`**${t("Dépôt")}** : ${p.repoUrl}`);
  parts.push("");
  for (const fld of [...TEXT_FIELDS.filter((x) => x.key !== "notes" && x.key !== "personalGoals"), ...PITCH_FIELDS.filter((x) => x.key !== "pitch")]) {
    const v = text(p, fld.key);
    if (!v) continue;
    const isList = TEXT_FIELDS.find((x) => x.key === fld.key)?.list;
    parts.push(`## ${fld.label}`, "", isList ? list(p, fld.key).map((x) => `- ${x}`).join("\n") : fld.key === "keyPoints" || fld.key === "demos" ? bullet(v) : v, "");
  }
  const milestones = items.filter((i) => i.kind === "milestone");
  if (milestones.length) {
    parts.push(`## ${t("Jalons")}`, "", ...milestones.map((m) => `- [${m.done ? "x" : " "}] ${m.title}${m.dueDay ? ` (${m.dueDay})` : ""}${m.assignee ? ` — ${m.assignee}` : ""}`), "");
  }
  const decisions = items.filter((i) => i.kind === "decision");
  if (decisions.length) parts.push(`## ${t("Décisions techniques")}`, "", ...decisions.map((d) => `- **${d.title}**${d.body ? ` : ${d.body.replace(/\n+/g, " ")}` : ""}`), "");
  const links = items.filter((i) => i.kind === "link" && i.url);
  if (links.length) parts.push(`## ${t("Liens")}`, "", ...links.map((l) => `- [${l.title}](${l.url})`), "");
  const members = items.filter((i) => i.kind === "member");
  if (members.length) parts.push(`## ${t("Équipe")}`, "", ...members.map((m) => `- ${m.title}`), "");
  parts.push(`## ${t("En chiffres")}`, "", `- ${t("Jalons atteints")} : ${f.milestonesDone}/${f.milestones}`, `- ${t("Tâches faites")} : ${f.tasksDone}/${f.tasks}`, `- ${t("Temps travaillé")} : ${fmtDur(f.minutesWorked)}`, "");
  parts.push(`_${t("Synthèse générée par TekBoard à partir des informations enregistrées. Les crédits indiqués sont une estimation personnelle, pas une validation officielle.")}_`, "");
  return parts.join("\n");
}

/** What Artix receives to help structure the pitch: the recorded fields only, and the rule not to invent. */
export function pitchPrompt(p: HubProject, items: HubItem[]): string {
  const known = [...TEXT_FIELDS, ...PITCH_FIELDS].map((f) => [f.label, text(p, f.key)] as const).filter(([, v]) => v);
  const milestones = items.filter((i) => i.kind === "milestone").map((m) => `${m.done ? "✓" : "·"} ${m.title}`);
  return [
    t("Aide-moi à structurer la présentation de mon projet HUB « {n} ». Utilise uniquement les informations ci-dessous : n'invente ni réalisation, ni compétence, ni chiffre. Si une partie manque, dis-le et pose-moi la question.", { n: p.name }),
    "",
    ...known.map(([k, v]) => `${k} : ${v}`),
    milestones.length ? `${t("Jalons")} : ${milestones.join(" ; ")}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
