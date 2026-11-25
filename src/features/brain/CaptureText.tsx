// A capture as it reads: light Markdown (code, lists, quotes) and its pasted images.
import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { Fragment } from "react";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import { cn } from "../../components/ui";
import { Markdown } from "../artix/Markdown";

const IMAGE_LINE = /^\s*!\[[^\]]*\]\(capture:([0-9a-f-]{8,64})\)\s*$/;

export function CaptureImage({ id, className }: { id: string; className?: string }) {
  const q = useQuery({ queryKey: ["brain-image", id], queryFn: () => api.brainImage(id), staleTime: Infinity, retry: false });
  if (q.isError)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-faint">
        <ImageOff className="size-3.5" /> {t("Image introuvable")}
      </span>
    );
  if (!q.data) return <span className={cn("block h-24 w-40 animate-pulse rounded-md bg-white/5", className)} />;
  return <img src={q.data} alt="" className={cn("max-h-64 max-w-full rounded-md border border-white/8 object-contain", className)} />;
}

/** Text blocks and image lines, in order. */
function parts(text: string): Array<{ kind: "text"; text: string } | { kind: "image"; id: string }> {
  const out: Array<{ kind: "text"; text: string } | { kind: "image"; id: string }> = [];
  let buf: string[] = [];
  let fence = false;
  const flush = () => {
    if (buf.join("").trim()) out.push({ kind: "text", text: buf.join("\n") });
    buf = [];
  };
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("```")) fence = !fence;
    const m = !fence && IMAGE_LINE.exec(line);
    if (m) {
      flush();
      out.push({ kind: "image", id: m[1] });
    } else buf.push(line);
  }
  flush();
  return out;
}

export function CaptureText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("text-[13px] leading-relaxed text-muted", className)}>
      {parts(text).map((p, i) => (
        <Fragment key={i}>{p.kind === "image" ? <CaptureImage id={p.id} className="my-1.5" /> : <Markdown text={p.text} />}</Fragment>
      ))}
    </div>
  );
}
