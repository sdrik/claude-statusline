#!/bin/bash
# Install and keep the status line in sync. Runs on SessionStart.
#
# Why a hook owns the installation, rather than the /statusline:setup command it
# replaced: the destination lives under ${CLAUDE_PLUGIN_DATA}, and that variable
# exists ONLY in hook environments — it is absent from the Bash tool's
# environment, so no command a user can invoke is able to resolve it. The old
# command-driven installer copied the renderer to a fixed path instead, which is
# why a plugin update had no effect until the user re-ran it, silently.
#
# Consequence to be honest about: this writes to $HOME and to the user's
# settings.json on every session start, unprompted, with the user's full
# privileges. That is the documented norm for hooks; it is nonetheless a change
# in what this plugin is, and the README says so.
#
# `set -e` is deliberately absent. A hook must never disturb the session, so
# every step below degrades on its own and the script always exits 0; failure
# reaches the user through the staleness badge in the status line, never through
# an exit code or a message (stdout here would be injected into the model's
# context).
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0
[ -n "${CLAUDE_PLUGIN_DATA:-}" ] || exit 0
[ -n "${CLAUDE_PLUGIN_ROOT:-}" ] || exit 0

# 1. Inline loading is the development mode: the data directory is named
# `<plugin>-inline` instead of `<plugin>-<marketplace>`, so a checkout loaded
# with --plugin-dir resolves a DIFFERENT destination than the marketplace
# install. Without this bail-out the two would rewrite settings.json against
# each other at every session start, and the status line would alternate
# between two renderers depending on which session started last. Development
# goes through the repo's own .claude/settings.local.json override instead.
case "$(basename "$CLAUDE_PLUGIN_DATA")" in
  *-inline) exit 0 ;;
esac

# 1 bis. Frein a main du developpeur. Une marketplace locale n'execute PAS la
# copie qu'elle met en cache : CLAUDE_PLUGIN_ROOT pointe sur l'arbre de travail,
# et une edition y est prise des la session suivante, sans reinstallation. Un
# depot installe comme sa propre marketplace pour une recette, puis laisse en
# place, fait donc tourner ce fichier en cours d'ecriture contre la vraie
# configuration de l'utilisateur, avec ses pleins privileges -- c'est le seul
# etat que ce marqueur existe pour couvrir, le developpement courant passant par
# --plugin-dir, que la garde ci-dessus arrete deja.
#
# La polarite est inversee a dessein : rien de pose = ce que recoit un vrai
# utilisateur, donc une recette teste exactement l'etat livre. Seule l'existence
# compte -- un contenu a interpreter est un contenu qu'on peut mal interpreter.
[ -e "$CLAUDE_PLUGIN_ROOT/.statusline-dev-hold" ] && exit 0

SRC="$CLAUDE_PLUGIN_ROOT/scripts/statusline-command.sh"
MANIFEST="$CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json"
DEST="$CLAUDE_PLUGIN_DATA/statusline-command.sh"
WITNESS="$CLAUDE_PLUGIN_DATA/statusline-witness"
CLAUDE_DIR="$HOME/.claude"
SETTINGS="$CLAUDE_DIR/settings.json"
POINTER="$CLAUDE_DIR/statusline-plugin.json"
# Where every version before 2.0.0 installed the renderer.
LEGACY="$CLAUDE_DIR/statusline-command.sh"
# Sentinel of the guarded command we write into settings.json. It doubles as the
# proof that an entry is ours even when the destination it names has moved, so
# treat it as a wire format: changing it orphans every entry already written
# with the old wording.
GUARD_MARK='⚠ renderer absent'
# Renderers we have shipped, by sha256, one entry per released renderer. This
# is what lets us adopt our own past installations (step 4) instead of presuming
# ownership. A missing entry does NOT degrade visibly: the user stays on their
# 1.x renderer, which has no witness beside it and therefore never raises the
# staleness badge, while /statusline:status calls the non-migration deliberate.
# tests/hook.test.sh asserts this list against the renderers reproduced from
# git, so a forgotten release fails the suite instead of failing a user.
LEGACY_SHA256="
b0a607d99dec6cc61cf4286fb6cd4ee318949ab84dc74a81c3dc5159439b52b4
102bbd41a8070d41d781d3ca63ba6bf016b8f597d4e66408fc30405f7ca44f9a
"

