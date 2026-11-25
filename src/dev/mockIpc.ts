// Development only: lets the UI run in a plain browser (Vite dev server, no Tauri) with
// realistic data, so screens can be looked at and captured without the Rust backend.
// Loaded by main.tsx only when `import.meta.env.DEV` and outside the Tauri webview; never
// part of a production bundle.
//
// URL parameters: `?page=projects&theme=aurora&mode=light&sheet=<path>&empty=1&fail=cmd1,cmd2`
//   empty  every list comes back empty (empty states)
//   fail   these commands reject (error states)
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import apiSource from "../lib/api.ts?raw";
import { fixtures } from "./fixtures";

type Kind = "array" | "void" | "nullable" | "boolean" | "number" | "string" | "record" | "object";

/** Return kind of every command, read from the `invoke<T>("cmd")` calls of api.ts. */
function returnKinds(): Map<string, Kind> {
  const kinds = new Map<string, Kind>();
  for (const m of apiSource.matchAll(/invoke<(.+?)>\("([a-z0-9_:|]+)"/g)) {
    const type = m[1].trim();
    const kind: Kind = /\[\]$|^Array</.test(type)
      ? "array"
      : /^(void|null|unknown)$/.test(type)
        ? "void"
        : /\| null$/.test(type)
          ? "nullable"
          : /^(boolean|number|string)$/.test(type)
            ? (type as Kind)
            : /^Record</.test(type)
              ? "record"
              : "object";
    kinds.set(m[2], kind);
  }
  return kinds;
}

const FALLBACK: Record<Exclude<Kind, "object">, unknown> = { array: [], void: null, nullable: null, boolean: false, number: 0, string: "", record: {} };

export function installMock() {
  const params = new URLSearchParams(window.location.search);
  const empty = params.has("empty");
  const fail = new Set((params.get("fail") ?? "").split(",").filter(Boolean));
  const kinds = returnKinds();
  const mode = params.get("mode");
  if (mode) localStorage.setItem("tekboard.colorMode", mode);
  const prefs: Record<string, unknown> = mode ? { colorMode: mode } : {};

  mockWindows(params.get("window") === "capture" ? "capture" : "main");
  mockIPC(
    async (cmd, args) => {
      // A short, realistic delay so loading states exist for a frame or two.
      await new Promise((r) => setTimeout(r, 40));
      if (cmd === "ui_prefs_get") return prefs;
      if (cmd === "ui_prefs_set") return Object.assign(prefs, (args as { prefs?: object })?.prefs ?? {}), null;
      if (fail.has(cmd)) throw { code: "mock_failure", message: `Échec simulé de ${cmd}` };
      const kind = kinds.get(cmd);
      if (empty && kind === "array") return [];
      const f = fixtures[cmd];
      if (f !== undefined) return typeof f === "function" ? f((args ?? {}) as Record<string, unknown>, params) : f;
      if (cmd.startsWith("plugin:")) return null;
      if (kind && kind !== "object") return FALLBACK[kind];
      // An object nobody wrote a fixture for: say so, like a real backend error would.
      throw { code: "mock_missing", message: `Pas de donnée de démonstration pour ${cmd}` };
    },
    { shouldMockEvents: true },
  );
}
