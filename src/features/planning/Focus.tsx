// Focus mode: one task or session, a running timer, the workspace opened. Stopping records the
// time really spent (and takes it off the project's remaining estimate).
import { useQueryClient } from "@tanstack/react-query";
import { Pause, Square, Timer, X } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "../../components/ui";
import { api, asAppError } from "../../lib/api";
import { useNow } from "../../lib/hooks";
import { fmtDur } from "../../lib/plan";
import { useUi, type Focus } from "../../lib/store";
import { planKey } from "./usePlan";

/** Starts the timer; opens the IDE and terminal of the project when it is a local repository. */
export function startFocus(f: Omit<Focus, "startedAt">, openWorkspace = true) {
  const ui = useUi.getState();
  if (ui.focus) {
    ui.toast({ kind: "error", title: "A focus session is already running", detail: `Stop “${ui.focus.title}” first.` });
    return;
  }
  ui.setFocus({ ...f, startedAt: Date.now() });
  if (openWorkspace && f.project && f.project.startsWith("/")) {
    api.openWorkspace(f.project).then(
      (r) => (r.ide || r.terminal) && ui.toast({ kind: "error", title: "Workspace partly opened", detail: r.ide ?? r.terminal ?? "" }),
      (e) => ui.toast({ kind: "error", title: "Could not open the workspace", detail: asAppError(e).message }),
    );
  }
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h > 0 ? `${h}:` : ""}${String(m).padStart(h > 0 ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** The running timer, pinned at the bottom right of every screen. */
export function FocusBar() {
  const focus = useUi((s) => s.focus);
  const now = useNow(1000);
  const qc = useQueryClient();
  const [stopping, setStopping] = useState(false);
  if (!focus) return null;
  const elapsed = now.getTime() - focus.startedAt;
  const over = focus.plannedMin !== null && elapsed > focus.plannedMin * 60_000;

  const stop = async (markDone: boolean) => {
    const ui = useUi.getState();
    const seconds = Math.round(elapsed / 1000);
    setStopping(true);
    try {
      if (seconds >= 60) await api.planLogAdd(focus.project, focus.taskId, focus.title, Math.floor(focus.startedAt / 1000), Math.min(seconds, 86_400));
      if (markDone && focus.eventId !== null) {
        const ev = (await api.planState()).events.find((e) => e.id === focus.eventId);
        if (ev) await api.planEventSave({ ...ev, done: true });
      }
      if (markDone && focus.taskId !== null) {
        const t = (await api.planState()).tasks.find((x) => x.id === focus.taskId);
        if (t && t.doneAt === null) await api.planTaskSave({ ...t, doneAt: Math.floor(Date.now() / 1000) });
      }
      ui.setFocus(null);
      ui.toast({ kind: "ok", title: seconds >= 60 ? `${fmtDur(seconds / 60)} recorded` : "Stopped", detail: seconds >= 60 ? focus.title : "Less than a minute: nothing recorded." });
    } catch (e) {
      ui.toast({ kind: "error", title: "Time not recorded", detail: asAppError(e).message });
    } finally {
      setStopping(false);
      void qc.invalidateQueries({ queryKey: planKey });
    }
  };

  return (
    <div className="glass anim-pop fixed right-5 bottom-5 z-[60] flex items-center gap-3 border border-white/10 py-2 pr-2 pl-3.5" role="status" aria-live="polite">
      <Timer className={over ? "size-4 text-warn" : "size-4 text-accent"} />
      <div className="min-w-0">
        <p className="max-w-56 truncate text-[13px] font-medium">{focus.title}</p>
        <p className="font-mono text-xs text-muted">
          {clock(elapsed)}
          {focus.plannedMin !== null && <span className={over ? "text-warn" : "text-faint"}> / {fmtDur(focus.plannedMin)}</span>}
        </p>
      </div>
      <Button size="sm" icon={<Square className="size-3" />} busy={stopping} onClick={() => void stop(true)} title="Records the time and marks the session (or task) done">
        Done
      </Button>
      <IconButton label="Stop and record the time, without marking it done" onClick={() => void stop(false)}>
        <Pause className="size-4" />
      </IconButton>
      <IconButton
        label="Discard this timer (nothing recorded)"
        onClick={() => {
          useUi.getState().setFocus(null);
        }}
      >
        <X className="size-4" />
      </IconButton>
    </div>
  );
}
