#!/bin/bash
# Install-hook tests: run the hook in a throwaway HOME and assert on what it
# wrote. Run: bash tests/hook.test.sh
#
# The hook writes to $HOME and to the user's settings.json on every session
# start, unprompted and with full privileges. That blast radius is what these
# cases pay for: every branch that decides *whether* to write is covered here.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/hooks/sync.sh"
# Every renderer this plugin has released, one "commit version" pair per line.
# Add a line here at each release. The hook recognises its own past
# installations by hashing the file it finds, so this list and the hook's
# LEGACY_SHA256 must hold exactly the same set -- which is asserted below,
# against the artefacts reproduced from git rather than against a constant.
RELEASED="
bcabb0a 1.0.0
4e1b21e 1.1.0
"

# The hashes the hook is willing to adopt, read out of the hook itself.
hook_hashes() {
  sed -n '/^LEGACY_SHA256="/,/^"$/p' "$HOOK" | grep -E '^[0-9a-f]{64}$'
}

# renderer_of <commit> -> that release's renderer on stdout
renderer_of() { git -C "$ROOT" show "$1:scripts/statusline-command.sh"; }
pass=0
fail=0
temps=()

# Some cases chmod directories to unwritable on purpose, so restore the bits
# before removing the trees.
cleanup() {
  local t
  for t in "${temps[@]}"; do
    chmod -R u+rwX "$t" 2>/dev/null
    rm -rf "$t"
  done
}
trap cleanup EXIT

eq() {
  local label="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n  attendu : %s\n  obtenu  : %s\n' "$label" "$want" "$got"
  fi
}

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

yes_file() {
  local label="$1" path="$2"
  if [ -e "$path" ]; then pass=$((pass + 1)); else
    fail=$((fail + 1)); printf 'FAIL %s\n  fichier attendu absent : %s\n' "$label" "$path"
  fi
}

no_file() {
  local label="$1" path="$2"
  if [ -e "$path" ]; then
    fail=$((fail + 1)); printf 'FAIL %s\n  fichier devait disparaitre : %s\n' "$label" "$path"
  else pass=$((pass + 1)); fi
}

# env_new [version] [data_dir_id] -> a fresh throwaway plugin install.
# Exports the three variables the hook reads. CLAUDE_PLUGIN_ROOT gets a real
# copy of the shipped renderer, because the version injection is asserted on it.
env_new() {
  local ver="${1:-2.0.0}" id="${2:-statusline-sdrik-plugins}" tmp
  tmp=$(mktemp -d)
  temps+=("$tmp")
  export HOME="$tmp/home"
  export CLAUDE_PLUGIN_ROOT="$tmp/root"
  export CLAUDE_PLUGIN_DATA="$tmp/data/$id"
  mkdir -p "$HOME/.claude" "$CLAUDE_PLUGIN_ROOT/.claude-plugin" "$CLAUDE_PLUGIN_ROOT/scripts"
  cp "$ROOT/scripts/statusline-command.sh" "$CLAUDE_PLUGIN_ROOT/scripts/"
  printf '{"name":"statusline","version":"%s"}\n' "$ver" \
    > "$CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json"
  SETTINGS="$HOME/.claude/settings.json"
  LEGACY="$HOME/.claude/statusline-command.sh"
  DEST="$CLAUDE_PLUGIN_DATA/statusline-command.sh"
  WITNESS="$CLAUDE_PLUGIN_DATA/statusline-witness"
  POINTER="$HOME/.claude/statusline-plugin.json"
}

run_hook() { bash "$HOOK" 2>/dev/null; }

# The status line payload is irrelevant to the badge, and a bare {} keeps every
# other segment out of the way (the throwaway HOME has no .claude.json either).
render_installed() { printf '{}' | bash "$DEST" 2>/dev/null; }

sl_command() { jq -r '.statusLine.command // empty' "$SETTINGS" 2>/dev/null; }

# --- installation neuve -------------------------------------------------------

env_new 2.0.0
run_hook

