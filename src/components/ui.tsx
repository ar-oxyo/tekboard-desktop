// Small presentational primitives shared by every screen.
import { createContext, useContext, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle } from "lucide-react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Default control size, unless the caller's classes already set a width or a height. */
function sized(className?: string): string {
  const has = (prefix: string) => (className ?? "").split(/\s+/).some((c) => c.startsWith(prefix));
  return cn(!has("h-") && "h-8", !has("w-") && "w-full");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: ReactNode;
  busy?: boolean;
  /** Why it is disabled, in words: never a grey button without a reason. */
  disabledReason?: string | null;
}

const variants: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "text-muted hover:text-fg hover:bg-hover",
  danger: "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25",
};

export function Button({ variant = "secondary", size = "md", icon, busy, children, className, disabled, disabledReason, title, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      title={disabled && disabledReason ? disabledReason : title}
      disabled={disabled || busy}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-(--btn-radius) whitespace-nowrap transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {busy ? <Spinner /> : icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
}

export function IconButton({ label, active, children, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors duration-150 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
        active ? "text-accent" : "text-faint hover:text-fg",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden className={cn("anim-spin size-3.5", className)} />;
}

export function Card({ children, className, hero }: { children: ReactNode; className?: string; hero?: boolean }) {
  return <section className={cn("card", hero && "card-hero", className)}>{children}</section>;
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex h-10 items-center justify-between gap-3 border-b border-line px-4">
      <h2 className="flex min-w-0 items-center gap-2 text-sm font-medium text-fg">{children}</h2>
      {right}
    </header>
  );
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-ink/6 text-muted",
  accent: "bg-accent-soft text-accent-strong",
  ok: "bg-ok/12 text-ok",
  warn: "bg-warn/12 text-warn",
  danger: "bg-danger/12 text-danger",
  info: "bg-info/12 text-info",
};

export function Badge({ tone = "neutral", children, title, mono }: { tone?: Tone; children: ReactNode; title?: string; mono?: boolean }) {
  return (
    <span title={title} className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs leading-none whitespace-nowrap", mono && "font-mono", tones[tone])}>
      {children}
    </span>
  );
}

const dots: Record<Tone, string> = { neutral: "bg-faint", accent: "bg-accent", ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", info: "bg-info" };
const inks: Record<Tone, string> = { neutral: "text-muted", accent: "text-accent-strong", ok: "text-ok", warn: "text-warn", danger: "text-danger", info: "text-muted" };

/** Quiet status: a small dot and plain text. For lists, where a row of pills would shout. */
export function Dot({ tone = "neutral", children, title, mono, ink }: { tone?: Tone; children?: ReactNode; title?: string; mono?: boolean; ink?: boolean }) {
  return (
    <span title={title} className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap", mono && "font-mono", ink ? inks[tone] : "text-muted")}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dots[tone])} />
      {children}
    </span>
  );
}

/** Module or unit code (`G-PSU-100`): quiet monospace text, never a pill. */
export function Tag({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="shrink-0 font-mono text-2xs whitespace-nowrap text-faint">
      {children}
    </span>
  );
}

/** Small heading inside a card or a list: sentence case, quiet. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs text-faint", className)}>{children}</p>;
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      spellCheck={false}
      autoComplete="off"
      className={cn(
        sized(className),
        "field border border-ink/8 px-2.5 text-sm text-fg placeholder:text-faint",
        "transition-colors duration-150 hover:border-line-strong focus:border-accent focus:outline-none",
        className,
      )}
      {...rest}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 text-faint">{icon}</div>}
      <p className="display text-md font-medium text-fg">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorNote({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div role="alert" className="selectable rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
      {title && <p className="font-medium">{title}</p>}
      <div className="break-words whitespace-pre-wrap opacity-90">{children}</div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[5px] border border-ink/8 bg-ink/5 px-1.5 py-px font-mono text-2xs text-faint">{children}</kbd>;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="selectable rounded bg-raised px-1.5 py-0.5 font-mono text-xs text-fg">{children}</code>;
}

/**
 * A titled block without a box: a heading row over a hairline, then the content. Grouping
 * comes from spacing and rules, so a screen does not turn into a wall of cards.
 */
export function Section({ title, meta, action, children, className, id }: { title: ReactNode; meta?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("min-w-0", className)}>
      <header className="flex min-h-8 items-center gap-3 border-b border-line pb-1.5">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">{title}</h2>
        {meta && <span className="min-w-0 truncate text-xs text-faint">{meta}</span>}
        {action && <div className="ml-auto flex shrink-0 items-center gap-1">{action}</div>}
      </header>
      {children}
    </section>
  );
}

const meterInk: Record<Tone, string> = { neutral: "bg-faint", accent: "bg-accent", ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", info: "bg-info" };

/** A thin bar for a share of something (tests passed, hours done). */
export function Meter({ value, max, tone = "accent", label, className }: { value: number; max: number; tone?: Tone; label?: string; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label} className={cn("block h-1.5 overflow-hidden rounded-full bg-ink/8", className)}>
      <span className={cn("meter-fill block h-full rounded-full transition-[width] duration-(--dur-base) ease-(--ease)", meterInk[tone])} style={{ width: `${pct}%` }} />
    </span>
  );
}

const noticeTone: Record<"info" | "warn" | "danger" | "ok", string> = {
  info: "bg-accent-soft text-fg [&>svg]:text-accent",
  warn: "bg-warn/10 text-fg [&>svg]:text-warn",
  danger: "bg-danger/10 text-fg [&>svg]:text-danger",
  ok: "bg-ok/10 text-fg [&>svg]:text-ok",
};

/** A line that needs attention, inside a screen: what is going on, and the way out. */
export function Notice({ tone = "info", icon, children, action, className }: { tone?: "info" | "warn" | "danger" | "ok"; icon?: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-2.5 rounded-(--btn-radius) px-3 py-2 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0", noticeTone[tone], className)}>
      {icon}
      <div className="min-w-0 flex-1 text-muted [&_strong]:font-medium [&_strong]:text-fg">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** The page bar's right-hand slot, when the page sits in a tabbed section (see App). */
export const PageBarSlot = createContext<HTMLElement | "pending" | null>(null);

/**
 * Title, one line of context and the page's actions, on one row. In a tabbed section
 * (Projects, Settings) the bar already shows the section and its tabs: the context and the
 * actions join it there instead of adding a second band.
 */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  const slot = useContext(PageBarSlot);
  if (slot === "pending") return null;
  if (slot)
    return createPortal(
      <>
        {subtitle && <span className="hidden min-w-0 truncate text-xs text-faint lg:block">{subtitle}</span>}
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </>,
      slot,
    );
  return (
    <div className="mb-5 flex min-h-9 items-center gap-4">
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        <h1 className="display title-gradient shrink-0 text-xl font-(--title-weight) tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="min-w-0 truncate text-xs text-faint">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A task's checkbox. Ticking it draws TekBoard's ring and a check (300 ms) before the task
 * is marked done, so the row does not vanish under the cursor. Without animations, at once.
 */
export function DoneCheck({ checked, onChange, label, className }: { checked: boolean; onChange: () => void; label: string; className?: string }) {
  const [drawing, setDrawing] = useState(false);
  const on = checked || drawing;
  const click = () => {
    if (drawing) return;
    const still = document.documentElement.dataset.motion === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (checked || still) return onChange();
    setDrawing(true);
    window.setTimeout(() => {
      setDrawing(false);
      onChange();
    }, 320);
  };
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} onPointerDown={(e) => e.stopPropagation()} onClick={click} className={cn("done-check inline-flex size-4 shrink-0 items-center justify-center rounded-full", className)}>
      <svg viewBox="0 0 16 16" className="size-4" aria-hidden data-on={on ? "" : undefined} data-drawing={drawing ? "" : undefined}>
        <circle cx="8" cy="8" r="6.5" className="done-track" />
        <circle cx="8" cy="8" r="6.5" className="done-ring" transform="rotate(-90 8 8)" />
        <path d="M5.2 8.3l1.9 1.9 3.7-4" className="done-tick" />
      </svg>
    </button>
  );
}