version=$(jq -r '.version // empty' "$MANIFEST" 2>/dev/null)
[ -n "$version" ] || exit 0

mkdir -p "$CLAUDE_PLUGIN_DATA" "$CLAUDE_DIR" 2>/dev/null

# 2. The witness carries the SHIPPED version and is written BEFORE the copy is
# attempted, on purpose: witness ahead of the version baked into the installed
# renderer is the only evidence a failed copy leaves behind, and it is what the
# badge reads. Writing it only on success would make failure undetectable.
printf '%s\n' "$version" > "$WITNESS" 2>/dev/null

# 3. Copy the renderer, injecting the version into the copy. The shipped file
# carries a placeholder, so plugin.json stays the single source of truth and no
# hand-maintained constant can drift out of step with it and make the badge lie.
copied=0
if tmp=$(mktemp "$CLAUDE_PLUGIN_DATA/.statusline.XXXXXX" 2>/dev/null); then
  # The injected line is asserted, not assumed: a sed that matches nothing still
  # exits 0 and still writes a plausible file, which would install a renderer
  # carrying the placeholder — a permanent staleness badge reported as a copy
  # failure that never happened.
  if sed "s|^VERSION='@@VERSION@@'|VERSION='$version'|" "$SRC" > "$tmp" 2>/dev/null \
    && grep -qxF "VERSION='$version'" "$tmp" && mv "$tmp" "$DEST" 2>/dev/null; then
    copied=1
  else
    rm -f "$tmp"
  fi
fi

# sha_of <file> -> sha256 of its contents, or nothing if it cannot be hashed
sha_of() {
  [ -f "$1" ] || return 1
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum < "$1" 2>/dev/null | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 < "$1" 2>/dev/null | cut -d' ' -f1
  else
    return 1
  fi
}

# shell_quoted <string> -> the string made safe to sit inside a double-quoted
# word of the command we write into settings.json. That command is re-executed
# by a shell, so a $HOME carrying " ` or $ would otherwise produce a broken
# entry — or a command substitution — and the ownership test below would then
# fail to recognise our own handiwork at every session start.
shell_quoted() { printf '%s' "$1" | sed 's/[\\"`$]/\\&/g'; }
DEST_Q=$(shell_quoted "$DEST")

# is_ours_legacy -> true when $LEGACY is byte-for-byte a renderer we shipped
is_ours_legacy() {
  local sha
  sha=$(sha_of "$LEGACY") || return 1
  [ -n "$sha" ] || return 1
  printf '%s' "$LEGACY_SHA256" | grep -qxF "$sha"
}

