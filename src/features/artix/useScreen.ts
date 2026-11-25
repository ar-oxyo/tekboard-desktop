// What is on screen, in the words Artix understands. Sent with each message so "this project"
// or "here" mean something, and used to pick the few suggestions the panel offers.
import { useMemo } from "react";
import type { Screen } from "../../lib/api";
import { useUi, type Page } from "../../lib/store";
import { t } from "../../lib/i18n";

export const SCREEN_OF: Record<Page, string> = {
  overview: "today",
  agenda: "planning",
  projects: "projects",
  git: "projects",
  testing: "projects",
  library: "projects",
  templates: "resources",
  myepitech: "school",
  skilltree: "school",
  logtime: "school",
  subjects: "school",
  analytics: "stats",
  cozy: "settings",
  settings: "settings",
  prompts: "settings",
  playground: "lab",
  arena: "lab",
  connect: "connect",
  live: "connect",
};

const TAB_OF: Partial<Record<Page, string>> = { git: "git", testing: "checks", library: "libraries" };

export function useScreen(): Screen {
  const page = useUi((s) => s.page);
  const sheet = useUi((s) => s.sheetPath);
  const git = useUi((s) => s.gitRepo);
  const testing = useUi((s) => s.testingRepo);
  const library = useUi((s) => s.libraryRepo);
  return useMemo(() => {
    const project = sheet ?? (page === "git" ? git : page === "testing" ? testing : page === "library" ? library : null);
    return { page: SCREEN_OF[page], project, tab: sheet ? "overview" : (TAB_OF[page] ?? null), detail: null };
  }, [page, sheet, git, testing, library]);
}

export const projectName = (key: string | null | undefined) => (key ? (key.startsWith("my:") ? key : (key.split("/").filter(Boolean).pop() ?? key)) : null);

/** Two or three things worth asking here. Plain requests: Artix does the rest with its tools. */
export function suggestionsFor(s: Screen, hour: number): string[] {
  const name = projectName(s.project);
  if (name) {
    if (s.tab === "checks") return [`Lance une moulinette sur ${name} et explique les problèmes`, `Quels tests manquent à ${name} ?`, `Prépare-moi une session de 45 min sur ${name}`];
    return [`Analyse ${name} et dis-moi ce qu'il reste à faire`, `Planifie mes prochaines sessions sur ${name}`, `Prépare-moi une session de 45 min sur ${name}`];
  }
  switch (s.page) {
    case "planning":
      return [t("Réorganise ma semaine en fonction de mes rendus"), t("Trouve-moi deux heures demain"), t("Ma semaine est-elle réaliste ?")];
    case "school":
      return [t("Quels sont mes prochains rendus ?"), t("Télécharge mes nouveaux sujets et ajoute-les à mes projets"), t("Où j'en suis de mes crédits ?")];
    default:
      return hour >= 17 ? [t("Qu'est-ce que j'ai fait aujourd'hui ?"), t("Prépare ma journée de demain"), t("J'en ai marre de coder, propose-moi autre chose pendant 20 minutes")] : [t("Organise-moi ma journée, mais laisse-moi du temps libre"), t("Je suis en retard sur un projet, trouve une solution"), t("Prépare-moi une session de travail de 45 minutes")];
  }
}
