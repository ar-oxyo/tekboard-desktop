#!/usr/bin/env bash
# TekBoard: installation guidée.
#
#   curl -fsSL https://raw.githubusercontent.com/ar-oxyo/tekboard-desktop/main/install.sh | bash
#   ./install.sh                 depuis un clone du dépôt
#
# Options :
#   --yes          répond oui aux questions (outils optionnels compris)
#   --minimal      seulement TekBoard et ce qui lui est obligatoire
#   --dry-run      montre ce qui serait fait, sans rien installer
#   --dev          compile TekBoard depuis ce clone (Rust, Node.js, bibliothèques de Tauri)
#   --uninstall    désinstalle TekBoard (tes données sont gardées, sauf si tu demandes le contraire)
#
# Le script peut être relancé autant de fois que tu veux : un outil qui fonctionne déjà n'est
# jamais réinstallé. Rien n'est installé avec sudo sans le dire d'abord.
set -euo pipefail

REPO="ar-oxyo/tekboard-desktop"
APP_ID="dev.tekboard.app"
DEB_PACKAGE="tek-board"

YES=0 MINIMAL=0 DRY=0 DEV=0 UNINSTALL=0
for arg in "$@"; do
    case "$arg" in
        --yes|-y) YES=1 ;;
        --minimal) MINIMAL=1 ;;
        --dry-run) DRY=1 ;;
        --dev) DEV=1 ;;
        --uninstall) UNINSTALL=1 ;;
        --help|-h) sed -n '2,16p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) printf 'Option inconnue : %s (voir --help)\n' "$arg" >&2; exit 2 ;;
    esac
done

# ───────────────────────────── affichage ─────────────────────────────

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
    B=$'\033[1m' DIM=$'\033[2m' G=$'\033[32m' Y=$'\033[33m' R=$'\033[31m' C=$'\033[36m' N=$'\033[0m'
else
    B="" DIM="" G="" Y="" R="" C="" N=""
