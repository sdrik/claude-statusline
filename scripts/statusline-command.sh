#!/bin/bash
# Claude Code statusline
# Order: email | mode | model | effort | context | loop turns | rate limit usage

command -v jq >/dev/null 2>&1 || exit 0

# Degradation anchors. These are product choices, not research results —
# see the "Session degradation" section of the README before changing them.
CTX_WARN=${STATUSLINE_CTX_WARN:-100000}   # tokens: gauge turns yellow
CTX_CRIT=${STATUSLINE_CTX_CRIT:-200000}   # tokens: gauge turns red, and full scale
TURNS_LO=${STATUSLINE_TURNS_MIN:-30}      # loop turns: below this the counter stays green
TURNS_HI=${STATUSLINE_TURNS_MAX:-250}     # loop turns: at or above this it saturates red

# A non-numeric override would otherwise mis-scale the gauge and spam stderr on
# every refresh, so fall back to the default instead of trusting the value.
for _v in CTX_WARN:100000 CTX_CRIT:200000 TURNS_LO:30 TURNS_HI:250; do
  _name=${_v%%:*}
  case ${!_name} in
    '' | *[!0-9]*) eval "$_name=${_v##*:}" ;;
  esac
done
unset _v _name

input="$(cat)"

# Colors (ANSI-C quoting so escapes are real bytes)
C_RESET=$'\033[0m'
C_DIM=$'\033[2m'
C_EMAIL=$'\033[36m'   # cyan
C_MODE=$'\033[35m'    # magenta
C_MODEL=$'\033[34m'   # blue
C_EFFORT=$'\033[33m'  # yellow
# Tier colors. Rate-limit gauges tier on a percentage (50% / 80%); the context
# gauge tiers on absolute tokens (CTX_WARN / CTX_CRIT) instead.
C_CTX_LO=$'\033[32m'  # green
C_CTX_MID=$'\033[33m' # yellow
C_CTX_HI=$'\033[31m'  # red

SEP="${C_DIM} │ ${C_RESET}"

segments=()

# 1. Connected user's email
email=""
if [ -f "$HOME/.claude.json" ]; then
  email=$(jq -r '.oauthAccount.emailAddress // empty' "$HOME/.claude.json" 2>/dev/null)
fi
[ -z "$email" ] && email="${CLAUDE_CODE_EMAIL:-}"
[ -n "$email" ] && segments+=("${C_EMAIL}${email}${C_RESET}")

# 2. Current mode (plan / default / accept edits / bypass permissions)
transcript=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
mode_raw=""
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  mode_raw=$(grep -a '"type":"permission-mode"' "$transcript" 2>/dev/null | tail -n1 | jq -r '.permissionMode // empty' 2>/dev/null)
fi
mode=""
case "$mode_raw" in
  plan) mode="Plan mode" ;;
  acceptEdits) mode="Accept edits" ;;
  bypassPermissions) mode="Bypass perms" ;;
  default) mode="Default mode" ;;
  "") mode="" ;;
  *) mode="$mode_raw" ;;
esac
[ -n "$mode" ] && segments+=("${C_MODE}${mode}${C_RESET}")

# 3. Model name
model=$(printf '%s' "$input" | jq -r '.model.display_name // empty')
[ -n "$model" ] && segments+=("${C_MODEL}${model}${C_RESET}")

# 4. Reasoning effort level
effort=$(printf '%s' "$input" | jq -r '.effort.level // empty')
[ -n "$effort" ] && segments+=("${C_EFFORT}${effort}${C_RESET}")

