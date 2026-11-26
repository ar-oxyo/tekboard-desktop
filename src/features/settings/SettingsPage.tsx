import { SpotifyCard } from "../space/spotify";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, ChevronRight, FolderPlus, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Select } from "../../components/Select";
import { Button, Card, CardTitle, cn, Code, ErrorNote, Field, IconButton, Input, PageHeader, Spinner } from "../../components/ui";
import { COLOR_MODES, crossFade, designHasLight, type ColorMode } from "../../lib/appearance";
import { api, asAppError, type Settings } from "../../lib/api";
import { tildify } from "../../lib/format";
import { ACCENT_PRESETS, parseHex, toHex } from "../../lib/color";
import { AUTO_AMBIANCE, keys, useAccent, useColorMode, useEnv, useMotionPref, type AutoAmbiance, useHome, usePref, useRepos, useSettings, useTemplates } from "../../lib/hooks";
import { cloneTargets } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { AiSettingsCard } from "./AiSettings";
import { ClaudeCard } from "./ClaudeCard";
import { DataCard } from "./DataCard";
import { DoctorCard } from "./DoctorCard";
import { CaptureCard } from "./CaptureCard";
import { UpdatesCard } from "./UpdatesCard";
import { applyLang, t } from "../../lib/i18n";

const TABS: Array<[string, string]> = [["general", t("Général")], ["doctor", "Doctor"], ["ai", t("Artix (IA)")], ["tools", t("Outils et Claude Code")], ["my", "MY Epitech"], ["design", t("Apparence")], ["updates", t("Mises à jour")], ["data", t("Données")]];

