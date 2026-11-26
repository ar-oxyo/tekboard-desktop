// A day, always shown day first (26/11/2026). The native date input follows the system locale
// in WebKitGTK and may show MM/DD/YYYY: this field never does. Typing is forgiving (26/11,
// 26/11/26, 26.11.2026, 2026-11-26); the arrows move by a day. The value stays ISO (AAAA-MM-JJ).
import { useEffect, useState, type KeyboardEvent } from "react";
import { cn } from "./ui";
import { t } from "../lib/i18n";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function valid(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "26/11" → this year's 26 November; "26/11/26" → 2026; "2026-11-26" stays; null when it is not a day. */
export function parseDate(text: string, today = new Date()): string | null {
  const s = text.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(y, mo, d) ? iso(y, mo, d) : null;
  }
  m = /^(\d{1,2})[/.\- ](\d{1,2})(?:[/.\- ](\d{2}|\d{4}))?$/.exec(s);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3] === undefined ? today.getFullYear() : m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return valid(y, mo, d) ? iso(y, mo, d) : null;
}

/** "2026-11-26" → "26/11/2026". */
export function formatDate(isoDay: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : isoDay;
}

/** The ISO day `n` days after `isoDay`. */
export function addDays(isoDay: string, n: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

interface Props {
  /** ISO day (AAAA-MM-JJ), or "" when empty. */
  value: string;
  onChange: (isoDay: string) => void;
  /** Empty is allowed. */
  optional?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function DateField({ value, onChange, optional, disabled, className, ...rest }: Props) {
  const [text, setText] = useState(value ? formatDate(value) : "");
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(value ? formatDate(value) : "");
    setBad(false);
  }, [value]);
  const commit = () => {
    if (!text.trim() && optional) {
      setBad(false);
      if (value) onChange("");
      return;
    }
    const d = parseDate(text);
    if (d === null) {
      setBad(true);
      return;
    }
    setBad(false);
    setText(formatDate(d));
    if (d !== value) onChange(d);
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const now = new Date();
    const base = parseDate(text) ?? (value || iso(now.getFullYear(), now.getMonth() + 1, now.getDate()));
    const next = addDays(base, e.key === "ArrowUp" ? 1 : -1);
    setText(formatDate(next));
    onChange(next);
  };
  return (
    <span className={cn("field inline-flex h-9 items-center border border-ink/8 px-2.5 text-sm text-fg transition-colors duration-150 hover:border-line-strong focus-within:border-accent", bad && "border-danger", disabled && "opacity-50", className)}>
      <input
        inputMode="numeric"
        className="w-full min-w-0 bg-transparent font-mono tabular-nums outline-none placeholder:text-faint"
        placeholder={t("JJ/MM/AAAA")}
        value={text}
        disabled={disabled}
        aria-invalid={bad || undefined}
        aria-label={rest["aria-label"]}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={key}
        title={bad ? t("Date au format JJ/MM/AAAA, par exemple 26/11/2026") : undefined}
      />
    </span>
  );
}
