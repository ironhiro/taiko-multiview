#!/usr/bin/env bash
# Starts or stops the local multiview stack and waits until it answers.
#
#   stack.sh mock     mock backend :5180 (6x9 mock venues, real players) + Vite :5173
#   stack.sh devapi   Vite :5175 proxied to the deployed dev server's API (real data)
#   stack.sh stop     stops everything listening on the stack's ports
#   stack.sh status   what is listening
#
# Runs on macOS and on Windows Git Bash: the .NET 10 path, the LAN address and killing a
# port are each resolved per platform (see the helpers below).
#
# Logs go to $TMPDIR/taiko-stack-*.log, and Git Bash usually leaves TMPDIR unset, so there
# they land in /tmp. `stack.sh status` prints the log paths it would use.
#
# A running API holds a lock on backend/TaikoLabs.Api/bin, so `dotnet test` and Playwright's
# own :5190 server cannot build while this stack is up. Build those elsewhere instead of
# stopping the stack: -p:BaseOutputPath=<a temp dir>/ (multiview-local-env documents it).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
LOG="${TMPDIR:-/tmp}"
DEV_API="https://taiko-multiview-dev.agreeabletree-b826eb73.koreacentral.azurecontainerapps.io"

case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) WINDOWS=1 ;; *) WINDOWS=0 ;; esac

# The API needs a .NET 10 SDK. macOS has .NET 8 from Homebrew on PATH with 10 installed
# beside it; on Windows the dotnet on PATH is already 10. Take the first one that has it.
pick_dotnet() {
  local candidate
  for candidate in "${DOTNET:-}" "$(command -v dotnet || true)" /usr/local/share/dotnet/dotnet; do
    [ -n "$candidate" ] || continue
    if "$candidate" --list-sdks 2>/dev/null | grep -q '^10\.'; then echo "$candidate"; return 0; fi
  done
  echo "no .NET 10 SDK found (tried \$DOTNET, PATH, /usr/local/share/dotnet)" >&2
  return 1
}

lan_address() {
  if [ "$WINDOWS" = 1 ]; then
    powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.IPAddress -ne '127.0.0.1' -and \$_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress" 2>/dev/null | tr -d '\r' || true
  else
    ipconfig getifaddr en0 2>/dev/null || true
  fi
}

# pkill is not in Git Bash and its patterns do not match the Windows process names anyway,
# so both platforms kill whoever holds the port instead of matching a command line.
kill_port() { # port
  if [ "$WINDOWS" = 1 ]; then
    local pid
    for pid in $(netstat -ano 2>/dev/null | awk -v p=":$1" '$0 ~ /LISTENING/ && $2 ~ p"$" { print $NF }' | sort -u); do
      taskkill //PID "$pid" //F >/dev/null 2>&1 || true
    done
  else
    lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null || true
  fi
}

wait_for() { # url, seconds
  for _ in $(seq 1 "$2"); do curl -sf -o /dev/null "$1" && return 0; sleep 1; done
  echo "timed out waiting for $1" >&2; return 1
}

case "${1:-}" in
  mock)
    DOTNET="$(pick_dotnet)"
    export DOTNET_ROOT="$(dirname "$DOTNET")"
    LAN="$(lan_address)"; LAN="${LAN:-localhost}"
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
    LAN="$(lan_address)"; LAN="${LAN:-localhost}"
    if ! curl -sf -o /dev/null http://localhost:5175; then
      (cd "$ROOT/frontend" && TAIKO_API_PROXY="$DEV_API" nohup npx vite --port 5175 --strictPort --host >"$LOG/taiko-stack-vite-devapi.log" 2>&1 &)
    fi
    wait_for http://localhost:5175 60
    echo "dev-API stack up: http://localhost:5175  (phone: http://$LAN:5175)"
    ;;
  stop)
    for p in 5173 5175 5180; do kill_port "$p"; done
    echo "stopped"
    ;;
  status)
    for p in 5180 5173 5175; do
      if curl -sf -o /dev/null "http://localhost:$p$([ $p = 5180 ] && echo /api/health)"; then echo "$p up"; else echo "$p down"; fi
    done
    echo "logs: $LOG/taiko-stack-{api,vite-mock,vite-devapi}.log"
    ;;
  *)
    sed -n '2,16p' "$0"; exit 1 ;;
esac
