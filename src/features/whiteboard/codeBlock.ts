// A code block on a board: the code is highlighted (CodeMirror's C grammar) and drawn into
// an image; the source stays on the element (`customData.code`) so it can be edited again.
import { cppLanguage } from "@codemirror/lang-cpp";
import { classHighlighter, highlightTree } from "@lezer/highlight";

const COLORS: Array<[string, string]> = [
  ["tok-comment", "#6e7781"],
  ["tok-string", "#0a3069"],
  ["tok-number", "#0550ae"],
  ["tok-bool", "#0550ae"],
  ["tok-keyword", "#cf222e"],
  ["tok-typeName", "#8250df"],
  ["tok-meta", "#953800"],
  ["tok-processingInstruction", "#953800"],
  ["tok-definition", "#6639ba"],
  ["tok-operator", "#24292f"],
];

function colorOf(classes: string): string {
  for (const [c, color] of COLORS) if (classes.includes(c)) return color;
  return "#1f2328";
}

export interface CodeImage {
  dataURL: string;
  width: number;
  height: number;
}

/** Spans of `[text, colour]` per line. */
export function highlightLines(code: string): Array<Array<[string, string]>> {
  const tree = cppLanguage.parser.parse(code);
  const colors: string[] = Array(code.length).fill("#1f2328");
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    const c = colorOf(classes);
    for (let i = from; i < to; i++) colors[i] = c;
  });
  const lines: Array<Array<[string, string]>> = [];
  let line: Array<[string, string]> = [];
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === "\n") {
      lines.push(line);
      line = [];
      continue;
    }
    const last = line[line.length - 1];
    if (last && last[1] === colors[i]) last[0] += ch === "\t" ? "    " : ch;
    else line.push([ch === "\t" ? "    " : ch, colors[i]]);
  }
  lines.push(line);
  return lines;
}

export function renderCode(code: string, scale = 2): CodeImage {
  const lines = highlightLines(code.replace(/\s+$/, "")).slice(0, 120);
  const font = 14;
  const lh = 20;
  const pad = 14;
  const gutter = 34;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = `${font}px "JetBrains Mono Variable", monospace`;
  const widest = Math.max(200, ...lines.map((l) => probe.measureText(l.map((s) => s[0]).join("")).width));
  const w = Math.ceil(gutter + widest + pad * 2);
  const h = Math.ceil(lines.length * lh + pad * 2);
  const cv = document.createElement("canvas");
  cv.width = w * scale;
  cv.height = h * scale;
  const c = cv.getContext("2d")!;
  c.scale(scale, scale);
  c.fillStyle = "#f6f8fa";
  c.beginPath();
  c.roundRect(0.5, 0.5, w - 1, h - 1, 8);
  c.fill();
  c.strokeStyle = "#d0d7de";
  c.stroke();
  c.font = `${font}px "JetBrains Mono Variable", monospace`;
  c.textBaseline = "top";
  lines.forEach((spans, i) => {
    const y = pad + i * lh + 3;
    c.fillStyle = "#8c959f";
    c.textAlign = "right";
    c.fillText(String(i + 1), pad + gutter - 12, y);
    c.textAlign = "left";
    let x = pad + gutter;
    for (const [text, color] of spans) {
      c.fillStyle = color;
      c.fillText(text, x, y);
      x += c.measureText(text).width;
    }
  });
  return { dataURL: cv.toDataURL("image/png"), width: w, height: h };
}
