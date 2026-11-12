// MY Epitech: sign in on the real site in its own window, then sync your own data by hand.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, GraduationCap, LogIn, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { CodeView } from "../../components/DiffView";
import { Badge, Button, Card, CardTitle, EmptyState, ErrorNote, PageHeader, Spinner } from "../../components/ui";
import { api, asAppError, type MyEntry } from "../../lib/api";
import { formatBytes, timeAgo } from "../../lib/format";
import { useUi } from "../../lib/store";
import { MyProgress, MyProjects } from "./MyOverview";

const CONSENT_KEY = "tekboard.my.consent";

export function MyEpitechPage() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const status = useQuery({ queryKey: ["my-status"], queryFn: api.myStatus, refetchInterval: 2000, staleTime: 0 });
  const data = useQuery({ queryKey: ["my-data"], queryFn: api.myData, staleTime: 0 });
  const [consent, setConsent] = useState(() => {
    try {
      return window.localStorage.getItem(CONSENT_KEY) === "yes";
    } catch {
      return false;
    }
  });
  const [confirmForget, setConfirmForget] = useState(false);
  // Explanations are open until the agreement is given, then fold away.
  const [how, setHow] = useState<boolean | null>(null);
  const showHow = how ?? !consent;
  const [tab, setTab] = useState<"projects" | "progress" | "raw">("projects");
  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, detail: asAppError(e).message });
  const connect = useMutation({ mutationFn: api.myConnect, onSuccess: () => void qc.invalidateQueries({ queryKey: ["my-status"] }), onError: fail("The sign-in window did not open") });
  const sync = useMutation({
    mutationFn: api.mySync,
    onSuccess: (r) => {
      toast({ kind: r.unauthorized ? "error" : r.failed > 0 ? "info" : "ok", title: r.unauthorized ? "MY Epitech refused the session" : `Synced: ${r.ok} route(s) read${r.failed ? `, ${r.failed} not available` : ""}`, detail: r.unauthorized ? "Open the sign-in window and sign in again." : r.detail || undefined });
      void qc.invalidateQueries({ queryKey: ["my-data"] });
      void qc.invalidateQueries({ queryKey: ["my-overview"] });
      void qc.invalidateQueries({ queryKey: ["my-status"] });
      void qc.invalidateQueries({ queryKey: ["repos"] });
      void qc.invalidateQueries({ queryKey: ["my-academic"] });
    },
    onError: fail("Not synced"),
  });
  const forget = useMutation({
    mutationFn: (eraseCache: boolean) => api.myForget(eraseCache),
    onSuccess: () => {
      setConfirmForget(false);
      toast({ kind: "ok", title: "Session erased" });
      void qc.invalidateQueries({ queryKey: ["my-status"] });
      void qc.invalidateQueries({ queryKey: ["my-data"] });
    },
    onError: fail("Not erased"),
  });
  const accept = (v: boolean) => {
    setConsent(v);
    try {
      window.localStorage.setItem(CONSENT_KEY, v ? "yes" : "no");
    } catch {
      /* not remembered */
    }
  };
  const s = status.data;
  const entries = data.data?.entries ?? [];

  return (
    <>
      <PageHeader title="MY Epitech" subtitle="Your own account, read-only. You sign in on the real site; TekBoard never sees your password." />
      <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start gap-4">
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle right={s ? <Badge tone={s.connected ? "ok" : s.windowOpen ? "info" : "neutral"}>{s.connected ? "Connected" : s.windowOpen ? "Waiting for sign-in" : "Not connected"}</Badge> : <Spinner />}>Connection</CardTitle>
            <div className="flex flex-col gap-3 p-4 text-[13px]">
              <button type="button" aria-expanded={showHow} onClick={() => setHow(!showHow)} className="flex items-center gap-1 text-left text-xs text-muted hover:text-fg">
                {showHow ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} How the connection works and what is stored
              </button>
              {showHow && (
                <>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted">
                <li>A separate window opens <span className="font-mono">my.epitech.eu</span>. Microsoft sign-in and MFA happen there, as in a browser.</li>
                <li>That window keeps its browser session in a folder of its own on this computer, so you stay signed in. “Erase session” deletes it.</li>
                <li>TekBoard receives the site's access token from that window and keeps it in memory only. It is not written to its database or logs.</li>
                <li>Syncing happens only when you click: about {s?.routes ?? 15} read-only requests (plus two per ongoing project), half a second apart, on your own account.</li>
                <li>The answers are stored on this computer so you can read them offline. Check that this use fits your school's rules.</li>
              </ul>
                </>
              )}
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-(--color-accent)" checked={consent} onChange={(e) => accept(e.target.checked)} />
                I agree to keep a MY Epitech session in TekBoard on this computer
              </label>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={<LogIn className="size-3.5" />} disabled={!consent} busy={connect.isPending} onClick={() => connect.mutate()}>{s?.windowOpen ? "Show the sign-in window" : "Connect to MY Epitech"}</Button>
                <Button icon={<RefreshCw className="size-3.5" />} disabled={!s?.connected} busy={sync.isPending} onClick={() => sync.mutate()}>Sync now</Button>
                {(s?.sessionStored || s?.connected || entries.length > 0) && !confirmForget && <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmForget(true)}>Erase session…</Button>}
              </div>
              {confirmForget && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs">
                  <span className="mr-auto text-danger">Sign out here and delete the stored session?</span>
                  <Button size="sm" variant="danger" busy={forget.isPending} onClick={() => forget.mutate(false)}>Erase session</Button>
                  <Button size="sm" variant="danger" busy={forget.isPending} onClick={() => forget.mutate(true)}>Session and synced data</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmForget(false)}>Keep</Button>
                </div>
              )}
              {s?.connected && <p className="selectable text-xs text-muted">{s.account ? `Signed in as ${s.account}. ` : ""}{s.expiresAt ? `This token is valid until ${new Date(s.expiresAt * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}; keep the sign-in window open and the site renews it.` : ""}</p>}
              {s && (
                <p className="text-xs text-muted">
                  {s.syncMinutes > 0 ? `Automatic sync every ${s.syncMinutes >= 60 ? `${s.syncMinutes / 60} h` : `${s.syncMinutes} min`} while connected` : "Automatic sync is off"}
                  {s.lastSync ? ` · last sync ${timeAgo(s.lastSync)}` : ""}.{" "}
                  <button type="button" className="text-accent-strong hover:underline" onClick={() => useUi.getState().setPage("settings")}>
                    Change in Settings
                  </button>
                </p>
              )}
              {s && !s.connected && s.windowHidden && <p className="text-xs text-warn">The stored session was reopened in the background but the site has not handed over a session: sign-in is required. Click “Show the sign-in window”.</p>}
              {s && !s.connected && s.windowOpen && !s.windowHidden && <p className="text-xs text-muted">Sign in in the MY Epitech window. This turns to “Connected” a moment after the dashboard loads.</p>}
            </div>
          </Card>
          <Card>
            <CardTitle>Sync history</CardTitle>
            {(data.data?.history.length ?? 0) === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">No synchronisation yet.</p>
            ) : (
              <ul className="max-h-64 overflow-y-auto py-1">
                {data.data!.history.map((h) => (
                  <li key={h.at} className="selectable px-4 py-1.5 text-xs">
                    <span className="text-fg">{timeAgo(h.at)}</span> · <span className="text-ok">{h.ok} read</span>{h.failed > 0 && <span className="text-warn"> · {h.failed} not available</span>}
                    {h.detail && <p className="font-mono text-[11px] text-faint">{h.detail}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="min-w-0">
          <div className="flex h-11 items-center gap-1 border-b border-white/6 px-3">
            {([["projects", "Projects & deadlines"], ["progress", "Credits & validations"], ["raw", "Raw answers"]] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={`h-7 rounded-md px-3 text-[13px] transition-colors ${tab === id ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-fg"}`}>{label}</button>
            ))}
          </div>
          {tab === "projects" && <MyProjects />}
          {tab === "progress" && <MyProgress />}
          {tab === "raw" && (data.error ? (
            <div className="p-4"><ErrorNote>{asAppError(data.error).message}</ErrorNote></div>
          ) : entries.length === 0 ? (
            <EmptyState icon={<GraduationCap className="size-5" />} title="Nothing synced yet">Connect, then click “Sync now”. What MY Epitech answers is shown here as it is.</EmptyState>
          ) : (
            <ul className="py-1">{entries.map((e) => <EntryRow key={e.route} entry={e} />)}</ul>
          ))}
        </Card>
      </div>
    </>
  );
}

function summary(body: unknown): string {
  if (Array.isArray(body)) return `${body.length} item${body.length === 1 ? "" : "s"}`;
  if (body && typeof body === "object") {
    const keys = Object.keys(body as object);
    return `${keys.length} field${keys.length === 1 ? "" : "s"}: ${keys.slice(0, 6).join(", ")}${keys.length > 6 ? "…" : ""}`;
  }
  return String(body).slice(0, 80);
}

function EntryRow({ entry }: { entry: MyEntry }) {
  const [open, setOpen] = useState(false);
  const ok = entry.status >= 200 && entry.status < 300;
  const text = open ? JSON.stringify(entry.body, null, 2) : "";
  return (
    <li>
      <button type="button" onClick={() => setOpen(!open)} className="row-hover flex min-h-10 w-full items-center gap-2.5 px-4 py-1.5 text-left">
        {open ? <ChevronDown className="size-3.5 shrink-0 text-faint" /> : <ChevronRight className="size-3.5 shrink-0 text-faint" />}
        <span className="min-w-0 flex-1">
          <span className="block text-[13px]">{entry.label} <span className="font-mono text-[11px] text-faint">{entry.route}</span></span>
          <span className="block truncate text-xs text-muted">{ok ? summary(entry.body) : entry.status === 0 ? "no answer" : `not available (HTTP ${entry.status})`}</span>
        </span>
        <Badge tone={ok ? "ok" : "warn"} mono>{entry.status || "—"}</Badge>
        <span className="w-24 shrink-0 text-right text-xs text-faint">{formatBytes(entry.size)} · {timeAgo(entry.fetchedAt)}</span>
      </button>
      {open && <CodeView text={text.length > 60000 ? `${text.slice(0, 60000)}\n… (${formatBytes(text.length - 60000)} more)` : text} className="mx-4 mb-2 max-h-96 rounded-md" />}
    </li>
  );
}