# Formatting helpers
fmt_tokens() {
  awk -v n="$1" 'BEGIN{
    if (n=="" || n=="null") { print ""; exit }
    if (n>=1000000) printf "%.1fM", n/1000000;
    else if (n>=1000) printf "%.1fk", n/1000;
    else printf "%d", n;
  }'
}
# tier_color <pct> -> foreground color by usage threshold
tier_color() {
  if [ "$1" -ge 80 ]; then printf '%s' "$C_CTX_HI";
  elif [ "$1" -ge 50 ]; then printf '%s' "$C_CTX_MID";
  else printf '%s' "$C_CTX_LO"; fi
}
# tier_bg <pct> -> 256-color background code by usage threshold
tier_bg() {
  if [ "$1" -ge 80 ]; then printf '124';
  elif [ "$1" -ge 50 ]; then printf '136';
  else printf '28'; fi
}
# gauge <pct> <bg> -> 13-cell bar, fill as colored BACKGROUND, percentage centered on top
gauge() {
  awk -v p="$1" -v bg="$2" 'BEGIN{
    esc=sprintf("%c", 27);
    w=13; f=int(p/100*w+0.5); if(f>w)f=w; if(f<0)f=0;
    lab=sprintf("%d%%", p); ll=length(lab); start=int((w-ll)/2);
    fillbg=sprintf("%s[48;5;%d;38;5;255;1m", esc, bg);   # colored bg, bright bold text
    emptybg=sprintf("%s[48;5;238;38;5;250m", esc);        # grey bg, dim text
    reset=sprintf("%s[0m", esc);
    s="";
    for(i=0;i<w;i++){
      c=" "; if(i>=start && i<start+ll) c=substr(lab, i-start+1, 1);
      s=s (i<f ? fillbg : emptybg) c;
    }
    print s reset;
  }'
}

# 5. Context consumption + I/O tokens (merged):
#    bar + percentage + ↑input/window + ↓output
#
# The bar reads on the ABSOLUTE token scale (0 → CTX_CRIT), not as a fraction of
# the model's advertised window: degradation tracks absolute tokens, and a 1M
# window would otherwise show a near-empty bar well past the danger zone. The
# window fraction is not lost — ↑input/window states it literally.
#
# `exceeds_200k_tokens` is deliberately unused: the harness derives it from this
# very token count against a fixed 200000, so honouring it would silently cap
# CTX_CRIT and paint a quarter-full bar red on a tuned 1M window.
ctx_size=$(printf '%s' "$input" | jq -r '.context_window.context_window_size // empty')
tin_raw=$(printf '%s' "$input" | jq -r '.context_window.total_input_tokens // empty')
tout_raw=$(printf '%s' "$input" | jq -r '.context_window.total_output_tokens // empty')
# total_input_tokens is a literal 0 before the first API response, whereas
# used_percentage is null — so the latter is what tells us the session started.
ctx_started=$(printf '%s' "$input" | jq -r '.context_window.used_percentage // empty')
# Integer form for the -ge threshold comparisons below.
tin_int=$(LC_ALL=C printf '%.0f' "${tin_raw:-0}" 2>/dev/null) || tin_int=0
if [ -n "$ctx_started" ] && [ -n "$tin_raw" ] && [ "$tin_raw" != "null" ]; then
  ctx_pct=$(awk -v t="$tin_raw" -v c="$CTX_CRIT" 'BEGIN{
    if (c<=0) { print 100; exit }
    p=int(100*t/c+0.5); if(p>100)p=100; if(p<0)p=0; print p;
  }')
  if [ "$tin_int" -ge "$CTX_CRIT" ]; then
    ctx_color=$C_CTX_HI ctx_bg=124
  elif [ "$tin_int" -ge "$CTX_WARN" ]; then
    ctx_color=$C_CTX_MID ctx_bg=136
  else
    ctx_color=$C_CTX_LO ctx_bg=28
  fi
  ctx_str="${C_RESET}$(gauge "$ctx_pct" "$ctx_bg")${ctx_color}"
  # ↑ input tokens / context window size (input count == context numerator)
  tin=$(fmt_tokens "$tin_raw")
  if [ -n "$tin" ]; then
    if [ -n "$ctx_size" ] && [ "$ctx_size" != "null" ]; then
      ctx_str="${ctx_str} ↑${tin}/$(fmt_tokens "$ctx_size")"
    else
      ctx_str="${ctx_str} ↑${tin}"
    fi
  fi
  # ↓ output tokens
  tout=$(fmt_tokens "$tout_raw")
  [ -n "$tout" ] && ctx_str="${ctx_str} ↓${tout}"
  segments+=("${ctx_color}${ctx_str}${C_RESET}")
