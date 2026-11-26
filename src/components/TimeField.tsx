// A time of day, always in 24-hour form (09:00, 23:30). The native time input follows the
// system locale in WebKitGTK and may show AM/PM: this field never does. Typing is forgiving
// (9, 9h, 930, 21h15, 21:15); the arrows move by a quarter of an hour.
import { useEffect, useState, type KeyboardEvent } from "react";
import { cn } from "./ui";
import { t } from "../lib/i18n";

/** "9" → 540, "9h30" → 570, "0930" → 570, "21:15" → 1275; null when it is not a time. */
export function parseTime(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  const m = /^(\d{1,2})(?:[:h.]?(\d{2})?)?h?$/.exec(s) ?? /^(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export const formatTime = (minutes: number) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

interface Props {
  /** Minutes from midnight (0–1439), or null when empty (with `optional`). */
  value: number | null;
  onChange: (minutes: number | null) => void;
  /** Minutes moved by the arrow keys. */
  step?: number;
  /** Empty is allowed (an optional time). */
  optional?: boolean;
  /** Shown after the time, e.g. "+1 j" for an end on the next day. */
  suffix?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  title?: string;
}

export function TimeField({ value, onChange, step = 15, optional, suffix, disabled, className, title, ...rest }: Props) {
  const [text, setText] = useState(value === null ? "" : formatTime(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(value === null ? "" : formatTime(value));
    setBad(false);
  }, [value]);
  const commit = () => {
    if (!text.trim() && optional) {
      setBad(false);
      if (value !== null) onChange(null);
      return;
    }
    const m = parseTime(text);
    if (m === null) {
      setBad(true);
      return;
    }
    setBad(false);
    setText(formatTime(m));
    if (m !== value) onChange(m);
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const base = parseTime(text) ?? value ?? 9 * 60;
    const next = (((base + (e.key === "ArrowUp" ? step : -step)) % 1440) + 1440) % 1440;
    setText(formatTime(next));
    onChange(next);
  };
  return (
    <span className={cn("field inline-flex h-9 items-center gap-1 border border-ink/8 px-2.5 text-sm text-fg transition-colors duration-150 hover:border-line-strong focus-within:border-accent", bad && "border-danger", disabled && "opacity-50", className)} title={title}>
      <input
        inputMode="numeric"
        className="w-full min-w-0 bg-transparent font-mono tabular-nums outline-none placeholder:text-faint"
        placeholder="HH:MM"
        value={text}
        disabled={disabled}
        aria-invalid={bad || undefined}
        aria-label={rest["aria-label"]}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={key}
        title={bad ? t("Heure au format 24 h : 09:00, 14:30, 23:00") : undefined}
      />
      {suffix && <span className="shrink-0 text-2xs text-accent">{suffix}</span>}
    </span>
  );
}
