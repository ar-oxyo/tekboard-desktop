import { useMutation, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, FolderPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Select } from "../../components/Select";
import { Button, Card, CardTitle, Code, ErrorNote, Field, IconButton, Input, PageHeader, Spinner } from "../../components/ui";
import { api, asAppError, type Settings } from "../../lib/api";
import { tildify } from "../../lib/format";
import { keys, useEnv, useHome, usePref, useRepos, useSettings, useTemplates } from "../../lib/hooks";
import { cloneTargets } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { AiSettingsCard } from "./AiSettings";
import { ClaudeCard } from "./ClaudeCard";

const TABS: Array<[string, string]> = [["general", "Général"], ["ai", "Tika (IA)"], ["tools", "Outils et Claude Code"], ["my", "MY Epitech"], ["design", "Apparence"]];

export function SettingsPage() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const home = useHome();
  const settings = useSettings();
  const templates = useTemplates();
  const repos = useRepos((settings.data?.roots.length ?? 0) > 0);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [savedTab, setTab] = usePref<string>("settings.tab", "general");
  // `--run claude-check` opens the Tools tab. (Hooks stay above the early return below.)
  const [forceTools] = useState(() => useUi.getState().claudeAutoCheck);

  useEffect(() => {
    if (settings.data && draft === null) setDraft(settings.data);
  }, [settings.data, draft]);

  const save = useMutation({
    mutationFn: (s: Settings) => api.saveSettings(s),
    onSuccess: (saved) => {
      qc.setQueryData(keys.settings, saved);
      setDraft(saved);
      void qc.invalidateQueries({ queryKey: keys.repos });
      void qc.invalidateQueries({ queryKey: ["claude-info"] });
      void qc.invalidateQueries({ queryKey: ["testing-info"] });
      void qc.invalidateQueries({ queryKey: ["run-info"] });
      toast({ kind: "ok", title: "Réglages enregistrés" });
    },
  });

  if (!draft || !settings.data) {
    return settings.error ? (
      <ErrorNote>{asAppError(settings.error).message}</ErrorNote>
    ) : (
      <p className="flex items-center gap-2 py-16 text-muted">
        <Spinner /> Chargement…
      </p>
    );
  }

  const tab = forceTools ? "tools" : TABS.some(([id]) => id === savedTab) ? savedTab : "general";
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.data);
  const set = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch });

  async function addRoot() {
    const dir = await open({ directory: true, multiple: false, title: "Ajouter un dossier de projets" });
    if (typeof dir === "string" && draft && !draft.roots.includes(dir)) set({ roots: [...draft.roots, dir] });
  }

  async function addSchoolDir() {
    const dir = await open({ directory: true, multiple: false, title: "Un dossier qui contient du travail d'école", defaultPath: draft?.roots[0] });
    if (typeof dir === "string" && draft && !draft.epitechDirs.includes(dir)) set({ epitechDirs: [...draft.epitechDirs, dir] });
  }
  const targets = cloneTargets(repos.data ?? [], draft.roots).filter((t) => draft.roots.some((r) => t === r || t.startsWith(r + "/")));

  return (
    <>
      <PageHeader
        title="Réglages"
        actions={
          <>
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(settings.data!)}>
                Annuler les changements
              </Button>
            )}
            <Button variant="primary" icon={<Check className="size-3.5" />} disabled={!dirty} busy={save.isPending} onClick={() => save.mutate(draft)}>
              Enregistrer
            </Button>
          </>
        }
      />
      {save.error && (
        <div className="mb-4">
          <ErrorNote title="Non enregistré">{asAppError(save.error).message}</ErrorNote>
        </div>
      )}

      <div className="mb-6 flex items-center gap-5 border-b border-white/6" role="tablist" aria-label="Sections des réglages">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`-mb-px h-9 border-b-2 px-1 text-[13px] transition-colors duration-150 ${tab === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "ai" && <AiSettingsCard />}
      {tab === "general" && (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <Card>
            <CardTitle
              right={
                <Button size="sm" variant="ghost" icon={<FolderPlus className="size-3.5" />} onClick={() => void addRoot()}>
                  Ajouter un dossier
                </Button>
              }
            >
              Dossiers de projets
            </CardTitle>
            {draft.roots.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">Aucun dossier. TekBoard liste les dépôts trouvés dans les dossiers ajoutés ici.</p>
            ) : (
              <ul className="py-1">
                {draft.roots.map((root) => (
                  <li key={root} className="flex h-9 items-center gap-2 pr-2 pl-4">
                    <span className="selectable min-w-0 flex-1 truncate font-mono text-xs">{tildify(root, home)}</span>
                    <IconButton label="Ne plus lire ce dossier" onClick={() => set({ roots: draft.roots.filter((r) => r !== root), cloneDir: draft.cloneDir?.startsWith(root) ? null : draft.cloneDir })}>
                      <X className="size-4" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-white/6 px-4 py-3">
              <Field label="Cloner les nouveaux projets dans" hint="Automatique : à côté des dépôts du même type (Epitech avec Epitech).">
                <Select label="Dossier de clonage" mono value={draft.cloneDir ?? ""} onChange={(v) => set({ cloneDir: v || null })} options={[{ value: "", label: "Automatique" }, ...targets.map((t) => ({ value: t, label: tildify(t, home) }))]} />
              </Field>
            </div>
            <div className="border-t border-white/6 px-4 py-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-muted">Dossiers d'école</span>
                <Button size="sm" variant="ghost" icon={<FolderPlus className="size-3.5" />} onClick={() => void addSchoolDir()}>
                  Ajouter
                </Button>
              </div>
              {draft.epitechDirs.length === 0 ? (
                <p className="text-xs text-faint">Facultatif. Les dépôts de ces dossiers comptent comme travail Epitech, même sans nom de module ni correspondance MY Epitech.</p>
              ) : (
                <ul>
                  {draft.epitechDirs.map((dir) => (
                    <li key={dir} className="flex h-8 items-center gap-2">
                      <span className="selectable min-w-0 flex-1 truncate font-mono text-xs">{tildify(dir, home)}</span>
                      <IconButton label="Ce n'est plus un dossier d'école" onClick={() => set({ epitechDirs: draft.epitechDirs.filter((d) => d !== dir) })}>
                        <X className="size-4" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
          <Card>
            <CardTitle>Espace de travail</CardTitle>
            <div className="flex flex-col gap-3 px-4 py-4">
              <Field
                label="IDE command"
                hint={
                  <>
                    <Code>{"{dir}"}</Code> est remplacé par le dossier du projet. Lancé directement, sans shell.
                  </>
                }
              >
                <Input className="font-mono text-xs" placeholder="code {dir}" value={draft.ideCmd} onChange={(e) => set({ ideCmd: e.target.value })} />
              </Field>
              <Field label="Commande du terminal">
                <Input className="font-mono text-xs" placeholder="ptyxis --new-window -d {dir}" value={draft.terminalCmd} onChange={(e) => set({ terminalCmd: e.target.value })} />
              </Field>
              <Field label="Terminal qui lance un programme" hint="Utilisé par « Lancer le binaire ». Le programme et ses arguments sont ajoutés après cette commande.">
                <Input className="font-mono text-xs" placeholder="ptyxis --new-window -d {dir} --" value={draft.terminalRunCmd} onChange={(e) => set({ terminalRunCmd: e.target.value })} />
              </Field>
              <Field label="Modèle par défaut des nouveaux projets">
                <Select label="Modèle par défaut" value={draft.defaultTemplate ?? ""} onChange={(v) => set({ defaultTemplate: v || null })} options={[{ value: "", label: "Aucun" }, ...(templates.data ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
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
                  Ouvrir le gestionnaire de prompts
                </Button>
              }
            >
              Prompts
            </CardTitle>
            <p className="px-4 py-3 text-xs text-muted">Lis et personnalise ce que TekBoard demande à Claude Code : Tika, la moulinette, la génération de tests, le README, l'analyse. Tes versions sont gardées entre les mises à jour.</p>
          </Card>
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
                  Ouvrir MY Epitech
                </Button>
              }
            >
              MY Epitech synchronisation
            </CardTitle>
            <div className="flex flex-col gap-3 px-4 py-4">
              <Field label="Synchronisation automatique" hint="Seulement quand TekBoard est ouvert et connecté à MY Epitech. Lectures seules sur ton propre compte, espacées d'une demi-seconde. Un échec est signalé, jamais réessayé en boucle.">
                <Select
                  label="Synchronisation automatique"
                  value={String(draft.mySyncMinutes)}
                  onChange={(v) => set({ mySyncMinutes: Number(v) })}
                  options={[
                    { value: "0", label: "Désactivée : seulement quand je clique sur « Synchroniser »" },
                    { value: "15", label: "Toutes les 15 minutes" },
                    { value: "30", label: "Toutes les 30 minutes" },
                    { value: "60", label: "Toutes les heures" },
                    { value: "180", label: "Toutes les 3 heures" },
                  ]}
                />
              </Field>
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-0.5 accent-(--color-accent)" checked={draft.myAutoReconnect} onChange={(e) => set({ myAutoReconnect: e.target.checked })} />
                <span>
                  <span className="block text-[13px]">Se reconnecter au démarrage de TekBoard</span>
                  <span className="block text-xs text-faint">Rouvre dans une fenêtre cachée la session MY Epitech gardée sur cet ordinateur. Si le site redemande une connexion, rien n'est forcé : l'état l'indique et tu ouvres la fenêtre toi-même.</span>
                </span>
              </label>
            </div>
          </Card>
        </div>
      )}
      {tab === "design" && (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <Card>
            <CardTitle>Apparence</CardTitle>
            <ThemePicker
              current={settings.data.theme}
              onPick={(theme) => {
                useUi.setState({ themeOverride: null });
                save.mutate({ ...settings.data!, theme });
                setDraft((d) => (d ? { ...d, theme } : d));
              }}
            />
          </Card>
          <Card>
            <CardTitle>Apparence</CardTitle>
            <label className="flex items-center gap-3 px-4 py-4">
              <input type="checkbox" className="accent-(--color-accent)" checked={draft.glassEffects} onChange={(e) => set({ glassEffects: e.target.checked })} />
              <span>
                <span className="block text-[13px]">Effet verre sur les dialogues</span>
                <span className="block text-xs text-faint">Flou derrière la palette et les dialogues. Désactive-le si le défilement ou la saisie paraissent lents.</span>
              </span>
            </label>
          </Card>
        </div>
      )}
    </>
  );
}

// Swatches are fixed colours on purpose: each tile previews its own design, whatever the active one is.
const THEMES: Array<{ id: string; name: string; tagline: string; bg: string; card: string; accent: string; text: string; radius: number }> = [
  { id: "aurora", name: "Aurora", tagline: "Graphite, un seul accent violet", bg: "#141415", card: "#1e1e21", accent: "#9486ff", text: "#ededed", radius: 8 },
  { id: "flat", name: "Flat", tagline: "Gris-bleu, net et carré", bg: "#0c0d11", card: "#15181e", accent: "#8f83f7", text: "#e8eaf0", radius: 5 },
  { id: "neon", name: "Neon", tagline: "Magenta, cyan et une grille", bg: "radial-gradient(120px 70px at 5% 0%, #ff50d277, transparent 70%), radial-gradient(120px 80px at 100% 100%, #28dcff66, transparent 70%), #07050f", card: "#1a1030", accent: "linear-gradient(120deg,#ff7ad9,#b46bff,#46dcff)", text: "#f4eeff", radius: 7 },
  { id: "cozy", name: "Cozy", tagline: "Pastels chauds, coins ronds", bg: "radial-gradient(120px 70px at 10% 0%, #cba6f755, transparent 70%), radial-gradient(110px 70px at 100% 100%, #fab38744, transparent 70%), #14141f", card: "#25253a", accent: "linear-gradient(135deg,#cba6f7,#f5c2e7)", text: "#cdd6f4", radius: 11 },
  { id: "terminal", name: "Terminal", tagline: "Vert phosphore, monospace", bg: "repeating-linear-gradient(180deg,#5cff8f14 0 1px,transparent 1px 3px), #040704", card: "#080d08", accent: "#5cff8f", text: "#cdf7c8", radius: 2 },
];

function ThemePicker({ current, onPick }: { current: string; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3" role="radiogroup" aria-label="Apparence">
      {THEMES.map((t) => {
        const active = t.id === current;
        return (
          <button key={t.id} type="button" role="radio" aria-checked={active} onClick={() => !active && onPick(t.id)} className="group text-left">
            <span
              className={`block h-[84px] overflow-hidden border p-2.5 transition-colors duration-150 ${active ? "border-accent" : "border-white/10 group-hover:border-white/25"}`}
              style={{ background: t.bg, borderRadius: t.radius + 4 }}
            >
              <span className="block h-full p-2" style={{ background: t.card, borderRadius: t.radius, border: "1px solid rgb(255 255 255 / 0.08)" }}>
                <span className="block h-1.5 w-12 rounded-full" style={{ background: t.text, opacity: 0.85 }} />
                <span className="mt-1.5 block h-1 w-20 rounded-full" style={{ background: t.text, opacity: 0.3 }} />
                <span className="mt-2.5 block h-3.5 w-14" style={{ background: t.accent, borderRadius: Math.max(2, t.radius - 3) }} />
              </span>
            </span>
            <span className="mt-1.5 flex items-center gap-1.5 text-[13px] font-medium">
              {t.name}
              {active && <Check className="size-3.5 text-accent" />}
            </span>
            <span className="block text-xs text-faint">{t.tagline}</span>
          </button>
        );
      })}
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
        <p className="flex items-center gap-2 px-4 py-5 text-[13px] text-muted">
          <Spinner /> Vérification…
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
          <div className="space-y-2.5 border-t border-white/6 px-4 py-3 text-[13px]">
            <Row label="Identité git">
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
              <span className="text-muted">{env.data.sshAgent ? "Available" : "Not reachable — keys with a passphrase will fail"}</span>
            </Row>
            <Row label="GitHub par SSH">
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
