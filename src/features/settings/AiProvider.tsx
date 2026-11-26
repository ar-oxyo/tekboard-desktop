// Which AI answers in TekBoard: none, Claude Code, OpenRouter (an API key, free models) or a
// local model through Ollama. Used in Settings → AI and in the first-launch assistant.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Cloud, Cpu, Download, ExternalLink, KeyRound, Play, RefreshCw, TerminalSquare, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Modal } from "../../components/Modal";
import { Select } from "../../components/Select";
import { Badge, Button, Card, CardTitle, cn, Code, ErrorNote, Field, Input, Spinner } from "../../components/ui";
import { api, asAppError, type AiProviderKind, type AiSettings, type OpenRouterModel } from "../../lib/api";
import { useSettings, keys } from "../../lib/hooks";
import { useJob } from "../../lib/jobs";
import { useUi } from "../../lib/store";
import { t } from "../../lib/i18n";
import { ClaudeCard } from "./ClaudeCard";

export const AI_KEY = ["settings", "ai"] as const;
export const AI_STATUS_KEY = ["ai-provider"] as const;

/** The AI settings, saved at once on change. */
export function useAiSettings() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const query = useQuery({ queryKey: AI_KEY, queryFn: api.aiSettingsGet });
  const save = useMutation({
    mutationFn: (patch: Partial<AiSettings>) => api.aiSettingsSet({ ...(qc.getQueryData<AiSettings>(AI_KEY) ?? query.data!), ...patch }),
    onSuccess: (v) => {
      qc.setQueryData(AI_KEY, v);
      void qc.invalidateQueries({ queryKey: AI_STATUS_KEY });
    },
    onError: (e) => toast({ kind: "error", title: t("Non enregistré"), detail: asAppError(e).message }),
  });
  return { settings: query.data, save };
}

/** The provider in use and what it can do (for the screens that need AI). */
export function useAiStatus() {
  return useQuery({ queryKey: AI_STATUS_KEY, queryFn: api.aiProviderStatus, staleTime: 30_000 });
}

const PROVIDERS: Array<{ id: AiProviderKind; name: string; icon: ReactNode; text: string; tags: string[] }> = [
  { id: "claude", name: "Claude Code", icon: <TerminalSquare className="size-4" />, text: t("Le plus capable : toutes les fonctions, agents compris. Nécessite Claude Code installé et un compte Claude."), tags: [t("Toutes les fonctions")] },
  { id: "openrouter", name: "OpenRouter", icon: <Cloud className="size-4" />, text: t("Une clé API gratuite donne accès à des modèles gratuits en ligne. Rien à installer."), tags: [t("Gratuit"), t("Sans installation")] },
  { id: "ollama", name: t("IA locale (Ollama)"), icon: <Cpu className="size-4" />, text: t("Un modèle qui tourne sur ton ordinateur : sans clé, sans compte, rien ne sort de ta machine."), tags: [t("Hors ligne"), t("Privé")] },
  { id: "none", name: t("Sans IA"), icon: <Ban className="size-4" />, text: t("TekBoard fonctionne sans IA ; les fonctions d'Artix sont simplement masquées."), tags: [] },
];

