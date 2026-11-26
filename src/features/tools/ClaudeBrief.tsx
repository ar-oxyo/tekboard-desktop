// Shown before any AI run on a project: which AI, what it may read, write and not do, with the
// exact command (Claude Code) and instructions.
import { useQuery } from "@tanstack/react-query";
import { Modal } from "../../components/Modal";
import { CodeView } from "../../components/DiffView";
import { Button, ErrorNote, Spinner } from "../../components/ui";
import { api, asAppError } from "../../lib/api";
import { t } from "../../lib/i18n";

export function ClaudeBriefDialog({ repo, task, disclosure = false, confirmLabel, onClose, onConfirm }: { repo: string; task: "tests" | "readme" | "subject" | "analysis"; disclosure?: boolean; confirmLabel: string; onClose: () => void; onConfirm: () => void }) {
  const brief = useQuery({ queryKey: ["claude-brief", repo, task, disclosure], queryFn: () => api.claudeBrief(repo, task, disclosure), staleTime: 0 });
  const p = brief.data?.plan;
  return (
    <Modal
      open
      onClose={onClose}
      width="w-[720px]"
      title={(task === "tests" ? t("Générer des tests unitaires") : task === "readme" ? t("Écrire le README") : task === "analysis" ? t("Analyser le dépôt") : t("Comparer le code au sujet")) + (p ? ` · ${p.provider}` : "")}
      description={t("Rien ne démarre avant ta confirmation.")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("Annuler")}</Button>
          <Button variant="primary" disabled={!p?.available} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      {brief.isLoading ? (
        <p className="flex items-center gap-2 py-6 text-muted"><Spinner /> {t("Préparation…")}</p>
      ) : brief.error || !p ? (
        <ErrorNote>{asAppError(brief.error).message}</ErrorNote>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          {!p.available && <ErrorNote>{p.unavailable ?? t("Cette IA ne peut pas faire cette tâche.")}</ErrorNote>}
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2">
            <dt className="text-muted">{t("Peut lire")}</dt><dd>{p.canRead}</dd>
            <dt className="text-muted">{t("Peut modifier")}</dt><dd>{p.canWrite}</dd>
            <dt className="text-muted">Ne peut pas</dt><dd>{p.cannot}</dd>
            <dt className="text-muted">Compte</dt><dd>{p.account}{p.version && <span className="text-faint"> · {p.version}</span>}</dd>
          </dl>
          {p.argv.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Commande</p>
              <CodeView text={p.argv.join(" ")} className="max-h-28 rounded-md whitespace-pre-wrap" />
            </div>
          )}
          <div>
            <p className="mb-1 text-xs font-medium text-muted">{t("Instructions reçues")}</p>
            <CodeView text={brief.data!.prompt} className="max-h-56 rounded-md" />
          </div>
        </div>
      )}
    </Modal>
  );
}