yes_file "install neuve : le renderer est copie" "$DEST"
yes_file "install neuve : le temoin est ecrit" "$WITNESS"
yes_file "install neuve : le pointeur est publie" "$POINTER"
eq "install neuve : le temoin porte la version livree" "$(cat "$WITNESS")" "2.0.0"
ok "install neuve : la version est injectee dans la copie" "$(grep -m1 '^VERSION=' "$DEST")" "VERSION='2.0.0'"
no "install neuve : le placeholder ne survit pas" "$(cat "$DEST")" "@@VERSION@@"
ok "install neuve : settings.json pointe sur le dest" "$(sl_command)" "$DEST"
ok "install neuve : la commande est gardee" "$(sl_command)" "renderer absent"
eq "install neuve : le pointeur donne le dest" "$(jq -r .dest "$POINTER")" "$DEST"
eq "install neuve : le pointeur donne la version" "$(jq -r .version "$POINTER")" "2.0.0"
no "install neuve : pas de badge" "$(render_installed)" "⚠"

# Les autres reglages de l'utilisateur survivent a l'ecriture.
env_new 2.0.0
printf '{"theme":"dark","permissions":{"allow":["Bash(ls)"]}}\n' > "$SETTINGS"
run_hook
eq "install neuve : les autres reglages sont preserves" "$(jq -r .theme "$SETTINGS")" "dark"
eq "install neuve : les permissions sont preservees" "$(jq -r '.permissions.allow[0]' "$SETTINGS")" "Bash(ls)"

# --- statusLine etranger : on ne touche a rien --------------------------------

env_new 2.0.0
printf '{"statusLine":{"type":"command","command":"bash /opt/moi/ma-statusline.sh"}}\n' > "$SETTINGS"
run_hook
eq "statusLine etranger : intouche" "$(sl_command)" "bash /opt/moi/ma-statusline.sh"
yes_file "statusLine etranger : le renderer est copie quand meme" "$DEST"

# `true` est la porte de sortie documentee pour garder le plugin sans statusline.
env_new 2.0.0
printf '{"statusLine":{"type":"command","command":"true"}}\n' > "$SETTINGS"
run_hook
eq "opt-out par 'true' : respecte" "$(sl_command)" "true"

# --- migration depuis l'ancien chemin ----------------------------------------

# Tout renderer publie doit etre reconnu, pas seulement le premier. Un hash
# manquant, c'est un utilisateur jamais migre, EN SILENCE : le fichier fige n'a
# pas de temoin a cote, donc aucun badge ne se declenche, et le diagnostic
# annonce "wired to something else -- left untouched on purpose", c'est-a-dire
# qu'il presente la panne comme une decision. Ca ne se voit pas a l'usage.
released_shas=""
while read -r commit version; do
  [ -n "$commit" ] || continue
  if ! renderer_of "$commit" > /dev/null 2>&1; then
    printf 'FAIL renderer %s introuvable dans git (%s)\n' "$version" "$commit"
    fail=$((fail + 1))
    continue
  fi
  sha=$(renderer_of "$commit" | sha256sum | cut -d' ' -f1)
  released_shas="$released_shas$sha
"
  if hook_hashes | grep -qxF "$sha"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL le renderer %s (%s) manque a LEGACY_SHA256\n  hash : %s\n' \
      "$version" "$commit" "$sha"
  fi
done <<EOF
$RELEASED
EOF

# Et l'inverse : un hash de trop, c'est un fichier qu'on adopterait puis
# supprimerait sans savoir d'ou il sort.
while read -r sha; do
  [ -n "$sha" ] || continue
  if printf '%s' "$released_shas" | grep -qxF "$sha"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL LEGACY_SHA256 accepte un hash qui n_est aucun renderer publie\n  hash : %s\n' "$sha"
  fi
done <<EOF
$(hook_hashes)
EOF

# La migration elle-meme, rejouee depuis chaque version publiee.
while read -r commit version; do
  [ -n "$commit" ] || continue
  renderer_of "$commit" > /dev/null 2>&1 || continue
  env_new 2.0.0
  renderer_of "$commit" > "$LEGACY"
  # Forme exacte ecrite par l'ancien installeur : $HOME reste litteral.
  jq -n '{statusLine:{type:"command",command:"bash \"$HOME/.claude/statusline-command.sh\""}}' \
    > "$SETTINGS"
  BAK="$LEGACY.pre-statusline-plugin.bak"
  printf '#!/bin/bash\n# le script personnel de quelqu un\n' > "$BAK"
  run_hook
  ok "migration $version : settings.json repointe sur le dest" "$(sl_command)" "$DEST"
  no_file "migration $version : l'ancien renderer est supprime" "$LEGACY"
  yes_file "migration $version : le .bak n'est jamais touche" "$BAK"
  eq "migration $version : le .bak est intact" \
    "$(sed -n 2p "$BAK")" "# le script personnel de quelqu un"
