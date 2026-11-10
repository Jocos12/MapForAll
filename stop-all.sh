#!/usr/bin/env bash
# Stops what ./start-all.sh started (website, agents, connector, and the local MongoDB if the script launched it).
cd "$(dirname "$0")"
for port in 3000 8000 3100; do
  pids=$(lsof -ti tcp:$port -sTCP:LISTEN 2>/dev/null)
  [ -n "$pids" ] && kill $pids 2>/dev/null && echo "Stopped port $port"
done
pkill -f "mongodb-mcp-server" 2>/dev/null
if [ -f .local-logs/mongod.pid ]; then
  kill "$(cat .local-logs/mongod.pid)" 2>/dev/null && echo "Stopped local MongoDB (clean shutdown)"
  rm -f .local-logs/mongod.pid
fi
true
