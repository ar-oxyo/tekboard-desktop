// Suggestions found by TekBoard's rules (src-tauri/src/ai/insights.rs): a few lines, each with
// what can be done about it. "Plus tard" hides it for three hours, "Ignorer" for good.
import { listen } from "@tauri-apps/api/event";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlarmClock, CalendarClock, FileText, FlaskConical, Hourglass, Layers, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Button, IconButton } from "../../components/ui";
import { api, asAppError, type Insight, type InsightAction } from "../../lib/api";
import { useUi } from "../../lib/store";
import { t } from "../../lib/i18n";

const ICON: Record<string, ReactNode> = { deadline: <CalendarClock className="size-4" />, stalled: <Hourglass className="size-4" />, overload: <Layers className="size-4" />, missed: <AlarmClock className="size-4" />, tests: <FlaskConical className="size-4" />, subject: <FileText className="size-4" /> };

export const useInsights = () => useQuery({ queryKey: ["insights"], queryFn: api.insightsList, refetchInterval: 5 * 60_000 });

export async function runInsightAction(i: Insight, a: InsightAction) {
  const ui = useUi.getState();
  try {
    if (a.ask) ui.openAssistant({ text: a.ask });
    else if (a.tool) {
      const r = await api.aiTool(a.tool, a.args ?? {});
      if (r.status === "proposed") ui.openAssistant();
      else if (r.status === "nothing") ui.toast({ kind: "info", title: String(r.message ?? t("Rien à faire")) });
    }
    await api.insightSet(i.id, "done");
  } catch (e) {
    ui.toast({ kind: "error", title: "Action non faite", detail: asAppError(e).message });
  }
}

export function InsightList({ compact }: { compact?: boolean }) {
  const list = useInsights();
  const set = useMutation({ mutationFn: ({ id, s }: { id: number; s: "dismiss" | "snooze" }) => api.insightSet(id, s, 3) });
  if (!list.data?.length) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {list.data.slice(0, compact ? 1 : 10).map((i) => (
        <li key={i.id} className="group flex items-start gap-2.5 rounded-lg border border-ink/7 px-3 py-2.5">
          <span className="mt-0.5 shrink-0 text-accent">{ICON[i.kind] ?? <CalendarClock className="size-4" />}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{i.title}</p>
            <p className="text-xs text-muted">{i.body}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {i.actions.map((a) => (
                <Button key={a.label} size="sm" onClick={() => void runInsightAction(i, a)}>
                  {a.label}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => set.mutate({ id: i.id, s: "snooze" })}>
                {t("Plus tard")}
              </Button>
            </div>
          </div>
          <IconButton label="Ignorer" className="opacity-0 group-hover:opacity-100" onClick={() => set.mutate({ id: i.id, s: "dismiss" })}>
            <X className="size-3.5" />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}

const NUDGE_KEY = "tekboard.lastNudge";

/** At most one new suggestion said out loud every 30 minutes; the others wait in the box. */
export function useNudges() {
  useEffect(() => {
    const off = listen<string[]>("insights-new", async (e) => {
      const last = Number(localStorage.getItem(NUDGE_KEY) ?? 0);
      if (Date.now() - last < 30 * 60_000 || !e.payload.length) return;
      const all = await api.insightsList().catch(() => []);
      const first = all.find((i) => e.payload.includes(i.key));
      if (!first) return;
      localStorage.setItem(NUDGE_KEY, String(Date.now()));
      useUi.getState().toast({ kind: "info", title: first.title, detail: `${first.body} — Ouvre Artix (Ctrl+J) pour agir.` });
    });
    return () => void off.then((f) => f());
  }, []);
}