done <<EOF
$RELEASED
EOF

if ! renderer_of bcabb0a > /dev/null 2>&1; then
  printf 'FAIL migration : impossible de reproduire le renderer 1.0.0 depuis git\n'
  fail=$((fail + 1))
else

  # Un statusLine qui vise le .bak n'est pas le notre, meme si l'ancien chemin
  # dont il derive porte, lui, un renderer que nous avons livre.
  env_new 2.0.0
  git -C "$ROOT" show bcabb0a:scripts/statusline-command.sh > "$LEGACY"
  BAK="$LEGACY.pre-statusline-plugin.bak"
  printf '#!/bin/bash\nprintf maison\n' > "$BAK"
  jq -n '{statusLine:{type:"command",command:"bash \"$HOME/.claude/statusline-command.sh.pre-statusline-plugin.bak\""}}' \
    > "$SETTINGS"
  run_hook
  ok "statusLine vise le .bak : intouche" "$(sl_command)" ".pre-statusline-plugin.bak"
  yes_file "statusLine vise le .bak : rien n'est supprime" "$LEGACY"
  yes_file "statusLine vise le .bak : le .bak survit" "$BAK"

  # Hash inconnu = fichier de quelqu'un d'autre : ni repointage, ni suppression.
  env_new 2.0.0
  printf '#!/bin/bash\n# ma statusline maison\nprintf coucou\n' > "$LEGACY"
  jq -n '{statusLine:{type:"command",command:"bash \"$HOME/.claude/statusline-command.sh\""}}' \
    > "$SETTINGS"
  run_hook
  eq "hash inconnu : settings.json intouche" "$(sl_command)" 'bash "$HOME/.claude/statusline-command.sh"'
  yes_file "hash inconnu : l'ancien fichier est conserve" "$LEGACY"
fi

# --- chargement inline : le hook ne fait rien --------------------------------

env_new 2.0.0 statusline-inline
run_hook
no_file "inline : aucun renderer installe" "$DEST"
no_file "inline : aucun temoin" "$WITNESS"
no_file "inline : aucun pointeur" "$POINTER"
no_file "inline : settings.json pas cree" "$SETTINGS"

# --- marqueur de chantier : le hook ne fait rien -------------------------------

# Une marketplace locale n'execute PAS une copie : CLAUDE_PLUGIN_ROOT pointe sur
# l'arbre de travail lui-meme, et une edition y est prise des la session
# suivante, sans reinstallation. Un depot installe comme sa propre marketplace
# et laisse en place fait donc tourner le sync.sh en cours d'ecriture contre la
# vraie configuration de l'utilisateur. Le marqueur est le frein a main, et sa
# polarite est inversee a dessein : rien de pose = ce que recoit un vrai
# utilisateur, donc une recette de release teste exactement cet etat-la.
env_new 2.0.0
: > "$CLAUDE_PLUGIN_ROOT/.statusline-dev-hold"
run_hook
no_file "marqueur : aucun renderer installe" "$DEST"
no_file "marqueur : aucun temoin" "$WITNESS"
no_file "marqueur : aucun pointeur" "$POINTER"
no_file "marqueur : settings.json pas cree" "$SETTINGS"

# Seule l'existence compte : un contenu a interpreter est un contenu qu'on peut
# mal interpreter, et un marqueur vide doit freiner comme un autre.
env_new 2.0.0
printf 'peu importe\n' > "$CLAUDE_PLUGIN_ROOT/.statusline-dev-hold"
run_hook
no_file "marqueur non vide : aucun renderer installe" "$DEST"