fi
STEP="démarrage"
step() { STEP="$1"; printf '\n%s── %s%s\n' "$B" "$1" "$N"; }
ok() { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
info() { printf '  %s·%s %s\n' "$DIM" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
fail() { printf '  %s✗%s %s\n' "$R" "$N" "$*"; }
cmd() { printf '      %s%s%s\n' "$C" "$*" "$N"; }

SUMMARY=()
note() { SUMMARY+=("$1|$2|$3"); } # état|outil|détail

on_error() {
    local code=$? line=$1 command=$2
    printf '\n%s✗ Erreur pendant « %s »%s\n' "$R" "$STEP" "$N" >&2
    printf '  La commande %s%s%s a échoué (code %s, ligne %s).\n' "$C" "$command" "$N" "$code" "$line" >&2
    printf "  Rien de ce qui était déjà installé n’a été retiré. Corrige le problème indiqué au-dessus,\n  puis relance le script : il reprend là où il s’est arrêté.\n" >&2
    printf "  Besoin d’aide ? https://github.com/%s/issues (joins la sortie ci-dessus).\n" "$REPO" >&2
    exit "$code"
}
trap 'on_error $LINENO "$BASH_COMMAND"' ERR

# Questions : lues sur le terminal, même quand le script arrive par `curl | bash`.
TTY=""
if [[ -r /dev/tty ]] && (: </dev/tty) 2>/dev/null; then TTY=/dev/tty; fi
ask() { # ask "question" défaut(o/n)
    local q=$1 def=${2:-o} a
    if ((YES)); then return 0; fi
    # Sans terminal (CI, redirection) : rien d'optionnel sans --yes.
    if [[ -z "$TTY" ]]; then return 1; fi
    local hint="[O/n]"; [[ "$def" == n ]] && hint="[o/N]"
    printf '  %s?%s %s %s ' "$Y" "$N" "$q" "$hint" >"$TTY"
    read -r a <"$TTY" || a=""
    a=${a:-$def}
    [[ "$a" == [oOyY]* ]]
}

have() { command -v "$1" >/dev/null 2>&1; }

# Exécution (ou simulation) d'une commande qui modifie le système.
run() {
    if ((DRY)); then cmd "[simulation] $*"; return 0; fi
    "$@"
}
SUDO=""
as_root() {
    if ((DRY)); then cmd "[simulation] ${SUDO:+$SUDO }$*"; return 0; fi
    ${SUDO:+$SUDO} "$@"
}

# ───────────────────────────── système ─────────────────────────────

detect_system() {
    step "Ton système"
    local os arch
    os=$(uname -s)
    arch=${TEKBOARD_ARCH:-$(uname -m)}
    case "$os" in
        Linux) ;;
        Darwin) fail "macOS n'est pas pris en charge : TekBoard n'existe que pour Linux pour l'instant."; exit 1 ;;
        MINGW*|MSYS*|CYGWIN*) fail "Windows n'est pas pris en charge. Avec WSL 2 (Ubuntu), relance ce script dans WSL."; exit 1 ;;
        *) fail "Système $os non pris en charge : TekBoard n'existe que pour Linux."; exit 1 ;;
    esac
    if [[ "$arch" != x86_64 ]]; then
        fail "Processeur $arch : TekBoard n'est publié que pour x86_64 (Intel/AMD 64 bits)."
        info "Tu peux le compiler toi-même depuis un clone : ./install.sh --dev"
        ((DEV)) || exit 1
    fi
    local release=${TEKBOARD_OS_RELEASE:-/etc/os-release}
    DISTRO_ID="" DISTRO_LIKE="" DISTRO_NAME="Linux"
    if [[ -r "$release" ]]; then
        # shellcheck source=/dev/null
        DISTRO_ID=$(. "$release"; echo "${ID:-}")
        # shellcheck source=/dev/null
        DISTRO_LIKE=$(. "$release"; echo "${ID_LIKE:-}")
        # shellcheck source=/dev/null
        DISTRO_NAME=$(. "$release"; echo "${PRETTY_NAME:-${NAME:-Linux}}")
    fi
    PM=""
    if have apt-get; then PM=apt; elif have dnf; then PM=dnf; elif have pacman; then PM=pacman; elif have zypper; then PM=zypper; fi
    ok "$DISTRO_NAME · $arch · gestionnaire de paquets : ${PM:-aucun reconnu}"
    if [[ -z "$PM" ]]; then
        warn "Aucun gestionnaire de paquets connu (apt, dnf, pacman). Le script installera l'AppImage et te dira quoi installer à la main."
    elif [[ "$PM" == zypper ]]; then
        warn "openSUSE : pas d'installation automatique des paquets ; le script dira quoi installer avec zypper."
    fi
    if [[ $(id -u) -eq 0 ]]; then
        SUDO=""
    elif have sudo; then
        SUDO=sudo
    else
        SUDO=""
        warn "sudo est absent : les paquets système ne pourront pas être installés par le script (il te dira lesquels)."
    fi
}

is_ubuntu() { [[ "$DISTRO_ID" == ubuntu || " $DISTRO_LIKE " == *" ubuntu "* ]]; }

# Nom du paquet d'un outil selon la distribution ("-" : pas de paquet).
pkg_for() {
    local tool=$1
    case "$PM:$tool" in
        apt:git) echo git ;; dnf:git) echo git ;; pacman:git) echo git ;;
        apt:ssh) echo openssh-client ;; dnf:ssh) echo openssh-clients ;; pacman:ssh) echo openssh ;;
        apt:make) echo make ;; dnf:make) echo make ;; pacman:make) echo make ;;
        apt:curl) echo curl ;; dnf:curl) echo curl ;; pacman:curl) echo curl ;;
        apt:gh) echo gh ;; dnf:gh) echo gh ;; pacman:gh) echo github-cli ;;
        apt:gcc) echo gcc ;; dnf:gcc) echo gcc ;; pacman:gcc) echo gcc ;;
        apt:valgrind) echo valgrind ;; dnf:valgrind) echo valgrind ;; pacman:valgrind) echo valgrind ;;
        apt:gdb) echo gdb ;; dnf:gdb) echo gdb ;; pacman:gdb) echo gdb ;;
        apt:gcovr) echo gcovr ;; dnf:gcovr) echo gcovr ;; pacman:gcovr) echo - ;;
        apt:pdftotext) echo poppler-utils ;; dnf:pdftotext) echo poppler-utils ;; pacman:pdftotext) echo poppler ;;
        apt:bwrap) echo bubblewrap ;; dnf:bwrap) echo bubblewrap ;; pacman:bwrap) echo bubblewrap ;;
        apt:webkit) echo libwebkit2gtk-4.1-0 ;; dnf:webkit) echo webkit2gtk4.1 ;; pacman:webkit) echo webkit2gtk-4.1 ;;
        apt:fuse) if apt_known libfuse2t64; then echo libfuse2t64; else echo libfuse2; fi ;;
        dnf:fuse) echo fuse-libs ;; pacman:fuse) echo fuse2 ;;
        zypper:*) echo "$tool" ;;
        *) echo - ;;
    esac
}

