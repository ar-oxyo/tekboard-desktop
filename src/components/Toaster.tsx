import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useUi } from "../lib/store";
import { cn } from "./ui";

export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[360px] max-w-[90vw] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={cn(
            "anim-rise pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-raised px-3 py-2.5 shadow-(--shadow-pop)",
            t.kind === "error" ? "border-danger/40" : "border-line-strong",
          )}
        >
          <span className={cn("mt-0.5", t.kind === "error" ? "text-danger" : t.kind === "ok" ? "text-ok" : "text-info")}>
            {t.kind === "error" ? <CircleAlert className="size-4" /> : t.kind === "ok" ? <CircleCheck className="size-4" /> : <Info className="size-4" />}
          </span>
          <div className="selectable min-w-0 flex-1">
            <p className="text-[13px] font-medium">{t.title}</p>
            {t.detail && <p className="mt-0.5 text-xs break-words text-muted">{t.detail}</p>}
          </div>
          <button type="button" aria-label="Fermer" onClick={() => dismiss(t.id)} className="text-faint hover:text-fg">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
