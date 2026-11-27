// Light mode (Settings → Appearance): the same app with only what is useful at the moment
// on screen. Nothing is removed: what a screen leaves out in light mode stays one click away
// (a "Plus" menu, a fold, a tooltip). Components ask `useLite()`; three building blocks cover
// most needs:
//   <Detail>   secondary content (explanations, technical figures, decorative extras): full mode only.
//   <Hint>     a one-line explanation under a control: full mode only, its text kept as a tooltip
//              on `title` by the caller when it carries information.
//   <More>     in light mode, folds its children behind a "Plus" disclosure instead of showing them.
// New screens use these instead of scattering `lite ? … : …` conditions.
import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { create } from "zustand";
import { t } from "../lib/i18n";

// Not `cn` from ui.tsx: ui.tsx itself reads `useLite`.
const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/**
 * The current mode, kept by `useLitePref` (lib/hooks.ts, mounted by App) from the saved
 * preference; before it is read, what `public/boot.js` put on <html>. A store without
 * dependencies, so the shared primitives (ui.tsx, Menu.tsx) can read it.
 */
export const useLiteStore = create<{ on: boolean }>(() => ({ on: typeof document !== "undefined" && document.documentElement.dataset.lite === "on" }));

/** Whether light mode is on. */
export function useLite(): boolean {
  return useLiteStore((s) => s.on);
}

/** Secondary content, shown in full mode only. */
export function Detail({ children }: { children: ReactNode }) {
  return useLite() ? null : <>{children}</>;
}

/** A short explanation under a control, in full mode only. */
export function Hint({ children, className, as: Tag = "p" }: { children: ReactNode; className?: string; as?: "p" | "span" }) {
  if (useLite()) return null;
  return <Tag className={cn("text-xs text-faint", Tag === "span" && "block", className)}>{children}</Tag>;
}

/**
 * Everything in full mode; in light mode, folded behind one "Plus" line that opens in place.
 * For groups of secondary controls or fields a screen does not need at first sight.
 */
export function More({ children, label = t("Plus"), className }: { children: ReactNode; label?: string; className?: string }) {
  const lite = useLite();
  const [open, setOpen] = useState(false);
  if (!lite) return <>{children}</>;
  return (
    <div className={className}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-1 text-xs text-faint hover:text-muted">
        <ChevronRight className={cn("size-3.5 transition-transform duration-(--dur-fast)", open && "rotate-90")} />
        {label}
      </button>
      {open && <div className="anim-fade mt-2">{children}</div>}
    </div>
  );
}
