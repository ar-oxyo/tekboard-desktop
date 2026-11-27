# Notes de version

Chaque version publiée a sa section ici ; la release GitHub reprend ce texte.

## 1.2.0

**Concentration**
- **Mode allégé** (Réglages → Apparence) : seul l'essentiel reste à l'écran. Explications en infobulle, actions secondaires sous « Plus », menus réorganisés (dépôt, Inbox, Playground), écrans Aujourd'hui, Projets, Planning, fiche projet et MY Epitech épurés. Rien n'est supprimé, la barre latérale ne change pas.
- **Taille de l'interface** de 80 à 150 %, appliquée par la fenêtre elle-même, avant son affichage.
- **Démarrage aux couleurs de ton ambiance** : logo, fond et icône, sans flash.

**Projets et planning**
- **Projet HUB** : un espace pour les projets HUB, de l'idée à la présentation (jalons, tâches du planning, temps travaillé, dépôt et activité, liens et fichiers, journal et décisions, pitch, checklist, synthèse exportable, équipe par Connect, objectif et estimations de crédits jamais présentées comme officielles).
- Un rendu d'école dépassé **clôt** le projet au lieu d'afficher des dizaines de jours de retard ; liste groupée (à rendre bientôt, en cours, à venir, clos récemment, anciens projets).
- **Planification groupée** : plusieurs tâches choisies, modifiées ensemble et placées en une fois, aperçu modifiable, annulation en un geste. Réglages du planning derrière une roue dentée.
- **Compte AER** à côté du compte Student ; agendas Student, AER ou les deux, sans doublon.

**Artix et TekSpace**
- Tableaux blancs : Artix suit un contrat strict (graphe, séquence, annotations), contrôlé et réparé automatiquement ; plus de Mermaid ni de fonctions inventées.
- TekSpace : Jam Spotify lancée d'un collage et rejointe en un clic, statut « En pause », invitations en cartes.

**Réglages**
- Onglets réorganisés (Général, Apparence, Comptes, Artix, Outils, Données, À propos).
- **Mode développeur** (sept appuis sur la version) : diagnostic local, journaux, rapport anonymisé ; Cozy Fox et les détails techniques de MY Epitech y sont rangés.

## 1.1.0

**École**
- **Skill Tree en galaxie** : chaque bloc de compétences est une constellation, chaque unité une étoile (taille selon ses crédits), ses acquis d'apprentissage et projets des satellites. On navigue par niveaux (galaxie → constellation → étoile) au clic, à la liste latérale, au fil d'Ariane ou au clavier (Échap pour revenir, ← → pour passer à la voisine). La molette fait défiler la page ; Ctrl + molette zoome.
- **Crédits justes** : MY Epitech n'attribue les crédits qu'en fin de semestre. Les unités entièrement validées sans note apparaissent maintenant en « Validés, note à venir » au lieu de compter pour 0, et les totaux de MY (obtenus, assurés, seuil) sont affichés tels quels, les mêmes dans Crédits et Skill Tree.
- Rapprochement barème ↔ MY Epitech beaucoup plus fiable (codes d'unité exacts, titres entiers, Piscine, HUB) ; tes scénarios existants en profitent sans rien refaire.
- **Plusieurs pistes de spécialisation**, choisies séparément pour le 1er et le 2e semestre. Ton ancien choix est repris pour les deux.
- Chaque unité d'enseignement est encadrée d'un fin filet pour mieux lire les groupes.
- Onglets d'École dans l'ordre Logtime, Crédits, Skill Tree, Sujets, MY Epitech.

**Labo**
- **Playground** : l'éditeur garde ses couleurs et sa mise en forme dans l'application installée ; barre d'outils sur deux lignes nettes ; la page défile au lieu d'écraser l'éditeur sur une fenêtre étroite.

**Fenêtre**
- Fermer la fenêtre masque TekBoard s'il reste en arrière-plan (icône de notification ou raccourci), et le quitte sinon.

## 1.0.0

**Nouveau design Riso**
- Interface redessinée, en clair et en sombre : quatre ambiances, barre latérale à une entrée par section, barre de page, moins de boîtes. Les anciens thèmes restent dans « Obsolètes ».
- Couleur d'accent personnelle (8 encres ou n'importe quelle couleur), ajustée pour rester lisible dans chaque mode ; l'icône de la fenêtre et de la zone de notification suit l'ambiance.
- **Aujourd'hui en widgets** : mode édition pour déplacer, redimensionner, ajouter ou retirer des blocs, sauvegarde automatique, « Disposition d'origine ». Ta disposition existante est reprise telle quelle. Nouveaux widgets : Crédits, Skill Tree, Inbox récente.

