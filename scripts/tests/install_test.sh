#!/usr/bin/env bash
# Tests of install.sh without touching the system: each scenario runs it with --dry-run and a
# PATH made of a few real basics plus stubs (fake apt-get, dnf, gh…), so a machine without
# git, a Fedora or an Arch can be simulated anywhere. No network: the version is given.
#
#   scripts/tests/install_test.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
SCRIPT="$PWD/install.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PASS=0 FAILED=0

BASICS=(bash sh env uname id sed grep cat mktemp rm mkdir head tail tr cut dirname basename sha256sum install ln chmod ls sort awk printf)

# new_env name os-release-ID [ID_LIKE]  → prints the folder; stubs go in $dir/bin.
new_env() {
    local dir="$WORK/$1"
    mkdir -p "$dir/bin" "$dir/home"
    for b in "${BASICS[@]}"; do
        local real
        real=$(command -v "$b") && ln -sf "$real" "$dir/bin/$b"
    done
    printf 'ID=%s\nID_LIKE="%s"\nPRETTY_NAME="%s test"\n' "$2" "${3:-}" "$2" >"$dir/os-release"
    echo "$dir"
}

# stub dir name [script body]: a fake program (default: succeeds silently).
stub() {
    # Remove first: the name may be a link to the real program, which must never be written.
    rm -f "$1/bin/$2"
    printf '#!/bin/sh\n%s\n' "${3:-exit 0}" >"$1/bin/$2"
    chmod +x "$1/bin/$2"
}

run_in() { # run_in dir args... → output in $OUT, status in $CODE
    local dir=$1
    shift
    OUT=$(cd "$dir/home" && env -i PATH="$dir/bin" HOME="$dir/home" NO_COLOR=1 TEKBOARD_OS_RELEASE="$dir/os-release" TEKBOARD_APT_DIR="$dir/apt" TEKBOARD_LATEST_VERSION=0.7.0 ${TEKBOARD_ARCH:+TEKBOARD_ARCH=$TEKBOARD_ARCH} bash "$SCRIPT" "$@" </dev/null 2>&1)
    CODE=$?
}

check() { # check "description" condition...
    local what=$1
    shift
    if "$@"; then
        PASS=$((PASS + 1))
        printf '  ok   %s\n' "$what"
    else
        FAILED=$((FAILED + 1))
        printf '  FAIL %s\n' "$what"
        printf '%s\n' "$OUT" | sed 's/^/       | /' | head -60
    fi
}
has() { grep -qF -- "$1" <<<"$OUT"; }
lacks() { ! grep -qF -- "$1" <<<"$OUT"; }
code_is() { [[ "$CODE" == "$1" ]]; }

apt_stubs() { # a Debian-family system where nothing TekBoard needs is installed
    stub "$1" apt-get
    stub "$1" apt-cache 'exit 1'
    stub "$1" dpkg-query 'exit 1'
    stub "$1" sudo
    stub "$1" curl 'exit 7'
}

echo "Ubuntu vierge"
d=$(new_env ubuntu ubuntu debian)
apt_stubs "$d"
run_in "$d" --dry-run --yes
check "termine sans erreur" code_is 0
check "installe git, ssh et make avec apt" has "[simulation] sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git"
check "paquet ssh de Debian" has "openssh-client"
check "télécharge le .deb de la dernière version" has "TekBoard_0.7.0_amd64.deb"
check "vérifie l'empreinte SHA-256" has "sha256sum -c"
check "ajoute le PPA d'Epitech pour epiclang" has "add-apt-repository -y ppa:epitech/ppa"
check "installe epiclang et Banana" has "epiclang banana-coding-style-checker"
check "installe bubblewrap (bac à sable des agents)" has "bubblewrap"
check "n'installe pas d'IA sans qu'on le demande" lacks "ollama.com/install.sh | sh"
check "résumé final" has "Terminé."

echo "Ubuntu où tout est déjà là (idempotence)"
d=$(new_env ubuntu-ready ubuntu debian)
apt_stubs "$d"
for t in git ssh make gh epiclang banana-check-repo gcc valgrind gdb gcovr pdftotext bwrap claude; do stub "$d" "$t"; done
stub "$d" dpkg-query 'case "$*" in *Status*tek-board*) printf "install ok installed";; *Version*tek-board*) printf "0.7.0";; *) exit 1;; esac'
run_in "$d" --dry-run --yes
check "termine sans erreur" code_is 0
check "rien n'est installé ni téléchargé" lacks "[simulation]"
check "TekBoard reconnu à jour" has "TekBoard 0.7.0 : déjà installé, à jour"
check "GitHub déjà connecté" has "Connecté à GitHub"

