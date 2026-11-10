#!/usr/bin/env bash
# MapForAll — one-time setup on a new machine (macOS / Linux). Safe to run again.
set -u
cd "$(dirname "$0")"
ok() { echo "  ✅ $1"; }; bad() { echo "  ❌ $1"; FAIL=1; }
FAIL=0
echo "Checking tools…"
if command -v node >/dev/null; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$major" -ge 20 ] && ok "Node $(node -v)" || bad "Node $(node -v) is too old — install Node 20+ from nodejs.org"
else bad "Node is missing — install Node 20+ from nodejs.org"; fi
PY=""
for c in python3.12 python3.13 python3.11; do command -v $c >/dev/null && { PY=$c; break; }; done
[ -n "$PY" ] && ok "Python ($($PY --version))" || bad "Python 3.11–3.13 is missing — install Python 3.12 from python.org"
command -v nc >/dev/null && ok "nc" || bad "nc (netcat) is missing"
[ "$FAIL" = 0 ] || { echo "Fix the items above, then run ./setup.sh again."; exit 1; }

echo "Python agents…"
[ -d agents/.venv ] || $PY -m venv agents/.venv
agents/.venv/bin/pip install -q --upgrade pip
# --prefer-binary: Intel Macs have no wheel for the newest "cryptography"; take the latest ready-made one.
agents/.venv/bin/pip install -q --prefer-binary -r agents/requirements.txt && ok "agents installed" || { bad "pip install failed"; exit 1; }

echo "Website…"
( cd client && npm install --no-audit --no-fund >/dev/null 2>&1 ) && ok "client packages installed" || { bad "npm install failed (run it in client/ to see why)"; exit 1; }

echo "Config files…"
[ -f agents/.env ] && ok "agents/.env exists" || { cp agents/.env.example agents/.env; echo "  📝 created agents/.env — fill it in"; }
[ -f client/.env.local ] && ok "client/.env.local exists" || { cp client/.env.local.example client/.env.local; echo "  📝 created client/.env.local — fill it in"; }

echo ""
echo "Next: fill in agents/.env and client/.env.local (see SETUP_AND_CHANGES.md), then run ./start-all.sh"