apt_known() { apt-cache show "$1" >/dev/null 2>&1; }

pkg_installed() {
    case "$PM" in
        apt) dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed" ;;
        dnf) rpm -q "$1" >/dev/null 2>&1 ;;
        pacman) pacman -Q "$1" >/dev/null 2>&1 ;;
        *) return 1 ;;
    esac
}

APT_UPDATED=0
pkg_install() { # pkg_install paquet...
    if [[ -z "$PM" || "$PM" == zypper ]]; then return 1; fi
    if [[ -z "$SUDO" && $(id -u) -ne 0 ]]; then return 1; fi
    case "$PM" in
        apt)
            if ((!APT_UPDATED)); then as_root apt-get update -qq; APT_UPDATED=1; fi
            as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" ;;
        dnf) as_root dnf install -y -q "$@" ;;
        pacman) as_root pacman -S --needed --noconfirm "$@" ;;
    esac
}

manual_hint() { # what to type when the script cannot install it
    local pkg=$1
    case "$PM" in
        apt) cmd "sudo apt install $pkg" ;;
        dnf) cmd "sudo dnf install $pkg" ;;
        pacman) cmd "sudo pacman -S $pkg" ;;
        zypper) cmd "sudo zypper install $pkg" ;;
        *) info "Installe « $pkg » avec le gestionnaire de paquets de ta distribution." ;;
    esac
}

# ensure_tool outil commande niveau(requis|optionnel) "pourquoi" "fonctions concernées"
ensure_tool() {
    local tool=$1 bin=$2 level=$3 why=$4 features=$5 pkg
    if have "$bin"; then
        ok "$tool : déjà présent"
        note ok "$tool" "déjà présent"
        return 0
    fi
    pkg=$(pkg_for "$tool")
    if [[ "$pkg" == - ]]; then
        warn "$tool absent ($why). Pas de paquet connu pour ta distribution : installe-le à la main."
        info "Concerne : $features"
        if [[ "$level" == requis ]]; then note err "$tool" "absent : $features"; return 1; fi
        note warn "$tool" "absent, à installer à la main"
        return 0
    fi
    if [[ "$level" == optionnel ]] && ((MINIMAL)); then
        info "$tool absent (optionnel, ignoré avec --minimal) — $features"
        note skip "$tool" "ignoré (--minimal)"
        return 0
    fi
    local q="Installer $tool ($why) ?"
    if [[ "$level" == requis ]] || ask "$q" o; then
        if pkg_install "$pkg"; then
            if ((DRY)) || have "$bin"; then
                ok "$tool : installé"
                note ok "$tool" "installé"
                return 0
            fi
        fi
        fail "$tool n'a pas pu être installé. Pour le faire toi-même :"
        manual_hint "$pkg"
        info "Concerne : $features"
        note "$([[ $level == requis ]] && echo err || echo warn)" "$tool" "absent : $features"
        [[ "$level" == requis ]] && return 1
        return 0
    fi
    info "$tool non installé. Concerne : $features"
    note skip "$tool" "non installé (tu as choisi plus tard)"
}

# ───────────────────────────── TekBoard ─────────────────────────────

