#!/bin/bash
# Renderer tests: feed synthetic statusline payloads, assert on the output.
# Run: bash tests/render.test.sh

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/statusline-command.sh"
ESC=$'\033'
pass=0
fail=0

# mk <total_input_tokens> <exceeds_200k> <requests|-> -> a payload on stdout
mk() {
  local tin="$1" exc="$2" req="$3" pc=""
  [ "$req" != "-" ] && pc=",\"prompt_cache\":{\"requests\":$req}"
  printf '{"model":{"display_name":"Opus"},"effort":{"level":"high"},"context_window":{"used_percentage":8,"context_window_size":1000000,"total_input_tokens":%s,"total_output_tokens":5000},"exceeds_200k_tokens":%s%s,"rate_limits":{"five_hour":{"used_percentage":23.5,"resets_at":%s}}}' \
    "$tin" "$exc" "$pc" "$(( $(date +%s) + 7200 ))"
}

# mk_ctx <total_input_tokens> -> payload with the context gauge as the ONLY gauge,
# so bar cells can be counted without the rate-limit bars colliding.
mk_ctx() {
  printf '{"context_window":{"used_percentage":8,"context_window_size":1000000,"total_input_tokens":%s,"total_output_tokens":5000}}' "$1"
}

render() { bash "$SCRIPT"; }

# cells <output> <bg_code> -> how many bar cells carry that background
cells() { printf '%s' "$1" | grep -o "\[48;5;$2;" | wc -l; }

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

# --- compteur d'iterations de boucle -----------------------------------------

out=$(mk 50000 false - | render)
no "pas de segment quand prompt_cache est absent" "$out" "⟳"

out=$(mk 50000 false 42 | render)
ok "affiche le nombre d'iterations" "$out" "⟳ 42"

no "le compteur n'a pas de barre" "$out" "⟳ 42/"

# Le degrade sature en vert sous l'ancre basse et en rouge au-dessus de la haute.
out=$(mk 50000 false 5 | render)
ok "vert sous l'ancre basse" "$out" "${ESC}[38;5;34m⟳ 5"

out=$(mk 50000 false 30 | render)
ok "vert a l'ancre basse" "$out" "${ESC}[38;5;34m⟳ 30"

out=$(mk 50000 false 250 | render)
ok "rouge a l'ancre haute" "$out" "${ESC}[38;5;196m⟳ 250"

out=$(mk 50000 false 537 | render)
ok "sature en rouge au-dela de l'ancre haute" "$out" "${ESC}[38;5;196m⟳ 537"

out=$(mk 50000 false 140 | render)
no "valeur mediane : pas vert" "$out" "${ESC}[38;5;34m⟳ 140"
no "valeur mediane : pas rouge" "$out" "${ESC}[38;5;196m⟳ 140"
ok "valeur mediane : affichee" "$out" "⟳ 140"

out=$(STATUSLINE_TURNS_MAX=100 render < <(mk 50000 false 100))
ok "STATUSLINE_TURNS_MAX deplace l'ancre haute" "$out" "${ESC}[38;5;196m⟳ 100"

out=$(STATUSLINE_TURNS_MIN=200 render < <(mk 50000 false 200))
ok "STATUSLINE_TURNS_MIN deplace l'ancre basse" "$out" "${ESC}[38;5;34m⟳ 200"

# --- jauge de contexte sur l'echelle des tokens absolus ----------------------

out=$(mk 50000 false 42 | render)
ok "sous le palier jaune : fond vert" "$out" "[48;5;28;"
no "sous le palier jaune : pas de fond jaune" "$out" "[48;5;136;"

out=$(mk 150000 false 42 | render)
ok "entre les paliers : fond jaune" "$out" "[48;5;136;"

out=$(mk 250000 false 42 | render)
ok "au-dela du palier critique : fond rouge" "$out" "[48;5;124;"

# exceeds_200k_tokens is derived by the harness from this same token count
# against a fixed 200000, so honouring it would cap a tuned CTX_CRIT.
out=$(STATUSLINE_CTX_CRIT=1000000 render < <(mk 250000 true 42))
ok "un CTX_CRIT regle n'est pas plafonne par exceeds_200k_tokens" "$out" "[48;5;28;"
no "…et ne peint pas la barre en rouge" "$out" "[48;5;124;"

# The bar fills on the 0 -> CTX_CRIT scale, not on the model's window (8% here).
# Counting cells is what pins this down: the label is interleaved with escapes.
# 100k is exactly CTX_WARN, so the filled cells are yellow (136), not green.
out=$(mk_ctx 100000 | render)
eq "13 cellules de barre au total" "$(( $(cells "$out" 136) + $(cells "$out" 238) ))" "13"
eq "100k sur 200k remplit 7 cellules sur 13" "$(cells "$out" 136)" "7"

out=$(mk_ctx 20000 | render)
eq "20k sur 200k remplit 1 cellule sur 13" "$(cells "$out" 28)" "1"

# Guards against a regression to used_percentage, which would fill 1 cell here.
out=$(mk_ctx 180000 | render)
eq "180k sur 200k remplit 12 cellules sur 13" "$(cells "$out" 136)" "12"

out=$(STATUSLINE_CTX_WARN=40000 render < <(mk 50000 false 42))
ok "STATUSLINE_CTX_WARN deplace le palier jaune" "$out" "[48;5;136;"

out=$(STATUSLINE_CTX_CRIT=40000 render < <(mk 50000 false 42))
ok "STATUSLINE_CTX_CRIT deplace le palier rouge" "$out" "[48;5;124;"

# --- texte conserve et ordre des segments ------------------------------------

out=$(mk 90000 false 42 | render)
ok "les tokens entrants/sortants restent affiches" "$out" "↑90.0k/1.0M ↓5.0k"

# Le compteur se place apres la jauge de contexte et avant les quotas.
# Pas d'horloge dans l'assertion : time_left relit `date` de son cote.
plain=$(printf '%s' "$out" | sed 's/\x1b\[[0-9;]*m//g')
if printf '%s' "$plain" | grep -qE '↑90\.0k/1\.0M ↓5\.0k │ ⟳ 42 │ .*[0-9]+[hm]'; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf 'FAIL ordre des segments\n  sortie : %q\n' "$plain"
fi

# --- robustesse ---------------------------------------------------------------

out=$(printf '{}' | render)
no "payload vide : pas de compteur" "$out" "⟳"

out=$(printf '{"prompt_cache":{"requests":null}}' | render)
no "requests null : pas de compteur" "$out" "⟳"

# Avant la premiere reponse API le harnais envoie total_input_tokens=0 avec
# used_percentage null : la jauge ne doit pas s'afficher pour autant.
out=$(printf '{"context_window":{"total_input_tokens":0,"total_output_tokens":0,"context_window_size":200000,"used_percentage":null}}' | render)
no "session neuve : pas de jauge de contexte" "$out" "48;5;"
no "session neuve : pas de tokens" "$out" "↑0"

# Une valeur non numerique doit retomber sur le defaut, sans bruit sur stderr.
err=$(STATUSLINE_CTX_CRIT=200k render < <(mk 50000 false 42) 2>&1 >/dev/null)
eq "override non numerique : rien sur stderr" "$err" ""
out=$(STATUSLINE_CTX_CRIT=200k render < <(mk_ctx 100000))
eq "override non numerique : defaut de 200000 applique" "$(cells "$out" 136)" "7"

printf '\n%d passes, %d echecs\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
