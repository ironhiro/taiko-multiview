#!/usr/bin/env bash
# Starts or stops the local multiview stack and waits until it answers.
#
#   stack.sh mock     mock backend :5180 (6x9 mock venues, real players) + Vite :5173
#   stack.sh devapi   Vite :5175 proxied to the deployed dev server's API (real data)
#   stack.sh stop     stops everything this script started
#   stack.sh status   what is listening
#
# Logs go to $TMPDIR/taiko-stack-*.log. Vite binds --host, so a phone on the same Wi-Fi
# reaches it at http://<LAN IP>:<port>/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
LOG="${TMPDIR:-/tmp}"
DEV_API="https://taiko-multiview-dev.agreeabletree-b826eb73.koreacentral.azurecontainerapps.io"
# The dotnet on PATH is .NET 8 (Homebrew); the API needs the .NET 10 SDK installed here.
DOTNET="${DOTNET:-/usr/local/share/dotnet/dotnet}"
export DOTNET_ROOT="$(dirname "$DOTNET")"
LAN="$(ipconfig getifaddr en0 2>/dev/null || echo localhost)"

wait_for() { # url, seconds
  for _ in $(seq 1 "$2"); do curl -sf -o /dev/null "$1" && return 0; sleep 1; done
  echo "timed out waiting for $1" >&2; return 1
}

case "${1:-}" in
  mock)
    if [ ! -f "$ROOT/backend/TaikoLabs.Api/venues.mock.json" ]; then
      node "$ROOT/scripts/mock-venues.mjs" --venues "${VENUES:-6}" --stations "${STATIONS:-9}"
    fi
    if ! curl -sf -o /dev/null http://localhost:5180/api/health; then
      (cd "$ROOT/backend/TaikoLabs.Api" && ASPNETCORE_ENVIRONMENT=Mock nohup "$DOTNET" run --no-launch-profile --urls http://localhost:5180 >"$LOG/taiko-stack-api.log" 2>&1 &)
    fi
    if ! curl -sf -o /dev/null http://localhost:5173; then
      (cd "$ROOT/frontend" && nohup npx vite --port 5173 --strictPort --host >"$LOG/taiko-stack-vite-mock.log" 2>&1 &)
    fi
    wait_for http://localhost:5180/api/health 180
    wait_for http://localhost:5173 60
    echo "mock stack up: http://localhost:5173  (phone: http://$LAN:5173)"
    ;;
  devapi)
    if ! curl -sf -o /dev/null http://localhost:5175; then
      (cd "$ROOT/frontend" && TAIKO_API_PROXY="$DEV_API" nohup npx vite --port 5175 --strictPort --host >"$LOG/taiko-stack-vite-devapi.log" 2>&1 &)
    fi
    wait_for http://localhost:5175 60
    echo "dev-API stack up: http://localhost:5175  (phone: http://$LAN:5175)"
    ;;
  stop)
    pkill -f "vite --port 5173" || true
    pkill -f "vite --port 5175" || true
    pkill -f "urls http://localhost:5180" || true
    echo "stopped"
    ;;
  status)
    for p in 5180 5173 5175; do
      if curl -sf -o /dev/null "http://localhost:$p$([ $p = 5180 ] && echo /api/health)"; then echo "$p up"; else echo "$p down"; fi
    done
    ;;
  *)
    sed -n '2,11p' "$0"; exit 1 ;;
esac
