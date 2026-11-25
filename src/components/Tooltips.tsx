// One tooltip for the whole app, drawn in the current design. Any element with a `title`
// gets it: on hover (after a short pause, at once when another tooltip was just shown) or on
// keyboard focus. The title moves to `data-tip` so the system tooltip does not show twice;
// an element named only by its title keeps that name as its aria-label.
import { useEffect, useRef, useState } from "react";

const DELAY = 450;
const WARM = 400;

interface Tip {
  text: string;
  x: number;
  y: number;
  below: boolean;
}

function adopt(el: HTMLElement): string | null {
  const title = el.getAttribute("title");
  if (title) {
    el.dataset.tip = title;
    el.removeAttribute("title");
    if (!el.getAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", title);
  }
  return el.dataset.tip || null;
}

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastHide = useRef(0);
  const target = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const place = (el: HTMLElement, text: string) => {
      const r = el.getBoundingClientRect();
      const below = r.top < 40;
      setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below });
    };
    const hide = () => {
      window.clearTimeout(timer.current);
      target.current = null;
      setTip((t) => {
        if (t) lastHide.current = Date.now();
        return null;
      });
    };
    const show = (el: HTMLElement, now: boolean) => {
      const text = adopt(el);
      if (!text) return;
      target.current = el;
      window.clearTimeout(timer.current);
      const warm = Date.now() - lastHide.current < WARM;
      if (now || warm) place(el, text);
      else timer.current = window.setTimeout(() => target.current === el && el.isConnected && place(el, text), DELAY);
    };
    const over = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[title], [data-tip]");
      if (el === target.current) return;
      hide();
      if (el) show(el, false);
    };
    const focus = (e: FocusEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[title], [data-tip]");
      if (el && el.matches(":focus-visible")) show(el, true);
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="tooltip pointer-events-none fixed z-[100] max-w-72 px-2 py-1 text-xs"
      style={{ left: Math.min(Math.max(tip.x, 150), window.innerWidth - 150), top: tip.y, transform: `translate(-50%, ${tip.below ? "0" : "-100%"})` }}
    >
      {tip.text}
    </div>
  );
}