latest_version() {
    if [[ -n "${TEKBOARD_LATEST_VERSION:-}" ]]; then echo "$TEKBOARD_LATEST_VERSION"; return; fi
    local url
    url=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest") || return 1
    echo "${url##*/v}"
}

installed_version() {
    if [[ "$PM" == apt ]] && pkg_installed "$DEB_PACKAGE"; then
        dpkg-query -W -f='${Version}' "$DEB_PACKAGE"
        return
    fi
    local f="$HOME/.local/share/tekboard/installed-version"
    [[ -r "$f" ]] && cat "$f"
}

download() { # download nom fichier_de_sortie
    local name=$1 out=$2 base="https://github.com/$REPO/releases/download/v$VERSION"
    run curl -fSL --progress-bar -o "$out" "$base/$name"
}

verify_sha() { # verify_sha dossier nom
    local dir=$1 name=$2
    ((DRY)) && { cmd "[simulation] sha256sum -c ($name)"; return 0; }
    (cd "$dir" && grep " $name\$" SHA256SUMS | sha256sum -c --status) || { fail "L'empreinte SHA-256 de $name ne correspond pas : le téléchargement est abîmé ou modifié. Rien n'a été installé."; return 1; }
    ok "Empreinte SHA-256 vérifiée"
}

install_tekboard() {
    step "TekBoard"
    if ! VERSION=$(latest_version) || [[ -z "$VERSION" ]]; then
        fail "Impossible de connaître la dernière version (GitHub injoignable ?). Vérifie ta connexion à Internet puis relance."
        return 1
    fi
    local current
    current=$(installed_version || true)
    if [[ -n "$current" && "$current" == "$VERSION" ]]; then
        ok "TekBoard $VERSION : déjà installé, à jour"
        note ok TekBoard "$VERSION (à jour)"
        return 0
    fi
    if [[ -n "$current" ]]; then info "TekBoard $current installé : mise à jour vers $VERSION."; else info "Dernière version : $VERSION"; fi
    local tmp
    tmp=$(mktemp -d)
    # shellcheck disable=SC2064
    trap "rm -rf '$tmp'" EXIT
    download SHA256SUMS "$tmp/SHA256SUMS"
    if [[ "$PM" == apt ]]; then
        local deb="TekBoard_${VERSION}_amd64.deb"
        download "$deb" "$tmp/$deb"
        verify_sha "$tmp" "$deb"
        info "Installation du paquet (sudo) : les bibliothèques nécessaires (WebKitGTK) viennent avec."
        if [[ -z "$SUDO" && $(id -u) -ne 0 ]]; then
            fail "sudo est nécessaire pour installer le paquet .deb."
            cmd "sudo apt install $tmp/$deb"
            return 1
        fi
        as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$tmp/$deb"
        ok "TekBoard $VERSION installé (paquet $DEB_PACKAGE)"
    else
        # Autres distributions : l'AppImage, dans le dossier de l'utilisateur, sans sudo.
        ensure_lib webkit "affichage de TekBoard (WebKitGTK 4.1)"
        ensure_lib fuse "lancement de l'AppImage"
        local img="TekBoard_${VERSION}_amd64.AppImage" dest="$HOME/.local/bin/tekboard"
        download "$img" "$tmp/$img"
        verify_sha "$tmp" "$img"
        run mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/tekboard"
        run install -m 0755 "$tmp/$img" "$dest"
        if ((!DRY)); then
            printf '%s\n' "$VERSION" >"$HOME/.local/share/tekboard/installed-version"
            cat >"$HOME/.local/share/applications/TekBoard.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=TekBoard
Comment=Organise tes projets Epitech
Exec=$dest
Icon=tekboard
Categories=Education;Development;
Terminal=false
DESKTOP
        fi
        ok "TekBoard $VERSION installé dans $dest (AppImage)"
        case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) warn "$HOME/.local/bin n'est pas dans ton PATH : lance TekBoard depuis le menu des applications, ou ajoute ce dossier au PATH." ;; esac
    fi
    note ok TekBoard "$VERSION installé"
}

