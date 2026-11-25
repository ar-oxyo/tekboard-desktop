// Prompt manager: read, edit and personalise the instructions TekBoard gives to Claude Code.
// Defaults ship with the application; your variants ("presets") are stored with your settings.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, Eye, RotateCcw, Save, Share2, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Select } from "../../components/Select";
import { Badge, Button, Card, cn, ErrorNote, IconButton, Input, PageHeader, Spinner } from "../../components/ui";
import { api, asAppError, type PromptDef } from "../../lib/api";
import { useRepos } from "../../lib/hooks";
import { displayName } from "../../lib/repos";
import { useUi } from "../../lib/store";
import { locale, t } from "../../lib/i18n";

const DEFAULT = "\u0001default";
const VAR = /\{\{([A-Z0-9_]+)\}\}/g;

/** The prompt text with its variables coloured: known ones in the accent colour, unknown ones in red. */
function Highlighted({ text, known }: { text: string; known: Set<string> }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(VAR)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <mark key={at} className={cn("rounded-[3px] bg-transparent", known.has(m[1]) ? "text-accent-strong shadow-[0_0_0_1px_var(--color-accent-soft)] [background:var(--color-accent-soft)]" : "text-danger [background:color-mix(in_srgb,var(--color-danger)_18%,transparent)]")}>
        {m[0]}
      </mark>,
    );
    last = at + m[0].length;
  }
  parts.push(text.slice(last));
  // A trailing newline needs a character after it to take up a line, like in the textarea.
  return <>{parts}{text.endsWith("\n") ? " " : ""}</>;
}

const EDITOR = "m-0 w-full p-3 font-mono text-xs leading-[1.6] break-words whitespace-pre-wrap [tab-size:4]";

function Editor({ value, onChange, known, readOnly, areaRef }: { value: string; onChange?: (v: string) => void; known: Set<string>; readOnly?: boolean; areaRef?: React.RefObject<HTMLTextAreaElement | null> }) {
  const back = useRef<HTMLPreElement>(null);
  return (
    <div className="relative h-[420px] overflow-hidden rounded-md border border-line bg-bg focus-within:border-accent">
      <pre ref={back} aria-hidden className={cn(EDITOR, "pointer-events-none absolute inset-0 overflow-hidden text-fg")}>
        <Highlighted text={value} known={known} />
      </pre>
      <textarea
        ref={areaRef}
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        aria-label={t("Texte du prompt")}
        onChange={(e) => onChange?.(e.target.value)}
        onScroll={(e) => {
          if (back.current) back.current.scrollTop = e.currentTarget.scrollTop;
        }}
        className={cn(EDITOR, "selectable absolute inset-0 resize-none overflow-auto bg-transparent text-transparent caret-(--color-fg) focus:outline-none", readOnly && "cursor-default")}
      />
    </div>
  );
}

