// Settings → Accounts → MY Epitech: the optional AER account, beside the student one. Its own
// sign-in window and browser session, its own sync and date; its sessions can show in the
// planning. Students without one only see a single line about it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, UserPlus } from "lucide-react";
import { useState } from "react";
import { Button, cn, Dot, ErrorNote } from "../../components/ui";
import { api, asAppError } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { t } from "../../lib/i18n";
import { useUi } from "../../lib/store";

export const AER_STATUS_KEY = ["my-status", "aer"] as const;

export function AerAccount() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const status = useQuery({ queryKey: AER_STATUS_KEY, queryFn: api.myAerStatus, refetchInterval: (q) => (q.state.data?.windowOpen ? 3000 : false) });
  const [confirm, setConfirm] = useState(false);
  const sync = useMutation({
    mutationFn: api.myAerSync,
    onSuccess: (r) => toast({ kind: "ok", title: t("Compte AER synchronisé"), detail: r.failed > 0 ? t("{n} réponse(s) indisponible(s), le reste est à jour.", { n: r.failed }) : undefined }),
    onSettled: () => void qc.invalidateQueries({ queryKey: AER_STATUS_KEY }),
  });
  const forget = useMutation({
    mutationFn: api.myAerForget,
    onSuccess: () => {
      setConfirm(false);
      toast({ kind: "ok", title: t("Compte AER retiré de cet ordinateur") });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: AER_STATUS_KEY }),
  });
  const s = status.data;
  if (!s) return null;
  if (!s.sessionStored && !sync.isPending) {
    return (
      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
        <span className="text-xs text-faint">{t("Tu es AER avec un compte à part ? Ajoute-le pour voir ses séances dans ton planning.")}</span>
        <Button size="sm" variant="ghost" icon={<UserPlus className="size-3.5" />} onClick={() => sync.mutate()}>
          {t("Ajouter le compte AER")}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2 border-t border-line px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-[3px] bg-ink/8 px-1.5 font-mono text-2xs">AER</span>
        <Dot tone={s.connected ? "ok" : "neutral"}>{s.connected ? t("Connecté") : sync.isPending ? t("En attente de connexion") : t("Session gardée")}</Dot>
        {s.account && <span className="selectable min-w-0 truncate text-xs text-muted">{s.account}</span>}
        <span className="ml-auto text-xs text-faint">{s.lastSync ? t("Synchro {when}", { when: timeAgo(s.lastSync) }) : t("Jamais synchronisé")}</span>
      </div>
      <p className="text-xs text-faint">{t("Seules les séances de ce compte sont lues, pour ton planning. Tes projets, rendus et crédits restent ceux du compte Student.")}</p>
      {sync.error && <ErrorNote>{asAppError(sync.error).message}</ErrorNote>}
      {forget.error && <ErrorNote>{asAppError(forget.error).message}</ErrorNote>}
      <div className={cn("flex flex-wrap items-center gap-2", confirm && "rounded-md border border-danger/30 bg-danger/10 px-3 py-2")}>
        {confirm ? (
          <>
            <span className="mr-auto text-xs text-danger">{t("Retirer le compte AER, sa session et ses séances de cet ordinateur ?")}</span>
            <Button size="sm" variant="danger" busy={forget.isPending} onClick={() => forget.mutate()}>
              {t("Retirer")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              {t("Garder")}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" icon={<RefreshCw className={cn("size-3.5", sync.isPending && "anim-spin")} />} busy={sync.isPending} onClick={() => sync.mutate()}>
              {sync.isPending ? t("Connexion au compte AER…") : t("Synchroniser")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
              {t("Retirer…")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
