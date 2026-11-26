// The tabs of Settings, in the order of everyday use: what changes often first, what is set
// once in the middle, the advanced and the developer's at the end. Pure, tested in tabs.test.ts.
import { t } from "../../lib/i18n";

export type SettingsTab = "general" | "design" | "accounts" | "ai" | "tools" | "data" | "about" | "developer";

export const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; dev?: boolean }> = [
  { id: "general", label: t("Général") },
  { id: "design", label: t("Apparence") },
  { id: "accounts", label: t("Comptes") },
  { id: "ai", label: "Artix" },
  { id: "tools", label: t("Outils") },
  { id: "data", label: t("Données") },
  { id: "about", label: t("À propos") },
  { id: "developer", label: t("Développeur"), dev: true },
];

/** Tab ids from before this layout (Doctor links, toasts, a saved choice) and where they are now. */
const MOVED: Record<string, SettingsTab> = { doctor: "tools", my: "accounts", updates: "about" };

/** The tab to open for a requested id, or `null` when it does not exist (or is hidden). */
export function resolveTab(id: string | null | undefined, dev: boolean): SettingsTab | null {
  if (!id) return null;
  const tab = MOVED[id] ?? id;
  const found = SETTINGS_TABS.find((x) => x.id === tab);
  return found && (dev || !found.dev) ? found.id : null;
}

export const visibleTabs = (dev: boolean) => SETTINGS_TABS.filter((x) => dev || !x.dev);
