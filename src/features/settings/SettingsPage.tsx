import { useMutation, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, FolderPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, CardTitle, Code, ErrorNote, Field, IconButton, Input, PageHeader, Select, Spinner } from "../../components/ui";
import { api, asAppError, type Settings } from "../../lib/api";
import { tildify } from "../../lib/format";
import { keys, useEnv, useHome, useRepos, useSettings, useTemplates } from "../../lib/hooks";
import { cloneTargets } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { ClaudeCard } from "./ClaudeCard";

export function SettingsPage() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const home = useHome();
  const settings = useSettings();
  const templates = useTemplates();
  const repos = useRepos((settings.data?.roots.length ?? 0) > 0);
  const [draft, setDraft] = useState<Settings | null>(null);

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
      toast({ kind: "ok", title: "Settings saved" });
    },
  });

  if (!draft || !settings.data) {
    return settings.error ? (
      <ErrorNote>{asAppError(settings.error).message}</ErrorNote>
    ) : (
      <p className="flex items-center gap-2 py-16 text-muted">
        <Spinner /> Loading…
      </p>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.data);
  const set = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch });

  async function addRoot() {
    const dir = await open({ directory: true, multiple: false, title: "Add a projects folder" });
    if (typeof dir === "string" && draft && !draft.roots.includes(dir)) set({ roots: [...draft.roots, dir] });
  }

  async function addSchoolDir() {
    const dir = await open({ directory: true, multiple: false, title: "A folder that holds school work", defaultPath: draft?.roots[0] });
    if (typeof dir === "string" && draft && !draft.epitechDirs.includes(dir)) set({ epitechDirs: [...draft.epitechDirs, dir] });
  }
  const targets = cloneTargets(repos.data ?? [], draft.roots).filter((t) => draft.roots.some((r) => t === r || t.startsWith(r + "/")));

  return (
    <>
      <PageHeader
        title="Settings"
        actions={
          <>
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(settings.data!)}>
                Discard
              </Button>
            )}
            <Button variant="primary" icon={<Check className="size-3.5" />} disabled={!dirty} busy={save.isPending} onClick={() => save.mutate(draft)}>
              Save
            </Button>
          </>
        }
      />
      {save.error && (
        <div className="mb-4">
          <ErrorNote title="Not saved">{asAppError(save.error).message}</ErrorNote>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle
              right={
                <Button size="sm" variant="ghost" icon={<FolderPlus className="size-3.5" />} onClick={() => void addRoot()}>
                  Add folder
                </Button>
              }
            >
              Projects folders
            </CardTitle>
            {draft.roots.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">No folder yet. TekBoard lists the repositories found in the folders you add here.</p>
            ) : (
              <ul className="py-1">
                {draft.roots.map((root) => (
                  <li key={root} className="flex h-9 items-center gap-2 pr-2 pl-4">
                    <span className="selectable min-w-0 flex-1 truncate font-mono text-xs">{tildify(root, home)}</span>
                    <IconButton label="Stop scanning this folder" onClick={() => set({ roots: draft.roots.filter((r) => r !== root), cloneDir: draft.cloneDir?.startsWith(root) ? null : draft.cloneDir })}>
                      <X className="size-4" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-white/6 px-4 py-3">
              <Field label="Clone new projects into" hint="Automatic: next to the repositories of the same kind (Epitech with Epitech).">
                <Select value={draft.cloneDir ?? ""} onChange={(e) => set({ cloneDir: e.target.value || null })}>
                  <option value="">Automatic</option>
                  {targets.map((t) => (
                    <option key={t} value={t}>
                      {tildify(t, home)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="border-t border-white/6 px-4 py-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-muted">School folders</span>
                <Button size="sm" variant="ghost" icon={<FolderPlus className="size-3.5" />} onClick={() => void addSchoolDir()}>
                  Add
                </Button>
              </div>
              {draft.epitechDirs.length === 0 ? (
                <p className="text-xs text-faint">Optional. Repositories inside these folders count as Epitech work even without a module name or a MY Epitech match.</p>
              ) : (
                <ul>
                  {draft.epitechDirs.map((dir) => (
                    <li key={dir} className="flex h-8 items-center gap-2">
                      <span className="selectable min-w-0 flex-1 truncate font-mono text-xs">{tildify(dir, home)}</span>
                      <IconButton label="No longer a school folder" onClick={() => set({ epitechDirs: draft.epitechDirs.filter((d) => d !== dir) })}>
                        <X className="size-4" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card>
            <CardTitle>Workspace</CardTitle>
            <div className="flex flex-col gap-3 px-4 py-4">
              <Field
                label="IDE command"
                hint={
                  <>
                    <Code>{"{dir}"}</Code> is replaced by the project folder. Run directly, without a shell.
                  </>
                }
              >
                <Input className="font-mono text-xs" placeholder="code {dir}" value={draft.ideCmd} onChange={(e) => set({ ideCmd: e.target.value })} />
              </Field>
              <Field label="Terminal command">
                <Input className="font-mono text-xs" placeholder="ptyxis --new-window -d {dir}" value={draft.terminalCmd} onChange={(e) => set({ terminalCmd: e.target.value })} />
              </Field>
              <Field label="Terminal that runs a program" hint="Used by “Launch Binary”. The program and its arguments are appended after this command.">
                <Input className="font-mono text-xs" placeholder="ptyxis --new-window -d {dir} --" value={draft.terminalRunCmd} onChange={(e) => set({ terminalRunCmd: e.target.value })} />
              </Field>
              <Field label="Default template for new projects">
                <Select value={draft.defaultTemplate ?? ""} onChange={(e) => set({ defaultTemplate: e.target.value || null })}>
                  <option value="">None</option>
                  {(templates.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          <Card>
            <CardTitle>Design</CardTitle>
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
            <CardTitle>Appearance</CardTitle>
            <label className="flex items-center gap-3 px-4 py-4">
              <input type="checkbox" className="accent-(--color-accent)" checked={draft.glassEffects} onChange={(e) => set({ glassEffects: e.target.checked })} />
              <span>
                <span className="block text-[13px]">Glass effect on dialogs</span>
                <span className="block text-xs text-faint">Blur behind the command palette and dialogs. Turn off if scrolling or typing feels slow.</span>
              </span>
            </label>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <ClaudeCard configured={settings.data.claudePath} saving={save.isPending} onPick={(claudePath) => save.mutate({ ...settings.data!, claudePath })} />
          <EnvironmentCard />
        </div>
      </div>
    </>
  );
}

// Swatches are fixed colours on purpose: each tile previews its own design, whatever the active one is.
const THEMES: Array<{ id: string; name: string; tagline: string; bg: string; card: string; accent: string; text: string; radius: number }> = [
  { id: "aurora", name: "Aurora", tagline: "Colour halos, lit surfaces", bg: "radial-gradient(120px 70px at 10% 0%, #7c6ef266, transparent 70%), radial-gradient(110px 70px at 100% 100%, #3fbed644, transparent 70%), #080910", card: "#151829", accent: "linear-gradient(135deg,#b9aeff,#6f8dff)", text: "#eceef6", radius: 8 },
  { id: "flat", name: "Flat", tagline: "Solid and quiet", bg: "#0c0d11", card: "#15181e", accent: "#8f83f7", text: "#e8eaf0", radius: 5 },
  { id: "neon", name: "Neon", tagline: "Magenta, cyan and a grid", bg: "radial-gradient(120px 70px at 5% 0%, #ff50d277, transparent 70%), radial-gradient(120px 80px at 100% 100%, #28dcff66, transparent 70%), #07050f", card: "#1a1030", accent: "linear-gradient(120deg,#ff7ad9,#b46bff,#46dcff)", text: "#f4eeff", radius: 7 },
  { id: "cozy", name: "Cozy", tagline: "Warm pastels, round corners", bg: "radial-gradient(120px 70px at 10% 0%, #cba6f755, transparent 70%), radial-gradient(110px 70px at 100% 100%, #fab38744, transparent 70%), #14141f", card: "#25253a", accent: "linear-gradient(135deg,#cba6f7,#f5c2e7)", text: "#cdd6f4", radius: 11 },
  { id: "terminal", name: "Terminal", tagline: "Phosphor green, monospace", bg: "repeating-linear-gradient(180deg,#5cff8f14 0 1px,transparent 1px 3px), #040704", card: "#080d08", accent: "#5cff8f", text: "#cdf7c8", radius: 2 },
];

function ThemePicker({ current, onPick }: { current: string; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3" role="radiogroup" aria-label="Design">
      {THEMES.map((t) => {
        const active = t.id === current;
        return (
          <button key={t.id} type="button" role="radio" aria-checked={active} onClick={() => !active && onPick(t.id)} className="group text-left">
            <span
              className={`block h-[84px] overflow-hidden border p-2.5 transition-transform group-hover:-translate-y-0.5 ${active ? "border-accent ring-2 ring-accent/30" : "border-white/10"}`}
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
            Recheck
          </Button>
        }
      >
        Environment
      </CardTitle>
      {env.isLoading || !env.data ? (
        <p className="flex items-center gap-2 px-4 py-5 text-[13px] text-muted">
          <Spinner /> Checking…
        </p>
      ) : (
        <>
          <ul className="py-1">
            {env.data.tools.map((t) => (
              <li key={t.name} className="flex h-9 items-center gap-3 px-4" title={t.path ?? undefined}>
                <span className={`size-1.5 shrink-0 rounded-full ${t.path ? "bg-ok" : t.required ? "bg-danger" : "bg-faint"}`} />
                <span className="w-20 shrink-0 font-mono text-xs">{t.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{t.path ? (t.version ?? t.path) : t.purpose}</span>
                {!t.path && <Badge tone={t.required ? "danger" : "neutral"}>{t.required ? "missing" : "not installed"}</Badge>}
              </li>
            ))}
          </ul>
          <div className="space-y-2.5 border-t border-white/6 px-4 py-3 text-[13px]">
            <Row label="Git identity">
              {env.data.identity.name && env.data.identity.email ? (
                <span className="selectable text-muted">
                  {env.data.identity.name} · {env.data.identity.email}
                </span>
              ) : (
                <span className="text-warn">
                  Not set — <Code>git config --global user.name</Code> / <Code>user.email</Code>
                </span>
              )}
            </Row>
            <Row label="GitHub CLI">
              {gh?.state === "ready" ? (
                <span className="text-muted">Connected{gh.login ? ` as ${gh.login}` : ""}</span>
              ) : gh?.state === "missing" ? (
                <span className="text-muted">
                  Not installed — <Code>sudo apt install gh</Code>
                </span>
              ) : gh?.state === "loggedOut" ? (
                <span className="text-warn">
                  Not logged in — <Code>gh auth login</Code>
                </span>
              ) : (
                <span className="selectable text-warn">{gh?.state === "error" ? gh.message : ""}</span>
              )}
            </Row>
            <Row label="SSH agent">
              <span className="text-muted">{env.data.sshAgent ? "Available" : "Not reachable — keys with a passphrase will fail"}</span>
            </Row>
            <Row label="GitHub over SSH">
              <span className="flex min-w-0 items-center gap-2">
                <Button size="sm" busy={ssh.isPending} onClick={() => ssh.mutate()}>
                  Test
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
