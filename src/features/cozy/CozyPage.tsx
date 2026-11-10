// Cozy Fox control: only what the Cozy Glass setup really exposes
// (the `companion` block of widgets.json and the fox's one-shot commands).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PawPrint, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, Card, CardTitle, Code, EmptyState, ErrorNote, PageHeader, Spinner } from "../../components/ui";
import { api, asAppError, type Companion, type Settings } from "../../lib/api";
import { tildify } from "../../lib/format";
import { keys, useHome, useSettings } from "../../lib/hooks";
import { useUi } from "../../lib/store";

const PLAY: Array<{ cmd: string; label: string; hint: string }> = [
  { cmd: "ball", label: "Ball", hint: "Throw him a ball" },
  { cmd: "zoomies", label: "Zoomies", hint: "A burst of running around" },
  { cmd: "spin", label: "Spin", hint: "Chase his tail" },
  { cmd: "pounce", label: "Pounce", hint: "Hunter's jump" },
  { cmd: "glass", label: "Glass jump", hint: "Jump onto a window" },
  { cmd: "bird", label: "Bird", hint: "A bird comes by" },
  { cmd: "mail", label: "Mail", hint: "He crosses the screen with a letter" },
  { cmd: "water", label: "Water break", hint: "The water reminder, now" },
  { cmd: "laser", label: "Laser", hint: "Toggle the laser pointer (also Super+Alt+L)" },
  { cmd: "pilot", label: "Pilot mode", hint: "Take control of the fox: keyboard and mouse go to him until you stop (also Super+Alt+F)" },
];

const PREVIEW: Array<{ cmd: string; label: string }> = [
  { cmd: "wx-rain", label: "Rain" },
  { cmd: "wx-snow", label: "Snow" },
  { cmd: "wx-sun", label: "Sun" },
  { cmd: "wx-cold", label: "Cold" },
  { cmd: "wx-auto", label: "Real weather" },
  { cmd: "season-halloween", label: "Halloween" },
  { cmd: "season-christmas", label: "Christmas" },
  { cmd: "season-spring", label: "Spring" },
  { cmd: "season-auto", label: "Real season" },
];

