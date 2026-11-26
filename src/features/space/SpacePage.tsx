// TekSpace: a small pixel-art campus where TekBoard contacts meet to work together. One of
// you hosts a space (it runs in their TekBoard), the others join. Walk with ZQSD / WASD /
// the arrows or a click, sit at a table, share goals, a focus timer, an ambience and the
// table's resources. Nothing records what you do elsewhere; microphone and camera are never used.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DoorOpen, ExternalLink, Music, PenTool, Pin, Play, Send, Share2, Square, Star, Target, Timer, Trash2, UserPlus, Users, Volume2, VolumeX } from "lucide-react";
import { check, refusal } from "../../lib/moderation";
import { api, asAppError, type ConnectConfig, type ConnectState, type LiveSession } from "../../lib/api";
import { useUi } from "../../lib/store";
import { usePref } from "../../lib/hooks";
import { useConnect } from "../connect/ConnectPage";
import { CHOOSABLE, CONNECT_KEY, STATUS } from "../../lib/connect";
import { recipients } from "../../lib/share";
import { LIVE_KEY } from "../connect/LivePage";
import { Menu, MenuItem, MenuLabel } from "../../components/Menu";
import { Select } from "../../components/Select";
import { Badge, Button, Card, CardTitle, cn, EmptyState, ErrorNote, IconButton, Input, PageHeader } from "../../components/ui";
import { decodeLook, type Look } from "./avatar";
import { AvatarPicker } from "./avatars";
import { SpotifyLink } from "./spotify";
import { drawAvatar } from "./sprites";
import { roomName, seatById, TABLES, type TableDef } from "./map";
import { REACTIONS, SOUNDS, validJam, type Sound, type SpaceState, type TableState } from "./protocol";
import { liveSpaces, useSpaceLobby } from "./lobby";
import { join, leave, moveLocal, send, setAudience, startHosting, useSpace } from "./client";
import { SpaceEngine } from "./engine";
import * as audio from "./audio";
import { joinBoard, useBoardBus } from "../whiteboard/bus";
import { t } from "../../lib/i18n";

const SOUND_LABEL: Record<Sound, string> = { rain: t("Pluie"), cafe: t("Café"), fire: t("Cheminée"), forest: t("Forêt"), library: t("Bibliothèque"), brown: t("Bruit brun") };

export default function SpacePage() {
  const qc = useQueryClient();
  const connect = useConnect();
  const mode = useSpace((s) => s.mode);
  const st = connect.data;
  // Announces of a hosted space go to the paired contacts online at that moment.
  useEffect(() => setAudience(() => recipients(qc.getQueryData<ConnectState>(CONNECT_KEY)?.peers ?? []).map((p) => p.fp)), [qc]);
  if (!st) return null;
  const configure = async (patch: Partial<ConnectConfig>) => {
    const next: ConnectConfig = { enabled: st.enabled, profile: st.profile, port: st.port ?? 0, interface: st.interface, space: st.space, ...patch };
    qc.setQueryData(CONNECT_KEY, await api.connectConfigure(next));
  };
  if (!st.enabled || !st.running) {
    return (
      <EmptyState icon={<Users className="size-6" />} title="TekSpace" action={<Button variant="primary" onClick={() => useUi.getState().setPage("connect")}>{t("Ouvrir Connect")}</Button>}>
        {t("TekSpace passe par TekBoard Connect : active-le d'abord et appaire-toi avec tes amis.")}
      </EmptyState>
    );
  }
  if (!st.space && mode === "idle") {
    return (
      <Card hero className="mx-auto max-w-xl space-y-3 p-6">
        <h2 className="display text-xl text-fg">TekSpace</h2>
        <p className="text-sm text-muted">{t("Un petit campus en pixel art pour travailler avec tes amis : tables de travail, café, bibliothèque, salle de concentration avec minuteur partagé et ambiances sonores. C'est facultatif et ne consomme rien tant que tu ne l'ouvres pas.")}</p>
        <Button variant="primary" onClick={() => void configure({ space: true })}>
          {t("Activer TekSpace")}
        </Button>
      </Card>
    );
  }
  const me = { fp: st.fp, nick: st.profile.nick, avatar: st.profile.avatar, status: st.profile.status };
  if (mode === "hosting" || mode === "joined") return <InSpace meFp={st.fp} connect={st} />;
  return <Lobby me={me} connect={st} onAvatar={(avatar) => void configure({ profile: { ...st.profile, avatar } })} onDisable={() => { leave(); audio.shutdown(); void configure({ space: false }); }} />;
}

// ───────────────────────────── lobby ─────────────────────────────

