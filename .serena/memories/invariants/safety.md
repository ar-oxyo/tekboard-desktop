# Invariants de sécurité et de confiance

Les violer = régression grave, même si les tests passent.
- Webview : capabilities limitées à `core:default`, déplacement de fenêtre et dialogues ouvrir/enregistrer (`capabilities/default.json`) ; ne pas en ajouter sans raison forte. Aucun accès shell/fs/HTTP côté JS ; tout passe par les commandes. CSP stricte (`tauri.conf.json`) : pas d'URL externe, images `data:`/`blob:` seulement.
- Tout chemin reçu de l'UI est résolu et contrôlé : `commands::project_dir` / `repo_dir` / `repo_dir_of` (hors racines configurées → refus). Écriture dans un projet seulement après plan/aperçu (modèles, bibliothèques, README avec hash du contenu affiché), avec sauvegarde des fichiers remplacés.
- Jamais de shell : commandes configurées découpées par `jobs::argv_of`, commandes tapées par `jobs::split_command` (syntaxe shell refusée sauf entre guillemets). Lancement de binaire via script enveloppe à paramètres positionnels (`runner.rs`).
- Git : aucune opération destructrice (pas de reset/force/clean/suppression de branche) ni dans l'UI ni dans le backend ; pull en ff-only, push sur confirmation.
- IA : tout passe par `ai::runner::run` ; Claude Code en `--restricted`, outils explicites, jamais `Bash` ; commandes d'agent dans bubblewrap (`ai::sandbox`) sans réseau et SANS repli non isolé. Fournisseurs non-Claude : lecture seule (`ai_needs_claude`). Actions d'Artix : lecture / réversible journalisée / proposition à approuver.
- Secrets : clés API dans `secrets.json` (0600), jamais dans le blob settings envoyé à la fenêtre ; `secrets::scrub` sur erreurs/rapports ; jeton MY Epitech en mémoire seulement ; fenêtre `my-epitech` sans capability.
- MY Epitech : GET uniquement, espacés (500 ms) ; ne pas synchroniser les routes qui exposent toute la promo.
- Données : jamais d'invention (dates de rendu tapées ou rapportées, jamais déduites ; absence dite, pas comptée zéro) ; pas de faux boutons. Dossiers de données/cache en 0700.
- Connect/TekShare : désactivé par défaut, TLS mutuel à empreinte épinglée, rien n'est exécuté à la réception, quarantaine + contrôles d'archive.
- Moulinette TekBoard : résultats, jamais de solution (prompts et UI) ; tests Criterion refusés s'ils appellent la libc ou calculent l'attendu avec la fonction testée ; rien n'est écrit dans le projet sans aperçu, jamais d'écrasement.
- Modération (pseudos, discussion, sujets, objectifs, épingles, musique) : vérifiée côté client ET sur l'hôte TekSpace / la Connect Rust ; aucune donnée envoyée à un service tiers ; mots entiers seulement (pas de sous-chaîne).
- Musique : lecture seule (MPRIS, ou Spotify avec les scopes de lecture), jeton de rafraîchissement dans `secrets.json`, Client ID fourni par l'utilisateur, relevé seulement pendant un partage ; jamais présentée comme une écoute synchronisée. Pochettes : `i.scdn.co` ou fichier image local du dossier personnel, passées en `data:`.
