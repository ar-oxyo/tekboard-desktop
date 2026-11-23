// Drop-down list used everywhere instead of the native <select>: one look and one behaviour
// whatever the number of options (arrows, Enter, Escape; a search box when the list is long).
//
// It never fails silently:
// - a value that is not among the options is shown as such ("introuvable") instead of a blank;
// - an empty list says why and can offer what to do (`emptyState`);
// - a disabled list says why (`disabledReason`), in its tooltip and under it when asked.
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, Search, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "./ui";

export interface Option<T extends string = string> {
  value: T;
  label: string;
  /// Secondary text shown at the right of the row.
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /// Rows sharing a group are listed under that heading.
  group?: string;
}

interface SelectProps<T extends string> {
  value: T | null;
  onChange: (value: T) => void;
  options: Array<Option<T>>;
  placeholder?: string;
  /// Accessible name when no visible label is attached.
  label?: string;
  className?: string;
  size?: "sm" | "md";
  mono?: boolean;
  disabled?: boolean;
  /// Why it is disabled, in words. Shown as a tooltip, and under the list with `showReason`.
  disabledReason?: string | null;
  showReason?: boolean;
  /// Search box above the list. Default: on from 8 options.
  search?: boolean;
  /// Text shown when the search matches nothing.
  empty?: string;
  /// What to show when there is no option at all, with an optional way out.
  emptyState?: { text: string; action?: { label: string; onClick: () => void } };
}

/** What the closed list shows. Exported for the tests. */
export function display<T extends string>(value: T | null, options: Array<Option<T>>, placeholder: string | undefined, emptyText: string | undefined): { text: string; tone: "value" | "placeholder" | "missing" } {
  if (value !== null) {
    const o = options.find((x) => x.value === value);
    if (o) return { text: o.label, tone: "value" };
    if (value !== "") return { text: `${value.split("/").filter(Boolean).pop() ?? value} (introuvable)`, tone: "missing" };
  }
  if (options.length === 0 && emptyText) return { text: emptyText, tone: "placeholder" };
  return { text: placeholder ?? "Choisir", tone: "placeholder" };
}

function groups<T extends string>(options: Array<Option<T>>): Array<[string | undefined, Array<Option<T>>]> {
  const out: Array<[string | undefined, Array<Option<T>>]> = [];
  for (const o of options) {
    const last = out[out.length - 1];
    if (last && last[0] === o.group) last[1].push(o);
    else out.push([o.group, [o]]);
  }
  return out;
}

export function Select<T extends string = string>({ value, onChange, options, placeholder, label, className, size = "md", mono, disabled, disabledReason, showReason, search, empty, emptyState }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const shown = display(value, options, placeholder, emptyState?.text);
  const searchable = search ?? options.length >= 8;
  const has = (prefix: string) => (className ?? "").split(/\s+/).some((c) => c.startsWith(prefix));
  const reason = disabled ? (disabledReason ?? null) : null;
  const trigger = (
    <Popover.Root open={open} onOpenChange={(o) => !disabled && setOpen(o)} modal>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          title={reason ?? (shown.tone === "missing" ? "Cette valeur n'est plus dans la liste : choisis-en une autre." : undefined)}
          className={cn(
            "select-trigger group inline-flex min-w-0 items-center justify-between gap-2 border border-white/8 text-left text-fg",
            "transition-colors duration-100 hover:border-line-strong focus-visible:border-accent focus-visible:outline-none data-[state=open]:border-accent",
            "disabled:cursor-not-allowed disabled:opacity-50",
            size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-2.5 text-[13px]",
            mono && "font-mono",
            !has("w-") && "w-full",
            shown.tone === "missing" && "border-warn/50",
            className,
          )}
        >
          {shown.tone === "missing" && <TriangleAlert className="size-3.5 shrink-0 text-warn" />}
          <span className={cn("min-w-0 flex-1 truncate", shown.tone === "placeholder" && "text-faint", shown.tone === "missing" && "text-warn")}>{shown.text}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-faint" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={5} className="menu anim-pop z-[70] w-[max(var(--radix-popover-trigger-width),14rem)] overflow-hidden p-0">
          {options.length === 0 ? (
            <div className="flex flex-col items-start gap-2 px-3 py-3 text-xs text-muted">
              <span>{emptyState?.text ?? "Aucun choix possible pour l'instant."}</span>
              {emptyState?.action && (
                <button
                  type="button"
                  className="text-accent-strong hover:underline"
                  onClick={() => {
                    setOpen(false);
                    emptyState.action!.onClick();
                  }}
                >
                  {emptyState.action.label}
                </button>
              )}
            </div>
          ) : (
            <Command loop>
              {searchable && (
                <div className="flex items-center gap-2 border-b border-white/8 px-2.5">
                  <Search className="size-3.5 shrink-0 text-faint" />
                  <Command.Input autoFocus placeholder="Rechercher" className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-fg placeholder:text-faint focus:outline-none" />
                </div>
              )}
              <Command.List className="max-h-72 overflow-y-auto p-1">
                <Command.Empty className="px-2.5 py-3 text-xs text-muted">{empty ?? "Rien ne correspond."}</Command.Empty>
                {groups(options).map(([group, items], i) => (
                  <Command.Group key={group ?? `g${i}`} heading={group}>
                    {items.map((o) => (
                      <Command.Item
                        key={o.value}
                        value={`${o.label} ${o.hint ?? ""} ${o.value}`}
                        disabled={o.disabled}
                        onSelect={() => {
                          onChange(o.value);
                          setOpen(false);
                        }}
                        className={cn("menu-item pr-7", size === "sm" && "text-xs", mono && "font-mono")}
                      >
                        {o.icon}
                        <span className="min-w-0 truncate">{o.label}</span>
                        {o.hint && <span className="ml-auto shrink-0 pl-3 font-sans text-xs text-faint">{o.hint}</span>}
                        {o.value === value && <Check className="absolute right-2 size-3.5 text-accent" />}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
  if (!(reason && showReason)) return trigger;
  return (
    <span className={cn("flex min-w-0 flex-col gap-1", !has("w-") && "w-full")}>
      {trigger}
      <span className="text-[11px] text-faint">{reason}</span>
    </span>
  );
}
