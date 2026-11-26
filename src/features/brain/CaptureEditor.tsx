// Where an idea is written: one text box, focused at once. Nothing to choose before saving:
// Enter saves (a new line inside a code block), Shift+Enter adds a line, Ctrl+Enter saves and
// stays for the next one, Escape closes and keeps the draft. Pasted or dropped images are
// stored and referenced in the text. The draft is kept on every keystroke.
import { Eye, FolderGit2, ImagePlus, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, asAppError, type Capture } from "../../lib/api";
import { clearDraft, fileBase64, loadDraft, saveDraft } from "../../lib/brain";
import { t } from "../../lib/i18n";
import { Button, cn, IconButton, Kbd } from "../../components/ui";
import { ProjectPicker } from "../../components/ProjectPicker";
import { CaptureText } from "./CaptureText";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Inside an unclosed ``` block at the cursor. */
const inFence = (text: string, at: number) => (text.slice(0, at).match(/^\s*```/gm)?.length ?? 0) % 2 === 1;

export function CaptureEditor({ project: initialProject, onSaved, onClose, autoFocusKey, floating }: { project?: string | null; onSaved: (c: Capture, keepOpen: boolean) => void; onClose: () => void; autoFocusKey?: number; floating?: boolean }) {
  const draft = useRef(loadDraft());
  const [text, setText] = useState(draft.current.text);
  const [project, setProject] = useState<string | null>(initialProject ?? draft.current.project);
  const [pickProject, setPickProject] = useState(Boolean(initialProject));
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);

  // Focus at once, cursor at the end (and again each time the floating window is shown).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocusKey]);
  useEffect(() => {
    const id = window.setTimeout(() => saveDraft(text, project), 300);
    return () => window.clearTimeout(id);
  }, [text, project]);
  // Grows with the text, up to a limit.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, floating ? 150 : 320)}px`;
  }, [text, floating, preview]);

  const save = async (keepOpen: boolean) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const c = await api.brainSave(text, project);
      clearDraft();
      setText("");
      if (!initialProject) setProject(null);
      setPreview(false);
      onSaved(c, keepOpen);
      if (keepOpen) box.current?.focus();
    } catch (e) {
      // The draft is still there: nothing is lost.
      setError(asAppError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const insert = (snippet: string) => {
    const el = box.current;
    const at = el?.selectionStart ?? text.length;
    const before = text.slice(0, at);
    const lead = before && !before.endsWith("\n") ? "\n" : "";
    const next = `${before}${lead}${snippet}\n${text.slice(el?.selectionEnd ?? at)}`;
    setText(next);
    requestAnimationFrame(() => {
      const pos = before.length + lead.length + snippet.length + 1;
      box.current?.focus();
      box.current?.setSelectionRange(pos, pos);
    });
  };

  const attach = async (files: File[]) => {
    for (const f of files.filter((f) => IMAGE_TYPES.includes(f.type)).slice(0, 5)) {
      try {
        const id = await api.brainAttach(f.type, await fileBase64(f));
        insert(`![](capture:${id})`);
      } catch (e) {
        setError(asAppError(e).message);
      }
    }
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2"
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => IMAGE_TYPES.includes(i.type))) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = [...e.dataTransfer.files];
        if (files.some((f) => IMAGE_TYPES.includes(f.type))) {
          e.preventDefault();
          void attach(files);
        }
      }}
    >
      {preview ? (
        <div className="min-h-[96px] overflow-y-auto rounded-lg border border-ink/8 bg-well px-3 py-2" style={{ maxHeight: floating ? 150 : 320 }}>
          <CaptureText text={text || t("Rien à afficher")} />
        </div>
      ) : (
        <textarea
          ref={box}
          aria-label={t("Capture")}
          rows={floating ? 3 : 4}
          spellCheck
          value={text}
          placeholder={t("Une idée, un bug, une commande, un lien… Écris, valide, c'est rangé.")}
          className="selectable min-h-[72px] w-full resize-none rounded-lg border border-ink/8 bg-well px-3 py-2.5 text-sm leading-relaxed text-fg placeholder:text-faint focus:border-accent/50 focus:outline-none"
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.some((f) => IMAGE_TYPES.includes(f.type))) {
              e.preventDefault();
              void attach(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void save(true);
            } else if (e.key === "Enter" && !e.shiftKey && !e.altKey && !inFence(text, e.currentTarget.selectionStart)) {
              e.preventDefault();
              void save(false);
            }
          }}
        />
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {pickProject ? (
          <div className="flex items-center gap-1">
            <ProjectPicker size="sm" className="w-52" value={project} onChange={setProject} includeNone label={t("Projet")} />
            {!initialProject && (
              <IconButton
                label={t("Sans projet")}
                onClick={() => {
                  setProject(null);
                  setPickProject(false);
                }}
              >
                <X className="size-3.5" />
              </IconButton>
            )}
          </div>
        ) : (
          <button type="button" onClick={() => setPickProject(true)} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-faint transition-colors duration-150 hover:bg-ink/5 hover:text-fg">
            <FolderGit2 className="size-3.5" /> {t("Projet")}
          </button>
        )}
        <button type="button" onClick={() => file.current?.click()} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-faint transition-colors duration-150 hover:bg-ink/5 hover:text-fg" title={t("Ajouter une image (ou colle-la directement)")}>
          <ImagePlus className="size-3.5" /> {t("Image")}
        </button>
        <input
          ref={file}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          multiple
          hidden
          onChange={(e) => {
            void attach([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        {text.trim() && (
          <button type="button" onClick={() => setPreview(!preview)} className={cn("flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors duration-150 hover:bg-ink/5", preview ? "text-accent-strong" : "text-faint hover:text-fg")}>
            {preview ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />} {preview ? t("Écrire") : t("Aperçu")}
          </button>
        )}
        <span className="ml-auto hidden items-center gap-1 text-2xs text-faint sm:flex">
          <Kbd>↵</Kbd> {t("enregistrer")} · <Kbd>⇧↵</Kbd> {t("ligne")} · <Kbd>Échap</Kbd> {t("fermer")}
        </span>
        <Button size="sm" variant="primary" busy={busy} disabled={!text.trim()} disabledReason={t("Rien à enregistrer")} onClick={() => void save(false)}>
          {t("Noter")}
        </Button>
      </div>
    </div>
  );
}