# Il ne doit pas non plus toucher a une installation deja en place : le frein
# arrete le hook, il ne demonte pas ce que les sessions precedentes ont cable.
env_new 2.0.0
run_hook
wired=$(sl_command)
: > "$CLAUDE_PLUGIN_ROOT/.statusline-dev-hold"
rm -f "$WITNESS"
run_hook
eq "marqueur : settings.json intact" "$(sl_command)" "$wired"
no_file "marqueur : le temoin n'est pas reecrit" "$WITNESS"

# Et il est muet, comme tout le reste du cas nominal.
env_new 2.0.0
: > "$CLAUDE_PLUGIN_ROOT/.statusline-dev-hold"
out=$(bash "$HOOK" 2>/dev/null)
eq "marqueur : rien sur stdout" "$out" ""

# --- echec de copie => badge --------------------------------------------------

# Le temoin est ecrit AVANT la tentative de copie : c'est ce qui rend l'echec
# detectable. On installe donc une version, puis on casse la source et on
# remonte la version livree — le renderer reste a l'ancienne, le temoin passe a
# la nouvelle, et le badge doit apparaitre.
env_new 1.9.0
run_hook
eq "avant l'echec : renderer en 1.9.0" "$(grep -m1 '^VERSION=' "$DEST")" "VERSION='1.9.0'"
no "avant l'echec : pas de badge" "$(render_installed)" "⚠"

printf '{"name":"statusline","version":"2.0.0"}\n' > "$CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json"
chmod 000 "$CLAUDE_PLUGIN_ROOT/scripts/statusline-command.sh"
if [ -r "$CLAUDE_PLUGIN_ROOT/scripts/statusline-command.sh" ]; then
  printf 'SKIP echec de copie : la source reste lisible (execution privilegiee ?)\n'
else
  run_hook
  eq "echec de copie : le temoin passe a la version livree" "$(cat "$WITNESS")" "2.0.0"
  eq "echec de copie : le renderer reste a l'ancienne version" \
    "$(grep -m1 '^VERSION=' "$DEST")" "VERSION='1.9.0'"
  ok "echec de copie : le badge apparait" "$(render_installed)" "⚠"
  # Le badge doit etre le premier segment : un terminal tronque par la droite.
  eq "echec de copie : le badge est en tete" \
    "$(render_installed | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-3)" "⚠"
fi
chmod 644 "$CLAUDE_PLUGIN_ROOT/scripts/statusline-command.sh"

# Un echec de copie sur une install NEUVE ne doit pas cabler settings.json vers
# un fichier absent : mieux vaut pas de statusline qu'une statusline muette.
env_new 2.0.0
chmod 000 "$CLAUDE_PLUGIN_ROOT/scripts/statusline-command.sh"
if [ ! -r "$CLAUDE_PLUGIN_ROOT/scripts/statusline-command.sh" ]; then
  run_hook
  no_file "echec sur install neuve : le renderer est absent" "$DEST"
  eq "echec sur install neuve : settings.json non cable" "$(sl_command)" ""
fi
chmod 644 "$CLAUDE_PLUGIN_ROOT/scripts/statusline-command.sh"

# Et il ne doit pas casser une migration en cours : l'ancien renderer marche.
if git -C "$ROOT" show bcabb0a:scripts/statusline-command.sh > /dev/null 2>&1; then
  env_new 2.0.0
  git -C "$ROOT" show bcabb0a:scripts/statusline-command.sh > "$LEGACY"
  jq -n '{statusLine:{type:"command",command:"bash \"$HOME/.claude/statusline-command.sh\""}}' \
    > "$SETTINGS"
  chmod 000 "$CLAUDE_PLUGIN_ROOT/scripts/statusline-command.sh"
  if [ ! -r "$CLAUDE_PLUGIN_ROOT/scripts/statusline-command.sh" ]; then
    run_hook
    yes_file "echec pendant migration : l'ancien renderer est conserve" "$LEGACY"
    eq "echec pendant migration : settings.json reste sur l'ancien" \
      "$(sl_command)" 'bash "$HOME/.claude/statusline-command.sh"'
  fi
  chmod 644 "$CLAUDE_PLUGIN_ROOT/scripts/statusline-command.sh"
fi

