// Imported before Excalidraw: its fonts come from TekBoard itself (see vite.config.ts), never
// from a CDN — the window's security policy forbids that anyway.
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}
window.EXCALIDRAW_ASSET_PATH = `${window.location.origin}/excalidraw/`;

// Excalidraw redraws text once its fonts are loaded, on the `loadingdone` event of
// `document.fonts`. WebKitGTK does not always fire it, so text added by code (shapes, a
// collaborator's drawing) stayed in a fallback font: load the faces and announce them.
const FAMILIES = /^"?(Excalifont|Nunito|Lilita One|Comic Shanns|Cascadia|Liberation Sans|Virgil|Assistant|Helvetica)/;

export async function ensureFonts(): Promise<void> {
  const pending = [...document.fonts].filter((f) => f.status !== "loaded" && FAMILIES.test(f.family));
  if (!pending.length) return;
  const done = await Promise.allSettled(pending.map((f) => f.load()));
  const loaded = done.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!loaded.length) return;
  const ev = new Event("loadingdone") as Event & { fontfaces?: FontFace[] };
  ev.fontfaces = loaded;
  document.fonts.dispatchEvent(ev);
}