export function ProviderPicker() {
  const { settings, save } = useAiSettings();
  if (!settings) return <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> {t("Chargement…")}</p>;
  const current = settings.provider || "none";
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("Fournisseur d'IA")}>
      {PROVIDERS.map((p) => {
        const on = current === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={save.isPending}
            onClick={() => !on && save.mutate({ provider: p.id })}
            className={cn("flex flex-col gap-1.5 rounded-(--radius-card) border p-3 text-left transition-colors duration-150", on ? "border-accent bg-accent/8" : "border-line hover:border-line-strong")}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-fg">
              <span className={on ? "text-accent" : "text-muted"}>{p.icon}</span>
              {p.name}
              {on && <Check className="ml-auto size-3.5 text-accent" />}
            </span>
            <span className="text-xs text-muted">{p.text}</span>
            {p.tags.length > 0 && (
              <span className="flex flex-wrap gap-1">
                {p.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** What works with the provider in use. */
export function Capabilities() {
  const status = useAiStatus();
  const s = status.data;
  if (!s || s.provider === "none") return null;
  const rows: Array<[string, boolean, string?]> = [
    [t("Conversation avec Artix (planning, tâches, projets)"), s.caps.chat],
    [t("Assistant de planning et lecture des sujets"), s.caps.text],
    [t("Analyse d'un projet, README, contrôle du sujet"), s.caps.readFiles],
    [t("Moulinette d'Artix et génération de tests"), s.caps.agents, s.caps.agents ? undefined : t("Claude Code uniquement : ces agents modifient des fichiers et lancent des commandes dans un bac à sable.")],
  ];
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {rows.map(([label, ok, why]) => (
        <li key={label} className="flex items-start gap-2">
          <span className={cn("mt-0.5 size-1.5 shrink-0 rounded-full", ok ? "bg-ok" : "bg-faint")} />
          <span className={ok ? "text-fg" : "text-muted"}>
            {label}
            {why && <span className="block text-faint">{why}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TestButton({ disabled }: { disabled?: boolean }) {
  const test = useMutation({ mutationFn: api.aiProviderTest });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" icon={<Play className="size-3.5" />} busy={test.isPending} disabled={disabled} onClick={() => test.mutate()}>
        {t("Tester la connexion")}
      </Button>
      {test.isPending && <span className="text-xs text-muted">{t("Question au modèle… quelques secondes.")}</span>}
      {test.data && <span className={cn("selectable min-w-0 text-xs", test.data.ok ? "text-ok" : "text-danger")}>{test.data.ok ? `${test.data.detail} · ${(test.data.ms / 1000).toFixed(1)} s` : test.data.detail}</span>}
    </div>
  );
}

function HelpLink({ url, children }: { url: string; children: ReactNode }) {
  return (
    <button type="button" className="inline-flex items-center gap-1 text-xs text-accent hover:underline" onClick={() => void api.openHelpUrl(url)}>
      {children} <ExternalLink className="size-3" />
    </button>
  );
}

function modelOption(m: OpenRouterModel) {
  const ctx = m.context >= 1000 ? `${Math.round(m.context / 1000)} k` : `${m.context}`;
  const price = m.free ? t("gratuit") : `${m.priceIn.toFixed(2)} $ / ${m.priceOut.toFixed(2)} $ par M tokens`;
  return { value: m.id, label: m.name, hint: [m.recommended ? t("recommandé") : null, price, ctx, m.tools ? t("outils") : t("sans outils")].filter(Boolean).join(" · "), group: m.free ? t("Gratuits") : t("Payants") };
}

function OpenRouterPanel() {
  const qc = useQueryClient();
  const { settings, save } = useAiSettings();
  const key = useQuery({ queryKey: ["openrouter-key"], queryFn: api.aiOpenRouterKey });
  const models = useQuery({ queryKey: ["openrouter-models"], queryFn: () => api.aiOpenRouterModels(false), staleTime: 10 * 60_000, retry: 1 });
  const [typed, setTyped] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [showPaid, setShowPaid] = useState(false);
  const [confirmPaid, setConfirmPaid] = useState(false);
  const setKey = useMutation({
    mutationFn: (k: string | null) => api.aiOpenRouterKeySet(k),
    onSuccess: (v) => {
      qc.setQueryData(["openrouter-key"], v);
      setTyped("");
      setReplacing(false);
      void qc.invalidateQueries({ queryKey: AI_STATUS_KEY });
    },
  });
  const list = models.data ?? [];
  const chosen = list.find((m) => m.id === settings?.openrouterModel);
  // A recommended free model is picked the first time, so the provider works at once.
  useEffect(() => {
    if (settings && !settings.openrouterModel && key.data?.hasKey && list.length > 0) {
      const first = list.find((m) => m.recommended) ?? list.find((m) => m.free);
      if (first) save.mutate({ openrouterModel: first.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.openrouterModel, key.data?.hasKey, list.length]);
  if (!settings) return null;
  const options = list.filter((m) => m.free || showPaid || settings.allowPaid || m.id === settings.openrouterModel).map(modelOption);
  return (
    <div className="flex flex-col gap-4">
      <Field label={t("Clé API OpenRouter")} hint={<HelpLink url="https://openrouter.ai/keys">{t("Créer une clé gratuite sur openrouter.ai")}</HelpLink>}>
        {key.data?.hasKey && !replacing ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="ok"><KeyRound className="mr-1 inline size-3" />{key.data.source === "env" ? t("Clé de l'environnement (OPENROUTER_API_KEY)") : t("Clé enregistrée")} {key.data.hint}</Badge>
            <Button size="sm" variant="ghost" onClick={() => setReplacing(true)}>{t("Remplacer")}</Button>
            {key.data.source === "saved" && <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} busy={setKey.isPending} onClick={() => setKey.mutate(null)}>{t("Supprimer")}</Button>}
          </div>
        ) : (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) setKey.mutate(typed.trim()); }}>
            <Input type="password" className="font-mono text-xs" placeholder="sk-or-v1-…" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={t("Clé API OpenRouter")} />
            <Button type="submit" variant="primary" busy={setKey.isPending} disabled={!typed.trim()} disabledReason={t("Colle d'abord la clé")}>{t("Enregistrer la clé")}</Button>
            {replacing && <Button variant="ghost" onClick={() => setReplacing(false)}>{t("Annuler")}</Button>}
          </form>
        )}
      </Field>
      {setKey.error && <ErrorNote>{asAppError(setKey.error).message}</ErrorNote>}
      <p className="-mt-2 text-xs text-faint">{t("La clé est vérifiée auprès d'OpenRouter puis gardée dans un fichier lisible par toi seul. Elle n'est jamais affichée, ni écrite dans les journaux.")}</p>

      <Field label={t("Modèle")} hint={chosen && !chosen.tools ? t("Ce modèle ne sait pas utiliser d'outils : Artix ne pourra ni lire tes projets ni agir sur ton planning.") : t("Les modèles gratuits ont une limite de requêtes (environ 20 par minute).")}>
        <div className="flex gap-2">
          <Select className="flex-1" value={settings.openrouterModel || null} onChange={(v) => save.mutate({ openrouterModel: v })} options={options} placeholder={models.isLoading ? t("Chargement des modèles…") : t("Choisis un modèle")} label={t("Modèle OpenRouter")} search />
          <Button variant="ghost" icon={<RefreshCw className="size-3.5" />} busy={models.isFetching} title={t("Recharger la liste")} onClick={() => void qc.fetchQuery({ queryKey: ["openrouter-models"], queryFn: () => api.aiOpenRouterModels(true) })} />
        </div>
      </Field>
      {models.error && <ErrorNote>{asAppError(models.error).message}</ErrorNote>}
      <label className="flex items-start gap-2 text-sm text-muted">
        <input type="checkbox" className="mt-0.5 accent-(--color-accent)" checked={settings.allowPaid || showPaid} onChange={(e) => (e.target.checked ? (settings.allowPaid ? setShowPaid(true) : setConfirmPaid(true)) : (setShowPaid(false), save.mutate({ allowPaid: false })))} />
        <span>
          {t("Autoriser les modèles payants")}
          <span className="block text-xs text-faint">{t("Désactivé : TekBoard refuse tout modèle payant, même si un modèle gratuit le devient.")}</span>
        </span>
      </label>
      <TestButton disabled={!key.data?.hasKey || !settings.openrouterModel} />
      <Modal
        open={confirmPaid}
        onClose={() => setConfirmPaid(false)}
        title={t("Autoriser les modèles payants ?")}
        description={t("Un modèle payant consomme les crédits de ton compte OpenRouter à chaque message. TekBoard ne change jamais de modèle tout seul : seul celui que tu choisis sera utilisé.")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmPaid(false)}>{t("Rester sur les modèles gratuits")}</Button>
            <Button variant="primary" onClick={() => { setConfirmPaid(false); setShowPaid(true); save.mutate({ allowPaid: true }); }}>{t("Autoriser")}</Button>
          </>
        }
      >
        <p className="px-5 pb-4 text-sm text-muted">{t("Tu peux revenir en arrière à tout moment en décochant la case.")}</p>
      </Modal>
    </div>
  );
}

function OllamaPanel() {
  const qc = useQueryClient();
  const { settings, save } = useAiSettings();
  const info = useQuery({ queryKey: ["ollama-info"], queryFn: api.aiOllamaInfo, refetchOnWindowFocus: true });
  const [jobId, setJobId] = useState<number | null>(null);
  const [other, setOther] = useState("");
  const job = useJob(jobId);
  const pull = useMutation({ mutationFn: (m: string) => api.aiOllamaPull(m), onSuccess: setJobId });
  const pulling = job.data?.status === "running";
  const pulled = job.data?.status === "success" ? (job.data.repo ?? null) : null;
  useEffect(() => {
    if (pulled) {
      void qc.invalidateQueries({ queryKey: ["ollama-info"] });
      save.mutate({ ollamaModel: pulled });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulled]);
  const [url, setUrl] = useState<string | null>(null);
  if (!settings) return null;
  const d = info.data;
  const installed = d?.models ?? [];
  const hasRecommended = d && installed.some((m) => m.name === d.recommended.model);
  const progress = typeof job.data?.summary.progress === "number" ? (job.data.summary.progress as number) : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {!d ? <span className="flex items-center gap-2 text-muted"><Spinner /> {t("Recherche d'Ollama…")}</span> : d.running ? <Badge tone="ok">Ollama {d.version}</Badge> : <Badge tone={d.installed ? "warn" : "danger"}>{d.installed ? t("Installé, arrêté") : t("Non installé")}</Badge>}
        {d && <span className="text-xs text-faint">{t("Mémoire {ram} Go", { ram: Math.round(d.hardware.ramGb) })}{d.hardware.gpu ? ` · ${d.hardware.gpu} (${Math.round(d.hardware.vramGb ?? 0)} Go)` : ""}</span>}
        <Button size="sm" variant="ghost" className="ml-auto" icon={<RefreshCw className="size-3.5" />} busy={info.isFetching} onClick={() => void info.refetch()}>{t("Revérifier")}</Button>
      </div>
      {d && !d.running && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-bg p-3 text-sm text-muted">
          <p>{d.detail}</p>
          {d.installed ? <Code>ollama serve</Code> : <Code>curl -fsSL https://ollama.com/install.sh | sh</Code>}
          <HelpLink url="https://ollama.com/download/linux">{t("Instructions officielles d'Ollama")}</HelpLink>
        </div>
      )}
      {d?.running && (
        <>
          <Field label={t("Modèle utilisé")} hint={installed.length === 0 ? t("Aucun modèle installé : installe celui qui est recommandé ci-dessous.") : undefined}>
            <Select value={settings.ollamaModel || null} onChange={(v) => save.mutate({ ollamaModel: v })} options={installed.map((m) => ({ value: m.name, label: m.name, hint: [m.parameters, `${m.sizeGb} Go`].filter(Boolean).join(" · ") }))} placeholder={t("Choisis un modèle installé")} label={t("Modèle local")} />
          </Field>
          {!hasRecommended && (
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-bg p-3">
              <p className="text-sm text-fg">{t("Recommandé pour ton ordinateur :")} <span className="font-mono">{d.recommended.model}</span> <span className="text-xs text-faint">({t("{n} Go à télécharger", { n: d.recommended.downloadGb })})</span></p>
              <p className="text-xs text-muted">{d.recommended.why}</p>
              <div><Button size="sm" variant="primary" icon={<Download className="size-3.5" />} busy={pull.isPending || pulling} onClick={() => pull.mutate(d.recommended.model)}>{t("Installer ce modèle")}</Button></div>
            </div>
          )}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (other.trim()) pull.mutate(other.trim()); }}>
            <Input className="font-mono text-xs" placeholder={t("Autre modèle (ex. llama3.2:3b)")} value={other} onChange={(e) => setOther(e.target.value)} />
            <Button type="submit" icon={<Download className="size-3.5" />} disabled={!other.trim() || pulling}>{t("Installer")}</Button>
          </form>
          {job.data && (
            <div className="flex flex-col gap-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-ink/8"><div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} /></div>
              <span className={cn("text-xs", job.data.status === "failed" ? "text-danger" : "text-muted")}>
                {job.data.status === "running" ? `${job.data.title} · ${(job.data.summary.progressText as string) ?? t("préparation…")}` : job.data.status === "success" ? t("Modèle installé et choisi.") : String(job.data.summary.error ?? job.data.status)}
              </span>
            </div>
          )}
          {pull.error && <ErrorNote>{asAppError(pull.error).message}</ErrorNote>}
          <TestButton disabled={!settings.ollamaModel} />
        </>
      )}
      <Field label={t("Adresse du service Ollama")} hint={t("Laisse la valeur par défaut si Ollama tourne sur cet ordinateur.")}>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (url !== null) save.mutate({ ollamaUrl: url }, { onSuccess: () => { setUrl(null); void info.refetch(); } }); }}>
          <Input className="font-mono text-xs" value={url ?? settings.ollamaUrl} onChange={(e) => setUrl(e.target.value)} />
          {url !== null && url !== settings.ollamaUrl && <Button type="submit">{t("Utiliser")}</Button>}
        </form>
      </Field>
    </div>
  );
}

function ClaudePanel() {
  const qc = useQueryClient();
  const settings = useSettings();
  const save = useMutation({ mutationFn: (claudePath: string | null) => api.saveSettings({ ...settings.data!, claudePath }), onSuccess: (s) => { qc.setQueryData(keys.settings, s); void qc.invalidateQueries({ queryKey: ["claude-info"] }); void qc.invalidateQueries({ queryKey: AI_STATUS_KEY }); } });
  if (!settings.data) return null;
  return (
    <div className="flex flex-col gap-2">
      <ClaudeCard configured={settings.data.claudePath} saving={save.isPending} onPick={(p) => save.mutate(p)} />
      <p className="text-xs text-faint">
        {t("Pas encore installé ?")} <HelpLink url="https://code.claude.com/docs/en/setup">{t("Installer Claude Code")}</HelpLink> {t("puis lance `claude` une fois dans un terminal pour te connecter.")}
      </p>
    </div>
  );
}

/** The settings of the provider in use. */
export function ProviderPanel() {
  const { settings } = useAiSettings();
  const p = settings?.provider || "none";
  if (p === "none") return null;
  return p === "claude" ? <ClaudePanel /> : p === "openrouter" ? <OpenRouterPanel /> : <OllamaPanel />;
}

/** The whole choice, in one card (Settings → AI). */
export function ProviderCard() {
  const status = useAiStatus();
  return (
    <Card>
      <CardTitle right={status.data && status.data.provider !== "none" && <Badge tone={status.data.configured ? "ok" : "warn"}>{status.data.configured ? t("Prêt") : t("À configurer")}</Badge>}>{t("Fournisseur d'IA")}</CardTitle>
      <div className="flex flex-col gap-4 p-4">
        <ProviderPicker />
        {status.data?.detail && status.data.provider !== "none" && !status.data.configured && <ErrorNote>{status.data.detail}</ErrorNote>}
        <ProviderPanel />
        <Capabilities />
      </div>
    </Card>
  );
}