# Paquets sans programme à tester (bibliothèques).
ensure_lib() { # ensure_lib nom raison
    local name=$1 why=$2 pkg
    pkg=$(pkg_for "$name")
    [[ "$pkg" == - || -z "$PM" ]] && return 0
    if pkg_installed "$pkg"; then ok "$pkg : déjà présent"; return 0; fi
    if pkg_install "$pkg"; then ok "$pkg : installé ($why)"; return 0; fi
    warn "$pkg manque ($why). Pour l'installer :"; manual_hint "$pkg"
    note warn "$pkg" "absent : $why"
}

# ───────────────────────────── outils ─────────────────────────────

required_tools() {
    step "Outils obligatoires"
    ensure_tool git git requis "gestion des dépôts" "liste des projets, état git, clonage"
    ensure_tool ssh ssh requis "accès aux dépôts Epitech et GitHub" "clonage et push en SSH"
    ensure_tool make make requis "compilation des projets" "compilation, tests, simulation de rendu"
}

github_cli() {
    step "GitHub"
    ensure_tool gh gh optionnel "GitHub CLI" "liste de tes dépôts GitHub, clonage depuis TekBoard"
    have gh || return 0
    if gh auth status >/dev/null 2>&1; then
        ok "Connecté à GitHub ($(gh api user -q .login 2>/dev/null || echo 'compte GitHub'))"
        note ok "gh auth" "connecté"
        return 0
    fi
    warn "GitHub CLI n'est pas connecté à ton compte."
    if [[ -n "$TTY" ]] && ((!DRY)) && ask "Te connecter maintenant (gh auth login, dans le navigateur) ?" o; then
        if gh auth login --hostname github.com --git-protocol ssh --web </dev/tty; then
            ok "Connecté à GitHub"
            note ok "gh auth" "connecté"
            return 0
        fi
        fail "La connexion n'a pas abouti."
    fi
    info "Plus tard, dans un terminal :"
    cmd "gh auth login"
    note warn "gh auth" "non connecté : gh auth login"
}

epitech_tools() {
    step "Outils Epitech (epiclang, Banana)"
    if have epiclang && have banana-check-repo; then
        ok "epiclang et banana-check-repo : déjà présents"
        note ok epiclang "déjà présent"
        return 0
    fi
    if ((MINIMAL)); then note skip epiclang "ignoré (--minimal)"; return 0; fi
    if [[ "$PM" == apt ]] && is_ubuntu; then
        if ask "Installer epiclang et le correcteur de style Banana (PPA officiel d'Epitech) ?" o; then
            local apt_dir=${TEKBOARD_APT_DIR:-/etc/apt}
            if ! grep -rqs "epitech/ppa" "$apt_dir/sources.list" "$apt_dir/sources.list.d/" 2>/dev/null; then
                have add-apt-repository || pkg_install software-properties-common || true
                as_root add-apt-repository -y ppa:epitech/ppa
                APT_UPDATED=0
            fi
            if pkg_install epiclang banana-coding-style-checker && { ((DRY)) || have banana-check-repo; }; then
                ok "epiclang et Banana installés"
                note ok epiclang "installé (ppa:epitech/ppa)"
                return 0
            fi
            fail "L'installation depuis le PPA d'Epitech a échoué. À la main :"
            cmd "sudo add-apt-repository ppa:epitech/ppa && sudo apt install epiclang banana-coding-style-checker"
            note warn epiclang "absent : tuile Banana de TekBoard"
            return 0
        fi
        note skip epiclang "non installé"
        return 0
    fi
    warn "epiclang et Banana ne sont publiés par Epitech que pour Ubuntu (ppa:epitech/ppa)."
    info "Sur $DISTRO_NAME, utilise l'environnement fourni par ton campus. TekBoard fonctionne sans : seule la vérification Banana est désactivée."
    info "https://launchpad.net/~epitech/+archive/ubuntu/ppa"
    note warn epiclang "absent : non publié pour cette distribution"
}

