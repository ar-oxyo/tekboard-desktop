// README generator: a proposal built from the repository, editable, compared with the
// current file, written only when you say so.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { useEffect, useState } from "react";
import { DiffView } from "../../components/DiffView";
import { Modal } from "../../components/Modal";
import { Button, cn, ErrorNote, Spinner } from "../../components/ui";
import { useJob } from "../../lib/jobs";
import { api, asAppError } from "../../lib/api";
import { useUi } from "../../lib/store";
import { ClaudeBriefDialog } from "./ClaudeBrief";
import { t } from "../../lib/i18n";
import { aiGate } from "../../lib/ai";
import { useAiStatus } from "../settings/AiProvider";

export function ReadmeDialog({ repo }: { repo: string }) {
  const ai = aiGate(useAiStatus().data);
  const qc = useQueryClient();
  const close = useUi((s) => s.closeTool);
  const toast = useUi((s) => s.toast);
  const [disclosure, setDisclosure] = useState(false);
  const draft = useQuery({ queryKey: ["readme-draft", repo, disclosure], queryFn: () => api.readmeDraft(repo, disclosure), staleTime: 0, gcTime: 0 });
  const [text, setText] = useState<string | null>(null);
  const [tab, setTab] = useState<"edit" | "diff">("edit");
  const [brief, setBrief] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const [source, setSource] = useState<"facts" | "claude">("facts");

  // A fresh factual draft replaces the text only while the user has not typed or asked Claude.
  useEffect(() => {
    if (draft.data && source === "facts") setText(draft.data.proposed);
  }, [draft.data, source]);

  const job = useJob(jobId);
  const proposal = job.data?.status === "success" && typeof job.data.summary.readme === "string" ? job.data.summary.readme : null;
  useEffect(() => {
    if (proposal) {
      setSource("claude");
      setText(proposal);
      setTab("edit");
    }
  }, [proposal]);
  const running = jobId !== null && (job.data === undefined || job.data.status === "running");
  const failed = job.data && (job.data.status === "failed" || job.data.status === "cancelled") ? job.data.steps[0]?.detail ?? t("L'IA n'a pas répondu") : null;

  const diff = useQuery({ queryKey: ["readme-diff", repo, text], queryFn: () => api.readmeDiff(repo, text ?? ""), enabled: tab === "diff" && text !== null, staleTime: 0 });
  const write = useMutation({
    mutationFn: () => api.readmeWrite(repo, text ?? "", draft.data?.currentHash ?? null),
    onSuccess: (saved) => {
      toast({ kind: "ok", title: "README.md written", detail: saved ? "The previous version was saved in TekBoard's backups." : undefined });
      void qc.invalidateQueries({ queryKey: ["repos"] });
      close();
    },
  });
  const startAi = useMutation({ mutationFn: () => api.readmeAiStart(repo, disclosure), onSuccess: setJobId, onError: (e) => toast({ kind: "error", title: t("L'IA n'a pas pu démarrer"), detail: asAppError(e).message }) });
  const exists = draft.data?.current !== null && draft.data?.current !== undefined;

  return (
    <>
      <Modal
        open
        onClose={close}
        width="w-[860px]"
        title={t("Générer le README")}
        description={repo.split("/").pop()}
        footer={
          <>
            <span className="mr-auto text-xs text-muted">{exists ? t("README.md existe : compare avant de le remplacer. Le fichier actuel est sauvegardé d'abord.") : t("Ce projet n'a pas encore de README.md.")}</span>
            <Button variant="ghost" onClick={close}>{t("Annuler")}</Button>
            <Button variant="primary" busy={write.isPending} disabled={text === null || text.trim() === "" || running} disabledReason={running ? null : t("Le README est vide")} onClick={() => write.mutate()}>{exists ? t("Remplacer README.md") : t("Écrire README.md")}</Button>
          </>
        }
      >
        {draft.isLoading && text === null ? (
          <p className="flex items-center gap-2 py-8 text-muted"><Spinner /> {t("Lecture du projet…")}</p>
        ) : draft.error ? (
          <ErrorNote>{asAppError(draft.error).message}</ErrorNote>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                {(["edit", "diff"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setTab(k)} className={cn("h-7 rounded-md px-3 text-sm transition-colors", tab === k ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-fg")}>{k === "edit" ? t("Proposition (modifiable)") : exists ? t("Différences avec l'actuel") : t("Ce qui sera écrit")}</button>
                ))}
              </div>
              <label className="ml-auto flex items-center gap-2 text-xs text-muted" title={t("Ajoute une phrase dans la section Tests disant qu'une IA a aidé. Vérifie ce qu'exigent les règles de ton projet.")}>
                <input type="checkbox" className="accent-(--color-accent)" checked={disclosure} onChange={(e) => setDisclosure(e.target.checked)} />
                Mentionner l'aide d'une IA
              </label>
              <Button size="sm" icon={<Bot className="size-3.5" />} busy={running || startAi.isPending} disabled={!ai.read} disabledReason={ai.why} onClick={() => setBrief(true)}>{running ? t("L'IA lit le projet…") : t("Enrichir avec l'IA…")}</Button>
            </div>
            {source === "facts" && (draft.data?.missing.length ?? 0) > 0 && <p className="text-xs text-muted">{t("Construit seulement à partir des faits trouvés dans le dépôt. Laissé à compléter en")} <code className="font-mono">TODO</code> comments: {draft.data!.missing.join("; ")}.</p>}
            {source === "claude" && <p className="text-xs text-muted">{t("Écrit par l'IA ({name}) à partir des fichiers lus. Vérifie-le face à ton code avant de l'écrire : elle peut se tromper.", { name: ai.name })}</p>}
            {failed && <ErrorNote title={ai.name}>{failed}</ErrorNote>}
            {tab === "edit" ? (
              <textarea spellCheck={false} className="field selectable h-[46vh] w-full resize-none border border-ink/8 p-3 font-mono text-xs leading-relaxed text-fg focus:border-accent focus:outline-none" value={text ?? ""} onChange={(e) => { setText(e.target.value); if (source === "facts") setSource("claude"); }} />
            ) : diff.isLoading ? (
              <p className="flex items-center gap-2 py-6 text-muted"><Spinner /> {t("Comparaison…")}</p>
            ) : (diff.data ?? "").trim() === "" ? (
              <p className="py-6 text-sm text-muted">{t("Identique au README.md actuel.")}</p>
            ) : (
              <DiffView text={diff.data!} className="h-[46vh] rounded-md" />
            )}
            {write.error && <ErrorNote>{asAppError(write.error).message}</ErrorNote>}
          </div>
        )}
      </Modal>
      {brief && <ClaudeBriefDialog repo={repo} task="readme" disclosure={disclosure} confirmLabel={t("Lancer")} onClose={() => setBrief(false)} onConfirm={() => { setBrief(false); startAi.mutate(); }} />}
    </>
  );
}
