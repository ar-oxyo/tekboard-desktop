// Writes one icon per design into src-tauri/icons/themes/ (SVG source and 128 px PNG), for the
// window and the tray: the same drawing as public/tekboard.svg (a T inside a progress ring on a
// dark rounded square), only the ink and the background tint follow the design.
//
// Run once after changing a design's accent: `PLAYWRIGHT=/path/to/node_modules/playwright node scripts/theme-icons.mjs`
// (any Playwright install with WebKit or Chromium; it is not a dependency of TekBoard).
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons", "themes");
// [id, background from, background to, ink light, ink deep]
const DESIGNS = [
  ["aurora", "#22201d", "#121110", "#9fd2f5", "#4aa3e3"],
  ["sauge", "#1c211d", "#0f1310", "#a9e3c1", "#5fbf8a"],
  ["ardoise", "#1b2126", "#0e1215", "#8fe3ef", "#22b8cf"],
  ["prune", "#241b21", "#130e11", "#f0bcd8", "#d77fb0"],
  ["sumi", "#1f1d1b", "#0f0e0d", "#f5a597", "#e8553f"],
  // Legacy designs keep the original violet ink.
  ["legacy", "#25222f", "#121117", "#c3b9ff", "#7c68f2"],
];

export function svg([, bg1, bg2, ink1, ink2]) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
    <linearGradient id="ink" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ink1}"/><stop offset="1" stop-color="${ink2}"/></linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
  <rect x="21" y="21" width="470" height="470" rx="107" fill="none" stroke="#fff" stroke-opacity=".09" stroke-width="10"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="${ink2}" stroke-opacity=".16" stroke-width="34"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="url(#ink)" stroke-width="34" stroke-linecap="round" stroke-dasharray="700 243" transform="rotate(-90 256 256)"/>
  <path d="M194 202H318M256 202V318" fill="none" stroke="url(#ink)" stroke-width="50" stroke-linecap="round"/>
</svg>
`;
}

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT ?? "playwright");
const engine = pw.webkit ?? pw.chromium;
const browser = await engine.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 128, height: 128 }, deviceScaleFactor: 1 });
mkdirSync(out, { recursive: true });
for (const d of DESIGNS) {
  const source = svg(d);
  writeFileSync(join(out, `${d[0]}.svg`), source);
  await page.setContent(`<html><body style="margin:0;background:transparent">${source.replace('width="512" height="512"', 'width="128" height="128"')}</body></html>`);
  await page.screenshot({ path: join(out, `${d[0]}.png`), omitBackground: true, clip: { x: 0, y: 0, width: 128, height: 128 } });
  console.log(`${d[0]}.png`);
}
await browser.close();