optional_tools() {
    step "Outils optionnels"
    ensure_tool gcc gcc optionnel "compilateur C" "compilation des projets C"
    ensure_tool valgrind valgrind optionnel "détection des fuites mémoire" "vérifications mémoire de la moulinette"
    ensure_tool gdb gdb optionnel "débogueur" "débogage depuis TekBoard"
    ensure_tool gcovr gcovr optionnel "couverture de code" "rapport de couverture des tests"
    ensure_tool pdftotext pdftotext optionnel "lecture des sujets PDF" "analyse des sujets par l'IA, résumé des sujets"
    ensure_tool bwrap bwrap optionnel "bac à sable des agents IA" "moulinette d'Artix et génération de tests (Claude Code)"
}

ai_choice() {
    step "Intelligence artificielle (facultatif)"
    local found=()
    have claude && found+=("Claude Code")
    { have ollama || curl -fsS -m 2 http://localhost:11434/api/version >/dev/null 2>&1; } && found+=("Ollama")
    if ((${#found[@]})); then
        ok "Déjà présent : ${found[*]}. Choisis l'IA dans TekBoard → Réglages → Artix (IA)."
        note ok IA "${found[*]}"
        return 0
    fi
    info "Artix peut utiliser trois IA ; TekBoard fonctionne aussi sans."
    info "  1. OpenRouter : modèles gratuits en ligne, rien à installer (une clé gratuite sur openrouter.ai/keys)."
    info "  2. Ollama : un modèle sur ton ordinateur, sans compte (téléchargement de 1 à 9 Go)."
    info "  3. Claude Code : le plus capable, nécessite un compte Claude."
    if ((MINIMAL)) || ((YES)); then
        note skip IA "à choisir dans TekBoard"
        return 0
    fi
    if ask "Installer Ollama maintenant (script officiel ollama.com, avec sudo) ?" n; then
        if ((DRY)); then cmd "[simulation] curl -fsSL https://ollama.com/install.sh | sh"; else curl -fsSL https://ollama.com/install.sh | sh; fi
        ok "Ollama installé : choisis et télécharge un modèle dans TekBoard → Réglages → Artix (IA)."
        note ok IA "Ollama installé"
        return 0
    fi
    info "Pour Claude Code plus tard :"
    cmd "curl -fsSL https://claude.ai/install.sh | bash"
    note skip IA "à choisir dans TekBoard"
}

# ───────────────────────────── développement ─────────────────────────────

dev_build() {
    step "Compilation depuis les sources"
    local root
    root=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd) || root=""
    if [[ -z "$root" || ! -f "$root/package.json" || ! -d "$root/src-tauri" ]]; then
        fail "--dev se lance depuis un clone du dépôt :"
        cmd "git clone https://github.com/$REPO.git && cd tekboard-desktop && ./install.sh --dev"
        return 1
    fi
    if [[ "$PM" != apt && "$PM" != dnf && "$PM" != pacman ]]; then
        fail "--dev sait installer les bibliothèques de Tauri avec apt, dnf ou pacman seulement. Voir https://v2.tauri.app/start/prerequisites/"
        return 1
    fi
    local libs=()
    case "$PM" in
        apt) libs=(build-essential curl file pkg-config libssl-dev libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev) ;;
        dnf) libs=(gcc gcc-c++ make curl file pkgconf-pkg-config openssl-devel webkit2gtk4.1-devel gtk3-devel librsvg2-devel libappindicator-gtk3-devel) ;;
        pacman) libs=(base-devel curl file pkgconf openssl webkit2gtk-4.1 gtk3 librsvg libappindicator-gtk3) ;;
    esac
    local missing=()
    for p in "${libs[@]}"; do pkg_installed "$p" || missing+=("$p"); done
    if ((${#missing[@]})); then
        info "Bibliothèques de développement manquantes : ${missing[*]}"
        pkg_install "${missing[@]}"
    fi
    ok "Bibliothèques de Tauri présentes"
    if ! have node || [[ $(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0) -lt 20 ]]; then
        fail "Node.js 20 ou plus récent est nécessaire (trouvé : $(node --version 2>/dev/null || echo aucun))."
        info "Le plus simple, sans sudo : https://github.com/nvm-sh/nvm puis « nvm install 22 »."
        return 1
    fi
    ok "Node.js $(node --version)"
    export PATH="$HOME/.cargo/bin:$PATH"
    if ! have cargo; then
        if ask "Rust est absent. L'installer avec rustup (officiel, dans ton dossier personnel, sans sudo) ?" o; then
            run sh -c "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path"
        else
            fail "Rust est nécessaire pour compiler TekBoard : https://rustup.rs"
            return 1
        fi
    fi
    ((DRY)) || ok "$(cargo --version)"
    (cd "$root" && run npm ci && run ./scripts/tauri.sh build --bundles deb)
    if [[ "$PM" == apt ]] && ((!DRY)); then
        local deb
        # shellcheck disable=SC2012 # file names are TekBoard_<version>_amd64.deb
        deb=$(ls -t "$root"/src-tauri/target/release/bundle/deb/TekBoard_*_amd64.deb | head -1)
        as_root apt-get install -y "$deb"
        ok "Installé : $deb"
    else
        ok "Compilé : voir src-tauri/target/release/bundle/"
    fi
    note ok "TekBoard (sources)" "compilé"
}

# ───────────────────────────── désinstallation ─────────────────────────────

uninstall() {
    step "Désinstallation"
    local any=0
    if [[ "$PM" == apt ]] && pkg_installed "$DEB_PACKAGE"; then
        as_root apt-get remove -y -qq "$DEB_PACKAGE"
        ok "Paquet $DEB_PACKAGE retiré"
        any=1
    fi
    if [[ -f "$HOME/.local/bin/tekboard" && -f "$HOME/.local/share/tekboard/installed-version" ]]; then
        run rm -f "$HOME/.local/bin/tekboard" "$HOME/.local/share/applications/TekBoard.desktop"
        run rm -rf "$HOME/.local/share/tekboard"
        ok "AppImage retirée"
        any=1
    fi
    ((any)) || info "TekBoard n'était pas installé par ce script ou en paquet .deb."
    local data="$HOME/.local/share/$APP_ID" cache="$HOME/.cache/$APP_ID"
    if [[ -d "$data" || -d "$cache" ]]; then
        info "Tes données (projets suivis, planning, réglages, clé OpenRouter) sont dans $data."
        if ((!YES)) && ask "Supprimer aussi ces données ? (irréversible)" n; then
            run rm -rf "$data" "$cache"
            ok "Données supprimées"
        else
            ok "Données gardées : une réinstallation les retrouvera."
        fi
    fi
    info "Les outils installés à côté (git, gh, epiclang, Ollama…) sont laissés en place."
}

# ───────────────────────────── résumé ─────────────────────────────

summary() {
    step "Résumé"
    local line state tool detail errs=0
    for line in "${SUMMARY[@]}"; do
        IFS='|' read -r state tool detail <<<"$line"
        case "$state" in
            ok) ok "$tool — $detail" ;;
            warn) warn "$tool — $detail" ;;
            err) fail "$tool — $detail"; errs=1 ;;
            *) info "$tool — $detail" ;;
        esac
    done
    if ((errs)); then
        printf '\n%sDes outils obligatoires manquent : corrige les lignes en rouge puis relance ./install.sh.%s\n' "$R" "$N"
        trap - ERR
        exit 1
    fi
    printf '\n%sTerminé.%s Lance TekBoard depuis le menu des applications ou avec la commande %stekboard%s.\n' "$G" "$N" "$C" "$N"
    printf "Au premier lancement, TekBoard vérifie ton environnement (Réglages → Doctor) et t’aide à choisir une IA.\n"
}

main() {
    local mode=""
    if ((DRY)); then mode=" (simulation : rien ne sera modifié)"; fi
    printf '%sTekBoard · installation%s%s\n' "$B" "$N" "$mode"
    detect_system
    if ((UNINSTALL)); then uninstall; exit 0; fi
    have curl || { fail "curl est nécessaire."; manual_hint curl; exit 1; }
    required_tools || true
    if ((DEV)); then
        dev_build
    else
        install_tekboard
    fi
    github_cli
    epitech_tools
    ((MINIMAL)) || optional_tools
    ai_choice
    summary
}

main
