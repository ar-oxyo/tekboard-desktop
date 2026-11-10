import { cn } from "./ui";

/** Unified diff, coloured line by line. */
export function DiffView({ text, className }: { text: string; className?: string }) {
  return (
    <pre className={cn("selectable overflow-auto bg-black/25 py-2 font-mono text-[11.5px] leading-[1.55]", className)}>
      {text.split("\n").map((line, i) => (
        <div
          key={i}
          className={cn(
            "px-3 whitespace-pre",
            line.startsWith("+++") || line.startsWith("---") ? "text-faint" : line.startsWith("+") ? "bg-ok/10 text-ok" : line.startsWith("-") ? "bg-danger/10 text-danger" : line.startsWith("@@") ? "text-info" : "text-muted",
          )}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

/** Plain source or log text, monospaced, with line numbers when `numbered`. */
export function CodeView({ text, className, numbered }: { text: string; className?: string; numbered?: boolean }) {
  const lines = text.split("\n");
  return (
    <pre className={cn("selectable overflow-auto bg-black/25 py-2 font-mono text-[11.5px] leading-[1.55] text-fg/90", className)}>
      {lines.map((line, i) => (
        <div key={i} className="flex px-3 whitespace-pre">
          {numbered && <span className="mr-3 inline-block w-8 shrink-0 text-right text-faint select-none">{i + 1}</span>}
          <span>{line || " "}</span>
        </div>
      ))}
    </pre>
  );
}
