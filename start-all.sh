#!/usr/bin/env bash
# MapForAll — start everything for local development (macOS / Linux).
#   ./start-all.sh           start (rebuilds the website automatically after a git pull)
#   ./start-all.sh --build   force a website rebuild
#   ./stop-all.sh            stop everything
# First time on a new machine: run ./setup.sh first. Logs: .local-logs/
set -u
cd "$(dirname "$0")"
ROOT="$(pwd)"
LOGS="$ROOT/.local-logs"
mkdir -p "$LOGS"

envval() { # envval FILE KEY  -> value of KEY=... (last match, quotes stripped)
  [ -f "$1" ] || return 0
  grep -E "^$2=" "$1" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}
port_open() { nc -z 127.0.0.1 "$1" >/dev/null 2>&1; }
wait_port() { # port label seconds logname
  for _ in $(seq 1 "$3"); do port_open "$1" && { echo "  ✅ $2 is running (port $1)"; return 0; }; sleep 1; done
  echo "  ❌ $2 did not start. Last lines of $LOGS/$4.log:"; tail -n 20 "$LOGS/$4.log" 2>/dev/null; exit 1
}

[ -f agents/.env ] || { echo "❌ agents/.env is missing. Run ./setup.sh, then fill it in (see SETUP_AND_CHANGES.md)."; exit 1; }
[ -f client/.env.local ] || { echo "❌ client/.env.local is missing. Run ./setup.sh, then fill it in (see SETUP_AND_CHANGES.md)."; exit 1; }
[ -x agents/.venv/bin/adk ] || { echo "❌ Python agents are not installed. Run ./setup.sh first."; exit 1; }

MONGODB_URI="$(envval agents/.env MONGODB_URI)"
[ -n "$MONGODB_URI" ] || MONGODB_URI="$(envval client/.env.local MONGODB_URI)"
[ -n "$MONGODB_URI" ] || { echo "❌ MONGODB_URI is not set in agents/.env"; exit 1; }

echo "Stopping anything already running…"
"$ROOT/stop-all.sh" >/dev/null 2>&1
sleep 2

echo "1/4 Database"
case "$MONGODB_URI" in
  mongodb://127.0.0.1*|mongodb://localhost*)
    if port_open 27017; then
      echo "  ✅ Local MongoDB already running (port 27017)"
    else
      MONGOD="${MONGOD_BIN:-$(command -v mongod || true)}"
      [ -z "$MONGOD" ] && MONGOD="$(ls -d "$HOME"/mongodb/*/bin/mongod 2>/dev/null | head -n 1)"
      [ -x "$MONGOD" ] || { echo "  ❌ mongod not found. Install MongoDB Community, or set MONGOD_BIN=/path/to/mongod (see SETUP_AND_CHANGES.md)."; exit 1; }
      DATA="${MONGO_DATA:-$HOME/mongodb/data}"; mkdir -p "$DATA"
      nohup "$MONGOD" --dbpath "$DATA" --bind_ip 127.0.0.1 > "$LOGS/mongodb.log" 2>&1 &
      echo $! > "$LOGS/mongod.pid"
      wait_port 27017 "Local MongoDB" 30 mongodb
    fi ;;
  *) echo "  ✅ Using remote MongoDB (Atlas) from agents/.env" ;;
esac

echo "2/4 Database connector (MongoDB MCP, pinned to 1.14.0)"
MDB_MCP_CONNECTION_STRING="$MONGODB_URI" nohup npx -y mongodb-mcp-server@1.14.0 \
  --transport http --httpPort=3100 > "$LOGS/connector.log" 2>&1 &
wait_port 3100 "Connector" 120 connector

echo "3/4 AI agents"
# python.org Python on macOS ships without CA certificates: use certifi's bundle.
CERTS="$(agents/.venv/bin/python -c 'import certifi; print(certifi.where())' 2>/dev/null)"
( cd agents && SSL_CERT_FILE="$CERTS" REQUESTS_CA_BUNDLE="$CERTS" nohup .venv/bin/adk api_server hodari > "$LOGS/agents.log" 2>&1 & )
wait_port 8000 "AI agents" 120 agents

echo "4/4 Website"
cd client
[ -d node_modules ] || { echo "  Installing website packages (first run)…"; npm install > "$LOGS/npm-install.log" 2>&1 || { echo "  ❌ npm install failed — see $LOGS/npm-install.log"; exit 1; }; }
HEAD_NOW="$(git rev-parse HEAD 2>/dev/null)$(git status --porcelain 2>/dev/null | md5sum 2>/dev/null || git status --porcelain | md5)"
if [ "${1:-}" = "--build" ] || [ ! -f .next/BUILD_ID ] || [ "$(cat .next/.mfa-build-head 2>/dev/null)" != "$HEAD_NOW" ]; then
  echo "  Building the website (a few minutes)…"
  npm run build > "$LOGS/build.log" 2>&1 || { echo "  ❌ Build failed — last lines:"; tail -n 25 "$LOGS/build.log"; exit 1; }
  echo "$HEAD_NOW" > .next/.mfa-build-head
fi
nohup npm start > "$LOGS/website.log" 2>&1 &
wait_port 3000 "Website" 60 website

echo ""
echo "🎉 All running. Open http://localhost:3000"
echo "   Stop everything with: ./stop-all.sh   ·   Logs: .local-logs/"