function Lobby({ me, connect, onAvatar, onDisable }: { me: { fp: string; nick: string; avatar: string; status: string }; connect: ConnectState; onAvatar: (a: string) => void; onDisable: () => void }) {
  const { mode, error } = useSpace();
  const spaces = useSpaceLobby((s) => s.spaces);
  const [now, setNow] = useState(Date.now());
  const [name, setName] = useState("");
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);
  const online = new Set(recipients(connect.peers).map((p) => p.fp));
  const list = liveSpaces(spaces, now).filter((s) => online.has(s.host));
  return (
    <>
    <PageHeader title="TekSpace" subtitle={t("Un campus en pixel art pour travailler ensemble")} />
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-4">
      <div className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <Card>
          <CardTitle>
            <Users className="size-4 text-faint" /> {t("Espaces ouverts par tes contacts")}
          </CardTitle>
          {list.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">{t("Aucun pour l'instant. Ouvre le tien : tes contacts connectés le verront apparaître.")}</p>
          ) : (
            <ul className="divide-y divide-ink/5">
              {list.map((s) => (
                <li key={s.space} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-fg">{s.name}</p>
                    <p className="text-xs text-faint">{t("ouvert par {h} · {n} personne(s)", { h: s.hostNick, n: s.count })}</p>
                  </div>
                  {s.v !== 1 ? <Badge tone="warn">{t("autre version")}</Badge> : null}
                  <Button size="sm" variant="primary" busy={mode === "joining"} disabled={s.v !== 1} disabledReason={t("Version de TekSpace différente : mettez-vous à jour")} onClick={() => join(me, s.space, s.host)}>
                    {t("Entrer")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="space-y-3 p-4">
          <h3 className="text-sm text-fg">{t("Ouvrir mon espace")}</h3>
          <p className="text-xs text-muted">{t("L'espace tourne dans ton TekBoard : tant qu'il reste ouvert, tes contacts peuvent te rejoindre. Il se ferme quand tu le quittes ou fermes TekBoard.")}</p>
          <div className="flex gap-2">
            <Input placeholder={t("Nom de l'espace (facultatif)")} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            <Button variant="primary" icon={<Play className="size-3.5" />} onClick={() => startHosting(me, name)}>
              {t("Ouvrir")}
            </Button>
          </div>
        </Card>
        <button type="button" className="text-xs text-faint hover:text-fg" onClick={onDisable}>
          {t("Désactiver TekSpace")}
        </button>
      </div>
      <AvatarEditor value={me.avatar} seed={me.fp} onSave={onAvatar} />
    </div>
    </>
  );
}

function AvatarPreview({ look, size = 96 }: { look: Look; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.imageSmoothingEnabled = false;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, 64, 64);
    c.setTransform(size / 20, 0, 0, size / 20, 0, 0);
    drawAvatar(c, look, 2, 3, "down", 0, false);
  }, [look, size]);
  return <canvas ref={ref} width={size} height={size} style={{ width: size, height: size, imageRendering: "pixelated" }} aria-label={t("Aperçu du personnage")} />;
}

/** Your character: a ready-made avatar or your own, kept in your Connect profile (everyone sees the same). */
function AvatarEditor({ value, seed, onSave }: { value: string; seed: string; onSave: (a: string) => void }) {
  return (
    <Card>
      <CardTitle>{t("Ton personnage")}</CardTitle>
      <div className="space-y-3 p-4">
        <div className="flex justify-center rounded-md bg-ink/4 py-2">
          <AvatarPreview look={decodeLook(value, seed)} />
        </div>
        <AvatarPicker value={value} seed={seed} onPick={onSave} />
      </div>
    </Card>
  );
}

// ───────────────────────────── in a space ─────────────────────────────

function mySeatTable(space: SpaceState | null, fp: string): { def: TableDef; state: TableState } | null {
  const seat = space?.players[fp]?.seat;
  const found = seat ? seatById(seat) : null;
  return found && space ? { def: found.table, state: space.tables[found.table.id] } : null;
}

function InSpace({ meFp, connect }: { meFp: string; connect: ConnectState }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const { mode, version } = useSpace();
  const space = useSpace((s) => s.space);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<SpaceEngine | null>(null);
  const [focusTable, setFocusTable] = useState<TableDef | null>(null);
  const [muted, setMuted] = usePref("space.muted", false);
  const [volume, setVolume] = usePref("space.volume", 0.5);
  const [dndInFocus, setDndInFocus] = usePref("space.dndInFocus", false);
  useEffect(() => {
    if (!canvas.current) return;
    const e = new SpaceEngine(canvas.current, {
      me: meFp,
      state: () => useSpace.getState().space,
      onMove: moveLocal,
      onSit: (seat) => send({ t: "space.sit", space: useSpace.getState().space!.id, seat: seat.id }),
      onStand: () => send({ t: "space.stand", space: useSpace.getState().space!.id }),
      onTable: setFocusTable,
    });
    engine.current = e;
    return () => {
      e.destroy();
      engine.current = null;
    };
  }, [meFp]);
  // Network changes wake the engine up (it sleeps when nothing moves).
  useEffect(() => engine.current?.wake(), [version]);
  const table = mySeatTable(space, meFp);
  const [favId] = usePref<string | null>("space.favTable", null);
  const favTable = TABLES.find((x) => x.id === favId) ?? null;
  // The table's ambience plays for the people seated at it, each at their own volume.
  useEffect(() => {
    audio.setMuted(muted);
    audio.setVolume(volume);
    audio.play(table?.state.ambience?.sound ?? null);
  }, [table?.state.ambience?.sound, muted, volume]);
  useEffect(() => () => audio.play(null), []);
  // Optional: "do not disturb" during the work phases of the table's focus timer.
  const working = table?.state.focus?.phase === "work";
  const before = useRef<string | null>(null);
  useEffect(() => {
    if (!dndInFocus) return;
    const cur = qc.getQueryData<ConnectState>(CONNECT_KEY);
    if (!cur) return;
    if (working && cur.profile.status !== "dnd") {
      before.current = cur.profile.status;
      void api.connectConfigure({ enabled: cur.enabled, profile: { ...cur.profile, status: "dnd" }, port: cur.port ?? 0, interface: cur.interface, space: cur.space }).then((s) => qc.setQueryData(CONNECT_KEY, s));
    } else if (!working && before.current) {
      const back = before.current;
      before.current = null;
      void api.connectConfigure({ enabled: cur.enabled, profile: { ...cur.profile, status: back as ConnectState["profile"]["status"] }, port: cur.port ?? 0, interface: cur.interface, space: cur.space }).then((s) => qc.setQueryData(CONNECT_KEY, s));
    }
  }, [working, dndInFocus, qc]);
  // Profile changes (pseudonym, avatar, status) follow into the space.
  useEffect(() => {
    if (space) send({ t: "space.profile", space: space.id, nick: connect.profile.nick, avatar: connect.profile.avatar, status: connect.profile.status });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect.profile.nick, connect.profile.avatar, connect.profile.status]);
  if (!space) return null;
  const me = space.players[meFp];
  const people = Object.values(space.players);
  const inviteable = recipients(connect.peers).filter((p) => !space.players[p.fp]);
  const invite = (fp: string, nick: string) => void api.sessionSend(fp, { t: "space.invite", space: space.id, name: space.name, hostNick: space.players[space.host]?.nick ?? "" }).then(() => toast({ kind: "ok", title: t("{n} est invité(e)", { n: nick }) }), (e) => toast({ kind: "error", title: "TekSpace", detail: asAppError(e).message }));
  return (
    <div className="flex h-[calc(100vh-7.5rem)] min-h-[520px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="display text-md text-fg">{space.name}</h2>
        <Badge>{t("{n} présent(s)", { n: people.length })}</Badge>
        {mode === "hosting" && <Badge tone="accent">{t("tu héberges")}</Badge>}
        <span className="text-xs text-faint">{me ? t(roomName(me.x, me.y) ?? "") : ""}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Select size="sm" className="w-44" label={t("Statut")} value={connect.profile.status} onChange={(status) => void api.connectConfigure({ enabled: connect.enabled, profile: { ...connect.profile, status }, port: connect.port ?? 0, interface: connect.interface, space: connect.space }).then((s) => qc.setQueryData(CONNECT_KEY, s))} options={CHOOSABLE.map((s) => ({ value: s, label: STATUS[s].label }))} />
          <IconButton label={muted ? t("Remettre le son") : t("Couper le son")} active={!muted} onClick={() => setMuted(!muted)}>
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </IconButton>
          <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label={t("Volume de l'ambiance")} className="w-20 accent-(--color-accent)" />
          <Menu trigger={<Button size="sm" icon={<UserPlus className="size-3.5" />}>{t("Inviter")}</Button>}>
            <MenuLabel>{t("Contacts connectés")}</MenuLabel>
            {inviteable.length === 0 && <MenuItem disabled>{t("Personne d'autre en ligne")}</MenuItem>}
            {inviteable.map((p) => (
              <MenuItem key={p.fp} onSelect={() => invite(p.fp, p.profile.nick)}>
                {p.profile.nick}
              </MenuItem>
            ))}
          </Menu>
          <Button size="sm" variant="ghost" icon={<DoorOpen className="size-3.5" />} onClick={() => { audio.play(null); leave(); }}>
            {mode === "hosting" ? t("Fermer l'espace") : t("Quitter")}
          </Button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] gap-3">
        <div className="card relative min-h-0 overflow-hidden">
          <canvas ref={canvas} tabIndex={0} className="block size-full outline-none" aria-label={t("Le campus : ZQSD, WASD ou flèches pour marcher, clic pour aller quelque part ou s'asseoir à une table")} />
          <p className="pointer-events-none absolute bottom-2 left-3 text-2xs text-white/60">{t("ZQSD / WASD / flèches · clic pour marcher · clic sur une table pour s'asseoir")}</p>
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto">
          {table ? (
            <TablePanel space={space} meFp={meFp} def={table.def} state={table.state} dndInFocus={dndInFocus} setDndInFocus={setDndInFocus} />
          ) : (
            <Card className="space-y-2 p-4 text-sm text-muted">
              <p>{focusTable ? t("Direction « {n} »…", { n: t(focusTable.name) }) : t("Clique sur une table pour t'y asseoir.")}</p>
              {favTable && !focusTable && (
                <Button size="sm" icon={<Star className="size-3.5" />} onClick={() => engine.current?.goSit(favTable)}>
                  {t("S'asseoir à ma table favorite ({n})", { n: t(favTable.name) })}
                </Button>
              )}
            </Card>
          )}
          <Card>
            <CardTitle>
              <Users className="size-4 text-faint" /> {t("Présents")}
            </CardTitle>
            <ul className="divide-y divide-ink/5">
              {people.map((p) => {
                const where = p.seat ? seatById(p.seat)?.table : null;
                return (
                  <li key={p.fp} className="flex items-center gap-2 px-3 py-1.5">
                    <AvatarPreview look={decodeLook(p.avatar, p.fp)} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">
                        {p.nick} {p.fp === space.host && <span className="text-2xs text-faint">· {t("hôte")}</span>}
                      </span>
                      <span className="block truncate text-2xs text-faint">
                        {(STATUS[p.status as keyof typeof STATUS] ?? STATUS.available).label}
                        {where ? ` · ${t(where.name)}` : ""}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function remaining(endsAt: number, now: number): string {
  const s = Math.max(0, Math.round((endsAt - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Shares what you listen to at your table, read every 10 s while the window is visible, from
 * the source you chose (your desktop player, or your Spotify account). Stopping or leaving the
 * table clears it. It is what you hear, never a synchronised playback.
 */
function useMusicShare(space: SpaceState, table: TableDef, source: "mpris" | "spotify" | null) {
  const toast = useUi((s) => s.toast);
  const last = useRef<string>("");
  useEffect(() => {
    if (!source) return;
    let stopped = false;
    const read = async () => {
      if (document.hidden) return;
      try {
        const np = await api.musicNow(source);
        if (stopped) return;
        const key = np ? `${np.title}|${np.artist}|${np.playing}` : "";
        if (key === last.current) return;
        const trackChanged = !np || last.current.split("|").slice(0, 2).join("|") !== `${np.title}|${np.artist}`;
        last.current = key;
        send({ t: "space.music", space: space.id, table: table.id, music: np ? { title: np.title, artist: np.artist, art: trackChanged ? np.art : null, playing: np.playing, source: np.source, at: Date.now() } : null });
      } catch (e) {
        if (!stopped) toast({ kind: "error", title: t("Musique"), detail: asAppError(e).message });
      }
    };
    void read();
    const id = window.setInterval(() => void read(), 10_000);
    return () => {
      stopped = true;
      window.clearInterval(id);
      last.current = "";
      send({ t: "space.music", space: space.id, table: table.id, music: null });
    };
  }, [source, space.id, table.id, toast]);
}

function TablePanel({ space, meFp, def, state, dndInFocus, setDndInFocus }: { space: SpaceState; meFp: string; def: TableDef; state: TableState; dndInFocus: boolean; setDndInFocus: (v: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const owner = state.owner === meFp || space.host === meFp;
  const seated = Object.values(space.players).filter((p) => p.seat && seatById(p.seat)?.table.id === def.id);
  const others = seated.filter((p) => p.fp !== meFp);
  const [goal, setGoal] = useState(state.goals[meFp]?.text ?? "");
  const [jam, setJam] = useState(state.jam ?? "");
  const [pinText, setPinText] = useState("");
  const [work, setWork] = useState(25);
  const [rest, setRest] = useState(5);
  const [now, setNow] = useState(Date.now());
  const [say, setSay] = useState("");
  const [sayError, setSayError] = useState<string | null>(null);
  const [fav, setFav] = usePref<string | null>("space.favTable", null);
  const [source, setSource] = useState<"mpris" | "spotify" | null>(null);
  useMusicShare(space, def, source);
  useEffect(() => {
    if (!state.focus) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state.focus]);
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => chatEnd.current?.scrollIntoView({ block: "nearest" }), [state.chat?.length]);
  const tableMsg = (patch: Record<string, unknown>) => send({ t: "space.table", space: space.id, table: def.id, ...patch } as never);
  const live = qc.getQueryData<LiveSession | null>(LIVE_KEY);
  const sameSpace = useMemo(() => new Set(others.map((p) => p.fp)), [others]);
  // Checked before sending (the host checks again: this is only to say it sooner).
  const moderated = (text: string, then: () => void, onError: (e: string | null) => void = (e) => e && toast({ kind: "error", title: t("Message refusé"), detail: e })) => {
    const why = refusal(check(text));
    onError(why);
    if (!why) then();
  };
  const sendSay = () => moderated(say, () => { send({ t: "space.say", space: space.id, table: def.id, text: say.trim() }); setSay(""); }, setSayError);
  const music = state.music ?? null;
  const stale = music ? Date.now() - music.at > 60_000 : false;
  const mineMusic = music?.by === meFp;

  return (
    <Card hero>
      <div className="flex items-start gap-2 border-b border-ink/6 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-fg">
            {t(def.name)}
            {fav === def.id && <Star className="size-3.5 fill-current text-accent" aria-label={t("Table favorite")} />}
          </p>
          <p className="truncate text-xs text-muted">{state.topic || (state.privacy === "reserved" ? t("Réservée au groupe") : t("Ouverte à tous"))}</p>
        </div>
        <Menu label={t("Options de la table")}>
          {owner && <MenuItem onSelect={() => { const v = window.prompt(t("Sujet ou projet de la table (ex. my_ls)"), state.topic); if (v !== null) moderated(v, () => tableMsg({ topic: v.slice(0, 120) })); }}>{t("Changer le sujet…")}</MenuItem>}
          {owner && <MenuItem onSelect={() => tableMsg({ privacy: state.privacy === "open" ? "reserved" : "open" })}>{state.privacy === "open" ? t("Réserver au groupe") : t("Ouvrir à tous")}</MenuItem>}
          {owner && state.privacy === "reserved" && (
            <>
              <MenuLabel>{t("Peuvent s'asseoir")}</MenuLabel>
              {Object.values(space.players).filter((p) => p.fp !== meFp).map((p) => (
                <MenuItem key={p.fp} onSelect={() => tableMsg({ members: state.members.includes(p.fp) ? state.members.filter((m) => m !== p.fp) : [...state.members, p.fp] })} hint={state.members.includes(p.fp) ? "✓" : undefined}>{p.nick}</MenuItem>
              ))}
            </>
          )}
          <MenuItem icon={<Star className="size-4" />} onSelect={() => setFav(fav === def.id ? null : def.id)}>{fav === def.id ? t("Ne plus en faire ma table favorite") : t("En faire ma table favorite")}</MenuItem>
          <MenuItem icon={<Share2 className="size-4" />} disabled={others.length === 0} onSelect={() => { const text = window.prompt(t("Note à partager avec la table")); if (text?.trim()) useUi.getState().openShare({ kind: "note", title: text.trim().split("\n")[0].slice(0, 60), text }, others.map((p) => p.fp)); }}>{t("Partager une note avec la table…")}</MenuItem>
          <MenuItem icon={<Send className="size-4" />} disabled={!live?.link || others.length === 0} onSelect={() => void Promise.all(others.filter((p) => sameSpace.has(p.fp)).map((p) => api.liveInvite(p.fp))).then(() => toast({ kind: "ok", title: t("Session TekLive proposée à la table") }), (e) => toast({ kind: "error", title: "TekLive", detail: asAppError(e).message }))}>{t("Inviter la table dans ma session TekLive")}</MenuItem>
          <MenuItem onSelect={() => send({ t: "space.stand", space: space.id })}>{t("Se lever")}</MenuItem>
        </Menu>
      </div>

      <div className="space-y-4 p-4 text-sm">
        {/* Who is here */}
        <ul className="flex flex-wrap gap-2" aria-label={t("Assis à la table")}>
          {seated.map((p) => (
            <li key={p.fp} className="flex items-center gap-1.5 rounded-full bg-ink/5 py-0.5 pr-2.5 pl-0.5" title={(STATUS[p.status as keyof typeof STATUS] ?? STATUS.available).label}>
              <AvatarPreview look={decodeLook(p.avatar, p.fp)} size={22} />
              <span className="max-w-24 truncate text-xs text-fg">{p.fp === meFp ? t("toi") : p.nick}</span>
            </li>
          ))}
        </ul>

        {/* The three main actions */}
        <div className="grid grid-cols-3 gap-1.5">
          {state.focus ? (
            <Button size="sm" variant="secondary" icon={<Square className="size-3.5" />} onClick={() => send({ t: "space.focus", space: space.id, table: def.id, action: "stop" })}>{t("Fin du focus")}</Button>
          ) : (
            <Button size="sm" variant="secondary" icon={<Timer className="size-3.5" />} onClick={() => send({ t: "space.focus", space: space.id, table: def.id, action: "start", workMin: work, breakMin: rest })} title={t("{w} min de travail, {r} min de pause, pour toute la table", { w: work, r: rest })}>{t("Focus")}</Button>
          )}
          <Menu trigger={<Button size="sm" variant="secondary" className="w-full" icon={<Music className="size-3.5" />}>{source ? t("Partagé") : t("Musique")}</Button>} label={t("Musique")}>
            <MenuLabel>{t("Partager ce que j'écoute")}</MenuLabel>
            <MenuItem hint={source === "mpris" ? "✓" : undefined} onSelect={() => setSource(source === "mpris" ? null : "mpris")}>{t("Depuis le lecteur de cet ordinateur")}</MenuItem>
            <MenuItem hint={source === "spotify" ? "✓" : undefined} onSelect={() => setSource(source === "spotify" ? null : "spotify")}>{t("Depuis mon compte Spotify")}</MenuItem>
            {source && <MenuItem onSelect={() => setSource(null)}>{t("Arrêter le partage")}</MenuItem>}
          </Menu>
          <TableBoardSection space={space} meFp={meFp} def={def} state={state} compact />
        </div>

        {state.focus && (
          <div className="flex items-center gap-3 rounded-(--btn-radius) bg-ink/4 px-3 py-2">
            <span className={cn("display text-2xl tabular-nums", state.focus.phase === "work" ? "text-accent-strong" : "text-ok")}>{remaining(state.focus.endsAt, now)}</span>
            <span className="text-xs text-muted">{state.focus.phase === "work" ? t("travail · cycle {c}", { c: state.focus.cycle }) : t("pause")}</span>
          </div>
        )}

        {/* Shared music: what someone at the table is listening to */}
        {(music || state.jam) && (
          <div className="flex items-center gap-3 rounded-(--btn-radius) bg-ink/4 p-2">
            {music?.art ? <img src={music.art} alt="" className="size-11 shrink-0 rounded-[4px] object-cover" /> : <span className="flex size-11 shrink-0 items-center justify-center rounded-[4px] bg-ink/8"><Music className="size-4 text-faint" /></span>}
            <div className="min-w-0 flex-1">
              {music ? (
                <>
                  <p className="truncate text-sm text-fg">{music.title}</p>
                  <p className="truncate text-xs text-muted">{music.artist}</p>
                  <p className="text-2xs text-faint">{stale ? t("dernier morceau de {n}", { n: mineMusic ? t("toi") : (music.byNick ?? "?") }) : t("{state} · écouté par {n}", { state: music.playing ? t("en lecture") : t("en pause"), n: mineMusic ? t("toi") : (music.byNick ?? "?") })}</p>
                </>
              ) : (
                <p className="text-xs text-muted">{t("La table a une Jam Spotify")}</p>
              )}
            </div>
            {state.jam && <IconButton label={t("Rejoindre la Jam Spotify de la table")} onClick={() => void api.spaceOpenJam(state.jam!).catch((e) => toast({ kind: "error", title: "Spotify", detail: asAppError(e).message }))}><ExternalLink className="size-4" /></IconButton>}
          </div>
        )}
        {source === "spotify" && <SpotifyLink onGone={() => setSource(null)} />}

        {/* Chat of the session and small reactions */}
        <section className="space-y-1.5">
          <ul className="max-h-40 space-y-1 overflow-y-auto" aria-label={t("Discussion de la table")} aria-live="polite">
            {(state.chat ?? []).length === 0 && <li className="text-xs text-faint">{t("Personne n'a encore écrit. Les messages ne sont pas gardés après la session.")}</li>}
            {(state.chat ?? []).map((l, i) => (
              <li key={`${l.at}-${i}`} className="text-xs leading-relaxed">
                <span className={cn("font-medium", l.by === meFp ? "text-accent-strong" : "text-fg")}>{l.by === meFp ? t("toi") : l.nick}</span> <span className="selectable break-words text-muted">{l.text}</span>
              </li>
            ))}
            <div ref={chatEnd} />
          </ul>
          <div className="flex gap-1.5">
            <Input className="h-8 text-xs" placeholder={t("Écrire à la table…")} value={say} maxLength={300} onChange={(e) => { setSay(e.target.value); setSayError(null); }} onKeyDown={(e) => e.key === "Enter" && say.trim() && sendSay()} aria-label={t("Message à la table")} />
            <IconButton label={t("Envoyer")} disabled={!say.trim()} onClick={sendSay}><Send className="size-3.5" /></IconButton>
          </div>
          {sayError && <p className="text-2xs text-danger">{sayError}</p>}
          <div className="flex gap-1" aria-label={t("Réactions")}>
            {REACTIONS.map((r) => (
              <button key={r.id} type="button" className="flex size-7 items-center justify-center rounded-(--btn-radius) text-sm hover:bg-hover" onClick={() => send({ t: "space.react", space: space.id, react: r.id })} aria-label={t("Réagir : {r}", { r: r.emoji })}>{r.emoji}</button>
            ))}
          </div>
        </section>

        {/* Goals, short */}
        <section className="space-y-1.5">
          <h3 className="flex items-center gap-1.5 text-xs text-faint"><Target className="size-3.5" /> {t("Objectifs")}</h3>
          <ul className="space-y-1">
            {Object.entries(state.goals).map(([fp, g]) => (
              <li key={fp} className="flex items-center gap-2">
                <input type="checkbox" className="accent-(--color-accent)" checked={g.done} disabled={fp !== meFp} onChange={(e) => send({ t: "space.goal", space: space.id, table: def.id, text: g.text, done: e.target.checked })} />
                <span className={cn("min-w-0 flex-1 truncate text-xs", g.done ? "text-faint line-through" : "text-fg")}>{g.text}</span>
                <span className="text-2xs text-faint">{fp === meFp ? t("toi") : space.players[fp]?.nick}</span>
              </li>
            ))}
          </ul>
          <Input className="h-8 text-xs" placeholder={t("Mon objectif pour cette session (Entrée)")} value={goal} maxLength={140} onChange={(e) => setGoal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && moderated(goal, () => send({ t: "space.goal", space: space.id, table: def.id, text: goal, done: false }))} />
        </section>

        {/* Secondary: sounds, pins, Jam link, timer lengths */}
        <details className="border-t border-ink/6 pt-3">
          <summary className="cursor-pointer text-xs text-muted hover:text-fg">{t("Ambiance, ressources et réglages")}</summary>
          <div className="mt-3 space-y-4">
            <section className="space-y-1.5">
              <h3 className="text-xs text-faint">{t("Ambiance sonore")}</h3>
              <div className="flex flex-wrap gap-1">
                <button type="button" className={cn("rounded-md border px-2 py-0.5 text-2xs", !state.ambience ? "border-accent text-fg" : "border-ink/10 text-muted")} onClick={() => send({ t: "space.ambience", space: space.id, table: def.id, sound: null })}>{t("Silence")}</button>
                {SOUNDS.map((s) => (
                  <button key={s} type="button" className={cn("rounded-md border px-2 py-0.5 text-2xs", state.ambience?.sound === s ? "border-accent text-fg" : "border-ink/10 text-muted hover:text-fg")} onClick={() => send({ t: "space.ambience", space: space.id, table: def.id, sound: s })}>{SOUND_LABEL[s]}</button>
                ))}
              </div>
            </section>
            <section className="space-y-1.5">
              <h3 className="text-xs text-faint">{t("Durées du focus")}</h3>
              <div className="flex items-center gap-2">
                <Input type="number" min={5} max={120} className="h-7 w-16 text-xs" value={work} onChange={(e) => setWork(Number(e.target.value) || 25)} aria-label={t("Minutes de travail")} />
                <span className="text-xs text-faint">/</span>
                <Input type="number" min={1} max={30} className="h-7 w-14 text-xs" value={rest} onChange={(e) => setRest(Number(e.target.value) || 5)} aria-label={t("Minutes de pause")} />
                <span className="text-xs text-faint">{t("min")}</span>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" className="accent-(--color-accent)" checked={dndInFocus} onChange={(e) => setDndInFocus(e.target.checked)} />
                {t("Me mettre en « Ne pas déranger » pendant le travail")}
              </label>
            </section>
            {owner && (
              <section className="space-y-1.5">
                <h3 className="text-xs text-faint">{t("Jam Spotify de la table")}</h3>
                <div className="flex gap-2">
                  <Input placeholder={t("Lien d'invitation Spotify Jam")} className="h-8 text-xs" value={jam} onChange={(e) => setJam(e.target.value)} />
                  <Button size="sm" disabled={jam !== "" && !validJam(jam)} disabledReason={t("Seuls les liens d'invitation Spotify Jam sont acceptés")} onClick={() => tableMsg({ jam: jam || null })}>OK</Button>
                </div>
              </section>
            )}
            <section className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 text-xs text-faint"><Pin className="size-3.5" /> {t("Ressources de la table")}</h3>
              <ul className="space-y-1">
                {state.pins.map((p, i) => (
                  <li key={i} className="rounded-md bg-ink/4 px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-fg">{p.title}</span>
                      <span className="text-2xs text-faint">{space.players[p.by]?.nick ?? ""}</span>
                      {(owner || p.by === meFp) && <IconButton label={t("Retirer")} onClick={() => send({ t: "space.unpin", space: space.id, table: def.id, index: i })}><Trash2 className="size-3" /></IconButton>}
                    </div>
                    {p.text && <p className="selectable mt-0.5 text-xs break-words whitespace-pre-wrap text-muted">{p.text}</p>}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Input placeholder={t("Une note, un lien, une astuce…")} className="h-8 text-xs" value={pinText} maxLength={2000} onChange={(e) => setPinText(e.target.value)} />
                <Button size="sm" disabled={!pinText.trim()} onClick={() => moderated(pinText, () => { send({ t: "space.pin", space: space.id, table: def.id, title: pinText.trim().split("\n")[0].slice(0, 80), text: pinText.includes("\n") ? pinText : "" }); setPinText(""); })}>{t("Épingler")}</Button>
              </div>
            </section>
          </div>
        </details>
      </div>
    </Card>
  );
}

/** The table's whiteboard: one person seated opens it and hosts it; the others seated join it. */
function TableBoardSection({ space, meFp, def, state, compact }: { space: SpaceState; meFp: string; def: TableDef; state: TableState; compact?: boolean }) {
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const b = state.board;
  const seatedHere = (fp: string) => {
    const p = useSpace.getState().space?.players[fp];
    return !!p?.seat && seatById(p.seat)?.table.id === def.id;
  };
  const open = async () => {
    setBusy(true);
    try {
      const board = await api.boardCreate(t("Table « {n} » · {d}", { n: state.topic || t(def.name), d: new Date().toLocaleDateString() }), null);
      useBoardBus.setState({
        autoHost: {
          board: board.id,
          mayJoin: seatedHere,
          started: (session, name) => send({ t: "space.board", space: space.id, table: def.id, board: { session, name } }),
          stopped: () => send({ t: "space.board", space: space.id, table: def.id, board: null }),
        },
      });
      useUi.getState().openBoard(board.id);
    } catch (e) {
      toast({ kind: "error", title: t("Création impossible"), detail: asAppError(e).message });
    } finally {
      setBusy(false);
    }
  };
  if (compact) {
    // One button among the table's main actions: open, join or go back to the board.
    const go = b ? (b.host === meFp ? () => useUi.getState().openBoard(b.session.split("@")[0]) : () => joinBoard({ host: b.host, session: b.session.slice(0, 120), name: b.name.slice(0, 80), hostNick: b.hostNick.slice(0, 24), at: Date.now() })) : () => void open();
    const title = b ? (b.host === meFp ? t("Revenir à mon tableau « {n} »", { n: b.name }) : t("Rejoindre le tableau de {n}", { n: b.hostNick })) : t("Ouvrir un tableau pour la table : les personnes assises peuvent le rejoindre, il reste dans tes tableaux.");
    return (
      <Button size="sm" variant="secondary" busy={busy} icon={<PenTool className="size-3.5" />} title={title} onClick={go}>
        {b && b.host !== meFp ? t("Rejoindre") : t("Tableau")}
      </Button>
    );
  }
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-center gap-1.5 text-xs text-faint">
        <PenTool className="size-3.5" /> {t("Tableau blanc de la table")}
      </h3>
      {b ? (
        b.host === meFp ? (
          <Button size="sm" variant="secondary" onClick={() => useUi.getState().openBoard(b.session.split("@")[0])}>
            {t("Revenir à mon tableau « {n} »", { n: b.name })}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => joinBoard({ host: b.host, session: b.session.slice(0, 120), name: b.name.slice(0, 80), hostNick: b.hostNick.slice(0, 24), at: Date.now() })}>
            {t("Rejoindre le tableau de {n}", { n: b.hostNick })}
          </Button>
        )
      ) : (
        <>
          <Button size="sm" variant="secondary" busy={busy} onClick={() => void open()}>
            {t("Ouvrir un tableau pour la table")}
          </Button>
          <p className="text-2xs text-faint">{t("Les personnes assises à la table peuvent le rejoindre ; il reste dans tes tableaux.")}</p>
        </>
      )}
    </section>
  );
}
