// "Partager": what will leave (files, size, preview), what forbids it (secrets), the school
// rules reminder when it comes from a school project, and to whom (paired people online).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Send, ShieldAlert } from "lucide-react";
import { api, asAppError, type ShareResource } from "../../lib/api";
import { useUi } from "../../lib/store";
import { formatBytes } from "../../lib/format";
import { KIND_LABEL, recipients } from "../../lib/share";
import { STATUS } from "../../lib/connect";
import { Modal } from "../../components/Modal";
import { CodeView } from "../../components/DiffView";
import { Button, cn, ErrorNote, Spinner } from "../../components/ui";
import { useConnect } from "./ConnectPage";
import { Avatar } from "./Avatar";
import { t } from "../../lib/i18n";

export function ShareDialog({ resource }: { resource: ShareResource }) {
  const close = () => useUi.getState().openShare(null);
  const toast = useUi((s) => s.toast);
  const setPage = useUi((s) => s.setPage);
  const connect = useConnect();
  const check = useQuery({ queryKey: ["share-check", resource], queryFn: () => api.shareCheck(resource), retry: false, staleTime: 0 });
  const [to, setTo] = useState<string | null>(null);
  const [school, setSchool] = useState(false);
  const [busy, setBusy] = useState(false);
  const people = recipients(connect.data?.peers ?? []);
  const c = check.data;
  const reason = !connect.data?.running ? t("TekBoard Connect est désactivé") : c && c.blocked.length > 0 ? t("Envoi bloqué : voir ci-dessus") : !to ? t("Choisis à qui l'envoyer") : c?.school && !school ? t("Confirme le respect des règles de l'école") : null;
  const send = async () => {
    if (!to) return;
    setBusy(true);
    try {
      await api.shareOffer(to, resource, school);
      toast({ kind: "ok", title: t("Proposé"), detail: t("La personne voit ton offre et décide de l'accepter.") });
      close();
    } catch (e) {
      toast({ kind: "error", title: t("Partage impossible"), detail: asAppError(e).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={close}
      title={t("Partager avec TekShare")}
      description={c ? `${KIND_LABEL[c.kind] ?? c.kind} · ${c.title}` : undefined}
      width="w-[640px]"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t("Annuler")}
          </Button>
          <Button variant="primary" icon={<Send className="size-3.5" />} busy={busy} disabled={!!reason} disabledReason={reason} onClick={() => void send()}>
            {t("Proposer")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {check.isLoading && <Spinner />}
        {check.error && <ErrorNote>{asAppError(check.error).message}</ErrorNote>}
        {c && (
          <>
            <p className="text-xs text-muted">
              {t("{n} fichier(s), {s}", { n: c.files.length, s: formatBytes(c.bytes) })} · <span className="font-mono">{c.files.slice(0, 6).join(", ")}{c.files.length > 6 ? "…" : ""}</span>
            </p>
            {c.preview && <CodeView text={c.preview} className="max-h-40 rounded-md" />}
            {c.blocked.map((b, i) => (
              <p key={i} className="flex gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" /> {b}
              </p>
            ))}
            {c.school && (
              <label className="flex gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[13px] text-warn">
                <input type="checkbox" className="mt-0.5 accent-(--color-accent)" checked={school} onChange={(e) => setSchool(e.target.checked)} />
                <span>
                  <AlertTriangle className="mr-1 inline size-3.5" />
                  {t("Ce contenu vient du projet de l'école « {p} ». Partager du code d'un projet noté peut être considéré comme de la triche. Je confirme que ce partage respecte les règles pédagogiques (aide, explication, code autorisé).", { p: c.school })}
                </span>
              </label>
            )}
          </>
        )}
        <section>
          <h3 className="mb-2 text-xs text-faint">{t("À qui")}</h3>
          {!connect.data?.running ? (
            <p className="text-[13px] text-muted">
              {t("TekBoard Connect est désactivé.")}{" "}
              <button type="button" className="text-accent hover:underline" onClick={() => { close(); setPage("connect"); }}>
                {t("L'activer")}
              </button>
            </p>
          ) : people.length === 0 ? (
            <p className="text-[13px] text-muted">{t("Aucun contact connecté pour l'instant. Seules les personnes appairées et en ligne peuvent recevoir.")}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-1.5">
              {people.map((p) => (
                <li key={p.fp}>
                  <button type="button" onClick={() => setTo(p.fp)} className={cn("flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left", to === p.fp ? "border-accent/60 bg-accent-soft/40" : "border-white/8 hover:bg-hover")}>
                    <Avatar profile={p.profile} fp={p.fp} size={28} online />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-fg">{p.profile.nick}</span>
                      <span className="block text-[11px] text-faint">{STATUS[p.profile.status]?.label}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
