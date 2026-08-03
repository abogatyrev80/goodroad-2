#!/bin/bash
set -euo pipefail

CFD="$HOME/.local/bin/cloudflared"
LOG="/tmp/cloudflared.log"
API="https://goodroad.su"
MODEL="qwopus3.5-tools"

if [ ! -x "$CFD" ]; then
  mkdir -p "$HOME/.local/bin"
  curl -sL -o "$CFD" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x "$CFD"
fi

pkill -f 'cloudflared tunnel' 2>/dev/null || true
sleep 2
nohup "$CFD" tunnel --url http://localhost:11434 --no-autoupdate >"$LOG" 2>&1 &

for i in $(seq 1 15); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 2
done

if [ -z "$URL" ]; then
  echo "ERROR: tunnel URL not found in $LOG" >&2
  tail -20 "$LOG" >&2
  exit 1
fi

echo "Tunnel: $URL"
curl -s -X POST "$API/api/llm/settings" \
  -H 'Content-Type: application/json' \
  -d "{\"url\":\"$URL\",\"model\":\"$MODEL\"}"
echo
curl -s "$API/api/llm/health"
echo
