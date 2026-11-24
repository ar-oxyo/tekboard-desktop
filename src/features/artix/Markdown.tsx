// A small Markdown renderer for Artix's answers: paragraphs, **bold**, *italic*, `code`,
// fenced code, lists, headings and quotes. It builds React elements only (no HTML is
// injected), so whatever the model writes stays text.
import { Fragment, type ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  // `code`, **bold**, *italic* / _italic_
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k} className="rounded bg-white/7 px-1 py-px font-mono text-[12px] text-accent-strong">{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k} className="font-semibold text-fg">{t.slice(2, -2)}</strong>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { kind: "p" | "h" | "quote"; text: string; level?: number } | { kind: "code"; text: string; lang: string } | { kind: "ul" | "ol"; items: string[] };

/** Exported for the tests. */
export function blocks(src: string): Block[] {
  const lines = src.replace(/\r/g, "").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```(\w*)/.exec(line.trim());
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++;
      out.push({ kind: "code", text: body.join("\n"), lang: fence[1] });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ kind: "h", text: h[2], level: h[1].length });
      i++;
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/).test(lines[i])) {
        let item = lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/, "");
        i++;
        // Continuation lines of the same item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) item += " " + lines[i++].trim();
        items.push(item);
      }
      out.push({ kind: ordered ? "ol" : "ul", items });
      continue;
    }
    if (line.startsWith(">")) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) q.push(lines[i++].replace(/^>\s?/, ""));
      out.push({ kind: "quote", text: q.join(" ") });
      continue;
    }
    const p: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*[-*•]\s+|\s*\d+[.)]\s+)/.test(lines[i])) p.push(lines[i++]);
    out.push({ kind: "p", text: p.join("\n") });
  }
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {blocks(text).map((b, i) => {
        const k = String(i);
        switch (b.kind) {
          case "code":
            return (
              <pre key={k} className="selectable my-2 overflow-x-auto rounded-lg border border-white/6 bg-black/30 p-2.5 font-mono text-[12px] leading-relaxed">
                {b.text}
              </pre>
            );
          case "h":
            return (
              <p key={k} className="mt-3 mb-1 text-[13px] font-semibold text-fg first:mt-0">
                {inline(b.text, k)}
              </p>
            );
          case "ul":
          case "ol": {
            const List = b.kind === "ul" ? "ul" : "ol";
            return (
              <List key={k} className={b.kind === "ul" ? "my-1.5 flex list-none flex-col gap-1 pl-0" : "my-1.5 flex list-decimal flex-col gap-1 pl-5 marker:text-faint"}>
                {b.items.map((it, j) => (
                  <li key={j} className={b.kind === "ul" ? "relative pl-3.5 before:absolute before:top-[0.6em] before:left-0.5 before:size-1 before:rounded-full before:bg-accent/70" : ""}>
                    {inline(it, `${k}-${j}`)}
                  </li>
                ))}
              </List>
            );
          }
          case "quote":
            return (
              <p key={k} className="my-1.5 border-l-2 border-accent/40 pl-2.5 text-muted">
                {inline(b.text, k)}
              </p>
            );
          default:
            return (
              <p key={k} className="my-1.5 whitespace-pre-wrap first:mt-0 last:mb-0">
                {b.text.split("\n").map((l, j, all) => (
                  <Fragment key={j}>
                    {inline(l, `${k}-${j}`)}
                    {j < all.length - 1 && <br />}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