# 4. Write settings.json ONLY when the statusLine entry is absent or provably
# ours. This is the single place where we touch the user's own configuration, so
# it takes proof rather than presumption: the entry names our destination, or it
# carries the sentinel of a guard we wrote, or it names the pre-2.0.0 path AND
# the file sitting there hashes to a renderer we shipped. Anything else belongs
# to someone — including a copy of our renderer that they took over
# deliberately — and is left alone.
#
# Skipped entirely when the copy failed and no renderer exists at the
# destination: wiring the status line to a missing file would replace a working
# install (or an empty status line) with a permanently mute one.
owned=""
if [ "$copied" = 1 ] || [ -f "$DEST" ]; then
  if [ ! -f "$SETTINGS" ]; then
    owned="new"
  else
    current=$(jq -r '.statusLine.command // empty' "$SETTINGS" 2>/dev/null)
    if [ -z "$current" ]; then
      owned="new"
    elif printf '%s' "$current" | grep -qF -- "$DEST_Q"; then
      owned="current"
    elif printf '%s' "$current" | grep -qF -- "$GUARD_MARK"; then
      # A guarded command we wrote ourselves, but naming a destination that is
      # no longer $DEST: the data directory is named after the marketplace, so
      # re-adding the plugin from another one moves it. Without this the entry
      # would never be recognised again and the status line would be stuck for
      # good on the "renderer absent" notice, with /statusline:status calling
      # it deliberate.
      owned="moved"
    elif printf '%s' "$current" | grep -qF -- '.pre-statusline-plugin.bak'; then
      # Someone pointed their status line at the backup the old installer made
      # of their own script. The legacy path is a substring of that one, so this
      # has to be ruled out before the test below claims the entry as ours.
      :
    elif printf '%s' "$current" | grep -qF -- '$HOME/.claude/statusline-command.sh' \
      || printf '%s' "$current" | grep -qF -- "$LEGACY"; then
      # The pre-2.0.0 installer wrote $HOME literally, for the shell that runs
      # the command to expand; an expanded form is accepted too.
      #
      # Nothing at the legacy path is proof too, of a different kind: there is
      # no file to take from anyone, the status line the entry describes is
      # already blank, and the entry is byte-for-byte what our own 1.x
      # installer wrote. Requiring the file made that state unrepairable for
      # good. A file that IS there and hashes to nothing we shipped stays
      # someone else's, as before — absence is the proof, not the path.
      if is_ours_legacy; then
        owned="legacy"
      elif [ ! -e "$LEGACY" ]; then
        owned="orphan"
      fi
    fi
  fi
fi

if [ -n "$owned" ]; then
  # Guarded command: uninstalling the plugin deletes CLAUDE_PLUGIN_DATA, and a
  # statusLine whose command is missing leaves the line blank and silent with no
  # retry. The guard turns that dead end into an instruction, which the badge
  # cannot do — nothing of ours runs at all once the renderer is gone.
  guard="[ -f \"$DEST_Q\" ] && exec bash \"$DEST_Q\" || printf '$GUARD_MARK — retirez statusLine de settings.json ou réinstallez le plugin'"
  wired=0
  if [ "${current:-}" = "$guard" ]; then
    # Already byte-for-byte what we would write. Rewriting it anyway would put a
    # read-modify-write of the user's settings.json on every single session
    # start, racing whatever else edits that file and making Claude Code reload
    # it for nothing.
    wired=1
  elif [ -f "$SETTINGS" ] || printf '{}\n' > "$SETTINGS"; then
    if tmp=$(mktemp "$CLAUDE_DIR/.settings.json.XXXXXX" 2>/dev/null); then
      # A settings.json that does not parse is left exactly as it is: jq fails,
      # the temporary file stays empty, and the user keeps their file intact.
      if jq --arg cmd "$guard" '.statusLine = {"type":"command","command":$cmd}' \
        "$SETTINGS" > "$tmp" 2>/dev/null && [ -s "$tmp" ] \
        && mv "$tmp" "$SETTINGS" 2>/dev/null; then
        wired=1
      else
        rm -f "$tmp"
      fi
    fi
  fi

  # 5. Only once the entry actually points at the new destination is the
  # pre-2.0.0 renderer an orphan. Delete it on exact hash equality alone — the
  # proof that it is ours, and the last moment that proof exists. Gated on the
  # write having succeeded: deleting it while the entry still names it would
  # take a working status line down to a silent blank, the one outcome this
  # design exists to prevent. Never touch the .bak beside it either — the old
  # installer put someone's personal script there.
  [ "$owned" = "legacy" ] && [ "$wired" = 1 ] && is_ours_legacy && rm -f "$LEGACY"
fi

# 6. Publish where things are. The Bash-side /statusline:status command cannot
# resolve CLAUDE_PLUGIN_DATA, so this fixed path is its only way to find out.
if tmp=$(mktemp "$CLAUDE_DIR/.statusline-plugin.XXXXXX" 2>/dev/null); then
  jq -n --arg dest "$DEST" --arg version "$version" \
    '{dest:$dest, version:$version}' > "$tmp" 2>/dev/null \
    && [ -s "$tmp" ] && mv "$tmp" "$POINTER" 2>/dev/null
  rm -f "$tmp"
fi

exit 0
