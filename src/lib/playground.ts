// Code Playground: what the screen computes on its own (file names, completions, the
// requests handed to Artix). Pure functions, tested in playground.test.ts.
import type { CDiagnostic, Draft, DraftFile, DraftSettings, JobView, MemIssue, PlaygroundCompile, PlaygroundRun } from "./api";
import { t } from "./i18n";

export const DEFAULT_SETTINGS: DraftSettings = { compiler: "gcc", flags: "-Wall -Wextra", args: "", stdin: "", asan: false, ubsan: false, valgrind: false, timeoutS: 10, memMb: 256 };

export const C_KEYWORDS = ["auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else", "enum", "extern", "float", "for", "goto", "if", "inline", "int", "long", "register", "restrict", "return", "short", "signed", "sizeof", "static", "struct", "switch", "typedef", "union", "unsigned", "void", "volatile", "while", "bool", "true", "false", "NULL", "size_t", "ssize_t", "uint8_t", "uint32_t", "uint64_t", "int64_t"];

/** The libc functions students reach for first (with their header, for the completion hint). */
export const LIBC: Array<[string, string]> = [
  ["printf", "stdio.h"], ["fprintf", "stdio.h"], ["dprintf", "stdio.h"], ["puts", "stdio.h"], ["putchar", "stdio.h"], ["scanf", "stdio.h"], ["fgets", "stdio.h"], ["getline", "stdio.h"], ["fopen", "stdio.h"], ["fclose", "stdio.h"], ["fread", "stdio.h"], ["fwrite", "stdio.h"], ["snprintf", "stdio.h"],
  ["malloc", "stdlib.h"], ["calloc", "stdlib.h"], ["realloc", "stdlib.h"], ["free", "stdlib.h"], ["exit", "stdlib.h"], ["atoi", "stdlib.h"], ["strtol", "stdlib.h"], ["qsort", "stdlib.h"], ["rand", "stdlib.h"], ["srand", "stdlib.h"], ["abs", "stdlib.h"],
  ["strlen", "string.h"], ["strcmp", "string.h"], ["strncmp", "string.h"], ["strcpy", "string.h"], ["strncpy", "string.h"], ["strcat", "string.h"], ["strdup", "string.h"], ["strchr", "string.h"], ["strstr", "string.h"], ["memcpy", "string.h"], ["memset", "string.h"], ["memmove", "string.h"], ["memcmp", "string.h"],
  ["write", "unistd.h"], ["read", "unistd.h"], ["close", "unistd.h"], ["fork", "unistd.h"], ["execve", "unistd.h"], ["open", "fcntl.h"], ["waitpid", "sys/wait.h"], ["sqrt", "math.h"], ["pow", "math.h"], ["assert", "assert.h"],
];

/** Identifiers declared or used in a file (for completion), keywords excluded. */
export function identifiersOf(text: string): string[] {
  const noComments = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''");
  const seen = new Set<string>();
  for (const m of noComments.matchAll(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g)) {
    if (!C_KEYWORDS.includes(m[0]) && !/^\d/.test(m[0])) seen.add(m[0]);
  }
  return [...seen].sort();
}

