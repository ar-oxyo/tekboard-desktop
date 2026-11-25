import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** The whiteboard's fonts, served by TekBoard itself under /excalidraw/fonts (nothing is fetched
 *  from a CDN). Xiaolai (Chinese characters, 13 MB) is left out: such text falls back on a
 *  system font. */
function excalidrawFonts(): Plugin {
  const root = join("node_modules", "@excalidraw", "excalidraw", "dist", "prod", "fonts");
  const files = (): Array<[string, string]> => {
    if (!existsSync(root)) return [];
    const out: Array<[string, string]> = [];
    for (const family of readdirSync(root)) {
      if (family === "Xiaolai" || !statSync(join(root, family)).isDirectory()) continue;
      for (const f of readdirSync(join(root, family))) if (f.endsWith(".woff2")) out.push([`excalidraw/fonts/${family}/${f}`, join(root, family, f)]);
    }
    return out;
  };
  return {
    name: "tekboard-excalidraw-fonts",
    configureServer(server) {
      const map = new Map(files().map(([url, path]) => [`/${url}`, path]));
      server.middlewares.use((req, res, next) => {
        const path = req.url ? map.get(req.url.split("?")[0]) : undefined;
        if (!path) return next();
        res.setHeader("Content-Type", "font/woff2");
        res.end(readFileSync(path));
      });
    },
    generateBundle() {
      for (const [fileName, path] of files()) this.emitFile({ type: "asset", fileName, source: readFileSync(path) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), excalidrawFonts()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "es2022", chunkSizeWarningLimit: 800 },
  test: { environment: "node", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
});
