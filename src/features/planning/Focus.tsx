// Work sessions. The clock lives in the backend (focus.rs): a session cannot stay open by
// accident — it is closed at its planned end when nobody answers, paused while the computer
// sleeps, and a session left open when TekBoard closed ends where TekBoard last saw it.
// This bar only shows it and offers the next step, without pop-ups.
import { listen } from "@tauri-apps/api/event";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Coffee, Pause, Play, Plus, Square, Timer, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, cn, IconButton } from "../../components/ui";
import { api, asAppError, type FocusNotice, type FocusSession } from "../../lib/api";
import { useNow } from "../../lib/hooks";
import { fmtDur } from "../../lib/plan";
import { useUi } from "../../lib/store";
import { t } from "../../lib/i18n";

export const focusKey = ["focus"] as const;

/** Starts a session; opens the IDE and terminal of the project when it is a local repository. */
export function startFocus(f: { title: string; project: string | null; taskId: number | null; eventId: number | null; plannedMin: number | null; thenTitle?: string | null; thenMin?: number | null }, openWorkspace = true) {
  const ui = useUi.getState();
  api.focusStart({ title: f.title, project: f.project, taskId: f.taskId, eventId: f.eventId, minutes: Math.max(5, Math.round(f.plannedMin ?? 50)), thenTitle: f.thenTitle ?? null, thenMin: f.thenMin ?? null }).then(
    () => {
      if (openWorkspace && f.project && f.project.startsWith("/")) {
        api.openWorkspace(f.project).then(
          (r) => (r.ide || r.terminal) && ui.toast({ kind: "error", title: "Espace de travail ouvert en partie", detail: r.ide ?? r.terminal ?? "" }),
          (e) => ui.toast({ kind: "error", title: t("Espace de travail non ouvert"), detail: asAppError(e).message }),
        );
      }
    },
    (e) => ui.toast({ kind: "error", title: t("Session non démarrée"), detail: asAppError(e).message }),
  );
}

const clock = (s: number) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h > 0 ? `${h}:` : ""}${String(m).padStart(h > 0 ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Seconds worked so far (pauses excluded). Exported for the tests. */
export function elapsedOf(f: FocusSession, nowS: number) {
  return Math.max(0, (f.endedAt ?? f.pausedAt ?? nowS) - f.startedAt - f.pausedTotalS);
}

const REASON: Record<string, string> = { auto_overrun: "personne n'a répondu après la fin prévue : enregistrée à l'heure prévue", auto_closed: "TekBoard était fermé : arrêtée au dernier moment où il l'a vue", max: "4 h atteintes", stopped: "pause trop longue" };

/** The running session, pinned at the bottom of every screen. */
export function FocusBar() {
  const focus = useQuery({ queryKey: focusKey, queryFn: api.focusGet, refetchInterval: 60_000 });
  const now = useNow(1000);
  const toast = useUi((s) => s.toast);
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    const off = listen<FocusNotice>("focus-notice", (e) => {
      const n = e.payload;
      if (n.kind === "closed") toast({ kind: "info", title: `Session « ${n.title} » terminée (${fmtDur(n.minutes)})`, detail: REASON[n.reason] ?? undefined });
      if (n.kind === "paused") toast({ kind: "info", title: t("Session en pause"), detail: "L'ordinateur était en veille : ce temps n'est pas compté." });
      if (n.kind === "break") setHint(`Tu travailles depuis ${fmtDur(n.minutes)} : une vraie pause de 10 min ?`);
    });
    return () => void off.then((f) => f());
  }, [toast]);
  const err = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });
  const stop = useMutation({ mutationFn: (done: boolean) => api.focusStop(done), onSuccess: (f) => toast({ kind: "ok", title: (f.seconds ?? 0) >= 60 ? `${fmtDur(Math.round((f.seconds ?? 0) / 60))} enregistrées` : t("Session arrêtée"), detail: (f.seconds ?? 0) >= 60 ? f.title : t("Moins d'une minute : rien d'enregistré.") }), onError: err("Session non arrêtée") });
  const extend = useMutation({ mutationFn: (m: number) => api.focusExtend(m), onError: err("Session non prolongée") });
  const pause = useMutation({ mutationFn: (paused: boolean) => (paused ? api.focusResume() : api.focusPause()), onError: err("Impossible") });
  const discard = useMutation({ mutationFn: api.focusDiscard, onError: err("Impossible") });
  const f = focus.data;
  if (!f) return null;
  const nowS = Math.floor(now.getTime() / 1000);
  const elapsed = elapsedOf(f, nowS);
  const planned = f.plannedMin * 60;
  const due = elapsed >= planned;
  const paused = f.pausedAt !== null;
  const pct = Math.min(100, (elapsed / planned) * 100);
  const next = () => {
    const then = { title: f.thenTitle ?? "", minutes: f.thenMin ?? 10 };
    stop.mutate(true, { onSuccess: () => then.title && startFocus({ title: then.title, project: null, taskId: null, eventId: null, plannedMin: then.minutes }, false) });
  };
  return (
    <div className="glass anim-pop fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col overflow-hidden border border-white/10" role="status" aria-live="polite">
      <div className="flex items-center gap-3 py-2 pr-2 pl-3.5">
        <Timer className={cn("size-4", due ? "text-warn" : paused ? "text-faint" : "text-accent")} />
        <div className="min-w-0">
          <p className="max-w-64 truncate text-[13px] font-medium">{f.title}</p>
          <p className="font-mono text-xs text-muted">
            {clock(elapsed)} <span className={due ? "text-warn" : "text-faint"}>/ {fmtDur(f.plannedMin)}</span>
            {paused && <span className="ml-1.5 font-sans text-faint">{t("en pause")}</span>}
          </p>
        </div>
        {due ? (
          <>
            <span className="text-xs text-warn">{t("Temps écoulé")}</span>
            <Button size="sm" icon={<Plus className="size-3" />} onClick={() => extend.mutate(10)}>
              10 min
            </Button>
            <Button size="sm" icon={<Plus className="size-3" />} onClick={() => extend.mutate(25)}>
              25 min
            </Button>
            {f.thenTitle ? (
              <Button size="sm" variant="primary" icon={<Coffee className="size-3" />} busy={stop.isPending} onClick={next}>
                {f.thenTitle}
              </Button>
            ) : (
              <Button size="sm" variant="primary" icon={<Check className="size-3" />} busy={stop.isPending} onClick={() => stop.mutate(true)}>
                Terminer
              </Button>
            )}
          </>
        ) : (
          <>
            <Button size="sm" icon={<Square className="size-3" />} busy={stop.isPending} onClick={() => stop.mutate(true)} title="Enregistre le temps et marque la session (ou la tâche) comme faite">
              {t("Fait")}
            </Button>
            <IconButton label={paused ? "Reprendre" : t("Pause (le temps ne compte pas)")} onClick={() => pause.mutate(paused)}>
              {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            </IconButton>
            <IconButton label={t("Arrêter sans marquer comme fait")} onClick={() => stop.mutate(false)}>
              <Square className="size-3.5" />
            </IconButton>
            <IconButton label={t("Abandonner (rien d'enregistré)")} onClick={() => discard.mutate()}>
              <X className="size-4" />
            </IconButton>
          </>
        )}
      </div>
      {hint && !due && (
        <button type="button" onClick={() => setHint(null)} className="border-t border-white/6 px-3.5 py-1.5 text-left text-xs text-muted hover:text-fg">
          {hint} <span className="text-faint">· ok</span>
        </button>
      )}
      <span className="h-0.5 bg-white/5">
        <span className={cn("block h-full", due ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
