// Artix's settings: which model answers, what agents may spend and for how long, whether new
// subjects are read without asking, and exactly what Artix receives at the start of a message.
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Select } from "../../components/Select";
import { Button, Card, CardTitle, Field, Input } from "../../components/ui";
import { api, asAppError, type AiSettings } from "../../lib/api";
import { useUi } from "../../lib/store";
import { t } from "../../lib/i18n";

const MODELS = [
  { value: "", label: "Celui de Claude Code par défaut" },
  { value: "haiku", label: "Haiku", hint: t("le plus rapide, le moins cher") },
  { value: "sonnet", label: "Sonnet", hint: "équilibré" },
  { value: "opus", label: "Opus", hint: t("le plus fin, plus lent") },
];

export function AiSettingsCard() {
  const toast = useUi((s) => s.toast);
  const saved = useQuery({ queryKey: ["settings", "ai"], queryFn: api.aiSettingsGet });
  const [s, setS] = useState<AiSettings | null>(null);
  useEffect(() => {
    if (saved.data && !s) setS(saved.data);
  }, [saved.data, s]);
  const preview = useQuery({ queryKey: ["ai-context-preview"], queryFn: () => api.aiContextPreview({ page: "settings" }), enabled: false });
  const save = useMutation({ mutationFn: (v: AiSettings) => api.aiSettingsSet(v), onSuccess: (v) => (setS(v), toast({ kind: "ok", title: t("Réglages d'Artix enregistrés") })), onError: (e) => toast({ kind: "error", title: t("Non enregistré"), detail: asAppError(e).message }) });
  if (!s) return <p className="text-[13px] text-muted">{t("Chargement…")}</p>;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card>
        <CardTitle right={<Button size="sm" variant="primary" busy={save.isPending} onClick={() => save.mutate(s)}>{t("Enregistrer")}</Button>}>{t("Modèles et limites")}</CardTitle>
        <div className="grid grid-cols-2 gap-3 p-4">
          <Field label={t("Conversation avec Artix")} hint={t("Réponses rapides et courantes")}>
            <Select value={s.chatModel} onChange={(v) => setS({ ...s, chatModel: v })} options={MODELS} label={t("Modèle de conversation")} />
          </Field>
          <Field label={t("Agents (moulinette, tests)")} hint={t("Travail long sur ton code")}>
            <Select value={s.agentModel} onChange={(v) => setS({ ...s, agentModel: v })} options={MODELS} label={t("Modèle des agents")} />
          </Field>
          <Field label={t("Durée maximale d'un agent")} hint={t("minutes, 3 à 60")}>
            <Input type="number" min={3} max={60} value={s.agentMinutes} onChange={(e) => setS({ ...s, agentMinutes: Number(e.target.value) || 15 })} />
          </Field>
          <Field label={t("Budget par tâche d'agent")} hint={t("en dollars, 0 = pas de limite (estimation de Claude Code)")}>
            <Input type="number" min={0} max={50} step={0.5} value={s.agentBudgetUsd} onChange={(e) => setS({ ...s, agentBudgetUsd: Number(e.target.value) || 0 })} />
          </Field>
          <label className="col-span-2 flex items-start gap-2 text-[13px] text-muted">
            <input type="checkbox" className="mt-0.5 accent-(--color-accent)" checked={s.autoAnalyze} onChange={(e) => setS({ ...s, autoAnalyze: e.target.checked })} />
            <span>
              {t("Analyser automatiquement les nouveaux sujets récupérés de MY Epitech")}
              <span className="block text-xs text-faint">Chaque sujet n'est lu qu'une fois ; son résumé sert ensuite à Artix, au planning et à la moulinette. Compte dans ton usage de Claude.</span>
            </span>
          </label>
        </div>
      </Card>
      <Card>
        <CardTitle right={<Button size="sm" onClick={() => void preview.refetch()} busy={preview.isFetching}>Afficher</Button>}>{t("Ce que Artix reçoit au début d'un message")}</CardTitle>
        <div className="p-4 text-[13px] text-muted">
          <p className="mb-2">Une courte carte de contexte (environ 1 à 2 k tokens) : écran, journée, rendus proches, session en cours, souvenirs utiles. Le reste, Artix le lit avec ses outils quand il en a besoin. Aucun mot de passe ni jeton n'y figure.</p>
          {preview.data && <pre className="selectable max-h-80 overflow-auto rounded-lg bg-black/25 p-3 font-mono text-xs whitespace-pre-wrap text-fg">{preview.data}</pre>}
          {preview.error && <p className="text-danger">{asAppError(preview.error).message}</p>}
          <p className="mt-2 text-xs text-faint">La mémoire se consulte et se corrige dans le panneau d'Artix (icône cerveau). Les instructions d'Artix se modifient dans Réglages → Prompts.</p>
        </div>
      </Card>
    </div>
  );
}
