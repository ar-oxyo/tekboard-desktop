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

        <EnvironmentCard />
      </div>
    </>
  );
}

function EnvironmentCard() {
  const env = useEnv();
  const qc = useQueryClient();
  const ssh = useMutation({ mutationFn: api.testGithubSsh });
  const gh = env.data?.github;

  return (
    <Card className="self-start">
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
