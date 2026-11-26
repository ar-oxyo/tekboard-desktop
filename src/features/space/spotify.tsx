// Linking a Spotify account, only to read what it is playing (for a TekSpace table). The
// person brings their own Spotify app (Client ID): TekBoard ships no shared key, the refresh
// token stays in the local secrets file, and nothing is ever played or controlled.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { api, asAppError } from "../../lib/api";
import { useUi } from "../../lib/store";
import { t } from "../../lib/i18n";
import { Badge, Button, Card, CardTitle, Input } from "../../components/ui";

const KEY = ["spotify-status"];

function useSpotify() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const status = useQuery({ queryKey: KEY, queryFn: api.spotifyStatus, staleTime: 30_000 });
  useEffect(() => {
    const un = listen<{ ok: boolean; error: string | null }>("spotify-linked", (e) => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast(e.payload.ok ? { kind: "ok", title: t("Compte Spotify relié") } : { kind: "error", title: "Spotify", detail: e.payload.error ?? t("Connexion interrompue") });
    });
    return () => void un.then((f) => f());
  }, [qc, toast]);
  return status;
}

function LinkForm({ clientId, redirectUri }: { clientId: string | null; redirectUri: string }) {
  const toast = useUi((s) => s.toast);
  const [id, setId] = useState(clientId ?? "");
  const [busy, setBusy] = useState(false);
  const link = async () => {
    setBusy(true);
    try {
      await api.spotifyLogin(id);
      toast({ kind: "info", title: t("Spotify s'ouvre dans ton navigateur"), detail: t("Accepte l'accès en lecture de ce que tu écoutes, puis reviens ici.") });
    } catch (e) {
      toast({ kind: "error", title: "Spotify", detail: asAppError(e).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted">{t("Crée une app sur developer.spotify.com (gratuit), ajoute l'adresse de redirection ci-dessous, puis colle son Client ID. Tant que l'app est en mode développement, seuls les comptes que tu y ajoutes peuvent se relier.")}</p>
      <p className="font-mono text-2xs text-faint select-all">{redirectUri}</p>
      <div className="flex gap-1.5">
        <Input className="h-8 font-mono text-xs" placeholder="Client ID" value={id} onChange={(e) => setId(e.target.value.trim())} aria-label={t("Client ID Spotify")} />
        <Button size="sm" busy={busy} disabled={!/^[0-9a-f]{32}$/i.test(id)} disabledReason={t("Le Client ID fait 32 caractères")} onClick={() => void link()}>
          {t("Relier")}
        </Button>
      </div>
    </div>
  );
}

/** Shown in a table panel when the Spotify source is chosen but no account is linked yet. */
export function SpotifyLink({ onGone }: { onGone: () => void }) {
  const status = useSpotify();
  if (!status.data || status.data.connected) return null;
  return (
    <div className="space-y-2 rounded-(--btn-radius) border border-line p-3">
      <p className="text-xs text-fg">{t("Relier ton compte Spotify")}</p>
      <LinkForm clientId={status.data.clientId} redirectUri={status.data.redirectUri} />
      <button type="button" className="text-2xs text-muted hover:text-fg" onClick={onGone}>
        {t("Utiliser plutôt le lecteur de cet ordinateur")}
      </button>
    </div>
  );
}

/** Settings → Outils: link or unlink the account. */
export function SpotifyCard() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const status = useSpotify();
  const s = status.data;
  return (
    <Card>
      <CardTitle right={s ? <Badge tone={s.connected ? "ok" : "neutral"}>{s.connected ? t("Relié") : t("Non relié")}</Badge> : null}>Spotify</CardTitle>
      <div className="space-y-3 px-4 py-3">
        <p className="text-xs text-muted">{t("Pour montrer à ta table TekSpace ce que tu écoutes sur ton compte, même depuis ton téléphone. Lecture seule : TekBoard ne lance ni ne contrôle aucune musique. Sans compte relié, le lecteur de cet ordinateur suffit.")}</p>
        {s && !s.connected && <LinkForm clientId={s.clientId} redirectUri={s.redirectUri} />}
        {s?.connected && (
          <Button size="sm" variant="ghost" onClick={() => void api.spotifyLogout().then(() => qc.invalidateQueries({ queryKey: KEY }), (e) => toast({ kind: "error", title: "Spotify", detail: asAppError(e).message }))}>
            {t("Délier le compte")}
          </Button>
        )}
      </div>
    </Card>
  );
}
