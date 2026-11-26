// Copies a text and says so in place: the icon turns into a check for a moment, nothing else
// moves. A failed copy says how to do it by hand.
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { useUi } from "../lib/store";
import { Button } from "./ui";

export function CopyButton({ text, label = t("Copier"), size = "sm", variant = "secondary" }: { text: string; label?: string; size?: "sm" | "md"; variant?: "secondary" | "ghost" }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(false), 1600);
    return () => window.clearTimeout(id);
  }, [done]);
  const copy = () =>
    void navigator.clipboard.writeText(text).then(
      () => setDone(true),
      () => useUi.getState().toast({ kind: "error", title: t("Copie impossible : sélectionne le texte et copie-le à la main.") }),
    );
  return (
    <Button size={size} variant={variant} icon={done ? <Check className="anim-pop size-3.5 text-ok" /> : <Copy className="size-3.5" />} onClick={copy} aria-live="polite">
      {done ? t("Copié") : label}
    </Button>
  );
}