export function CozyPage() {
  const qc = useQueryClient();
  const home = useHome();
  const toast = useUi((s) => s.toast);
  const settings = useSettings();
  const status = useQuery({ queryKey: ["cozy"], queryFn: api.cozyStatus, staleTime: 0 });
  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });

  const update = useMutation({ mutationFn: (patch: Companion) => api.cozyUpdate(patch), onSuccess: (s) => qc.setQueryData(["cozy"], s), onError: fail("Could not change the setting") });
  const send = useMutation({ mutationFn: (cmd: string) => api.cozySend(cmd), onError: fail("The fox did not get the command") });
  const restore = useMutation({
    mutationFn: (name: string) => api.cozyRestore(name),
    onSuccess: (s) => {
      qc.setQueryData(["cozy"], s);
      toast({ kind: "ok", title: "Previous configuration restored" });
    },
    onError: fail("Could not restore"),
  });
  const saveSettings = useMutation({ mutationFn: (s: Settings) => api.saveSettings(s), onSuccess: (s) => qc.setQueryData(keys.settings, s), onError: fail("Not saved") });

  if (status.isLoading) {
    return (
      <p className="flex items-center gap-2 py-16 text-muted">
        <Spinner /> Looking for Cozy Fox…
      </p>
    );
  }
  if (status.error || !status.data) return <ErrorNote>{asAppError(status.error).message}</ErrorNote>;
  const s = status.data;

  if (!s.installed) {
    return (
      <>
        <PageHeader title="Cozy Fox" />
        <Card>
          <EmptyState icon={<PawPrint className="size-6" />} title="Cozy Fox is not installed here">
            <span className="selectable">
              TekBoard looks for the Cozy Glass configuration at <Code>{tildify(s.widgetsPath, home)}</Code> and did not find it. Nothing was created.
            </span>
          </EmptyState>
        </Card>
      </>
    );
  }

  const c = s.companion;
  const on = c.enabled ?? true;

  return (
    <>
      <PageHeader title="Cozy Fox" subtitle="Your desktop companion. Changes apply at once; the previous configuration is saved every time." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle right={update.isPending ? <Spinner /> : undefined}>Settings</CardTitle>
            <div className="py-1">
              <Toggle label="Fox on the desktop" checked={on} onChange={(v) => update.mutate({ enabled: v })} />
              <Toggle label="Outfits" hint="All of them: weather and season" checked={c.outfits ?? true} onChange={(v) => update.mutate({ outfits: v })} />
              <Toggle label="Weather outfits" hint="Umbrella, scarf, sunglasses" checked={c.weatherOutfits ?? true} onChange={(v) => update.mutate({ weatherOutfits: v })} />
              <Toggle label="Season outfits" hint="Hats, flower, pumpkin" checked={(c.season ?? "auto") !== "none"} onChange={(v) => update.mutate({ season: v ? "auto" : "none" })} />
              <NumberRow label="Size" unit="×" value={c.scale} fallback="default" min={1} max={6} step={1} onCommit={(v) => update.mutate({ scale: v })} />
              <NumberRow label="Speed" unit="×" value={c.speed} fallback="default" min={0.25} max={3} step={0.25} onCommit={(v) => update.mutate({ speed: v })} />
              <NumberRow label="Water reminder" unit="min" hint="0 turns it off" value={c.water} fallback="default" min={0} max={240} step={5} onCommit={(v) => update.mutate({ water: v })} />
              <NumberRow label="Bird visits" unit="min" hint="Average interval" value={c.birdEvery} fallback="default" min={1} max={120} step={1} onCommit={(v) => update.mutate({ birdEvery: v })} />
            </div>
            <p className="selectable border-t border-white/6 px-4 py-2.5 text-xs text-faint">
              Written to the <Code>companion</Code> block of <Code>{tildify(s.widgetsPath, home)}</Code>. “default” means the key is absent and the fox uses its own value.
            </p>
          </Card>

          <Card>
            <CardTitle>TekBoard → fox</CardTitle>
            <Toggle
              label="React to builds and pushes made from TekBoard"
              hint="Happy or sulking after a build, rocket after a push"
              checked={settings.data?.foxSignals ?? false}
              onChange={(v) => settings.data && saveSettings.mutate({ ...settings.data, foxSignals: v })}
            />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Play</CardTitle>
            {!on && <p className="px-4 pt-3 text-xs text-warn">The fox is off: commands are sent but he will not show up.</p>}
            <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
              {PLAY.map((p) => (
                <Button key={p.cmd} title={p.hint} disabled={send.isPending} onClick={() => send.mutate(p.cmd)}>
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="border-t border-white/6 px-4 py-3">
              <p className="mb-2 text-xs text-muted">Outfit previews — until the next reload</p>
              <div className="flex flex-wrap gap-1.5">
                {PREVIEW.map((p) => (
                  <Button key={p.cmd} size="sm" variant="ghost" onClick={() => send.mutate(p.cmd)}>
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-white/6 px-4 py-3">
              <span className="text-xs text-muted">Rocket previews and code reload</span>
              <span className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => send.mutate("push")}>
                  Push ok
                </Button>
                <Button size="sm" variant="ghost" onClick={() => send.mutate("push-fail")}>
                  Push refused
                </Button>
                <Button size="sm" variant="ghost" title="Reloads the fox's code without logging out" onClick={() => send.mutate("reload")}>
                  Reload fox
                </Button>
              </span>
            </div>
          </Card>

          <Card>
            <CardTitle>Saved configurations</CardTitle>
            {s.backups.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">A copy of widgets.json is saved here before each change made from TekBoard.</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto py-1">
                {s.backups.slice(0, 20).map((name) => (
                  <li key={name} className="flex h-9 items-center gap-3 pr-2 pl-4">
                    <span className="selectable min-w-0 flex-1 truncate font-mono text-xs text-muted">{backupLabel(name)}</span>
                    <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} busy={restore.isPending && restore.variables === name} onClick={() => restore.mutate(name)}>
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/** `widgets-20261110-142233.123.json` → `2026-11-10 14:22:33`. */
function backupLabel(name: string): string {
  const m = /^widgets-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : name;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex min-h-10 items-center gap-3 px-4 py-1.5">
      <span className="min-w-0 flex-1">
        <span className="block text-[13px]">{label}</span>
        {hint && <span className="block text-xs text-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label={label} hint={hint}>
      <input type="checkbox" className="size-4 accent-(--color-accent)" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </Row>
  );
}

function NumberRow({ label, hint, unit, value, fallback, min, max, step, onCommit }: { label: string; hint?: string; unit: string; value: number | null | undefined; fallback: string; min: number; max: number; step: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    setDraft(null);
    if (draft.trim() !== "" && Number.isFinite(v) && v >= min && v <= max && v !== value) onCommit(v);
  };
  return (
    <Row label={label} hint={hint}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        placeholder={fallback}
        value={draft ?? (value ?? "")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-7 w-20 rounded-md border border-line bg-bg px-2 text-right text-[13px] text-fg placeholder:text-faint hover:border-line-strong focus:border-accent focus:outline-none"
      />
      <span className="w-7 text-xs text-faint">{unit}</span>
    </Row>
  );
}
