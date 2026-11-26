// Nine sections, one per subject; Ctrl+1 to Ctrl+9 open them in this order. The sidebar has
// one entry per section; a section with several screens shows them as tabs in the page bar
// (`tabs`).
import type { Page } from "../lib/store";
import { t } from "../lib/i18n";

export interface Section {
  id: "today" | "projects" | "planning" | "school" | "stats" | "lab" | "connect" | "resources" | "settings";
  label: string;
  pages: Array<{ page: Page; label: string }>;
  /** Its screens are tabs in the page bar instead of sidebar entries. */
  tabs?: boolean;
}

export const SECTIONS: Section[] = [
  { id: "today", label: t("Aujourd'hui"), pages: [{ page: "overview", label: t("Aujourd'hui") }] },
  { id: "projects", label: t("Projets"), pages: [{ page: "projects", label: t("Liste") }, { page: "git", label: "Git" }, { page: "testing", label: "Tests" }, { page: "library", label: t("Bibliothèques") }], tabs: true },
  { id: "planning", label: t("Planning"), pages: [{ page: "agenda", label: t("Planning") }] },
  { id: "school", label: t("École"), pages: [{ page: "logtime", label: "Logtime" }, { page: "credits", label: t("Crédits") }, { page: "skilltree", label: "Skill Tree" }, { page: "subjects", label: t("Sujets") }, { page: "myepitech", label: "MY Epitech" }], tabs: true },
  { id: "stats", label: "Stats", pages: [{ page: "analytics", label: "Stats" }] },
  { id: "lab", label: t("Labo"), pages: [{ page: "playground", label: "Playground" }, { page: "arena", label: "Arena" }, { page: "boards", label: t("Tableaux") }], tabs: true },
  { id: "connect", label: "Connect", pages: [{ page: "connect", label: t("Personnes") }, { page: "live", label: "TekLive" }, { page: "space", label: "TekSpace" }], tabs: true },
  { id: "resources", label: t("Modèles"), pages: [{ page: "templates", label: t("Modèles") }] },
  { id: "settings", label: t("Réglages"), pages: [{ page: "settings", label: t("Réglages") }, { page: "prompts", label: "Prompts" }, { page: "cozy", label: "Cozy Fox" }], tabs: true },
];

export const sectionOf = (page: Page): Section => SECTIONS.find((s) => s.pages.some((p) => p.page === page)) ?? SECTIONS[0];

const last = new Map<Section["id"], Page>();
/** Remembers the tab used last in each section, so coming back lands where you were. */
export function remember(page: Page) {
  last.set(sectionOf(page).id, page);
}
export const entryOf = (s: Section): Page => last.get(s.id) ?? s.pages[0].page;

/** The name of a screen, as the sidebar and the palette show it. */
export const pageLabel = (page: Page): string => {
  const s = sectionOf(page);
  return s.pages.find((p) => p.page === page)?.label ?? s.label;
};
