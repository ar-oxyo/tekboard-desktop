// Seven places instead of thirteen screens. Each section groups the screens of one subject;
// inside a section, a tab bar switches between them.
import type { Page } from "../lib/store";

export interface Section {
  id: "today" | "projects" | "planning" | "school" | "stats" | "resources" | "settings";
  label: string;
  pages: Array<{ page: Page; label: string }>;
}

export const SECTIONS: Section[] = [
  { id: "today", label: "Aujourd'hui", pages: [{ page: "overview", label: "Aujourd'hui" }] },
  { id: "projects", label: "Projets", pages: [{ page: "projects", label: "Liste" }, { page: "git", label: "Git" }, { page: "testing", label: "Vérifier" }, { page: "library", label: "Bibliothèques" }] },
  { id: "planning", label: "Planning", pages: [{ page: "agenda", label: "Planning" }] },
  { id: "school", label: "École", pages: [{ page: "myepitech", label: "MY Epitech" }, { page: "subjects", label: "Sujets" }] },
  { id: "stats", label: "Stats", pages: [{ page: "analytics", label: "Stats" }] },
  { id: "resources", label: "Modèles", pages: [{ page: "templates", label: "Modèles" }] },
  { id: "settings", label: "Réglages", pages: [{ page: "settings", label: "Réglages" }, { page: "prompts", label: "Prompts" }, { page: "cozy", label: "Cozy Fox" }] },
];

export const sectionOf = (page: Page): Section => SECTIONS.find((s) => s.pages.some((p) => p.page === page)) ?? SECTIONS[0];

const last = new Map<Section["id"], Page>();
/** Remembers the tab used last in each section, so coming back lands where you were. */
export function remember(page: Page) {
  last.set(sectionOf(page).id, page);
}
export const entryOf = (s: Section): Page => last.get(s.id) ?? s.pages[0].page;