export function SettingsPage() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const home = useHome();
  const settings = useSettings();
  const templates = useTemplates();
  const repos = useRepos((settings.data?.roots.length ?? 0) > 0, { all: true });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [savedTab, setTab] = usePref<string>("settings.tab", "general");
  // `--run claude-check` opens the Tools tab. (Hooks stay above the early return below.)
  const [forceTools] = useState(() => useUi.getState().claudeAutoCheck);
  // A toast's "Voir la mise à jour" opens one tab, once.
  const [forced] = useState(() => {
    const tab = useUi.getState().settingsTab;
    if (tab) useUi.setState({ settingsTab: null });
    return tab;
  });

  useEffect(() => {
    if (settings.data && draft === null) setDraft(settings.data);
  }, [settings.data, draft]);
  // A link elsewhere (the Doctor, Artix) asks for a tab while Settings is already open.
  const wanted = useUi((u) => u.settingsTab);
  const [pending, setPending] = useState<string | null>(forced);
  useEffect(() => {
    if (wanted) {
      setTab(wanted);
      setPending(null);
      useUi.setState({ settingsTab: null });
    }
  }, [wanted, setTab]);

  const save = useMutation({
    mutationFn: (s: Settings) => api.saveSettings(s),
    onSuccess: (saved) => {
      qc.setQueryData(keys.settings, saved);
      setDraft(saved);
      void qc.invalidateQueries({ queryKey: keys.repos });
      void qc.invalidateQueries({ queryKey: ["claude-info"] });
      void qc.invalidateQueries({ queryKey: ["testing-info"] });
      void qc.invalidateQueries({ queryKey: ["run-info"] });
      toast({ kind: "ok", title: t("Réglages enregistrés") });
      // Capture shortcut and tray icon follow at once.
      void api.desktopApply().then((st) => qc.setQueryData(["desktop-status"], st));
      // A new language is applied at once (the window reloads; nothing else restarts).
      applyLang(saved.language);
    },
  });

  if (!draft || !settings.data) {
    return settings.error ? (
      <ErrorNote>{asAppError(settings.error).message}</ErrorNote>
    ) : (
      <p className="flex items-center gap-2 py-16 text-muted">
        <Spinner /> {t("Chargement…")}
      </p>
    );
  }

  // The tab asked at opening wins until another tab is picked.
  const tab = forceTools ? "tools" : forced && forced === pending && TABS.some(([id]) => id === forced) ? forced : TABS.some(([id]) => id === savedTab) ? savedTab : "general";
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.data);
  const set = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch });

  async function addRoot() {
    const dir = await open({ directory: true, multiple: false, title: t("Ajouter un dossier de projets") });
    if (typeof dir === "string" && draft && !draft.roots.includes(dir)) set({ roots: [...draft.roots, dir] });
  }

  async function addSchoolDir() {
    const dir = await open({ directory: true, multiple: false, title: t("Un dossier qui contient du travail d'école"), defaultPath: draft?.roots[0] });
    if (typeof dir === "string" && draft && !draft.epitechDirs.includes(dir)) set({ epitechDirs: [...draft.epitechDirs, dir] });
  }
  const targets = cloneTargets(repos.data ?? [], draft.roots).filter((t) => draft.roots.some((r) => t === r || t.startsWith(r + "/")));

  return (
    <div className="settings-flat">
      <PageHeader
        title={t("Réglages")}
        actions={
          <>
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(settings.data!)}>
                {t("Annuler les changements")}
              </Button>
            )}
            <Button variant="primary" icon={<Check className="size-3.5" />} disabled={!dirty} busy={save.isPending} onClick={() => save.mutate(draft)}>
              {t("Enregistrer")}
            </Button>
          </>
        }
      />
      {save.error && (
        <div className="mb-4">
          <ErrorNote title={t("Non enregistré")}>{asAppError(save.error).message}</ErrorNote>
        </div>
      )}

      <div className="mb-6 flex items-center gap-5 border-b border-ink/6" role="tablist" aria-label={t("Sections des réglages")}>
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => (setTab(id), setPending(null))} className={`-mb-px h-9 border-b-2 px-1 text-sm transition-colors duration-150 ${tab === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "ai" && <AiSettingsCard />}
      {tab === "doctor" && (
        <div className="max-w-4xl">
          <DoctorCard />
        </div>
      )}
      {tab === "general" && (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <Card className="xl:col-span-2">
            <CardTitle>{t("Préférences")}</CardTitle>
            <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
              <Field label={t("Langue")} hint={t("Appliquée dès l'enregistrement. Les termes techniques restent tels quels : test, zone de test, moulinette.")}>
                <Select
                  label={t("Langue")}
                  value={draft.language}
                  onChange={(v) => set({ language: v })}
                  options={[
                    { value: "fr", label: "Français" },
                    { value: "en", label: "English" },
                  ]}
                />
              </Field>
              <label className="flex items-start gap-3 pt-5">
                <input type="checkbox" className="mt-0.5 accent-(--color-accent)" checked={draft.epitechOnly} onChange={(e) => set({ epitechOnly: e.target.checked })} />
                <span>
                  <span className="block text-sm">Epitech Projects Only</span>
                  <span className="block text-xs text-faint">{t("Seuls les projets Epitech apparaissent dans les listes, le planning et pour Artix. Décoche pour voir aussi tes projets personnels.")}</span>
                </span>
              </label>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
              <span className="text-xs text-faint">{t("L'assistant de démarrage repasse par la langue, l'apparence, MY Epitech et tes dossiers. Rien n'est effacé.")}</span>
              <Button
                size="sm"
                onClick={() =>
                  void api.saveSettings({ ...settings.data!, onboarded: false, onboardingStep: "welcome" }).then(
                    (saved) => qc.setQueryData(keys.settings, saved),
                    (e) => toast({ kind: "error", title: t("Non relancé"), detail: asAppError(e).message }),
                  )
                }
              >
                {t("Relancer l'assistant de démarrage")}
              </Button>
            </div>
          </Card>
          <CaptureCard draft={draft} set={set} />
          <Card>
            <CardTitle
              right={
                <Button size="sm" variant="ghost" icon={<FolderPlus className="size-3.5" />} onClick={() => void addRoot()}>
                  {t("Ajouter un dossier")}
                </Button>
              }
            >
              {t("Dossiers de projets")}
            </CardTitle>
            {draft.roots.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">{t("Aucun dossier. TekBoard liste les dépôts trouvés dans les dossiers ajoutés ici.")}</p>
            ) : (
              <ul className="py-1">
                {draft.roots.map((root) => (
                  <li key={root} className="flex h-9 items-center gap-2 pr-2 pl-4">
                    <span className="selectable min-w-0 flex-1 truncate font-mono text-xs">{tildify(root, home)}</span>
                    <IconButton label={t("Ne plus lire ce dossier")} onClick={() => set({ roots: draft.roots.filter((r) => r !== root), cloneDir: draft.cloneDir?.startsWith(root) ? null : draft.cloneDir })}>
                      <X className="size-4" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-ink/6 px-4 py-3">
              <Field label={t("Cloner les nouveaux projets dans")} hint={t("Automatique : à côté des dépôts du même type (Epitech avec Epitech).")}>
                <Select label={t("Dossier de clonage")} mono value={draft.cloneDir ?? ""} onChange={(v) => set({ cloneDir: v || null })} options={[{ value: "", label: t("Automatique") }, ...targets.map((t) => ({ value: t, label: tildify(t, home) }))]} />
              </Field>
            </div>
            <div className="border-t border-ink/6 px-4 py-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-muted">{t("Dossiers d'école")}</span>
                <Button size="sm" variant="ghost" icon={<FolderPlus className="size-3.5" />} onClick={() => void addSchoolDir()}>
                  {t("Ajouter")}
                </Button>
              </div>
              {draft.epitechDirs.length === 0 ? (
                <p className="text-xs text-faint">{t("Facultatif. Les dépôts de ces dossiers comptent comme travail Epitech, même sans nom de module ni correspondance MY Epitech.")}</p>
              ) : (
                <ul>
                  {draft.epitechDirs.map((dir) => (
                    <li key={dir} className="flex h-8 items-center gap-2">
                      <span className="selectable min-w-0 flex-1 truncate font-mono text-xs">{tildify(dir, home)}</span>
                      <IconButton label={t("Ce n'est plus un dossier d'école")} onClick={() => set({ epitechDirs: draft.epitechDirs.filter((d) => d !== dir) })}>
                        <X className="size-4" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
          <Card>
            <CardTitle>{t("Espace de travail")}</CardTitle>
            <div className="flex flex-col gap-3 px-4 py-4">
              <Field
                label={t("Commande de l'IDE")}
                hint={
                  <>
                    <Code>{"{dir}"}</Code> est remplacé par le dossier du projet. Lancé directement, sans shell.
                  </>
                }
              >
                <Input className="font-mono text-xs" placeholder="code {dir}" value={draft.ideCmd} onChange={(e) => set({ ideCmd: e.target.value })} />
              </Field>
              <Field label={t("Commande du terminal")}>
                <Input className="font-mono text-xs" placeholder="ptyxis --new-window -d {dir}" value={draft.terminalCmd} onChange={(e) => set({ terminalCmd: e.target.value })} />
              </Field>
              <Field label={t("Terminal qui lance un programme")} hint={t("Utilisé par « Lancer le binaire ». Le programme et ses arguments sont ajoutés après cette commande.")}>
                <Input className="font-mono text-xs" placeholder="ptyxis --new-window -d {dir} --" value={draft.terminalRunCmd} onChange={(e) => set({ terminalRunCmd: e.target.value })} />
              </Field>
              <Field label={t("Modèle par défaut des nouveaux projets")}>
                <Select label={t("Modèle par défaut")} value={draft.defaultTemplate ?? ""} onChange={(v) => set({ defaultTemplate: v || null })} options={[{ value: "", label: "Aucun" }, ...(templates.data ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
              </Field>
            </div>
          </Card>
        </div>
      )}
      {tab === "tools" && (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <div className="flex flex-col gap-4">
            <ClaudeCard configured={settings.data.claudePath} saving={save.isPending} onPick={(claudePath) => save.mutate({ ...settings.data!, claudePath })} />
          <Card>
            <CardTitle
              right={
                <Button size="sm" onClick={() => useUi.getState().setPage("prompts")}>
                  {t("Ouvrir le gestionnaire de prompts")}
                </Button>
              }
            >
              Prompts
            </CardTitle>
            <p className="px-4 py-3 text-xs text-muted">{t("Lis et personnalise ce que TekBoard demande à Claude Code : Artix, la moulinette, la génération de tests, le README, l'analyse. Tes versions sont gardées entre les mises à jour.")}</p>
          </Card>
          <SpotifyCard />
          </div>
          <EnvironmentCard />
        </div>
      )}
      {tab === "my" && (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <Card>
            <CardTitle
              right={
                <Button size="sm" onClick={() => useUi.getState().setPage("myepitech")}>
                  {t("Ouvrir MY Epitech")}
                </Button>
              }
            >
              MY Epitech synchronisation
            </CardTitle>
            <div className="flex flex-col gap-3 px-4 py-4">
              <Field label={t("Synchronisation automatique")} hint={t("Seulement quand TekBoard est ouvert et connecté à MY Epitech. Lectures seules sur ton propre compte, espacées d'une demi-seconde. Un échec est signalé, jamais réessayé en boucle.")}>
                <Select
                  label={t("Synchronisation automatique")}
                  value={String(draft.mySyncMinutes)}
                  onChange={(v) => set({ mySyncMinutes: Number(v) })}
                  options={[
                    { value: "0", label: t("Désactivée : seulement quand je clique sur « Synchroniser »") },
                    { value: "15", label: t("Toutes les 15 minutes") },
                    { value: "30", label: t("Toutes les 30 minutes") },
                    { value: "60", label: t("Toutes les heures") },
                    { value: "180", label: t("Toutes les 3 heures") },
                  ]}
                />
              </Field>
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-0.5 accent-(--color-accent)" checked={draft.myAutoReconnect} onChange={(e) => set({ myAutoReconnect: e.target.checked })} />
                <span>
                  <span className="block text-sm">{t("Se reconnecter au démarrage de TekBoard")}</span>
                  <span className="block text-xs text-faint">{t("Rouvre dans une fenêtre cachée la session MY Epitech gardée sur cet ordinateur. Si le site redemande une connexion, rien n'est forcé : l'état l'indique et tu ouvres la fenêtre toi-même.")}</span>
                </span>
              </label>
            </div>
          </Card>
        </div>
      )}
      {tab === "updates" && <UpdatesCard settings={settings.data} />}
      {tab === "data" && <DataCard />}
      {tab === "design" && (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <Card>
            <CardTitle>{t("Apparence")}</CardTitle>
            <ThemePicker
              current={settings.data.theme}
              onPick={(theme) => {
                crossFade();
                useUi.setState({ themeOverride: null });
                save.mutate({ ...settings.data!, theme });
                setDraft((d) => (d ? { ...d, theme } : d));
              }}
            />
            <AccentPicker />
          </Card>
          <Card>
            <CardTitle>{t("Effets et confort")}</CardTitle>
            <label className="flex items-center gap-3 px-4 py-4">
              <input type="checkbox" className="accent-(--color-accent)" checked={draft.glassEffects} onChange={(e) => set({ glassEffects: e.target.checked })} />
              <span>
                <span className="block text-sm">{t("Effet verre sur les dialogues")}</span>
                <span className="block text-xs text-faint">{t("Flou derrière la palette et les dialogues. Désactive-le si le défilement ou la saisie paraissent lents.")}</span>
              </span>
            </label>
            <ComfortSettings />
          </Card>
        </div>
      )}
    </div>
  );
}

// Swatches are fixed colours on purpose: each tile previews its own design, whatever the active one is.
const THEMES: Array<{ id: string; name: string; tagline: string; bg: string; card: string; accent: string; text: string; radius: number; obsolete?: boolean }> = [
  { id: "aurora", name: "Riso", tagline: t("Deux encres sur papier, en clair ou en sombre"), bg: "linear-gradient(135deg, #f3efe6 0 50%, #181715 50% 100%)", card: "#f9f7f1", accent: "#0078bf", text: "#1d1b19", radius: 6 },
  { id: "sauge", name: "Sauge", tagline: t("Encre verte et ambre : calme, naturel"), bg: "linear-gradient(135deg, #eef1e8 0 50%, #141815 50% 100%)", card: "#f6f8f2", accent: "#2f7a4f", text: "#1a211b", radius: 6 },
  { id: "ardoise", name: "Ardoise", tagline: t("Ardoise froide, cyan et orange : concentration"), bg: "linear-gradient(135deg, #eef2f6 0 50%, #13171c 50% 100%)", card: "#f7f9fb", accent: "#0e7490", text: "#141a21", radius: 6 },
  { id: "prune", name: "Prune", tagline: t("Lie-de-vin et moutarde : chaleur du soir"), bg: "linear-gradient(135deg, #f6eef0 0 50%, #1a1418 50% 100%)", card: "#fbf6f7", accent: "#8e2f63", text: "#24171e", radius: 6 },
  { id: "sumi", name: "Sumi", tagline: t("Encre noire, vermillon et or : minimal"), bg: "linear-gradient(135deg, #f7f5ef 0 50%, #111111 50% 100%)", card: "#fcfbf7", accent: "#b8321f", text: "#141414", radius: 6 },
  { id: "flat", obsolete: true, name: "Flat", tagline: t("Gris-bleu, net et carré"), bg: "#0c0d11", card: "#15181e", accent: "#8f83f7", text: "#e8eaf0", radius: 5 },
  { id: "neon", obsolete: true, name: "Neon", tagline: t("Magenta, cyan et une grille"), bg: "radial-gradient(120px 70px at 5% 0%, #ff50d277, transparent 70%), radial-gradient(120px 80px at 100% 100%, #28dcff66, transparent 70%), #07050f", card: "#1a1030", accent: "linear-gradient(120deg,#ff7ad9,#b46bff,#46dcff)", text: "#f4eeff", radius: 7 },
  { id: "cozy", obsolete: true, name: "Cozy", tagline: t("Pastels chauds, coins ronds"), bg: "radial-gradient(120px 70px at 10% 0%, #cba6f755, transparent 70%), radial-gradient(110px 70px at 100% 100%, #fab38744, transparent 70%), #14141f", card: "#25253a", accent: "linear-gradient(135deg,#cba6f7,#f5c2e7)", text: "#cdd6f4", radius: 11 },
  { id: "terminal", obsolete: true, name: "Terminal", tagline: t("Vert phosphore, monospace"), bg: "repeating-linear-gradient(180deg,#5cff8f14 0 1px,transparent 1px 3px), #040704", card: "#080d08", accent: "#5cff8f", text: "#cdf7c8", radius: 2 },
];

const MODE_LABEL: Record<ColorMode, string> = { system: t("Système"), light: t("Clair"), dark: t("Sombre") };

/** Personal accent: a few inks, or any colour; adjusted for contrast in each mode. */
function AccentPicker() {
  const [accent, setAccent] = useAccent();
  const [hex, setHex] = useState(accent ?? "");
  useEffect(() => setHex(accent ?? ""), [accent]);
  const pick = (v: string | null) => {
    crossFade();
    setAccent(v);
  };
  return (
    <div className="space-y-2.5 border-t border-line px-4 py-4">
      <div className="flex items-baseline gap-2">
        <p className="text-sm">{t("Couleur d'accent")}</p>
        <p className="text-xs text-faint">{t("Actions, sélection et liens. L'urgence garde la couleur de l'ambiance.")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => pick(null)} aria-pressed={!accent} title={t("Couleur de l'ambiance")} className={cn("flex h-8 items-center gap-1.5 rounded-(--btn-radius) border px-2.5 text-xs", !accent ? "border-accent text-fg" : "border-line text-muted hover:text-fg")}>
          <RotateCcw className="size-3.5" /> {t("Ambiance")}
        </button>
        {ACCENT_PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => pick(p.hex)} aria-pressed={accent === p.hex} aria-label={t(p.name)} title={t(p.name)} className={cn("size-8 rounded-full border-2 transition-transform hover:scale-105", accent === p.hex ? "border-fg" : "border-transparent")} style={{ background: p.hex }} />
        ))}
        <label className="flex items-center gap-1.5" title={t("Une autre couleur")}>
          <input type="color" className="size-8 cursor-pointer rounded-(--btn-radius) border border-line bg-transparent" value={parseHex(hex) ? toHex(parseHex(hex)!) : "#006bab"} onChange={(e) => pick(e.target.value)} aria-label={t("Choisir une couleur")} />
          <Input className="h-8 w-24 font-mono text-xs" value={hex} placeholder="#006bab" onChange={(e) => setHex(e.target.value)} onBlur={() => { const p = parseHex(hex); if (p) pick(toHex(p)); else setHex(accent ?? ""); }} aria-label={t("Code hexadécimal")} />
        </label>
      </div>
      {accent && <p className="text-xs text-faint">{t("Ajustée si besoin pour rester lisible sur le fond clair comme sur le fond sombre.")}</p>}
    </div>
  );
}

export function ThemePicker({ current, onPick: pick }: { current: string; onPick: (id: string) => void }) {
  const [mode, setModeRaw] = useColorMode(current);
  const [, setChosen] = usePref<boolean>("ambianceChosen", false);
  const onPick = (id: string) => {
    setChosen(true);
    pick(id);
  };
  const setMode = (m: ColorMode) => {
    setChosen(true);
    setModeRaw(m);
  };
  const light = designHasLight(current);
  return (
    <div className="p-4">
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <span className="text-sm text-muted">{t("Mode")}</span>
      <div className="flex rounded-(--btn-radius) border border-line p-0.5" role="radiogroup" aria-label={t("Mode")} title={light ? undefined : t("Ce design n'existe qu'en sombre : choisis Riso pour le mode clair.")}>
        {COLOR_MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            disabled={!light}
            onClick={() => setMode(m)}
            className={cn("h-7 rounded-[calc(var(--btn-radius)-2px)] px-3 text-sm transition-colors duration-(--dur-fast) disabled:cursor-not-allowed disabled:opacity-50", mode === m && light ? "bg-ink/8 font-medium text-fg" : "text-muted hover:text-fg")}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      {!light && <span className="text-xs text-faint">{t("Sombre seulement avec ce design.")}</span>}
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t("Design")}>
      {THEMES.filter((x) => !x.obsolete).map((t) => {
        const active = t.id === current;
        return (
          <button key={t.id} type="button" role="radio" aria-checked={active} onClick={() => !active && onPick(t.id)} className="group text-left">
            <span
              className={`block h-[84px] overflow-hidden border p-2.5 transition-colors duration-150 ${active ? "border-accent" : "border-ink/10 group-hover:border-ink/25"}`}
              style={{ background: t.bg, borderRadius: t.radius + 4 }}
            >
              <span className="block h-full p-2" style={{ background: t.card, borderRadius: t.radius, border: "1px solid rgb(255 255 255 / 0.08)" }}>
                <span className="block h-1.5 w-12 rounded-full" style={{ background: t.text, opacity: 0.85 }} />
                <span className="mt-1.5 block h-1 w-20 rounded-full" style={{ background: t.text, opacity: 0.3 }} />
                <span className="mt-2.5 block h-3.5 w-14" style={{ background: t.accent, borderRadius: Math.max(2, t.radius - 3) }} />
              </span>
            </span>
            <span className="mt-1.5 flex items-center gap-1.5 text-sm font-medium">
              {t.name}
              {active && <Check className="size-3.5 text-accent" />}
            </span>
            <span className="block text-xs text-faint">{t.tagline}</span>
          </button>
        );
      })}
    </div>
    <details className="group mt-5" open={THEMES.some((x) => x.obsolete && x.id === current)}>
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-xs text-faint hover:text-muted [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        {t("Obsolètes")}
        <span className="text-faint">· {t("plus mis à jour, sombres seulement")}</span>
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t("Designs obsolètes")}>
        {THEMES.filter((x) => x.obsolete).map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={x.id === current} onClick={() => x.id !== current && onPick(x.id)} className="group/o text-left opacity-80 hover:opacity-100">
            <span className={`block h-[60px] overflow-hidden border ${x.id === current ? "border-accent" : "border-ink/10 group-hover/o:border-ink/25"}`} style={{ background: x.bg, borderRadius: x.radius + 4 }} />
            <span className="mt-1.5 flex items-center gap-1.5 text-sm">
              {x.name}
              {x.id === current && <Check className="size-3.5 text-accent" />}
            </span>
          </button>
        ))}
      </div>
    </details>
    </div>
  );
}

function EnvironmentCard() {
  const env = useEnv();
  const qc = useQueryClient();
  const ssh = useMutation({ mutationFn: api.testGithubSsh });
  const gh = env.data?.github;

  return (
    <Card>
      <CardTitle
        right={
          <Button size="sm" variant="ghost" busy={env.isFetching} onClick={() => void qc.invalidateQueries({ queryKey: keys.env })}>
            Revérifier
          </Button>
        }
      >
        Environnement
      </CardTitle>
      {env.isLoading || !env.data ? (
        <p className="flex items-center gap-2 px-4 py-5 text-sm text-muted">
          <Spinner /> {t("Vérification…")}
        </p>
      ) : (
        <>
          <ul className="py-1">
            {env.data.tools.map((t) => (
              <li key={t.name} className="flex h-9 items-center gap-3 px-4" title={t.path ?? undefined}>
                <span className={`size-1.5 shrink-0 rounded-full ${t.path ? "bg-ok" : t.required ? "bg-danger" : "bg-faint"}`} />
                <span className="w-20 shrink-0 font-mono text-xs">{t.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{t.path ? (t.version ?? t.path) : t.purpose}</span>
                {!t.path && <span className={`shrink-0 text-xs ${t.required ? "text-danger" : "text-faint"}`}>{t.required ? "missing" : "not installed"}</span>}
              </li>
            ))}
          </ul>
          <div className="space-y-2.5 border-t border-ink/6 px-4 py-3 text-sm">
            <Row label={t("Identité git")}>
              {env.data.identity.name && env.data.identity.email ? (
                <span className="selectable text-muted">
                  {env.data.identity.name} · {env.data.identity.email}
                </span>
              ) : (
                <span className="text-warn">
                  Non configuré — <Code>git config --global user.name</Code> / <Code>user.email</Code>
                </span>
              )}
            </Row>
            <Row label="GitHub CLI">
              {gh?.state === "ready" ? (
                <span className="text-muted">Connected{gh.login ? ` as ${gh.login}` : ""}</span>
              ) : gh?.state === "missing" ? (
                <span className="text-muted">
                  Non installé — <Code>sudo apt install gh</Code>
                </span>
              ) : gh?.state === "loggedOut" ? (
                <span className="text-warn">
                  Non connecté — <Code>gh auth login</Code>
                </span>
              ) : (
                <span className="selectable text-warn">{gh?.state === "error" ? gh.message : ""}</span>
              )}
            </Row>
            <Row label="SSH agent">
              <span className="text-muted">{env.data.sshAgent ? "Available" : t("Injoignable : les clés protégées par une phrase secrète échoueront")}</span>
            </Row>
            <Row label={t("GitHub par SSH")}>
              <span className="flex min-w-0 items-center gap-2">
                <Button size="sm" busy={ssh.isPending} onClick={() => ssh.mutate()}>
                  Tester
                </Button>
                {ssh.data && <span className={`selectable min-w-0 truncate text-xs ${ssh.data.ok ? "text-ok" : "text-danger"}`}>{ssh.data.message}</span>}
              </span>
            </Row>
          </div>
        </>
      )}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-faint">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

const LIGHT_THEMES = THEMES.filter((x) => designHasLight(x.id)).map((x) => ({ value: x.id, label: x.name }));
const MODES = [
  { value: "light" as const, label: t("Clair") },
  { value: "dark" as const, label: t("Sombre") },
];
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${h} h` }));

