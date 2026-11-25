// Seven places instead of thirteen screens. Each section groups the screens of one subject;
// inside a section, a tab bar switches between them.
import type { Page } from "../lib/store";
import { t } from "../lib/i18n";

export interface Section {
  id: "today" | "projects" | "planning" | "school" | "stats" | "resources" | "settings";
  label: string;
  pages: Array<{ page: Page; label: string }>;
}

export const SECTIONS: Section[] = [
  { id: "today", label: t("Aujourd'hui"), pages: [{ page: "overview", label: t("Aujourd'hui") }] },
  { id: "projects", label: t("Projets"), pages: [{ page: "projects", label: t("Liste") }, { page: "git", label: "Git" }, { page: "testing", label: "Tests" }, { page: "library", label: t("Bibliothèques") }] },
  { id: "planning", label: t("Planning"), pages: [{ page: "agenda", label: t("Planning") }] },
  { id: "school", label: t("École"), pages: [{ page: "myepitech", label: "MY Epitech" }, { page: "skilltree", label: "Skill Tree" }, { page: "logtime", label: "Logtime" }, { page: "subjects", label: t("Sujets") }] },
  { id: "stats", label: "Stats", pages: [{ page: "analytics", label: "Stats" }] },
  { id: "resources", label: t("Modèles"), pages: [{ page: "templates", label: t("Modèles") }] },
  { id: "settings", label: t("Réglages"), pages: [{ page: "settings", label: t("Réglages") }, { page: "prompts", label: "Prompts" }, { page: "cozy", label: "Cozy Fox" }] },
];

export const sectionOf = (page: Page): Section => SECTIONS.find((s) => s.pages.some((p) => p.page === page)) ?? SECTIONS[0];

const last = new Map<Section["id"], Page>();
/** Remembers the tab used last in each section, so coming back lands where you were. */
export function remember(page: Page) {
  last.set(sectionOf(page).id, page);
}
export const entryOf = (s: Section): Page => last.get(s.id) ?? s.pages[0].page;
