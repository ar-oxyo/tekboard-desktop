// Small presentational primitives shared by every screen.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
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
}

const variants: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "text-muted hover:text-fg hover:bg-hover",
  danger: "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25",
};

export function Button({ variant = "secondary", size = "md", icon, busy, children, className, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-(--btn-radius) whitespace-nowrap transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
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
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors duration-150 hover:bg-hover disabled:opacity-40",
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
    <header className="flex h-11 items-center justify-between gap-3 border-b border-white/6 px-4">
      <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-fg">{children}</h2>
      {right}
    </header>
  );
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-white/6 text-muted",
  accent: "bg-accent-soft text-accent-strong",
  ok: "bg-ok/12 text-ok",
  warn: "bg-warn/12 text-warn",
  danger: "bg-danger/12 text-danger",
  info: "bg-info/12 text-info",
};

export function Badge({ tone = "neutral", children, title, mono }: { tone?: Tone; children: ReactNode; title?: string; mono?: boolean }) {
  return (
    <span title={title} className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] leading-none whitespace-nowrap", mono && "font-mono", tones[tone])}>
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
    <span title={title} className="shrink-0 font-mono text-[11px] whitespace-nowrap text-faint">
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
        "field border border-white/8 px-2.5 text-[13px] text-fg placeholder:text-faint",
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
      <p className="display text-[15px] font-medium text-fg">{title}</p>
      {children && <div className="max-w-md text-[13px] text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorNote({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div role="alert" className="selectable rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
      {title && <p className="font-medium">{title}</p>}
      <div className="break-words whitespace-pre-wrap opacity-90">{children}</div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[5px] border border-white/8 bg-white/5 px-1.5 py-px font-mono text-[11px] text-faint">{children}</kbd>;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="selectable rounded bg-raised px-1.5 py-0.5 font-mono text-xs text-fg">{children}</code>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex min-h-10 items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="display title-gradient truncate text-[24px] leading-[1.2] font-medium">{title}</h1>
        {subtitle && <p className="mt-1 truncate text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