/** Animations, the ambiance of the hour and Today's layout: every extra can be switched off. */
function ComfortSettings() {
  const [motion, setMotion] = useMotionPref();
  const [auto, setAuto] = usePref<AutoAmbiance>("autoAmbiance", AUTO_AMBIANCE);
  const set = (p: Partial<AutoAmbiance>) => {
    crossFade();
    setAuto({ ...auto, ...p });
  };
  const toggle = (on: boolean, onChange: (v: boolean) => void, title: string, hint: string) => (
    <label className="flex items-start gap-3 border-t border-line px-4 py-3.5">
      <input type="checkbox" className="mt-0.5 accent-(--color-accent)" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm">{title}</span>
        <span className="block text-xs text-faint">{hint}</span>
      </span>
    </label>
  );
  return (
    <>
      {toggle(motion, setMotion, t("Animations"), t("Entrées de page, barres qui se remplissent, tâche cochée. Coupées aussi si le système demande moins d'animations."))}
      {toggle(auto.on, (on) => set({ on }), t("Ambiance selon l'heure"), t("Passe d'une ambiance de jour à une ambiance du soir, sans changer ton choix ci-contre."))}
      {auto.on && (
        <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 px-4 pb-4 pl-11 text-sm">
          <span className="text-muted">{t("Jour")}</span>
          <Select<string> size="sm" label={t("Ambiance de jour")} value={auto.dayTheme} onChange={(v) => set({ dayTheme: v })} options={LIGHT_THEMES} />
          <Select<"light" | "dark"> size="sm" label={t("Mode de jour")} value={auto.dayMode} onChange={(v) => set({ dayMode: v })} options={MODES} />
          <span className="text-muted">{t("Soir")}</span>
          <Select<string> size="sm" label={t("Ambiance du soir")} value={auto.nightTheme} onChange={(v) => set({ nightTheme: v })} options={LIGHT_THEMES} />
          <Select<"light" | "dark"> size="sm" label={t("Mode du soir")} value={auto.nightMode} onChange={(v) => set({ nightMode: v })} options={MODES} />
          <span className="text-muted">{t("Horaires")}</span>
          <Select<string> size="sm" label={t("Le soir commence à")} value={String(auto.nightFrom)} onChange={(v) => set({ nightFrom: Number(v) })} options={HOURS} />
          <Select<string> size="sm" label={t("Le jour revient à")} value={String(auto.dayFrom)} onChange={(v) => set({ dayFrom: Number(v) })} options={HOURS} />
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3.5">
        <span>
          <span className="block text-sm">{t("Écran Aujourd'hui")}</span>
          <span className="block text-xs text-faint">{t("Widgets affichés, ordre, largeur, guide de démarrage.")}</span>
        </span>
        <Button
          size="sm"
          onClick={() => {
            useUi.setState({ page: "overview" });
            window.setTimeout(() => window.dispatchEvent(new CustomEvent("tekboard:customize-today")), 50);
          }}
        >
          {t("Personnaliser…")}
        </Button>
      </div>
    </>
  );
}
