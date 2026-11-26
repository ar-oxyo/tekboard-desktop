// The music of a TekSpace table, in one place: what someone at the table is listening to
// (cover, title, artist), and the table's Spotify Jam, joined in one click. Spotify offers no
// way to join a Jam from another app, so "Join" opens the Jam's own link in Spotify: one click,
// no copy. Starting one is a paste: Spotify → Start a Jam → Invite → Copy link, then paste here
// (the link is checked as soon as it lands, no OK button). Anyone seated may share a Jam when
// the table has none; the person who shared it, or the table's owner, ends it.
import { Music, Radio, X } from "lucide-react";
import { useState } from "react";
import { Hint } from "../../components/lite";
import { Button, cn, IconButton, Input } from "../../components/ui";
import { api, asAppError } from "../../lib/api";
import { t } from "../../lib/i18n";
import { useUi } from "../../lib/store";
import { validJam, type TableState } from "./protocol";

export function TableMusic({ state, meFp, owner, onJam }: { state: TableState; meFp: string; owner: boolean; onJam: (jam: string | null) => void }) {
  const toast = useUi((s) => s.toast);
  const [pasting, setPasting] = useState(false);
  const [value, setValue] = useState("");
  const [bad, setBad] = useState(false);
  const music = state.music ?? null;
  const stale = music ? Date.now() - music.at > 60_000 : false;
  const who = (fp: string | null | undefined, nick?: string | null) => (fp === meFp ? t("toi") : (nick ?? "?"));
  const canEnd = !!state.jam && (owner || state.jamBy === meFp || !state.jamBy);
  const join = () => void api.spaceOpenJam(state.jam!).catch((e) => toast({ kind: "error", title: "Spotify", detail: asAppError(e).message }));
  const take = (text: string) => {
    const link = text.trim();
    setValue(link);
    if (!link) return setBad(false);
    if (validJam(link)) {
      onJam(link);
      setPasting(false);
      setValue("");
      setBad(false);
      toast({ kind: "ok", title: t("Jam partagée avec la table") });
    } else setBad(true);
  };
  const fromClipboard = async () => {
    setPasting(true);
    try {
      take(await navigator.clipboard.readText());
    } catch {
      /* the system refused: the field is there, Ctrl+V works */
    }
  };

  if (!music && !state.jam) {
    return pasting ? (
      <JamPaste value={value} bad={bad} onChange={take} onCancel={() => (setPasting(false), setValue(""), setBad(false))} />
    ) : (
      <button type="button" onClick={() => void fromClipboard()} className="flex w-full items-center gap-2 rounded-(--btn-radius) border border-dashed border-line px-3 py-2 text-left text-xs text-muted hover:border-line-strong hover:text-fg">
        <Radio className="size-3.5 shrink-0" />
        {t("Lancer une Jam Spotify pour la table")}
      </button>
    );
  }
  return (
    <div className="anim-fade space-y-2">
      <div className={cn("flex items-center gap-3 rounded-(--btn-radius) p-2", state.jam ? "bg-accent-soft" : "bg-ink/4")}>
        {music?.art ? <img src={music.art} alt="" className="size-12 shrink-0 rounded-[4px] object-cover" /> : <span className="flex size-12 shrink-0 items-center justify-center rounded-[4px] bg-ink/8"><Music className="size-4 text-faint" /></span>}
        <div className="min-w-0 flex-1">
          {music ? (
            <>
              <p className="truncate text-sm font-medium text-fg">{music.title}</p>
              <p className="truncate text-xs text-muted">{music.artist}</p>
            </>
          ) : (
            <p className="text-sm text-fg">{t("Jam Spotify en cours")}</p>
          )}
          <p className="truncate text-2xs text-faint">
            {state.jam ? t("Jam lancée par {n}", { n: who(state.jamBy, null) }) : stale ? t("dernier morceau de {n}", { n: who(music?.by, music?.byNick) }) : t("{state} · écouté par {n}", { state: music?.playing ? t("en lecture") : t("en pause"), n: who(music?.by, music?.byNick) })}
          </p>
        </div>
        {state.jam ? (
          <Button size="sm" variant="secondary" icon={<Radio className="size-3.5" />} onClick={join} title={t("Ouvre la Jam dans Spotify")}>
            {t("Rejoindre")}
          </Button>
        ) : (
          !pasting && (
            <IconButton label={t("Lancer une Jam Spotify pour la table")} onClick={() => void fromClipboard()}>
              <Radio className="size-4" />
            </IconButton>
          )
        )}
        {canEnd && (
          <IconButton label={t("Terminer la Jam de la table")} onClick={() => onJam(null)}>
            <X className="size-3.5" />
          </IconButton>
        )}
      </div>
      {pasting && !state.jam && <JamPaste value={value} bad={bad} onChange={take} onCancel={() => (setPasting(false), setValue(""), setBad(false))} />}
    </div>
  );
}

function JamPaste({ value, bad, onChange, onCancel }: { value: string; bad: boolean; onChange: (v: string) => void; onCancel: () => void }) {
  return (
    <div className="anim-fade space-y-1">
      <div className="flex items-center gap-1.5">
        <Input autoFocus className={cn("h-8 text-xs", bad && "border-danger")} placeholder={t("Colle le lien de la Jam (Ctrl+V)")} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={bad} aria-label={t("Lien de la Jam Spotify")} />
        <IconButton label={t("Annuler")} onClick={onCancel}>
          <X className="size-3.5" />
        </IconButton>
      </div>
      {bad ? <p className="text-2xs text-danger">{t("Ce n'est pas un lien de Jam Spotify (open.spotify.com/socialsession/… ou spotify.link/…).")}</p> : <Hint className="text-2xs">{t("Dans Spotify : Démarrer une Jam → Inviter → Copier le lien.")}</Hint>}
    </div>
  );
}
