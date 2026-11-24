# Sécurité

## Signaler une faille

N'ouvre pas de ticket public. Utilise **Security → Report a vulnerability** sur la page GitHub du dépôt (signalement privé). Décris ce que tu as observé et comment le reproduire ; une réponse arrive en général sous une semaine.

## Ce que Tekboard garde, et où

| Quoi | Où | Protection |
| --- | --- | --- |
| Réglages, projets suivis, planning, notes (SQLite) | `~/.local/share/dev.tekboard.app/tekboard.db` | dossier lisible par toi seul (700) |
| Session du site MY Epitech (cookies du navigateur intégré) | `~/.local/share/dev.tekboard.app/my-session/` | jamais exportée, effacée par « Effacer la session » |
| Jeton d'accès MY Epitech | mémoire uniquement | jamais écrit sur le disque ni dans les journaux |
| Fichiers temporaires | `~/.cache/dev.tekboard.app/` | vidable à tout moment |

Tekboard n'enregistre aucun mot de passe : la connexion Microsoft se fait sur le vrai site, l'accès GitHub passe par `gh` et SSH par ton agent.

## Mises à jour

Les paquets sont signés (minisign) dans le workflow de release ; la clé publique est intégrée à l'application (`plugins.updater.pubkey`, `src-tauri/tauri.conf.json`). Un paquet dont la signature ne correspond pas est refusé avant toute installation. Les fichiers de chaque release sont accompagnés de leurs empreintes (`SHA256SUMS`) et d'une attestation de provenance GitHub (`gh attestation verify <fichier> -R ar-oxyo/tekboard-desktop`).

La clé privée ne se trouve jamais dans le dépôt : elle est uniquement dans les secrets GitHub Actions du projet.
