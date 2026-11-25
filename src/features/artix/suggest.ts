// "Plan my day / week / this project / what I did not do": computed by TekBoard's planning
// engine (src-tauri/src/schedule.rs) and shown as a proposal in Artix's panel, in a
// conversation of its own (one per day or week planned, reused when asked again).
import { api, asAppError } from "../../lib/api";
import { useUi } from "../../lib/store";
import { t } from "../../lib/i18n";
import { planThreadTitle, type PlanScope } from "./planThread";

export type { PlanScope };

export interface PlanOutcome {
  status: "proposed" | "nothing" | "error";
  message?: string;
}

/**
 * Asks the planning engine for a plan. When something is proposed, Artix opens on the
 * conversation that holds it. `quiet`: nothing is toasted, the caller shows the outcome.
 */
export async function suggestPlan(scope: PlanScope, project?: string | null, quiet = false): Promise<PlanOutcome> {
  const ui = useUi.getState();
  try {
    const r = (await api.aiTool("suggest_plan", project ? { scope, project } : { scope }, null, planThreadTitle(scope, new Date(), project))) as { status: string; message?: string; notes?: string[]; threadId?: number };
    if (r.status === "proposed") {
      ui.closeSheet();
      if (typeof r.threadId === "number") ui.setArtix({ thread: r.threadId, job: null });
      ui.openAssistant();
      return { status: "proposed" };
    }
    const message = [r.message, ...(r.notes ?? [])].filter(Boolean).join(" ");
    if (!quiet) ui.toast({ kind: "info", title: scope === "reorganize" ? t("Rien à replacer") : t("Rien à planifier"), detail: message });
    return { status: "nothing", message };
  } catch (e) {
    const message = asAppError(e).message;
    if (!quiet) ui.toast({ kind: "error", title: t("Planning non calculé"), detail: message });
    return { status: "error", message };
  }
}