**École**
- **Simulateur de crédits** (École → Crédits) : barème PGE1 2026, résultats officiels, en attente et simulés toujours séparés, minimum par UE, scénarios enregistrés.
- **Skill Tree** : la molette zoome sur le pointeur au lieu de faire défiler la page, trackpad et clavier, « Tout afficher » ; nouvelle disposition en couloirs par bloc, sans croisements.
- **Synchro MY** plus claire : état, dernière synchro, échecs en clair ; réponses brutes et historique repliés. Données de plus d'un jour signalées (barre latérale en orange, une proposition par session) ; Artix connaît leur âge.
- **Stats** en trois sections (Rythme, Projets, Parcours), listes longues raccourcies et filtrables.

**Tests et Labo**
- **Moulinette TekBoard** : lit le sujet, propose un plan de tests sourcé (et ce que le sujet ne précise pas), génère des tests Criterion au format Epitech (en-tête, `Test(suite, fonction_comportement)`, sans libc ni calcul de l'attendu par la fonction testée), les lance dans le bac à sable, et montre les résultats sans jamais donner de solution. Relancer les échecs, récupérer les fichiers (aperçu, jamais d'écrasement).
- **Playground** : temps de make, de compilation et d'exécution séparés, code de retour, mémoire ; compilation incrémentale ; **comparaison A/B** (exécutions répétées, médiane, verdict prudent, diff du code).
- **Algorithm Arena** : le profilage ne bloque plus (budget borné, progression visible, annulation), hypothèses du projet séparées de celles des bibliothèques et dédoublonnées, générateurs de tests vérifiés avant d'être proposés.

**Planning et Artix**
- Horaires en 24 h partout, dates en JJ/MM/AAAA, journée de travail qui peut finir après minuit (Artix le comprend). Bandes hors horaires lisibles en sombre.
- My Week : une conversation par semaine, propositions compactes groupées par jour, plus de doublons.
- Artix répond plus court et va à l'action, quel que soit le fournisseur.

**Connect**
- **TekSpace** : panneau de table resserré (Focus, Musique, Tableau), discussion de table éphémère, réactions, table favorite, focus et musique affichés sur la carte ; 24 avatars prédéfinis, aussi dans le profil Connect.
- **Musique partagée** : ce que joue le lecteur de l'ordinateur (MPRIS) ou ton compte Spotify (connexion avec ton propre Client ID, lecture seule). Jamais présentée comme une écoute synchronisée ; la Jam Spotify reste le moyen d'écouter ensemble.
- **Modération** locale des pseudos et textes publics : propos haineux, menaces et harcèlement refusés, gros mots ordinaires acceptés, rien n'est envoyé à un service tiers.
- **TekLive** : adresse `ws://` affichée et copiée au démarrage, choix du réseau, port 8765 avec repli.

**Divers**
- Miniatures des tableaux blancs sur fond anthracite.
- Boutons désactivés qui disent pourquoi ; derniers textes anglais traduits.

## 0.9.0

