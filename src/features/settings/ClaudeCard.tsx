// Claude Code: where it was found, its version and state, a manual path, and a real test.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronRight, FolderSearch, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, CardTitle, ErrorNote, Input, Spinner } from "../../components/ui";
import { api, asAppError, type ClaudeReport } from "../../lib/api";
import { tildify } from "../../lib/format";
import { useHome } from "../../lib/hooks";
import { useUi } from "../../lib/store";

const STATE: Record<ClaudeReport["state"], { label: string; tone: "ok" | "danger" | "warn" }> = {
  ready: { label: "Ready", tone: "ok" },
  not_found: { label: "Not found", tone: "danger" },
  not_executable: { label: "Wrong path", tone: "danger" },
  version_failed: { label: "Does not answer", tone: "warn" },
};

const SOURCE: Record<NonNullable<ClaudeReport["source"]>, string> = {
  settings: "the path you set below",
  path: "this application's PATH",
  user: "a per-user install folder (not in the PATH a desktop application receives)",
  shell: "your login shell's PATH (not in the PATH a desktop application receives)",
};

export function ClaudeCard({ configured, onPick, saving }: { configured: string | null; onPick: (path: string | null) => void; saving: boolean }) {
  const qc = useQueryClient();
  const home = useHome();
  const info = useQuery({ queryKey: ["claude-info"], queryFn: api.claudeInfo, staleTime: 0 });
  const check = useMutation({ mutationFn: api.claudeCheck });
  const [typed, setTyped] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  const d = info.data;
  const auto = useUi((s) => s.claudeAutoCheck);
  useEffect(() => {
    if (auto && d?.state === "ready") {
      useUi.setState({ claudeAutoCheck: false });
      check.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, d?.state]);
  const value = typed ?? configured ?? "";
  const recheck = () => {
    check.reset();
    void qc.invalidateQueries({ queryKey: ["claude-info"] });
    void qc.invalidateQueries({ queryKey: ["testing-info"] });
  };
  async function browse() {
    const file = await open({ multiple: false, directory: false, title: "Select the Claude Code executable (claude)" });
    if (typeof file === "string") {
      setTyped(null);
      onPick(file);
    }
  }
  const missing = d ? d.shellPath.filter((p) => !d.appPath.includes(p)) : [];
  return (
    <Card>
      <CardTitle
        right={
          <span className="flex items-center gap-2">
            {d && <Badge tone={STATE[d.state].tone}>{STATE[d.state].label}</Badge>}
            <Button size="sm" variant="ghost" busy={info.isFetching} onClick={recheck}>
              Recheck
            </Button>
          </span>
        }
      >
        Claude Code
      </CardTitle>
      {!d ? (
        <p className="flex items-center gap-2 px-4 py-5 text-[13px] text-muted">
          <Spinner /> Looking for Claude Code…
        </p>
      ) : (
        <div className="flex flex-col gap-3 px-4 py-3.5 text-[13px]">
          <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            <dt className="text-xs text-faint">Executable</dt>
            <dd className="selectable min-w-0 font-mono text-xs break-all">
              {d.path ? tildify(d.path, home) : <span className="font-sans text-muted">none</span>}
              {d.target && <span className="block text-faint">→ {tildify(d.target, home)}</span>}
            </dd>
            <dt className="text-xs text-faint">Version</dt>
            <dd className="selectable text-xs">{d.version ?? <span className="text-muted">—</span>}</dd>
            <dt className="text-xs text-faint">Found in</dt>
            <dd className="text-xs text-muted">{d.source ? SOURCE[d.source] : "—"}</dd>
          </dl>
          {d.detail && <ErrorNote>{d.detail}</ErrorNote>}
          <div>
            <span className="mb-1 block text-xs font-medium text-muted">Executable to use</span>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                onPick(value.trim() || null);
                setTyped(null);
              }}
            >
              <Input className="font-mono text-xs" placeholder="Found automatically — or pick the claude program" value={value} onChange={(e) => setTyped(e.target.value)} />
              {typed !== null && typed !== (configured ?? "") && (
                <Button busy={saving} onClick={() => { onPick(value.trim() || null); setTyped(null); }}>
                  Use
                </Button>
              )}
              <Button icon={<FolderSearch className="size-3.5" />} onClick={() => void browse()}>
                Browse…
              </Button>
              {configured && (
                <Button variant="ghost" icon={<X className="size-3.5" />} title="Back to automatic detection" onClick={() => { setTyped(null); onPick(null); }}>
                  Auto
                </Button>
              )}
            </form>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={<Play className="size-3.5" />} busy={check.isPending} disabled={d.state !== "ready"} onClick={() => check.mutate()} title="Sends one short question to Claude Code, headless, in an empty folder. Counts toward your Claude usage.">
              Run a test prompt
            </Button>
            {check.isPending && <span className="text-xs text-muted">Asking Claude Code… this takes a few seconds.</span>}
            {check.data && (
              <span className={`selectable min-w-0 text-xs ${check.data.ok ? "text-ok" : "text-danger"}`}>
                {check.data.ok ? `Answered “${check.data.answer}” in ${(check.data.durationMs / 1000).toFixed(1)} s${check.data.costUsd !== null ? ` · $${check.data.costUsd.toFixed(3)}` : ""}` : check.data.error}
              </span>
            )}
            {check.error && <span className="selectable text-xs text-danger">{asAppError(check.error).message}</span>}
          </div>
          <div>
            <button type="button" aria-expanded={why} onClick={() => setWhy(!why)} className="flex items-center gap-1 text-xs text-muted hover:text-fg">
              {why ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              Why a program can work in your terminal and not here
            </button>
            {why && (
              <div className="mt-1.5 rounded-lg border border-line bg-bg px-3 py-2 text-xs text-muted">
                <p>
                  An application started from the desktop gets the session's PATH, not the one your shell ({d.shell ?? "unknown"}) builds in its startup files. TekBoard therefore also looks in the usual per-user folders and asks your login shell for its PATH.
                </p>
                {missing.length > 0 ? (
                  <>
                    <p className="mt-1.5 text-fg">In your shell's PATH but not in this application's:</p>
                    <ul className="selectable mt-0.5 font-mono text-[11px]">{missing.map((p) => <li key={p}>{tildify(p, home)}</li>)}</ul>
                  </>
                ) : (
                  <p className="mt-1.5">{d.shellPath.length === 0 ? "Your login shell did not answer in time; only the PATH and the per-user folders were searched." : "Here both are the same: this application was probably started from a terminal."}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
