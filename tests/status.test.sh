#!/bin/bash
# Diagnostic tests: run bin/statusline-status in a throwaway $HOME and assert on
# what it tells the user. Run: bash tests/status.test.sh
#
# Every branch here answers "why is my status line not what I expect?", so a
# wrong answer sends the user to fix the wrong thing. That is what these cases
# are for.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/bin/statusline-status"
HOOK="$ROOT/hooks/sync.sh"
pass=0
fail=0
temps=()

cleanup() {
  local t
  for t in "${temps[@]}"; do
    chmod -R u+rwX "$t" 2>/dev/null
    rm -rf "$t"
  done
}
trap cleanup EXIT

ok() {
  local label="$1" haystack="$2" needle="$3"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n  attendu (present) : %q\n  sortie            : %q\n' "$label" "$needle" "$haystack"
  fi
}

no() {
  local label="$1" haystack="$2" needle="$3"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    fail=$((fail + 1))
    printf 'FAIL %s\n  attendu (absent) : %q\n  sortie           : %q\n' "$label" "$needle" "$haystack"
  else
    pass=$((pass + 1))
  fi
}

# env_new -> a throwaway $HOME with a data directory beside it, mirroring the
# real layout where CLAUDE_PLUGIN_DATA lives under $HOME.
env_new() {
  local tmp
  tmp=$(mktemp -d)
  temps+=("$tmp")
  export HOME="$tmp/home"
  DATA="$HOME/.claude/plugins/data/statusline-sdrik-plugins"
  mkdir -p "$HOME/.claude"
  SETTINGS="$HOME/.claude/settings.json"
  POINTER="$HOME/.claude/statusline-plugin.json"
  DEST="$DATA/statusline-command.sh"
}

point_at() { jq -n --arg d "$1" --arg v "${2:-2.0.0}" '{dest:$d,version:$v}' > "$POINTER"; }
report() { bash "$BIN" 2>&1; }

# --- rien d'installe ----------------------------------------------------------

env_new
ok "pas de pointeur : dit que rien n'est installe" "$(report)" "not installed yet"

# --- installation nominale ----------------------------------------------------

env_new
mkdir -p "$DATA"
sed "s|^VERSION='@@VERSION@@'|VERSION='2.0.0'|" "$ROOT/scripts/statusline-command.sh" > "$DEST"
point_at "$DEST" 2.0.0
jq -n --arg c "bash \"$DEST\"" '{statusLine:{type:"command",command:$c}}' > "$SETTINGS"
out=$(report)
ok "nominal : la version installee est lue" "$out" "Installed:       2.0.0"
ok "nominal : settings.json est cable dessus" "$out" "wired to this renderer"

# --- desinstallation : le dossier de donnees a disparu ------------------------

# Desinstaller supprime le dossier de donnees entier. C'est ce qui distingue
# une desinstallation d'une copie qui echoue, et le message doit le refleter.
env_new
point_at "$DEST" 2.0.0
out=$(report)
ok "desinstalle : dit que le renderer est parti" "$out" "Installed:       missing"
ok "desinstalle : nomme la desinstallation" "$out" "uninstall"

# --- copie en echec : le dossier est la, le renderer non ----------------------

# Le pointeur est publie meme quand la copie a echoue, donc pointeur + dossier
# present + renderer absent = l'installation echoue a chaque demarrage. Annoncer
# une desinstallation ici envoie l'utilisateur reinstaller un plugin qui est
# deja installe, au lieu de regarder les droits du dossier.
env_new
mkdir -p "$DATA"
point_at "$DEST" 2.0.0
out=$(report)
ok "copie en echec : signale l'echec de copie" "$out" "copy is failing"
no "copie en echec : ne parle pas de desinstallation" "$out" "uninstalling the plugin deletes"

# --- une destination aux caracteres speciaux ----------------------------------

# Le hook echappe $DEST dans l'entree qu'il ecrit ; le diagnostic doit
# reconnaitre cette forme-la, sinon il annonce "wired to something else" sur une
# installation parfaitement saine.
env_new
odd='ho"me $x`id`'
if mkdir -p "$HOME/../$odd" 2>/dev/null; then
  HOME=$(cd "$HOME/../$odd" && pwd)
  export HOME
  DATA="$HOME/.claude/plugins/data/statusline-sdrik-plugins"
  SETTINGS="$HOME/.claude/settings.json"
  POINTER="$HOME/.claude/statusline-plugin.json"
  DEST="$DATA/statusline-command.sh"
  mkdir -p "$DATA" "$HOME/.claude"
  export CLAUDE_PLUGIN_DATA="$DATA"
  CLAUDE_PLUGIN_ROOT=$(mktemp -d)
  export CLAUDE_PLUGIN_ROOT
  temps+=("$CLAUDE_PLUGIN_ROOT")
  mkdir -p "$CLAUDE_PLUGIN_ROOT/.claude-plugin" "$CLAUDE_PLUGIN_ROOT/scripts"
  cp "$ROOT/scripts/statusline-command.sh" "$CLAUDE_PLUGIN_ROOT/scripts/"
  printf '{"name":"statusline","version":"2.0.0"}\n' > "$CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json"
  bash "$HOOK" 2>/dev/null
  ok "dest special : reconnu comme cable" "$(report)" "wired to this renderer"
else
  printf 'SKIP destination aux caracteres speciaux non creable\n'
fi

printf '\n%d passes, %d echecs\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
