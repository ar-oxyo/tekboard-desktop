// Brain Dump helpers that need no backend: labels, the project a capture names, its code,
// the draft kept while writing. The type and tags are found by the backend at save time.
import type { Capture, CaptureType, RepoInfo, ShareResource } from "./api";
import { displayName } from "./repos";
import { t } from "./i18n";

export const CTYPE_LABEL: Record<CaptureType, string> = {
  idea: t("Idée"),
  bug: t("Bug"),
  improvement: t("Amélioration"),
  question: t("Question"),
  code: t("Code"),
  command: t("Commande"),
  link: t("Lien"),
  task: t("À faire"),
  info: t("À retenir"),
  image: t("Image"),
};

export const KIND_LABEL: Record<Capture["kind"], string> = {
  idea: t("Capture"),
  note: t("Note"),
  snippet: t("Snippet"),
  task: t("Tâche"),
};

/** Lowercase, without accents. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * A project the text names as a whole word ("… dans organized …" → Organized), when exactly
 * one matches. Only a suggestion: nothing is linked until the user accepts it.
 */
export function suggestProject(text: string, repos: Pick<RepoInfo, "path" | "name" | "remote" | "epitech">[]): string | null {
  const hay = ` ${fold(text).replace(/[^a-z0-9_-]+/g, " ")} `;
  const hits = new Set<string>();
  for (const r of repos) {
    const name = fold(displayName(r as RepoInfo)).replace(/\s*\(.*\)$/, "").trim();
    if (name.length < 3) continue;
    const words = name.replace(/[^a-z0-9_-]+/g, " ").trim();
    if (words && hay.includes(` ${words} `)) hits.add(r.path);
  }
  return hits.size === 1 ? [...hits][0] : null;
}

/** First fenced code block (or the whole text for a snippet or a command without one). */
export function codeOf(c: Pick<Capture, "text" | "kind" | "ctype">): { code: string; lang: string } | null {
  const m = /```([\w+-]*)[^\n]*\n([\s\S]*?)(?:```|$)/.exec(c.text);
  if (m) return { code: m[2].replace(/\n$/, ""), lang: (m[1] || "c").toLowerCase() };
  if (c.kind === "snippet" || c.ctype === "code") return { code: c.text, lang: "c" };
  if (c.ctype === "command") return { code: c.text.replace(/^\$ /gm, ""), lang: "sh" };
  return null;
}

export const isC = (lang: string) => lang === "c" || lang === "h" || lang === "cpp" || lang === "c++";

/** What TekShare sends for a capture: code as a snippet, anything else as a note. */
export function shareOf(c: Capture): ShareResource {
  const code = codeOf(c);
  if (code && (c.kind === "snippet" || c.ctype === "code")) return { kind: "snippet", title: c.title, text: code.code, lang: code.lang.replace(/[^a-z0-9]/g, "").slice(0, 8) || "txt" };
  return { kind: "note", title: c.title, text: c.text };
}

/** http(s) links written in a capture. */
export function linksOf(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s<>()"'`]+[^\s<>()"'`.,;:!?]/g) ?? [])];
}

/** Ids of the pasted images a text references (`![](capture:<id>)`). */
export function imageRefs(text: string): string[] {
  return [...new Set([...text.matchAll(/capture:([0-9a-f-]{8,64})/g)].map((m) => m[1]))];
}

// ───────────────────────────── draft ─────────────────────────────

const DRAFT = "tekboard.capture.draft";

/** The capture being written, kept on every keystroke (shared by both windows). */
export function loadDraft(): { text: string; project: string | null } {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFT) ?? "null") as { text?: unknown; project?: unknown } | null;
    return { text: typeof v?.text === "string" ? v.text : "", project: typeof v?.project === "string" ? v.project : null };
  } catch {
    return { text: "", project: null };
  }
}

export function saveDraft(text: string, project: string | null) {
  try {
    if (!text.trim() && !project) localStorage.removeItem(DRAFT);
    else localStorage.setItem(DRAFT, JSON.stringify({ text, project, at: Date.now() }));
  } catch {
    // Storage full or refused: the capture itself is unaffected.
  }
}

export const clearDraft = () => saveDraft("", null);

/** Reads a pasted or dropped file as base64 (no `data:` prefix). */
export function fileBase64(f: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}