# Si l'ecriture de settings.json echoue, l'ancien renderer NE DOIT PAS etre
# supprime : l'entree le designe encore, et le supprimer ferait tomber une
# statusline qui marche vers un vide muet.
if git -C "$ROOT" show bcabb0a:scripts/statusline-command.sh > /dev/null 2>&1; then
  env_new 2.0.0
  git -C "$ROOT" show bcabb0a:scripts/statusline-command.sh > "$LEGACY"
  jq -n '{statusLine:{type:"command",command:"bash \"$HOME/.claude/statusline-command.sh\""}}' \
    > "$SETTINGS"
  chmod 500 "$HOME/.claude"   # lecture possible, ecriture non
  if ! ( : > "$HOME/.claude/.probe" ) 2>/dev/null; then
    run_hook
    yes_file "settings.json non ecrit : l'ancien renderer survit" "$LEGACY"
  else
    rm -f "$HOME/.claude/.probe"
    printf 'SKIP ecriture impossible non simulable (execution privilegiee ?)\n'
  fi
  chmod 700 "$HOME/.claude"
fi

# --- temoin absent => pas de badge -------------------------------------------

# Cas de la session de migration elle-meme : le renderer tourne depuis un
# emplacement sans temoin, il ne peut rien affirmer sur sa fraicheur.
env_new 2.0.0
run_hook
rm -f "$WITNESS"
no "temoin absent : pas de badge" "$(render_installed)" "⚠"

# Un temoin vide n'est pas une preuve de peremption non plus.
env_new 2.0.0
run_hook
: > "$WITNESS"
no "temoin vide : pas de badge" "$(render_installed)" "⚠"

# --- idempotence --------------------------------------------------------------

env_new 2.0.0
run_hook
first=$(sl_command)
inode=$(ls -i "$SETTINGS" | awk '{print $1}')
run_hook
eq "deux executions : settings.json stable" "$(sl_command)" "$first"
no "deux executions : pas de badge" "$(render_installed)" "⚠"
# L'ecriture passe par mktemp + mv : un inode inchange prouve qu'on n'a pas
# reecrit le fichier de l'utilisateur pour rien a chaque demarrage de session.
eq "deux executions : settings.json pas reecrit" "$(ls -i "$SETTINGS" | awk '{print $1}')" "$inode"

# --- bascule du gagnant -------------------------------------------------------

# Le meme plugin installe depuis deux marketplaces obtient deux destinations,
# CLAUDE_PLUGIN_DATA portant le nom de la marketplace. Une seule copie se charge
# a la fois -- la premiere clef <nom>@<marketplace> de enabledPlugins -- donc un
# seul hook tourne et les deux ne peuvent pas se disputer settings.json. Mais ce
# gagnant BASCULE : desactiver la copie gagnante promeut l'autre, et reordonner
# enabledPlugins aussi. L'ancien dossier de donnees, lui, RESTE sur disque,
# puisque son plugin est toujours installe -- c'est ce qui distingue cette
# bascule d'une desinstallation, et c'est pour ca que l'existence de l'ancienne
# destination ne peut pas servir de preuve de propriete.
#
# L'entree qu'on a ecrite nous-memes doit donc rester reconnaissable a son
# sentinelle seule. Sans ca, la statusline resterait bloquee pour de bon sur
# l'avis "renderer absent" apres la moindre bascule.
env_new 2.0.0 statusline-marche-a
run_hook
dest_a="$DEST"
moved=$(sl_command)
export CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA%-a}-b"
DEST="$CLAUDE_PLUGIN_DATA/statusline-command.sh"
run_hook
ok "bascule : settings.json repointe" "$(sl_command)" "$DEST"
no "bascule : l'ancien dest a disparu de l'entree" "$(sl_command)" "$moved"
yes_file "bascule : le renderer est installe au nouvel endroit" "$DEST"
# Le coeur du cas : l'install perdante est masquee, pas desinstallee.
yes_file "bascule : l'ancienne destination existe toujours" "$dest_a"

# La bascule inverse doit reprendre la main de la meme facon. Un seul hook
# tournant a la fois, ca converge a chaque fois au lieu d'osciller.
export CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA%-b}-a"
DEST="$dest_a"
run_hook
ok "bascule retour : settings.json repointe" "$(sl_command)" "$dest_a"
back=$(sl_command)
inode=$(ls -i "$SETTINGS" | awk '{print $1}')
run_hook
eq "bascule retour : stable a la session suivante" "$(sl_command)" "$back"
eq "bascule retour : settings.json pas reecrit" "$(ls -i "$SETTINGS" | awk '{print $1}')" "$inode"

