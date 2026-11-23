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
  { cmd: "ball", label: "Balle", hint: "Lui lancer une balle" },
  { cmd: "zoomies", label: "Folie", hint: "Une course effrénée" },
  { cmd: "spin", label: "Toupie", hint: "Courir après sa queue" },
  { cmd: "pounce", label: "Bond", hint: "Saut de chasseur" },
  { cmd: "glass", label: "Saut sur fenêtre", hint: "Sauter sur une fenêtre" },
  { cmd: "bird", label: "Oiseau", hint: "Un oiseau passe" },
  { cmd: "mail", label: "Courrier", hint: "Il traverse l'écran avec une lettre" },
  { cmd: "water", label: "Pause eau", hint: "Le rappel d'eau, maintenant" },
  { cmd: "laser", label: "Laser", hint: "Activer le pointeur laser (aussi Super+Alt+L)" },
  { cmd: "pilot", label: "Mode pilote", hint: "Prends le contrôle du renard : clavier et souris vont à lui jusqu'à l'arrêt (aussi Super+Alt+F)" },
];

const PREVIEW: Array<{ cmd: string; label: string }> = [
  { cmd: "wx-rain", label: "Pluie" },
  { cmd: "wx-snow", label: "Neige" },
  { cmd: "wx-sun", label: "Soleil" },
  { cmd: "wx-cold", label: "Froid" },
  { cmd: "wx-auto", label: "Météo réelle" },
  { cmd: "season-halloween", label: "Halloween" },
  { cmd: "season-christmas", label: "Noël" },
  { cmd: "season-spring", label: "Printemps" },
  { cmd: "season-auto", label: "Saison réelle" },
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
      toast({ kind: "ok", title: "Configuration précédente restaurée" });
    },
    onError: fail("Could not restore"),
  });
  const saveSettings = useMutation({ mutationFn: (s: Settings) => api.saveSettings(s), onSuccess: (s) => qc.setQueryData(keys.settings, s), onError: fail("Not saved") });

  if (status.isLoading) {
    return (
      <p className="flex items-center gap-2 py-16 text-muted">
        <Spinner /> Recherche de Cozy Fox…
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
          <EmptyState icon={<PawPrint className="size-6" />} title="Cozy Fox n'est pas installé ici">
            <span className="selectable">
              TekBoard cherche la configuration de Cozy Glass dans <Code>{tildify(s.widgetsPath, home)}</Code> et ne l'a pas trouvée. Rien n'a été créé.
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
      <PageHeader title="Cozy Fox" subtitle="Ton compagnon de bureau. Les changements s'appliquent tout de suite ; la configuration précédente est sauvegardée à chaque fois." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle right={update.isPending ? <Spinner /> : undefined}>Réglages</CardTitle>
            <div className="py-1">
              <Toggle label="Renard sur le bureau" checked={on} onChange={(v) => update.mutate({ enabled: v })} />
              <Toggle label="Tenues" hint="Toutes : météo et saison" checked={c.outfits ?? true} onChange={(v) => update.mutate({ outfits: v })} />
              <Toggle label="Tenues météo" hint="Parapluie, écharpe, lunettes de soleil" checked={c.weatherOutfits ?? true} onChange={(v) => update.mutate({ weatherOutfits: v })} />
              <Toggle label="Tenues de saison" hint="Chapeaux, fleur, citrouille" checked={(c.season ?? "auto") !== "none"} onChange={(v) => update.mutate({ season: v ? "auto" : "none" })} />
              <NumberRow label="Taille" unit="×" value={c.scale} fallback="default" min={1} max={6} step={1} onCommit={(v) => update.mutate({ scale: v })} />
              <NumberRow label="Vitesse" unit="×" value={c.speed} fallback="default" min={0.25} max={3} step={0.25} onCommit={(v) => update.mutate({ speed: v })} />
              <NumberRow label="Rappel d'eau" unit="min" hint="0 le désactive" value={c.water} fallback="default" min={0} max={240} step={5} onCommit={(v) => update.mutate({ water: v })} />
              <NumberRow label="Visites d'oiseaux" unit="min" hint="Intervalle moyen" value={c.birdEvery} fallback="default" min={1} max={120} step={1} onCommit={(v) => update.mutate({ birdEvery: v })} />
            </div>
            <p className="selectable border-t border-white/6 px-4 py-2.5 text-xs text-faint">
              Écrit dans le bloc <Code>companion</Code> block of <Code>{tildify(s.widgetsPath, home)}</Code>. “default” means the key is absent and the fox uses its own value.
            </p>
          </Card>

          <Card>
            <CardTitle>TekBoard → renard</CardTitle>
            <Toggle
              label="Réagir aux compilations et aux push faits depuis TekBoard"
              hint="Content ou boudeur après une compilation, fusée après un push"
              checked={settings.data?.foxSignals ?? false}
              onChange={(v) => settings.data && saveSettings.mutate({ ...settings.data, foxSignals: v })}
            />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Jouer</CardTitle>
            {!on && <p className="px-4 pt-3 text-xs text-warn">Le renard est éteint : les commandes partent mais il n'apparaîtra pas.</p>}
            <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
              {PLAY.map((p) => (
                <Button key={p.cmd} title={p.hint} disabled={send.isPending} onClick={() => send.mutate(p.cmd)}>
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="border-t border-white/6 px-4 py-3">
              <p className="mb-2 text-xs text-muted">Aperçu des tenues, jusqu'au prochain rechargement</p>
              <div className="flex flex-wrap gap-1.5">
                {PREVIEW.map((p) => (
                  <Button key={p.cmd} size="sm" variant="ghost" onClick={() => send.mutate(p.cmd)}>
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-white/6 px-4 py-3">
              <span className="text-xs text-muted">Aperçu de la fusée et rechargement du code</span>
              <span className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => send.mutate("push")}>
                  Push réussi
                </Button>
                <Button size="sm" variant="ghost" onClick={() => send.mutate("push-fail")}>
                  Push refusé
                </Button>
                <Button size="sm" variant="ghost" title="Recharge le code du renard sans fermer la session" onClick={() => send.mutate("reload")}>
                  Recharger le renard
                </Button>
              </span>
            </div>
          </Card>

          <Card>
            <CardTitle>Configurations sauvegardées</CardTitle>
            {s.backups.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">Une copie de widgets.json est sauvegardée ici avant chaque changement fait depuis TekBoard.</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto py-1">
                {s.backups.slice(0, 20).map((name) => (
                  <li key={name} className="flex h-9 items-center gap-3 pr-2 pl-4">
                    <span className="selectable min-w-0 flex-1 truncate font-mono text-xs text-muted">{backupLabel(name)}</span>
                    <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} busy={restore.isPending && restore.variables === name} onClick={() => restore.mutate(name)}>
                      Restaurer
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
