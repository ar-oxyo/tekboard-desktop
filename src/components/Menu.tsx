// Action menu ("⋯", sort, status…): secondary actions live here instead of a row of buttons.
import * as DM from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Ellipsis } from "lucide-react";
import type { ReactNode } from "react";
import { cn, IconButton } from "./ui";
import { t } from "../lib/i18n";
import { useLite } from "./lite";

export function Menu({ trigger, children, align = "end", label }: { trigger?: ReactNode; children: ReactNode; align?: "start" | "end"; label?: string }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>
        {trigger ?? (
          <IconButton label={label ?? t("Autres actions")}>
            <Ellipsis className="size-4" />
          </IconButton>
        )}
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={5} collisionPadding={8} className="menu anim-pop z-[70] max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-48 overflow-y-auto p-1">
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

interface ItemProps {
  icon?: ReactNode;
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /// Right-aligned secondary text (a shortcut, a value).
  hint?: ReactNode;
  title?: string;
}

export function MenuItem({ icon, children, onSelect, disabled, danger, hint, title }: ItemProps) {
  return (
    <DM.Item disabled={disabled} onSelect={onSelect} title={title} className={cn("menu-item", danger && "text-danger")}>
      {icon && <span className="flex size-4 shrink-0 items-center justify-center text-faint">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 pl-3 text-xs text-faint">{hint}</span>}
    </DM.Item>
  );
}

/** One choice among several: the current one is ticked. */
export function MenuChoice({ checked, children, onSelect, hint, icon }: { checked: boolean; children: ReactNode; onSelect: () => void; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <DM.CheckboxItem checked={checked} onSelect={onSelect} className="menu-item pl-7">
      <DM.ItemIndicator className="absolute left-2">
        <Check className="size-3.5 text-accent" />
      </DM.ItemIndicator>
      {icon && <span className="flex size-4 shrink-0 items-center justify-center text-faint">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 pl-3 text-xs text-faint">{hint}</span>}
    </DM.CheckboxItem>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DM.Label className="menu-label">{children}</DM.Label>;
}

export function MenuSeparator() {
  return <DM.Separator className="mx-1 my-1 h-px bg-ink/8" />;
}

/**
 * Secondary items of a menu: listed in place in full mode, grouped under one "Plus" entry in
 * light mode, so the first level keeps only what is used every day.
 */
export function MenuMore({ children, label }: { children: ReactNode; label?: string }) {
  const lite = useLite();
  if (!lite) return <>{children}</>;
  return <SubMenu label={label ?? t("Plus")}>{children}</SubMenu>;
}

export function SubMenu({ icon, label, children }: { icon?: ReactNode; label: ReactNode; children: ReactNode }) {
  return (
    <DM.Sub>
      <DM.SubTrigger className="menu-item">
        {icon && <span className="flex size-4 shrink-0 items-center justify-center text-faint">{icon}</span>}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight className="size-3.5 text-faint" />
      </DM.SubTrigger>
      <DM.Portal>
        <DM.SubContent sideOffset={6} collisionPadding={8} className="menu anim-pop z-[71] min-w-44 p-1">
          {children}
        </DM.SubContent>
      </DM.Portal>
    </DM.Sub>
  );
}