export function PromptsPage() {
  const list = useQuery({ queryKey: ["prompts"], queryFn: api.promptsList, staleTime: 0 });
  const setPage = useUi((s) => s.setPage);
  const [id, setId] = useState<string | null>(null);
  const current = list.data?.find((p) => p.id === id) ?? list.data?.[0];
  return (
    <>
      <PageHeader
        title="Prompts"
        subtitle={t("Les instructions que TekBoard donne à Claude Code (Artix, moulinette, tests…). Modifie une copie, garde le texte par défaut sous la main.")}
        actions={
          <Button variant="ghost" icon={<ArrowLeft className="size-3.5" />} onClick={() => setPage("settings")}>
            {t("Réglages")}
          </Button>
        }
      />
      {list.isLoading ? (
        <p className="flex items-center gap-2 py-16 text-muted">
          <Spinner /> {t("Chargement…")}
        </p>
      ) : list.error || !current ? (
        <ErrorNote>{asAppError(list.error).message}</ErrorNote>
      ) : (
        <div className="grid grid-cols-[250px_minmax(0,1fr)] items-start gap-4">
          <Card>
            <ul className="py-1.5" role="listbox" aria-label="Prompts">
              {list.data!.map((p) => (
                <li key={p.id}>
                  <button type="button" role="option" aria-selected={p.id === current.id} onClick={() => setId(p.id)} className={cn("flex w-full flex-col gap-0.5 px-4 py-2 text-left row-hover", p.id === current.id && "bg-accent-soft")}>
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span className="min-w-0 flex-1 truncate">{p.title}</span>
                      {p.active !== null && <Badge tone="accent">custom</Badge>}
                    </span>
                    <span className="text-xs text-muted">{p.description}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="flex gap-2 border-t border-ink/6 px-4 py-3 text-xs text-faint">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              Un prompt n'est que du texte. Ce que Claude Code peut lire ou écrire est fixé par TekBoard pour chaque tâche et ne se change pas ici ; il n'a jamais de shell.
            </p>
          </Card>
          <PromptEditor key={current.id} def={current} />
        </div>
      )}
    </>
  );
}

function PromptEditor({ def }: { def: PromptDef }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const repos = useRepos();
  const known = useMemo(() => new Set(def.vars.map((v) => v.name)), [def]);
  // Which text is shown: the default, or one of the presets. Starts on the one in use.
  const [preset, setPreset] = useState<string>(def.active ?? DEFAULT);
  const stored = preset === DEFAULT ? def.default : (def.presets.find((p) => p.name === preset)?.body ?? def.default);
  const [body, setBody] = useState(stored);
  const [tab, setTab] = useState<"edit" | "default" | "preview">("edit");
  const [newName, setNewName] = useState("");
  const [repo, setRepo] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setBody(stored), [preset, stored]);
  const dirty = body !== stored;
  const inUse = (def.active ?? DEFAULT) === preset;
  const refresh = () => qc.invalidateQueries({ queryKey: ["prompts"] });
  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });
  const save = useMutation({
    mutationFn: ({ name, activate }: { name: string; activate: boolean }) => api.promptSave(def.id, name, body, activate),
    onSuccess: async (warnings, { name, activate }) => {
      await refresh();
      setPreset(name.trim());
      setNewName("");
      toast({ kind: warnings.length ? "info" : "ok", title: activate ? `“${name.trim()}” saved and now in use` : `“${name.trim()}” saved`, detail: warnings.join("\n") || undefined });
    },
    onError: fail(t("Pas enregistré")),
  });
  const activate = useMutation({
    mutationFn: (name: string | null) => api.promptActivate(def.id, name),
    onSuccess: async (_, name) => {
      await refresh();
      toast({ kind: "ok", title: name === null ? "Default restored" : `“${name}” is now in use` });
    },
    onError: fail(t("Pas modifié")),
  });
  const remove = useMutation({
    mutationFn: (name: string) => api.promptDelete(def.id, name),
    onSuccess: async () => {
      setPreset(DEFAULT);
      await refresh();
    },
    onError: fail(t("Pas supprimé")),
  });
  const preview = useQuery({ queryKey: ["prompt-preview", def.id, body, repo], queryFn: () => api.promptPreview(def.id, body, repo || null), staleTime: 0, enabled: tab === "preview" });
  const check = useQuery({ queryKey: ["prompt-check", def.id, body], queryFn: () => api.promptPreview(def.id, body, null), staleTime: 0, enabled: dirty });
  const insert = (name: string) => {
    const el = area.current;
    const token = `{{${name}}}`;
    if (!el || tab !== "edit") return setBody(body + token);
    const next = body.slice(0, el.selectionStart) + token + body.slice(el.selectionEnd);
    const caret = el.selectionStart + token.length;
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };
  const options = [{ value: DEFAULT, label: "Par défaut", hint: def.active === null ? "utilisé" : t("fourni avec TekBoard") }, ...def.presets.map((p) => ({ value: p.name, label: p.name, hint: p.problem ? "no longer valid" : def.active === p.name ? "utilisé" : undefined }))];
  const problem = dirty ? (check.data?.error ?? null) : (def.presets.find((p) => p.name === preset)?.problem ?? null);
  const name = preset === DEFAULT ? newName.trim() : preset;
  return (
    <Card className="min-w-0">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="display text-lg font-medium">{def.title}</h2>
            <p className="text-xs text-muted">{def.access} Expected answer: {def.expects}</p>
          </div>
          <Select className="w-52" label={t("Version affichée")} value={preset} onChange={setPreset} options={options} search={false} />
          <IconButton label={t("Partager cette version (TekShare)")} onClick={() => useUi.getState().openShare({ kind: "prompt", id: def.id, preset })}>
            <Share2 className="size-4" />
          </IconButton>
          {!inUse && !dirty && (
            <Button variant="primary" icon={<Check className="size-3.5" />} busy={activate.isPending} disabled={problem !== null} onClick={() => activate.mutate(preset === DEFAULT ? null : preset)}>
              {preset === DEFAULT ? "Restore Default" : t("Utiliser ce préréglage")}
            </Button>
          )}
          {inUse && <Badge tone="ok">utilisé</Badge>}
        </div>
        <div className="flex items-center gap-1 border-b border-ink/6">
          {(["edit", "default", "preview"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={cn("-mb-px flex h-8 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors", tab === t ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
              {t === "preview" && <Eye className="size-3.5" />}
              {t === "edit" ? (preset === DEFAULT ? "Text" : "Edit") : t === "default" ? "Par défaut" : "Preview"}
            </button>
          ))}
          <span className="ml-auto pb-1 text-xs text-faint">{body.length.toLocaleString(locale())} characters{dirty ? " · modified" : ""}</span>
        </div>
        {tab === "edit" && <Editor value={body} onChange={setBody} known={known} areaRef={area} />}
        {tab === "default" && <Editor value={def.default} known={known} readOnly />}
        {tab === "preview" && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{t("Variables remplies pour")}</span>
              <Select size="sm" className="w-64" label={t("Projet utilisé pour l'aperçu")} value={repo} onChange={setRepo} options={[{ value: "", label: "sample values" }, ...(repos.data ?? []).map((r) => ({ value: r.path, label: displayName(r), hint: r.my?.unitCode ?? r.epitech?.module }))]} />
              {preview.isFetching && <Spinner />}
              {preview.data && (
                <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => void navigator.clipboard.writeText(preview.data!.text).then(() => toast({ kind: "ok", title: t("Prompt copié") }))}>
                  Copier
                </Button>
              )}
            </div>
            {preview.error ? (
              <ErrorNote>{asAppError(preview.error).message}</ErrorNote>
            ) : (
              <>
                <pre className="selectable h-[372px] overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-xs leading-[1.6] break-words whitespace-pre-wrap text-fg">{preview.data?.text ?? ""}</pre>
                {preview.data && preview.data.variables.length > 0 && (
                  <p className="text-xs text-faint">
                    {preview.data.variables.map(([n, origin, len]) => `${n}: ${len.toLocaleString(locale())} characters ${origin === "project" ? "from the project" : "(sample)"}`).join(" · ")}. This is the exact text Claude Code would receive; nothing was run.
                  </p>
                )}
              </>
            )}
          </div>
        )}
        <div>
          <p className="mb-1 text-xs font-medium text-muted">{t("Variables : clique pour insérer au curseur")}</p>
          <ul className="flex flex-wrap gap-1.5">
            {def.vars.map((v) => (
              <li key={v.name}>
                <button type="button" title={`${v.description}${v.required ? "\nRequired: the prompt cannot work without it." : ""}\nExample: ${v.sample.slice(0, 160)}`} onClick={() => insert(v.name)} className={cn("flex h-6 items-center gap-1 rounded-md border px-2 font-mono text-2xs transition-colors hover:border-accent/50 hover:text-accent-strong", body.includes(`{{${v.name}}}`) ? "border-accent/30 bg-accent-soft text-accent-strong" : "border-ink/10 text-muted")}>
                  {`{{${v.name}}}`}
                  {v.required && <span className="font-sans text-warn">required</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {problem && <ErrorNote title={dirty ? t("Ce texte ne peut pas être enregistré") : t("Ce préréglage n'est plus valide : celui par défaut est utilisé")}>{problem}</ErrorNote>}
        {dirty && !problem && (check.data?.warnings.length ?? 0) > 0 && <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">{check.data!.warnings.join(" ")}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {preset === DEFAULT ? (
            <>
              <Input className="w-56" placeholder={t("Nom d'une nouvelle version")} value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} />
              <Button variant="primary" icon={<Save className="size-3.5" />} disabled={name === "" || problem !== null || check.isFetching} busy={save.isPending} onClick={() => save.mutate({ name, activate: true })} title="Garde ce texte comme ta version et l'utilise désormais">
                Enregistrer comme version et l'utiliser
              </Button>
              <Button disabled={name === "" || problem !== null || check.isFetching} busy={save.isPending} onClick={() => save.mutate({ name, activate: false })}>
                Enregistrer seulement
              </Button>
              {!dirty && <span className="text-xs text-faint">{t("Le texte par défaut n'est jamais modifié : modifie le texte, nomme-le, et il devient une version à toi.")}</span>}
            </>
          ) : (
            <>
              <Button variant="primary" icon={<Save className="size-3.5" />} disabled={!dirty || problem !== null || check.isFetching} busy={save.isPending} onClick={() => save.mutate({ name, activate: inUse })}>
                {t("Enregistrer")}
              </Button>
              {dirty && (
                <Button variant="ghost" onClick={() => setBody(stored)}>
                  {t("Annuler les changements")}
                </Button>
              )}
              <Button variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setBody(def.default)} title={t("Remet le texte par défaut dans l'éditeur ; rien n'est enregistré avant Enregistrer")}>
                Revenir au texte par défaut
              </Button>
              <Button className="ml-auto" variant="ghost" icon={<Trash2 className="size-3.5" />} busy={remove.isPending} onClick={() => remove.mutate(preset)} title={inUse ? t("Supprime ce préréglage ; celui par défaut est de nouveau utilisé") : t("Supprime ce préréglage")}>
                Supprimer la version
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
