#!/bin/bash
# Saves YOUR Google Maps API key into client/.env.local and agents/.env.
# The old values are kept as comments (# old ...) so you can go back.
cd "$(dirname "$0")"
read -r -s -p "Paste your Google Maps API key and press Enter (it stays hidden): " KEY; echo
KEY="$(echo "$KEY" | tr -d '[:space:]')"
[ -z "$KEY" ] && { echo "No key entered."; exit 1; }
python3 - "$KEY" <<'PY'
import re, sys
key = sys.argv[1]
def setv(path, names):
    s = open(path).read()
    for k in names:
        m = re.search(rf'(?m)^{k}=(.*)$', s)
        if m:
            s = s.replace(m.group(0), f'# old {k} (before set-maps-key.sh)\n{k}={key}', 1) if m.group(1) != key else s
        else:
            s = re.sub(rf'(?m)^#\s*{k}=.*$', f'{k}={key}', s, count=1) if re.search(rf'(?m)^#\s*{k}=', s) else s + f'\n{k}={key}\n'
    open(path, 'w').write(s)
setv('client/.env.local', ['NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'GOOGLE_MAPS_SERVER_KEY'])
setv('agents/.env', ['GOOGLE_MAPS_API_KEY', 'GOOGLE_MAPS_SERVER_KEY'])
PY
echo "✅ Maps key saved. The website must be rebuilt for it: ./start-all.sh --build"
