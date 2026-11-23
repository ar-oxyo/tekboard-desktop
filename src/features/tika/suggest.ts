// "Plan my day / week / this project / what I did not do": computed by TekBoard's planning
// engine (src-tauri/src/schedule.rs) and shown as a proposal card in Tika's panel.
import { api, asAppError } from "../../lib/api";
import { useUi } from "../../lib/store";

export type PlanScope = "day" | "week" | "two_weeks" | "reorganize";

export async function suggestPlan(scope: PlanScope, project?: string | null) {
  const ui = useUi.getState();
  try {
    const r = (await api.aiTool("suggest_plan", project ? { scope, project } : { scope })) as { status: string; message?: string; notes?: string[] };
    if (r.status === "proposed") {
      ui.closeSheet();
      ui.openAssistant();
    } else ui.toast({ kind: "info", title: scope === "reorganize" ? "Rien à replacer" : "Rien à planifier", detail: [r.message, ...(r.notes ?? [])].filter(Boolean).join(" ") });
  } catch (e) {
    ui.toast({ kind: "error", title: "Planning non calculé", detail: asAppError(e).message });
  }
}