# --- entree 1.x dont le renderer a disparu ------------------------------------

# L'utilisateur a supprime ~/.claude/statusline-command.sh a la main en laissant
# l'entree en place : la statusline est deja vide. Exiger le fichier pour
# prouver la propriete rendait le cas irreparable a jamais, alors que le texte
# de l'entree est mot pour mot ce que notre propre installeur 1.x ecrivait et
# qu'il n'y a rien a ecraser.
env_new 2.0.0
jq -n '{statusLine:{type:"command",command:"bash \"$HOME/.claude/statusline-command.sh\""}}' \
  > "$SETTINGS"
run_hook
ok "1.x orphelin : settings.json repointe sur le dest" "$(sl_command)" "$DEST"

# Mais un fichier PRESENT et inconnu reste la propriete de quelqu'un d'autre :
# l'absence est la preuve, pas le chemin.
env_new 2.0.0
printf '#!/bin/bash\nprintf maison\n' > "$LEGACY"
jq -n '{statusLine:{type:"command",command:"bash \"$HOME/.claude/statusline-command.sh\""}}' \
  > "$SETTINGS"
run_hook
eq "1.x hash inconnu : toujours intouche" \
  "$(sl_command)" 'bash "$HOME/.claude/statusline-command.sh"'
yes_file "1.x hash inconnu : le fichier survit" "$LEGACY"

# --- un HOME aux caracteres speciaux -------------------------------------------

# La commande gardee interpole $DEST dans une chaine entre guillemets doubles
# qu'un shell reexecutera. Un HOME contenant " ` ou $ y produirait une entree
# cassee -- ou une substitution de commande -- et la reconnaissance de propriete
# la relouperait ensuite a chaque session. L'assertion qui compte n'est pas la
# forme de l'entree mais qu'un shell l'execute et obtienne bien le renderer.
weird=$(mktemp -d)
temps+=("$weird")
# En production CLAUDE_PLUGIN_DATA vit SOUS $HOME, donc c'est un HOME bizarre
# qui rend la destination bizarre. On reproduit ce couplage.
odd='ho"me $x`id`'
if mkdir -p "$weird/$odd/.claude" "$weird/$odd/data" 2>/dev/null; then
  env_new 2.0.0
  export HOME="$weird/$odd"
  export CLAUDE_PLUGIN_DATA="$HOME/data/statusline-sdrik-plugins"
  SETTINGS="$HOME/.claude/settings.json"
  POINTER="$HOME/.claude/statusline-plugin.json"
  DEST="$CLAUDE_PLUGIN_DATA/statusline-command.sh"
  run_hook
  yes_file "dest special : le renderer est installe" "$DEST"
  got=$(bash -c "$(sl_command)" 2>/dev/null < /dev/null)
  no "dest special : la commande gardee ne crie pas au renderer absent" \
    "$got" "renderer absent"
  # `id` dans le chemin : s'il avait ete substitue, la sortie le montrerait.
  no "dest special : aucune substitution de commande" "$got" "uid="
  # Et elle doit rester reconnue comme notre a la session suivante, sinon le
  # hook reecrirait settings.json a chaque demarrage.
  first=$(sl_command)
  inode=$(ls -i "$SETTINGS" | awk '{print $1}')
  run_hook
  eq "dest special : entree stable" "$(sl_command)" "$first"
  eq "dest special : settings.json pas reecrit" \
    "$(ls -i "$SETTINGS" | awk '{print $1}')" "$inode"
else
  printf 'SKIP destination aux caracteres speciaux non creable\n'
fi

# --- silence ------------------------------------------------------------------

# Le stdout d'un hook SessionStart est injecte dans le contexte du modele : le
# cas nominal doit etre muet.
env_new 2.0.0
out=$(bash "$HOOK" 2>/dev/null)
eq "cas nominal : rien sur stdout" "$out" ""

env_new 2.0.0 statusline-inline
out=$(bash "$HOOK" 2>/dev/null)
eq "inline : rien sur stdout" "$out" ""

printf '\n%d passes, %d echecs\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
