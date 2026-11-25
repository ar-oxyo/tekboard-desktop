// C code editor (CodeMirror 6): line numbers, highlighting from the theme's own colours,
// light completion (keywords, libc, identifiers of the draft), compiler diagnostics in the
// gutter. Loaded with the screens that use it only (they are lazy), never at start.
import { useEffect, useRef } from "react";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { C_KEYWORDS, LIBC } from "../lib/playground";

export interface EditorMark {
  line: number;
  col?: number | null;
  severity: "error" | "warning" | "info";
  message: string;
}

interface Props {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  marks?: EditorMark[];
  /** Extra completion words (identifiers of the other files, imported functions). */
  words?: string[];
  /** Ctrl+Enter. */
  onRun?: () => void;
  /** Moves the cursor there when `nonce` changes. */
  jump?: { line: number; col?: number | null; nonce: number } | null;
  className?: string;
  /** Accessible name. */
  label?: string;
  /** `c` (default) highlights and completes C; `plain` is a plain text editor (Python, data). */
  language?: "c" | "plain";
}

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.modifier, tags.operatorKeyword], color: "var(--color-accent-strong)" },
  { tag: [tags.typeName, tags.standard(tags.typeName)], color: "var(--color-info)" },
  { tag: [tags.string, tags.special(tags.string), tags.character], color: "var(--color-ok)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--color-warn)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--color-faint)", fontStyle: "italic" },
  { tag: [tags.processingInstruction, tags.meta], color: "var(--color-danger)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--color-fg)", fontWeight: "500" },
  { tag: [tags.propertyName], color: "var(--color-muted)" },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: "var(--color-muted)" },
]);

const theme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "12.5px", backgroundColor: "transparent", color: "var(--color-fg)" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
    ".cm-content": { caretColor: "var(--color-accent)", padding: "8px 0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-accent)" },
    "&.cm-focused": { outline: "none" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--color-accent-soft)" },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--color-faint)", border: "none" },
    ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--color-ink) 4%, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-muted)" },
    ".cm-matchingBracket": { backgroundColor: "var(--color-accent-soft)", outline: "none" },
    ".cm-tooltip": { backgroundColor: "var(--color-raised)", border: "1px solid var(--color-line)", borderRadius: "var(--btn-radius)", color: "var(--color-fg)" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--color-accent-soft)", color: "var(--color-fg)" },
    ".cm-completionDetail": { color: "var(--color-faint)", fontStyle: "normal", marginLeft: "8px" },
    ".cm-diagnostic-error": { borderLeftColor: "var(--color-danger)" },
    ".cm-diagnostic-warning": { borderLeftColor: "var(--color-warn)" },
    ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--color-danger)", textUnderlineOffset: "3px" },
    ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--color-warn)", textUnderlineOffset: "3px" },
    ".cm-panels": { backgroundColor: "var(--color-raised)", color: "var(--color-fg)" },
    ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--color-accent-2) 28%, transparent)" },
    ".cm-foldGutter span": { color: "var(--color-faint)" },
  },
  { dark: true },
);

function toDiagnostics(state: EditorState, marks: EditorMark[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const m of marks) {
    if (m.line < 1 || m.line > state.doc.lines) continue;
    const line = state.doc.line(m.line);
    const from = Math.min(line.to, line.from + Math.max(0, (m.col ?? 1) - 1));
    // Underline the word at the column (or the whole line when there is none).
    const rest = state.doc.sliceString(from, line.to);
    const word = /^[A-Za-z0-9_]+/.exec(rest)?.[0].length ?? 1;
    out.push({ from: m.col ? from : line.from, to: m.col ? Math.min(line.to, from + word) : line.to, severity: m.severity, message: m.message });
  }
  return out;
}

export default function CodeEditor({ value, onChange, readOnly, marks, words, onRun, jump, className, label, language = "c" }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const editable = useRef(new Compartment());
  // Latest callbacks and words without rebuilding the editor.
  const live = useRef({ onChange, onRun, words });
  live.current = { onChange, onRun, words };

  useEffect(() => {
    if (!host.current) return;
    const complete = (ctx: CompletionContext) => {
      const word = ctx.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
      if (!word || (word.from === word.to && !ctx.explicit)) return null;
      const seen = new Set<string>();
      const options: Completion[] = [];
      const add = (label: string, type: string, detail?: string) => {
        if (seen.has(label)) return;
        seen.add(label);
        options.push({ label, type, detail });
      };
      for (const k of C_KEYWORDS) add(k, "keyword");
      for (const [fn, h] of LIBC) add(fn, "function", h);
      for (const w of live.current.words ?? []) add(w, "variable");
      return { from: word.from, options, validFor: /^[A-Za-z0-9_]*$/ };
    };
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          foldGutter(),
          lintGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          indentOnInput(),
          indentUnit.of("    "),
          EditorState.tabSize.of(4),
          bracketMatching(),
          closeBrackets(),
          language === "c" ? autocompletion({ override: [complete], activateOnTyping: true, maxRenderedOptions: 40 }) : [],
          highlightActiveLine(),
          highlightActiveLineGutter(),
          highlightSelectionMatches(),
          language === "c" ? [cpp(), syntaxHighlighting(highlight)] : [],
          theme,
          editable.current.of([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]),
          Prec.highest(keymap.of([{ key: "Mod-Enter", run: () => (live.current.onRun?.(), true), preventDefault: true }])),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) live.current.onChange?.(u.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ "aria-label": label ?? "Code" }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor is built once; the props below are applied by the other effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A value changed from outside (another tab, an import, a restore).
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);

  useEffect(() => {
    const v = view.current;
    if (v) v.dispatch(setDiagnostics(v.state, toDiagnostics(v.state, marks ?? [])));
  }, [marks, value]);

  useEffect(() => {
    const v = view.current;
    if (!v || !jump || jump.line < 1 || jump.line > v.state.doc.lines) return;
    const line = v.state.doc.line(jump.line);
    const pos = Math.min(line.to, line.from + Math.max(0, (jump.col ?? 1) - 1));
    v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    v.focus();
  }, [jump]);

  return <div ref={host} className={className} />;
}
