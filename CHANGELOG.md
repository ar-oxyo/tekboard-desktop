# Notes de version

Chaque version publiée a sa section ici ; la release GitHub reprend ce texte.

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
