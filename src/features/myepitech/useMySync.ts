// The one MY Epitech "Sync" button, wherever it is shown. The backend does the whole flow
// (`my_sync_auto`): session in memory, else the stored session reopened out of sight, else the
// MY Epitech window for the user to sign in; the sync starts as soon as a token is there, and
// the window closes afterwards only if this sync opened it. Here: one shared state, the
// phase reported by the backend, and one discreet toast with the result.
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { api, asAppError, type MySyncReport } from "../../lib/api";
import { invalidate, getQueryClient } from "../../lib/sync";
import { plural, t } from "../../lib/i18n";
import { useUi } from "../../lib/store";

export type SyncPhase = "idle" | "connecting" | "sign-in" | "syncing";

interface SyncState {
  phase: SyncPhase;
  busy: boolean;
}

export const useMySyncState = create<SyncState>(() => ({ phase: "idle", busy: false }));

let listening = false;
function listenOnce() {
  if (listening) return;
  listening = true;
  void listen<{ phase: string }>("my-sync-progress", (e) => {
    const p = e.payload.phase;
    if (p === "connecting" || p === "sign-in" || p === "syncing") useMySyncState.setState({ phase: p });
    else useMySyncState.setState({ phase: "idle" });
  });
}

/** Label of the button for the current phase. */
export function syncLabel(phase: SyncPhase): string {
  return phase === "connecting" ? t("Connexion…") : phase === "sign-in" ? t("Connecte-toi dans MY Epitech…") : phase === "syncing" ? t("Synchronisation…") : t("Sync");
}

/** Runs the sync; resolves with its report, or null when it did not happen. */
export async function runMySync(): Promise<MySyncReport | null> {
  listenOnce();
  if (useMySyncState.getState().busy) return null;
  useMySyncState.setState({ busy: true, phase: "connecting" });
  const toast = useUi.getState().toast;
  try {
    const r = await api.mySyncAuto();
    const parts = [
      r.failed > 0 ? plural(r.failed, "{n} élément indisponible", "{n} éléments indisponibles") : null,
      r.subjectsImported > 0 ? plural(r.subjectsImported, "{n} sujet ajouté", "{n} sujets ajoutés") : null,
      r.subjectsLinked > 0 ? plural(r.subjectsLinked, "{n} sujet associé", "{n} sujets associés") : null,
      r.subjectsToConfirm > 0 ? plural(r.subjectsToConfirm, "{n} association à valider (École → Sujets)", "{n} associations à valider (École → Sujets)") : null,
    ].filter(Boolean);
    toast({ kind: r.failed > 0 ? "info" : "ok", title: t("MY Epitech synchronisé"), detail: parts.join(" · ") || undefined });
    return r;
  } catch (e) {
    const err = asAppError(e);
    toast({ kind: err.code === "busy" ? "info" : "error", title: err.code === "busy" ? t("Synchronisation déjà en cours") : t("Pas synchronisé"), detail: err.message });
    return null;
  } finally {
    useMySyncState.setState({ busy: false, phase: "idle" });
    const qc = getQueryClient();
    if (qc) invalidate(qc, ["my", "subjects", "repos", "plan"]);
  }
}

export function useMySync() {
  listenOnce();
  const { phase, busy } = useMySyncState();
  return { phase, busy, label: syncLabel(busy ? phase : "idle"), sync: runMySync };
}