fi

# 6. Agent-loop turns: one API request per loop iteration (model call + the tool
# calls it triggers). A correlated symptom of a degrading session, not a cause —
# long trajectories and thrashing co-occur, and the causal direction is
# confounded. Hence a continuous gradient and no alarm: there is no cliff to
# alarm on. Absent until the first API response of a session.
#
# turns_color <n> -> foreground color interpolated on a green→red ramp
turns_color() {
  awk -v n="$1" -v lo="$TURNS_LO" -v hi="$TURNS_HI" 'BEGIN{
    split("34 70 106 148 184 220 214 208 202 196", ramp, " ");
    t = (hi<=lo) ? 1 : (n-lo)/(hi-lo);
    if(t<0)t=0; if(t>1)t=1;
    printf "%c[38;5;%dm", 27, ramp[int(t*9+0.5)+1];
  }'
}
turns=$(printf '%s' "$input" | jq -r '.prompt_cache.requests // empty')
if [ -n "$turns" ] && [ "$turns" != "null" ]; then
  segments+=("$(turns_color "$turns")⟳${turns}${C_RESET}")
fi

# 7. Usage against Claude.ai subscription rate limits
# time_left <resets_at> -> " Xd Yh" / " 2h14" / " 24m" or nothing
time_left() {
  local reset_iso="$1" reset_epoch now diff d h m
  [ -z "$reset_iso" ] || [ "$reset_iso" = "null" ] && return
  # resets_at is a Unix epoch (integer); tolerate an ISO string too.
  if printf '%s' "$reset_iso" | grep -qE '^[0-9]+$'; then
    reset_epoch="$reset_iso"                       # already epoch seconds — no `date` needed (portable)
  else
    # ISO string fallback: try GNU (`date -d`) then BSD/macOS (`date -j -f`) syntax
    reset_epoch=$(date -d "$reset_iso" +%s 2>/dev/null) \
      || reset_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S%z" "$reset_iso" +%s 2>/dev/null) \
      || reset_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$reset_iso" +%s 2>/dev/null)
  fi
  [ -z "$reset_epoch" ] && return
  now=$(date +%s)                                  # `date +%s` is portable (GNU + BSD)
  diff=$((reset_epoch - now))
  [ "$diff" -gt 0 ] || return
  d=$((diff / 86400)); h=$(((diff % 86400) / 3600)); m=$(((diff % 3600) / 60))
  if [ "$d" -gt 0 ]; then
    printf ' %dd %dh' "$d" "$h"
  elif [ "$h" -gt 0 ]; then
    printf ' %dh%02d' "$h" "$m"
  else
    printf ' %dm' "$m"
  fi
}
five=$(printf '%s' "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
week=$(printf '%s' "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
five_reset=$(printf '%s' "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
week_reset=$(printf '%s' "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')
# each window is its own segment: "<label>:<gauge> (time left)", colored by threshold
if [ -n "$five" ]; then
  fv=$(LC_ALL=C printf '%.0f' "$five"); col=$(tier_color "$fv")
  segments+=("${C_RESET}$(gauge "$fv" "$(tier_bg "$fv")")${col}$(time_left "$five_reset")${C_RESET}")
fi
if [ -n "$week" ]; then
  wk=$(LC_ALL=C printf '%.0f' "$week"); col=$(tier_color "$wk")
  segments+=("${C_RESET}$(gauge "$wk" "$(tier_bg "$wk")")${col}$(time_left "$week_reset")${C_RESET}")
fi

# Join segments with separator
output=""
for i in "${!segments[@]}"; do
  if [ "$i" -eq 0 ]; then
    output="${segments[$i]}"
  else
    output="${output}${SEP}${segments[$i]}"
  fi
done

printf '%s\n' "$output"