**Brain Dump** (Ctrl+I, l'Inbox de la barre latérale, la palette, la fiche projet)
- La capture rapide devient un vrai espace pour vider sa tête : on écrit, on valide, on reprend son travail. Rien à choisir (ni titre, ni catégorie, ni projet) : le type (idée, bug, amélioration, question, code, commande, lien, tâche, à retenir, image) et les `#tags` sont trouvés par des règles locales, sans IA.
- Texte sur plusieurs lignes avec un Markdown léger (blocs de code, listes, liens), images collées ou déposées, brouillon gardé à chaque frappe. Entrée enregistre (une nouvelle ligne dans un bloc de code), Maj+Entrée ajoute une ligne, Ctrl+Entrée enregistre et garde la fenêtre ouverte, Échap ferme sans rien perdre.
- Fenêtre de capture flottante, ouverte depuis n'importe où : raccourci global sous X11 (Ctrl+Alt+Espace par défaut, réglable), commande `tekboard capture` à associer à un raccourci du système sous Wayland, action « Capture rapide » du lanceur d'applications, icône facultative dans la zone de notification. Un seul TekBoard tourne à la fois : un second lancement passe la main au premier.
- **Inbox** discrète, sans nouvel onglet : associer à un projet, transformer en tâche (elle rejoint le Planning), garder comme note ou snippet, épingler, archiver, supprimer (avec annulation), partager via TekShare, ouvrir le code dans le Playground, ouvrir les liens.
- Suggestions sans IA : projet nommé dans le texte (« … dans organized … » propose une tâche du projet Organized), conversion évidente, idées proches déjà notées. Artix peut aussi proposer titre, projet, tags, reformulation ou regroupement, uniquement quand tu le demandes ; rien n'est appliqué sans ton clic.
- Recherche plein texte (SQLite FTS5, sans accents, par préfixe) dans l'Inbox et la palette : mots, `#tag`, `projet:nom`, `type:bug`, `date:AAAA-MM-JJ`, `aujourd'hui`, `hier`.
- TekShare : une note ou un snippet reçu peut aller directement dans ton Inbox.
- Les captures restent des lignes de la table des tâches : une conversion ne copie rien, et le Planning ne voit ni les notes, ni les snippets, ni les captures archivées.

## 0.8.0

**Code Playground** (Labo → Playground, ou « Nouveau brouillon C » dans la palette)
- Écrire quelques lignes de C et les lancer tout de suite, sans projet, sans dépôt ni Makefile : éditeur avec coloration, numéros de ligne, autocomplétion légère (mots-clés, libc, identifiants du brouillon), plusieurs onglets et plusieurs fichiers par brouillon, sauvegarde automatique.
- Compiler et lancer en un clic ou avec Ctrl+Entrée ; choix de gcc, clang ou epiclang selon ce qui est installé, options de compilation, arguments et entrée standard du programme.
- Erreurs et avertissements du compilateur et de l'édition de liens listés, soulignés dans le code et cliquables ; stdout et stderr séparés.
- AddressSanitizer, UndefinedBehaviorSanitizer et Valgrind en un clic : chaque problème mémoire est lu (type, octets, pile d'appels) et renvoie à la ligne en cause.
- Chaque exécution est isolée dans le bac à sable (bubblewrap : pas de réseau, système en lecture seule, environnement vidé), annulable, et limitée en temps, en mémoire et en nombre de processus (cgroup systemd quand c'est possible).
- Historique des brouillons fermés et des exécutions, avec restauration du code d'une exécution passée.
- Import de fonctions depuis les bibliothèques de TekBoard (avec leurs dépendances), export d'un brouillon en vrai projet (Makefile, .gitignore, git init facultatif).
- Artix, sur demande seulement : expliquer une erreur, le comportement ou les problèmes mémoire, proposer des cas limites ou un petit environnement de test, suggérer une correction sans l'appliquer, expliquer une notion.
- Doctor : nouvelle catégorie Labo (bac à sable, limites mémoire, clang, perf, python3, outils de Valgrind).

**Algorithm Arena** (Labo → Arena)
- Mesure un projet, une branche ou un commit d'un projet, ou un brouillon du Playground, sur des données de taille croissante : temps réel, temps CPU et mémoire maximale (outil de mesure à la microseconde), plusieurs exécutions avec échauffement, médiane, écart robuste et exécutions atypiques signalées.
- Compare deux versions (deux branches, deux commits, le dossier de travail et un commit, deux brouillons) sur exactement les mêmes données, sans modifier ton dossier ni ton dépôt : chaque version est copiée (git archive pour une révision) et construite à part.
- Générateurs de données en Python ou en C (`gen N SEED SORTIE`), graines reproductibles, aperçu des données utilisées.
- Avec Valgrind : instructions comptées à chaque taille (Callgrind), fonctions les plus coûteuses, pic du tas (Massif) et nombre d'allocations (Memcheck). Sans Valgrind, ces mesures sont signalées comme absentes, jamais estimées.
- Complexité estimée expérimentalement (moindres carrés sur 1, log n, n, n log n, n², n³, 2ⁿ) avec un niveau de confiance explicite ; « indéterminée » quand les mesures ne permettent pas de conclure.
- Graphiques interactifs (temps, CPU, mémoire, instructions, échelles logarithmiques), tableau des résultats, historique et benchmarks enregistrés.
- Lecture du code sans IA : boucles imbriquées, allocations ou entrées/sorties dans une boucle, `strlen` dans une condition, récursion multiple, tris quadratiques — présentées comme des hypothèses, distinctes des mesures.
- Artix, sur demande : écrit les générateurs et scénarios en direct (chaque fichier apparaît dès qu'il est complet, rien n'est exécuté avant ton accord), puis rédige le rapport final à partir des seules mesures (ce qui ralentit, preuves, limites, optimisations, compromis), sans toucher au code.

**TekBoard Connect** (Connect → Personnes) — facultatif, désactivé par défaut
- Retrouve les autres TekBoard du même réseau local qui ont activé Connect, par découverte mDNS / DNS-SD : pseudonyme, avatar et statut (disponible, en train de coder, en session de travail, disponible pour aider, ne pas déranger, invisible).
- Connexions directes chiffrées en TLS 1.3 mutuel, chaque appareil étant identifié par l'empreinte de son certificat ; aucun serveur, aucun compte, rien ne passe par Internet.
- Première connexion à deux : les deux écrans affichent le même code à 6 chiffres à comparer avant d'accepter ; l'empreinte est ensuite épinglée et la reconnexion est automatique.
- Contacts de confiance, blocage, oubli ; messages limités en taille et en débit ; un appareil non appairé ne peut rien envoyer d'autre qu'une demande.
- Code d'invitation (`tb1:…`) et connexion par adresse quand la découverte ne marche pas, diagnostic réseau en clair (interface, mDNS, test d'une adresse) : quand le réseau de l'école isole les appareils, TekBoard l'explique sans chercher à le contourner (pas de scan, pas de relais, aucune modification du pare-feu).
- Doctor : catégorie Connect.

**TekShare** (avec TekBoard Connect)
- Partage direct, entre personnes appairées, de fichiers, dossiers, extraits de code, fonctions C des bibliothèques, bibliothèques, modèles, prompts d'Artix, jeux de tests, benchmarks de l'Arena, journaux, messages d'erreur, patches Git, notes, brouillons du Playground et réglages d'apparence. « Partager » se trouve là où sont ces ressources (Playground, Arena, bibliothèques, modèles, prompts, rapport de tests, menu des projets) et dans Connect.
- Le destinataire voit l'expéditeur, le type, un aperçu et la taille, puis accepte ou refuse ; rien n'arrive sans son accord. Historique des transferts, progression, annulation.
- TekShare comprend ce qu'il reçoit et propose la bonne destination : une fonction dans les bibliothèques ou le Playground, un brouillon dans le Playground, un modèle dans les modèles, un prompt dans les prompts, des tests dans un projet, un benchmark dans l'Arena, un patch vérifié (`git apply --check`) puis appliqué sur demande, un journal ou une erreur à Artix, le reste dans Téléchargements.
- Sécurité : secrets (clés, jetons, cookies) et fichiers sensibles bloqués à l'envoi, avertissement sur les règles pédagogiques pour le code d'un projet de l'école et refus d'envoyer un dépôt d'école entier ; à l'arrivée, quarantaine, vérification de la taille et de l'empreinte SHA-256, extraction refusant chemins absolus, `..`, liens et archives piégées ; rien n'est jamais exécuté ni écrasé ; offres et débit limités.

**TekLive** (Connect → TekLive, ou « Collaborer » dans le menu d'un projet) — coder à plusieurs avec P2P Live Share
- TekBoard lance lui-même un relais WebSocket compatible avec l'extension P2P Live Share (kermanx.p2p-live-share 0.1.4, version testée), sur le réseau local : plus besoin de Node.js, de Bun, ni de chercher son adresse IP.
- Il ouvre le projet dans VS Code, où sa petite extension « TekBoard Bridge » (fournie, installée après confirmation) place ce relais en tête des serveurs et ouvre la liste de l'extension : il suffit d'appuyer sur Entrée. TekBoard voit alors la session s'ouvrir et affiche le vrai lien d'invitation.
- Invitation directe des contacts TekBoard : ils voient l'hôte et, si tu l'autorises, le nom du projet ; ils acceptent et VS Code rejoint la session tout seul (`code --folder-uri`), après installation de l'extension si besoin.
- Suivi de la session : état, durée, invités connectés, invitations envoyées, connexions refusées ; arrêt propre (le relais s'arrête avec la session et avec TekBoard).
- Par défaut, seules les adresses des contacts TekBoard peuvent rejoindre. P2P Live Share n'a pas de droits par participant (un invité peut modifier les fichiers) : TekBoard le dit clairement. Terminal et ports ne sont partagés que si l'hôte le fait lui-même. Aucun accès Internet, aucune modification du pare-feu.
- Doctor : catégorie TekLive (VS Code, extension, passerelle).

**TekSpace** (Connect → TekSpace) — facultatif, désactivable
- Un petit campus en pixel art, dessiné par TekBoard (aucune image externe) : coworking, bibliothèque, café, salle de concentration, deux salles de réunion, plantes, canapés, ordinateurs.
- Un personnage personnalisable (peau, coiffure, couleurs, tenue, accessoire), visible aussi dans Connect ; déplacement avec ZQSD, WASD ou les flèches, ou d'un clic (chemin calculé), collisions, pseudonyme et statut au-dessus de chacun.
- Un espace s'héberge dans ton TekBoard et se rejoint depuis la liste des espaces ouverts par tes contacts, ou sur invitation ; l'hôte fait autorité (pas de traversée de murs ni de téléportation), positions synchronisées et interpolées, départs et pertes de connexion gérés, versions incompatibles refusées avec un message.
- Des tables où l'on s'assoit : sujet ou projet, accès ouvert ou réservé à un groupe, objectifs partagés volontairement, concentration à plusieurs (minuteur et pauses synchronisés, « Ne pas déranger » facultatif pendant le travail), ressources épinglées, partage TekShare avec la table, invitation de la table dans sa session TekLive.
- Ambiances sonores générées en direct (pluie, café, cheminée, forêt, bibliothèque, bruit brun), communes à la table, avec volume et coupure propres à chacun ; lien d'invitation Spotify Jam facultatif (seuls les liens Jam s'ouvrent, aucun son ne passe par TekBoard).
- Léger : chargé seulement à l'ouverture, campus statique dessiné une fois, image redessinée seulement quand quelque chose bouge (30 i/s au plus), rien n'est dessiné quand la page est masquée. Aucun micro, aucune caméra, aucune surveillance de ce que tu fais ailleurs.

**Tableau blanc** (Labo → Tableaux, onglet Tableaux de la fiche projet, tables de TekSpace)
- Dessin à main levée, formes, flèches, texte, images, notes, grille et aimantation (Excalidraw, chargé seulement à l'ouverture d'un tableau ; polices fournies par TekBoard, rien n'est téléchargé).
- Formes pour expliquer du code, générées à partir de quelques valeurs : tableau C, structure, pointeur, pile et tas, liste chaînée, arbre binaire, graphe, pile, file, classe UML, organigramme, client-serveur, dépendances entre fonctions. Les flèches restent attachées aux formes quand on les déplace.
- Blocs de code C colorés comme dans l'éditeur, dont le code reste modifiable.
- Tableaux enregistrés automatiquement dans TekBoard (jamais dans le dépôt Git sauf export voulu) : renommer, dupliquer, épingler, trier, chercher par nom ou par texte, miniatures, historique de versions avec restauration, rattachement à un projet (onglet Tableaux de la fiche).
- Export PNG, SVG, PDF et `.tekboard-board` (réimportable, comme les fichiers `.excalidraw`), ou copie dans `docs/boards/` d'un projet. Partage par TekShare.
- Dessiner à plusieurs avec ses contacts TekBoard Connect : changements envoyés élément par élément, curseurs colorés et nommés, droits « peut dessiner » ou « lecture seule » vérifiés par l'hôte, arrivées, départs et reconnexion, annulation propre à chacun, mode présentation (suivre la vue de quelqu'un). À une table de TekSpace, un tableau s'ouvre pour la table et les personnes assises le rejoignent.
- Artix, sur demande : expliquer le tableau, générer un diagramme (organigramme, architecture, structure de données) ou annoter ce qui est dessiné. La proposition arrive en aperçu sélectionné, à garder ou annuler, et Ctrl+Z l'enlève d'un coup ; elle n'est envoyée aux autres qu'une fois gardée.

## 0.7.0

**Choisir son IA** (Réglages → Artix (IA), et au premier lancement)
- Trois fournisseurs au choix, ou aucun : Claude Code, OpenRouter (clé API gratuite, modèles gratuits recommandés, test de connexion) et une IA locale avec Ollama (modèles installés détectés, modèle recommandé selon la mémoire de l'ordinateur, téléchargement guidé).
- OpenRouter n'utilise jamais un modèle payant sans accord explicite : le prix du modèle est revérifié avant chaque requête, et aucun modèle de secours n'est envoyé.
- La clé OpenRouter est gardée à part, dans un fichier lisible par toi seul ; elle n'est jamais renvoyée à l'interface ni écrite dans les journaux.
- Chat, planning, lecture des sujets, analyse de projet et README fonctionnent avec les trois. La moulinette d'Artix et la génération de tests restent réservées à Claude Code, et l'interface le dit.
- Sans IA, chaque écran concerné l'indique et renvoie vers les réglages ; le reste de TekBoard fonctionne normalement.
- Une installation 0.6 garde Claude Code comme IA.

**Installation**
- `install.sh` : installation guidée en une commande (Ubuntu/Debian, Fedora, Arch), qui détecte ce qui est déjà là, installe TekBoard après vérification SHA-256, propose les outils optionnels (gh, epiclang et Banana depuis le PPA d'Epitech, valgrind, bubblewrap…), aide à `gh auth login` et peut être relancée sans risque. Options `--minimal`, `--dry-run`, `--dev`, `--uninstall`.

**TekBoard Doctor** (Réglages → Doctor)
- Vérifie les outils, GitHub, MY Epitech, l'IA, epiclang, la base de données, les permissions, les dossiers de projets et les mises à jour, avec un état clair, ce que chaque problème affecte et comment le résoudre.
- Réparations sans risque (permissions, sauvegarde puis optimisation de la base, retrait d'un dossier disparu après confirmation) et export d'un rapport anonymisé pour un ticket.
- Proposé au démarrage quand un problème bloquant est détecté, et montré pendant le premier lancement.

**Skill Tree** (École → Skill Tree)
- Ta progression en arbre interactif (zoom, déplacement, fiche détaillée) : blocs de compétences, unités, acquis d'apprentissage et projets, reliés par les relations officielles de MY Epitech.
- Crédits obtenus face à l'objectif, crédits assurés et atteignables, unités restant à valider, derniers jalons datés ; filtres par année, semestre, domaine et statut ; consultable hors ligne.
- Le domaine d'une unité (programmation, système…) est la seule déduction de TekBoard, toujours signalée comme estimation.

**Projets**
- Détection des dépôts dans les sous-dossiers jusqu'à 8 niveaux, y compris dans un dossier lui-même versionné ; les sous-modules, les `.git` vides, `node_modules` et les caches sont ignorés ; les liens symboliques sont suivis sans boucle ni doublon.
- Un dépôt déjà cloné ailleurs dans tes dossiers n'est plus recloné.

## 0.6.1

- Nouveau logo, sombre comme l'application : un T violet dans un anneau de progression, repris dans l'icône, la barre latérale et l'écran de lancement (l'anneau se remplit au démarrage).
- Le README et l'assistant de premier lancement précisent que TekBoard est un projet personnel et indépendant, sans lien avec Epitech.

## 0.6.0

Première version publique.

**Installation et premier lancement**
- Paquets `.deb` (Ubuntu, Debian) et AppImage (autres distributions) attachés à chaque release, signés.
- Écran de lancement discret, qui disparaît dès que l'application est prête.
- Assistant de premier lancement : langue et apparence, connexion MY Epitech, dossiers de projets. Chaque étape facultative se passe ; il reprend où tu l'as laissé et se relance depuis Réglages → Général.

**Mises à jour et données**
- Réglages → Mises à jour : version installée, recherche de la dernière release, notes, installation en un clic (AppImage sans mot de passe, `.deb` par la demande de mot de passe du système), vérification automatique quotidienne désactivable.
- Réglages → Données : emplacement des fichiers, export et restauration d'une sauvegarde, vidage du cache, réinitialisation des réglages ou de tout Tekboard. Les dépôts ne sont jamais touchés.
- Démarrage robuste : base illisible mise de côté, réglages abîmés réparés, base d'une version plus récente laissée intacte.

**Artix** (anciennement Tika)
- Nouveau nom, petit robot animé (attente, réflexion, action, succès, erreur).
- Comprend les demandes implicites (« RDV jeudi 14 h » crée l'événement), demande seulement ce qui manque, confirme ce qui est destructif. Réponses beaucoup plus courtes.
- Une action lancée depuis un écran (décomposer, planifier) ouvre sa propre conversation.
- Décomposition séparée de la planification : « Accepter » ou « Accepter et planifier ».

**École**
- Logtime : heures restantes sur les 30 h de la semaine, progression, jours, semaines précédentes.
- Sync MY Epitech en un bouton : ouvre MY si besoin, attend la connexion, synchronise, referme la fenêtre qu'il a ouverte.
- Sujets associés automatiquement aux projets (identifiant MY, puis nom exact) ; les cas incertains demandent une validation.

**Projets et calendrier**
- Masquer, archiver, restaurer un projet ; les copies d'un même dépôt sont signalées.
- Projets exclus du calendrier (par exemple Student Engagement) ; catégories d'événements personnalisées.
- Option « Epitech Projects Only », activée par défaut.
- Interface en français ou en anglais.

**Corrections**
- Listes déroulantes de nouveau cliquables à la souris.
- Les fenêtres et dialogues ne glissent plus depuis le coin de l'écran à l'ouverture.
- Onglet Library retiré de la fiche projet ; « Tout sélectionner » dans Bibliothèques.
