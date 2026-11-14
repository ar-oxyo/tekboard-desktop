// Drop-down list used everywhere instead of the native <select>: same look in the five
// designs, full keyboard support (arrows, Home/End, typing a name, Enter, Escape), and a
// search box when the list is long.
import * as Popover from "@radix-ui/react-popover";
import * as RSelect from "@radix-ui/react-select";
import { Command } from "cmdk";
import { Check, ChevronDown, ChevronsUpDown, Search } from "lucide-react";
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
  /// Search box above the list. Default: on from 12 options.
  search?: boolean;
  /// Text shown when the search matches nothing.
  empty?: string;
}

// Radix refuses an empty string as an item value; "" is common here ("None", "Automatic").
const EMPTY = "\u0001empty";
const enc = (v: string) => (v === "" ? EMPTY : v);
const dec = (v: string) => (v === EMPTY ? "" : v);

function triggerClass(size: "sm" | "md", mono: boolean | undefined, className: string | undefined) {
  const has = (prefix: string) => (className ?? "").split(/\s+/).some((c) => c.startsWith(prefix));
  return cn(
    "select-trigger group inline-flex min-w-0 items-center justify-between gap-2 border border-white/8 text-left text-fg",
    "transition-colors duration-100 hover:border-line-strong focus-visible:border-accent focus-visible:outline-none data-[state=open]:border-accent",
    "disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-2.5 text-[13px]",
    mono && "font-mono",
    !has("w-") && "w-full",
    className,
  );
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

export function Select<T extends string = string>(props: SelectProps<T>) {
  const searchable = props.search ?? props.options.length >= 12;
  return searchable ? <SearchSelect {...props} /> : <PlainSelect {...props} />;
}

function PlainSelect<T extends string>({ value, onChange, options, placeholder, label, className, size = "md", mono, disabled }: SelectProps<T>) {
  return (
    <RSelect.Root value={value === null ? undefined : enc(value)} onValueChange={(v) => onChange(dec(v) as T)} disabled={disabled}>
      <RSelect.Trigger aria-label={label} className={triggerClass(size, mono, className)}>
        <span className="min-w-0 flex-1 truncate">
          <RSelect.Value placeholder={<span className="text-faint">{placeholder ?? "Choose"}</span>} />
        </span>
        <RSelect.Icon>
          <ChevronDown className="size-3.5 shrink-0 text-faint transition-transform group-data-[state=open]:rotate-180" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content position="popper" sideOffset={5} className="menu anim-pop z-[70] max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden">
          <RSelect.Viewport className="p-1">
            {groups(options).map(([group, items], i) => (
              <RSelect.Group key={group ?? `g${i}`}>
                {group && <RSelect.Label className="menu-label">{group}</RSelect.Label>}
                {items.map((o) => (
                  <RSelect.Item key={o.value} value={enc(o.value)} disabled={o.disabled} className={cn("menu-item pr-7", size === "sm" && "text-xs", mono && "font-mono")}>
                    {o.icon}
                    <RSelect.ItemText>{o.label}</RSelect.ItemText>
                    {o.hint && <span className="ml-auto pl-3 font-sans text-xs text-faint">{o.hint}</span>}
                    <RSelect.ItemIndicator className="absolute right-2">
                      <Check className="size-3.5 text-accent" />
                    </RSelect.ItemIndicator>
                  </RSelect.Item>
                ))}
              </RSelect.Group>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

function SearchSelect<T extends string>({ value, onChange, options, placeholder, label, className, size = "md", mono, disabled, empty }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <button type="button" role="combobox" aria-expanded={open} aria-label={label} className={triggerClass(size, mono, className)}>
          <span className={cn("min-w-0 flex-1 truncate", !current && "text-faint")}>{current?.label ?? placeholder ?? "Choose"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-faint" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={5} className="menu anim-pop z-[70] w-[max(var(--radix-popover-trigger-width),16rem)] overflow-hidden p-0">
          <Command loop>
            <div className="flex items-center gap-2 border-b border-white/8 px-2.5">
              <Search className="size-3.5 shrink-0 text-faint" />
              <Command.Input autoFocus placeholder="Search" className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-fg placeholder:text-faint focus:outline-none" />
            </div>
            <Command.List className="max-h-72 overflow-y-auto p-1">
              <Command.Empty className="px-2.5 py-3 text-xs text-muted">{empty ?? "Nothing matches."}</Command.Empty>
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
