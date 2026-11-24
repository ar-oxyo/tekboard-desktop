// The launch screen of index.html. It goes away as soon as the app has its settings (or knows
// it cannot read them): never later, and never held on purpose.
let done = false;

export function hideSplash(): void {
  if (done || typeof document === "undefined") return;
  done = true;
  const el = document.getElementById("splash");
  if (!el) return;
  el.classList.add("gone");
  window.setTimeout(() => el.remove(), 200);
}
