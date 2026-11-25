// Which conversation a computed plan goes to: one per day or per week (named after its
// Monday), so asking again for the same week reuses it instead of opening another.
import { locale, t } from "../../lib/i18n";

export type PlanScope = "day" | "week" | "two_weeks" | "reorganize";

function monday(d: Date): Date {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

/** `null` for a project's plan: it stays in the conversation it was asked from. */
export function planThreadTitle(scope: PlanScope, now = new Date(), project?: string | null): string | null {
  if (project) return null;
  const day = (d: Date) => d.toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" });
  if (scope === "week" || scope === "two_weeks") return t("Planning · semaine du {d}", { d: day(monday(now)) });
  if (scope === "day") return t("Planning · {d}", { d: day(now) });
  return t("Réorganisation · {d}", { d: day(now) });
}
