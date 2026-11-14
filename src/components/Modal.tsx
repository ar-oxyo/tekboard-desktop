import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn, IconButton } from "./ui";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}

/** Centered dialog. The only place, with the command palette, where glass is used. */
export function Modal({ open, onClose, title, description, children, footer, width = "w-[640px]" }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim anim-fade fixed inset-0 z-40" />
        <Dialog.Content
          className={cn(
            "glass anim-pop fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col",
            "border border-white/10 focus:outline-none",
            width,
          )}
        >
          <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
            <div className="min-w-0">
              <Dialog.Title className="display truncate text-lg font-medium">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-[13px] text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <IconButton label="Close">
                <X className="size-4" />
              </IconButton>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
          {footer && <footer className="flex items-center justify-end gap-2 border-t border-white/6 px-5 py-3">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