/** `main.c` first, then sources, then headers; imported library files last. */
export function sortFiles(files: DraftFile[]): DraftFile[] {
  const rank = (f: DraftFile) => (f.library ? 3 : f.name === "main.c" ? 0 : f.name.endsWith(".c") ? 1 : 2);
  return [...files].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** A name not used yet: `file1.c`, `file2.c`… */
export function nextFileName(files: DraftFile[], ext: ".c" | ".h"): string {
  const taken = new Set(files.map((f) => f.name.toLowerCase()));
  for (let i = 1; ; i++) {
    const n = `${ext === ".h" ? "header" : "file"}${i}${ext}`;
    if (!taken.has(n)) return n;
  }
}

/** Same rules as the backend (`playground::validate`), to say it before saving. */
export function fileNameError(name: string, files: DraftFile[], current?: string): string | null {
  if (!/^[A-Za-z0-9_+\-][A-Za-z0-9_+.\-]*(\/[A-Za-z0-9_+\-][A-Za-z0-9_+.\-]*)*$/.test(name) || name.length > 120) return t("Lettres, chiffres, _ - . et / seulement");
  if (!/\.(c|h)$/.test(name)) return t("Un fichier .c ou .h");
  if (files.some((f) => f.name.toLowerCase() === name.toLowerCase() && f.name !== current)) return t("Ce nom est déjà pris");
  return null;
}

export function starterFor(name: string): string {
  if (!name.endsWith(".h")) return "";
  const guard = name.replace(/^.*\//, "").replace(/[^A-Za-z0-9]/g, "_").toUpperCase() + "_";
  return `#ifndef ${guard}\n    #define ${guard}\n\n#endif /* ${guard} */\n`;
}

export interface RunResult {
  compile: PlaygroundCompile | null;
  run: PlaygroundRun | null;
}

export function resultOf(job: JobView | null | undefined): RunResult {
  const s = job?.summary ?? {};
  return { compile: (s.compile as PlaygroundCompile | undefined) ?? null, run: (s.run as PlaygroundRun | undefined) ?? null };
}

export function diagnosticsFor(file: string, diags: CDiagnostic[]): CDiagnostic[] {
  return diags.filter((d) => d.file === file && d.line !== null);
}

export function counts(diags: CDiagnostic[]): { errors: number; warnings: number } {
  return { errors: diags.filter((d) => d.severity === "error").length, warnings: diags.filter((d) => d.severity === "warning").length };
}

/** One line for a run: what happened, in words. */
export function runHeadline(r: RunResult): { tone: "ok" | "warn" | "danger"; text: string } | null {
  if (r.compile && !r.compile.ok) {
    const c = counts(r.compile.diagnostics);
    return { tone: "danger", text: t("La compilation a échoué ({n} erreur(s))", { n: Math.max(1, c.errors) }) };
  }
  const run = r.run;
  if (!run) return null;
  if (run.timedOut) return { tone: "danger", text: t("Arrêté : limite de temps dépassée") };
  if (run.signal !== null) return { tone: "danger", text: t("Tué par {sig}", { sig: run.signalName ?? `signal ${run.signal}` }) };
  if (run.memory.length > 0) return { tone: "warn", text: t("{n} problème(s) mémoire · code {code}", { n: run.memory.length, code: run.exitCode ?? "?" }) };
  return { tone: run.exitCode === 0 ? "ok" : "warn", text: t("Code de sortie {code} · {ms} ms", { code: run.exitCode ?? "?", ms: run.durationMs }) };
}

export function memLabel(m: MemIssue): string {
  const where = m.at?.file ? `${m.at.file}${m.at.line ? `:${m.at.line}` : ""}` : null;
  return [m.kind, m.bytes ? t("{n} octets", { n: m.bytes }) : null, where].filter(Boolean).join(" · ");
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} caractères coupés)` : s);

export type ArtixAsk = "error" | "behavior" | "edge" | "tests" | "memory" | "fix" | "concept";

/** What is sent to Artix: the request, the code, and only the output that matters to it. */
export function artixRequest(kind: ArtixAsk, draft: Pick<Draft, "title" | "files" | "settings">, r: RunResult, concept = ""): string {
  const ask: Record<ArtixAsk, string> = {
    error: t("Explique-moi cette erreur de compilation, simplement, et dis-moi où regarder. Ne réécris pas tout le programme."),
    behavior: t("Explique-moi ce que fait ce programme et pourquoi il donne cette sortie."),
    edge: t("Propose des cas limites pour ce programme (entrées, arguments) et ce que chacun devrait donner."),
    tests: t("Propose un petit environnement de test pour ce programme : quelques entrées standard et arguments, avec la sortie attendue pour chacun. Ne lance rien."),
    memory: t("Explique-moi ces problèmes mémoire : la cause, la ligne en cause, et comment le vérifier."),
    fix: t("Suggère une correction sous forme de diff minimal, sans l'appliquer, et explique-la."),
    concept: t("Aide-moi à comprendre cette notion avec ce code comme exemple : {c}", { c: concept || t("la notion utilisée ici") }),
  };
  const own = draft.files.filter((f) => !f.library);
  const libs = draft.files.filter((f) => f.library);
  let budget = 14000;
  const parts: string[] = [`${ask[kind]}\n`, t("Brouillon du Playground « {t} », {cc} {flags}", { t: draft.title, cc: draft.settings.compiler, flags: draft.settings.flags })];
  for (const f of own) {
    const body = clip(f.content, Math.max(800, budget));
    budget -= body.length;
    parts.push(`\n${f.name} :\n\`\`\`c\n${body}\n\`\`\``);
  }
  if (libs.length) parts.push(t("\nFichiers importés de bibliothèques (non montrés) : {l}", { l: libs.map((f) => f.name).join(", ") }));
  if (r.compile && (kind === "error" || kind === "fix" || !r.compile.ok) && r.compile.output.trim()) parts.push(`\n${t("Sortie du compilateur")} :\n\`\`\`\n${clip(r.compile.output, 4000)}\n\`\`\``);
  if (r.run && kind !== "error") {
    if (draft.settings.args.trim()) parts.push(`\n${t("Arguments")} : ${draft.settings.args}`);
    if (draft.settings.stdin.trim()) parts.push(`\n${t("Entrée standard")} :\n\`\`\`\n${clip(draft.settings.stdin, 1500)}\n\`\`\``);
    parts.push(`\n${t("Résultat")} : ${runHeadline(r)?.text ?? ""}`);
    if (r.run.stdout.trim()) parts.push(`\nstdout :\n\`\`\`\n${clip(r.run.stdout, 2500)}\n\`\`\``);
    if (r.run.stderr.trim()) parts.push(`\nstderr :\n\`\`\`\n${clip(r.run.stderr, kind === "memory" ? 6000 : 2500)}\n\`\`\``);
  }
  return parts.join("\n");
}

/** One line of a line-by-line comparison. */
export interface DiffLine {
  kind: "same" | "del" | "add";
  text: string;
}

/**
 * Line diff of two texts (longest common subsequence), for comparing two versions of a
 * file. Long files fall back to "all removed, all added" rather than a slow table.
 */
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a.split("\n");
  const y = b.split("\n");
  if (x.length * y.length > 4_000_000) return [...x.map((text) => ({ kind: "del" as const, text })), ...y.map((text) => ({ kind: "add" as const, text }))];
  const n = x.length;
  const m = y.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ kind: "same", text: x[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: "del", text: x[i++] });
    else out.push({ kind: "add", text: y[j++] });
  }
  while (i < n) out.push({ kind: "del", text: x[i++] });
  while (j < m) out.push({ kind: "add", text: y[j++] });
  return out;
}
