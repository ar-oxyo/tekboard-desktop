// TekSpace: a small pixel-art campus where TekBoard contacts meet to work together. One of
// you hosts a space (it runs in their TekBoard), the others join. Walk with ZQSD / WASD /
// the arrows or a click, sit at a table, share goals, a focus timer, an ambience and the
// table's resources. Nothing records what you do elsewhere; microphone and camera are never used.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DoorOpen, ExternalLink, Music, PenTool, Pin, Play, Send, Share2, Square, Target, Timer, Trash2, UserPlus, Users, Volume2, VolumeX } from "lucide-react";
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
import { ACCESSORIES, decodeLook, encodeLook, HAIR_COLORS, HAIR_STYLES, OUTFIT_COLORS, OUTFITS, SKINS, type Look } from "./avatar";
import { drawAvatar } from "./sprites";
import { roomName, seatById, type TableDef } from "./map";
import { SOUNDS, validJam, type Sound, type SpaceState, type TableState } from "./protocol";
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

function AvatarEditor({ value, seed, onSave }: { value: string; seed: string; onSave: (a: string) => void }) {
  const [look, setLook] = useState<Look>(() => decodeLook(value, seed));
  const changed = encodeLook(look) !== encodeLook(decodeLook(value, seed));
  const row = (label: string, key: keyof Look, options: string[], swatches = false) => (
    <div>
      <p className="mb-1 text-2xs text-faint">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map((o, i) => (
          <button key={o} type="button" aria-pressed={look[key] === i} onClick={() => setLook({ ...look, [key]: i })} className={cn("rounded-md border text-2xs", swatches ? "size-6" : "px-2 py-0.5", look[key] === i ? "border-accent" : "border-ink/10 text-muted hover:text-fg")} style={swatches ? { background: o } : undefined} title={swatches ? undefined : o}>
            {swatches ? "" : t(o)}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <Card>
      <CardTitle right={changed ? <Button size="sm" variant="primary" onClick={() => onSave(encodeLook(look))}>{t("Enregistrer")}</Button> : null}>{t("Ton personnage")}</CardTitle>
      <div className="space-y-3 p-4">
        <div className="flex justify-center rounded-md bg-ink/4 py-2">
          <AvatarPreview look={look} />
        </div>
        {row(t("Peau"), "skin", SKINS, true)}
        {row(t("Coiffure"), "hair", HAIR_STYLES)}
        {row(t("Couleur des cheveux"), "hairColor", HAIR_COLORS, true)}
        {row(t("Tenue"), "outfit", OUTFITS)}
        {row(t("Couleur de la tenue"), "outfitColor", OUTFIT_COLORS, true)}
        {row(t("Accessoire"), "accessory", ACCESSORIES)}
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
              <p>{focusTable ? t("Direction « {n} »…", { n: t(focusTable.name) }) : t("Clique sur une table pour t'y asseoir : tu y retrouves les objectifs, le minuteur partagé, l'ambiance et les ressources de la table.")}</p>
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

function TablePanel({ space, meFp, def, state, dndInFocus, setDndInFocus }: { space: SpaceState; meFp: string; def: TableDef; state: TableState; dndInFocus: boolean; setDndInFocus: (v: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const owner = state.owner === meFp || space.host === meFp;
  const seated = Object.values(space.players).filter((p) => p.seat && seatById(p.seat)?.table.id === def.id);
  const others = seated.filter((p) => p.fp !== meFp);
  const [goal, setGoal] = useState(state.goals[meFp]?.text ?? "");
  const [topic, setTopic] = useState(state.topic);
  const [jam, setJam] = useState(state.jam ?? "");
  const [pinText, setPinText] = useState("");
  const [work, setWork] = useState(25);
  const [rest, setRest] = useState(5);
  const [now, setNow] = useState(Date.now());
  useEffect(() => setTopic(state.topic), [state.topic]);
  useEffect(() => {
    if (!state.focus) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state.focus]);
  const tableMsg = (patch: Record<string, unknown>) => send({ t: "space.table", space: space.id, table: def.id, ...patch } as never);
  const live = qc.getQueryData<LiveSession | null>(LIVE_KEY);
  const sameSpace = useMemo(() => new Set(others.map((p) => p.fp)), [others]);
  return (
    <Card hero>
      <CardTitle right={<Badge tone={state.privacy === "open" ? "neutral" : "warn"}>{state.privacy === "open" ? t("ouverte") : t("réservée")}</Badge>}>
        {t(def.name)}
      </CardTitle>
      <div className="space-y-4 p-4 text-sm">
        {owner ? (
          <div className="space-y-2">
            <Input placeholder={t("Sujet ou projet de la table (ex. my_ls)")} value={topic} maxLength={120} onChange={(e) => setTopic(e.target.value)} onBlur={() => topic !== state.topic && tableMsg({ topic })} />
            <div className="flex items-center gap-2">
              <Select<"open" | "reserved"> size="sm" className="w-40" label={t("Accès")} value={state.privacy} onChange={(privacy) => tableMsg({ privacy })} options={[{ value: "open", label: t("Ouverte à tous") }, { value: "reserved", label: t("Réservée au groupe") }]} />
              {state.privacy === "reserved" && (
                <Menu trigger={<Button size="sm">{t("Groupe ({n})", { n: state.members.length })}</Button>}>
                  <MenuLabel>{t("Peuvent s'asseoir")}</MenuLabel>
                  {Object.values(space.players).filter((p) => p.fp !== meFp).map((p) => (
                    <MenuItem key={p.fp} onSelect={() => tableMsg({ members: state.members.includes(p.fp) ? state.members.filter((m) => m !== p.fp) : [...state.members, p.fp] })} hint={state.members.includes(p.fp) ? "✓" : undefined}>
                      {p.nick}
                    </MenuItem>
                  ))}
                </Menu>
              )}
            </div>
          </div>
        ) : (
          state.topic && <p className="text-fg">{state.topic}</p>
        )}

        <section className="space-y-1.5">
          <h3 className="flex items-center gap-1.5 text-xs text-faint">
            <Target className="size-3.5" /> {t("Objectifs (partagés volontairement)")}
          </h3>
          <div className="flex gap-2">
            <Input placeholder={t("Mon objectif pour cette session")} value={goal} maxLength={140} onChange={(e) => setGoal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send({ t: "space.goal", space: space.id, table: def.id, text: goal, done: false })} />
            <Button size="sm" onClick={() => send({ t: "space.goal", space: space.id, table: def.id, text: goal, done: false })}>
              OK
            </Button>
          </div>
          <ul className="space-y-1">
            {Object.entries(state.goals).map(([fp, g]) => (
              <li key={fp} className="flex items-center gap-2">
                <input type="checkbox" className="accent-(--color-accent)" checked={g.done} disabled={fp !== meFp} onChange={(e) => send({ t: "space.goal", space: space.id, table: def.id, text: g.text, done: e.target.checked })} />
                <span className={cn("min-w-0 flex-1 truncate", g.done ? "text-faint line-through" : "text-fg")}>{g.text}</span>
                <span className="text-2xs text-faint">{space.players[fp]?.nick}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-1.5">
          <h3 className="flex items-center gap-1.5 text-xs text-faint">
            <Timer className="size-3.5" /> {t("Concentration à plusieurs")}
          </h3>
          {state.focus ? (
            <div className="flex items-center gap-3">
              <span className={cn("display text-2xl tabular", state.focus.phase === "work" ? "text-accent-strong" : "text-ok")}>{remaining(state.focus.endsAt, now)}</span>
              <span className="text-xs text-muted">{state.focus.phase === "work" ? t("travail · cycle {c}", { c: state.focus.cycle }) : t("pause")}</span>
              <Button size="sm" variant="ghost" icon={<Square className="size-3.5" />} className="ml-auto" onClick={() => send({ t: "space.focus", space: space.id, table: def.id, action: "stop" })}>
                {t("Arrêter")}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input type="number" min={5} max={120} className="h-7 w-16 text-xs" value={work} onChange={(e) => setWork(Number(e.target.value) || 25)} aria-label={t("Minutes de travail")} />
              <span className="text-xs text-faint">/</span>
              <Input type="number" min={1} max={30} className="h-7 w-14 text-xs" value={rest} onChange={(e) => setRest(Number(e.target.value) || 5)} aria-label={t("Minutes de pause")} />
              <Button size="sm" icon={<Play className="size-3.5" />} onClick={() => send({ t: "space.focus", space: space.id, table: def.id, action: "start", workMin: work, breakMin: rest })}>
                {t("Lancer")}
              </Button>
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" className="accent-(--color-accent)" checked={dndInFocus} onChange={(e) => setDndInFocus(e.target.checked)} />
            {t("Me mettre en « Ne pas déranger » pendant le travail")}
          </label>
        </section>

        <section className="space-y-1.5">
          <h3 className="flex items-center gap-1.5 text-xs text-faint">
            <Music className="size-3.5" /> {t("Ambiance de la table")}
          </h3>
          <div className="flex flex-wrap gap-1">
            <button type="button" className={cn("rounded-md border px-2 py-0.5 text-2xs", !state.ambience ? "border-accent text-fg" : "border-ink/10 text-muted")} onClick={() => send({ t: "space.ambience", space: space.id, table: def.id, sound: null })}>
              {t("Silence")}
            </button>
            {SOUNDS.map((s) => (
              <button key={s} type="button" className={cn("rounded-md border px-2 py-0.5 text-2xs", state.ambience?.sound === s ? "border-accent text-fg" : "border-ink/10 text-muted hover:text-fg")} onClick={() => send({ t: "space.ambience", space: space.id, table: def.id, sound: s })}>
                {SOUND_LABEL[s]}
              </button>
            ))}
          </div>
          <p className="text-2xs text-faint">{t("Sons générés par TekBoard, entendus par les personnes assises ; chacun règle ou coupe le sien en haut.")}</p>
          {owner ? (
            <div className="flex gap-2">
              <Input placeholder={t("Lien d'invitation Spotify Jam (facultatif)")} className="text-xs" value={jam} onChange={(e) => setJam(e.target.value)} />
              <Button size="sm" disabled={jam !== "" && !validJam(jam)} disabledReason={t("Seuls les liens d'invitation Spotify Jam sont acceptés")} onClick={() => tableMsg({ jam: jam || null })}>
                OK
              </Button>
            </div>
          ) : null}
          {state.jam && (
            <Button size="sm" variant="secondary" icon={<ExternalLink className="size-3.5" />} onClick={() => void api.spaceOpenJam(state.jam!).catch((e) => toast({ kind: "error", title: "Spotify", detail: asAppError(e).message }))}>
              {t("Rejoindre la Jam Spotify de la table")}
            </Button>
          )}
        </section>

        <TableBoardSection space={space} meFp={meFp} def={def} state={state} />

        <section className="space-y-1.5">
          <h3 className="flex items-center gap-1.5 text-xs text-faint">
            <Pin className="size-3.5" /> {t("Ressources de la table")}
          </h3>
          <ul className="space-y-1">
            {state.pins.map((p, i) => (
              <li key={i} className="rounded-md bg-ink/4 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-fg">{p.title}</span>
                  <span className="text-2xs text-faint">{space.players[p.by]?.nick ?? ""}</span>
                  {(owner || p.by === meFp) && (
                    <IconButton label={t("Retirer")} onClick={() => send({ t: "space.unpin", space: space.id, table: def.id, index: i })}>
                      <Trash2 className="size-3" />
                    </IconButton>
                  )}
                </div>
                {p.text && <p className="selectable mt-0.5 text-xs break-words whitespace-pre-wrap text-muted">{p.text}</p>}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input placeholder={t("Une note, un lien, une astuce…")} className="text-xs" value={pinText} maxLength={2000} onChange={(e) => setPinText(e.target.value)} />
            <Button size="sm" disabled={!pinText.trim()} onClick={() => { send({ t: "space.pin", space: space.id, table: def.id, title: pinText.trim().split("\n")[0].slice(0, 80), text: pinText.includes("\n") ? pinText : "" }); setPinText(""); }}>
              {t("Épingler")}
            </Button>
          </div>
        </section>

        <section className="flex flex-wrap gap-2 border-t border-ink/6 pt-3">
          <Button size="sm" icon={<Share2 className="size-3.5" />} disabled={others.length === 0} disabledReason={t("Personne d'autre à la table")} onClick={() => {
            const text = window.prompt(t("Note à partager avec la table"));
            if (text?.trim()) useUi.getState().openShare({ kind: "note", title: text.trim().split("\n")[0].slice(0, 60), text }, others.map((p) => p.fp));
          }}>
            {t("Partager avec la table")}
          </Button>
          <Button
            size="sm"
            icon={<Send className="size-3.5" />}
            disabled={!live?.link || others.length === 0}
            disabledReason={!live?.link ? t("Démarre d'abord une session TekLive (Connect → TekLive)") : t("Personne d'autre à la table")}
            onClick={() => void Promise.all(others.filter((p) => sameSpace.has(p.fp)).map((p) => api.liveInvite(p.fp))).then(() => toast({ kind: "ok", title: t("Session TekLive proposée à la table") }), (e) => toast({ kind: "error", title: "TekLive", detail: asAppError(e).message }))}
          >
            {t("Inviter la table dans ma session TekLive")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => send({ t: "space.stand", space: space.id })}>
            {t("Se lever")}
          </Button>
        </section>
        <p className="text-2xs text-faint">{t("Assis : {n}", { n: seated.map((p) => p.nick).join(", ") })}</p>
      </div>
    </Card>
  );
}

/** The table's whiteboard: one person seated opens it and hosts it; the others seated join it. */
function TableBoardSection({ space, meFp, def, state }: { space: SpaceState; meFp: string; def: TableDef; state: TableState }) {
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
