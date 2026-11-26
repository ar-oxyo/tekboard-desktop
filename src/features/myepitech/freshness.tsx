// How old the MY Epitech data is. The date is the OLDEST of the main answers of the last syncs
// (see myview::freshness), so one fresh answer cannot hide a stale one. Past a day, the screens
// say so discreetly and TekBoard suggests a sync once per session — never on its own.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { t } from "../../lib/i18n";
import { useUi } from "../../lib/store";
import { cn } from "../../components/ui";
import { runMySync } from "./useMySync";
import { isStale } from "../../lib/myFreshness";

export function useMyFreshness() {
  const o = useQuery({ queryKey: ["my-overview"], queryFn: api.myOverview, staleTime: 60_000 });
  const at = o.data?.syncedAt ?? null;
  return { at, stale: isStale(at), loaded: o.isSuccess };
}

/** "il y a 3 j", orange past a day. */
export function Freshness({ className }: { className?: string }) {
  const { at, stale } = useMyFreshness();
  if (at === null) return null;
  return (
    <span className={cn("text-xs", stale ? "text-warn" : "text-faint", className)} title={stale ? t("Données MY Epitech de plus d'un jour : une synchronisation les remettrait à jour.") : undefined}>
      {t("données relues {ago}", { ago: timeAgo(at) })}
    </span>
  );
}

let proposed = false;

/** Mounted once: past a day, suggests one sync per session (only if a session is kept). */
export function useStaleMyPrompt() {
  const status = useQuery({ queryKey: ["my-status"], queryFn: api.myStatus, staleTime: 60_000 });
  const { at, stale } = useMyFreshness();
  const kept = status.data?.sessionStored || status.data?.connected;
  useEffect(() => {
    if (proposed || !stale || !kept || at === null) return;
    proposed = true;
    useUi.getState().toast({ kind: "info", title: t("Données MY Epitech anciennes"), detail: t("Relues {ago}. Crédits, notes et rendus ont pu changer.", { ago: timeAgo(at) }), action: { label: t("Synchroniser"), run: () => void runMySync() }, duration: 12_000 });
  }, [stale, kept, at]);
}