echo "Ancienne version installée (mise à jour)"
d=$(new_env ubuntu-old ubuntu debian)
apt_stubs "$d"
for t in git ssh make; do stub "$d" "$t"; done
stub "$d" dpkg-query 'case "$*" in *Status*tek-board*) printf "install ok installed";; *Version*tek-board*) printf "0.6.1";; *) exit 1;; esac'
run_in "$d" --dry-run --minimal
check "propose la mise à jour" has "TekBoard 0.6.1 installé : mise à jour vers 0.7.0."
check "installe le nouveau paquet" has "TekBoard_0.7.0_amd64.deb"
check "--minimal laisse les outils optionnels" lacks "valgrind"

echo "Sans GitHub CLI connecté ni epiclang, sans terminal"
d=$(new_env ubuntu-gh ubuntu debian)
apt_stubs "$d"
for t in git ssh make; do stub "$d" "$t"; done
stub "$d" gh 'exit 1'
run_in "$d" --dry-run
check "explique comment se connecter à GitHub" has "gh auth login"
check "sans terminal, rien d'optionnel n'est installé" lacks "epiclang banana-coding-style-checker"
check "dit pourquoi epiclang manque" has "epiclang — non installé"

echo "Fedora sans gh ni epiclang"
d=$(new_env fedora fedora)
stub "$d" dnf
stub "$d" rpm 'exit 1'
stub "$d" sudo
stub "$d" curl 'exit 7'
for t in git ssh make; do stub "$d" "$t"; done
run_in "$d" --dry-run --yes
check "termine sans erreur" code_is 0
check "installe gh avec dnf" has "dnf install -y -q gh"
check "installe WebKitGTK pour l'AppImage" has "webkit2gtk4.1"
check "installe l'AppImage dans le dossier personnel" has "TekBoard_0.7.0_amd64.AppImage"
check "explique qu'epiclang n'existe que pour Ubuntu" has "que pour Ubuntu (ppa:epitech/ppa)"

echo "Arch Linux"
d=$(new_env arch arch)
stub "$d" pacman 'exit 1'
stub "$d" sudo
stub "$d" curl 'exit 7'
run_in "$d" --dry-run --yes
check "installe avec pacman" has "pacman -S --needed --noconfirm git"
check "paquet gh d'Arch" has "github-cli"
check "fuse2 pour l'AppImage" has "fuse2"

echo "Aucun gestionnaire de paquets, git absent"
d=$(new_env unknown nixos)
stub "$d" curl 'exit 7'
run_in "$d" --dry-run --yes
check "échoue (code 1)" code_is 1
check "dit quels outils obligatoires manquent" has "Des outils obligatoires manquent"
check "dit ce qui est touché" has "liste des projets, état git, clonage"

echo "Systèmes non pris en charge"
d=$(new_env mac macos)
stub "$d" uname 'echo Darwin'
run_in "$d" --dry-run
check "macOS : message clair" has "macOS n'est pas pris en charge"
check "macOS : code 1" code_is 1
d=$(new_env arm ubuntu debian)
apt_stubs "$d"
TEKBOARD_ARCH=aarch64 run_in "$d" --dry-run
check "ARM : message clair" has "n'est publié que pour x86_64"

echo "Désinstallation"
d=$(new_env uninstall ubuntu debian)
apt_stubs "$d"
stub "$d" dpkg-query 'case "$*" in *Status*tek-board*) printf "install ok installed";; *) exit 1;; esac'
mkdir -p "$d/home/.local/share/dev.tekboard.app"
run_in "$d" --uninstall --dry-run
check "retire le paquet" has "apt-get remove -y -qq tek-board"
check "garde les données par défaut" has "Données gardées"
check "les données sont toujours là" test -d "$d/home/.local/share/dev.tekboard.app"

echo "Options"
run_in "$d" --bogus
check "option inconnue refusée" code_is 2

printf '\n%d réussi(s), %d échec(s)\n' "$PASS" "$FAILED"
((FAILED == 0))
