#!/usr/bin/env bash
# Use a free Gemini API key (https://aistudio.google.com/apikey) instead of Vertex AI / Google Cloud.
cd "$(dirname "$0")/agents"
[ -f .env ] || cp .env.example .env
read -r -s -p "Paste your Gemini API key and press Enter (it stays hidden): " KEY; echo
KEY="$(echo "$KEY" | tr -d '[:space:]')"
[ -z "$KEY" ] && { echo "No key entered."; exit 1; }
python3 - "$KEY" <<'PY'
import re, sys
key = sys.argv[1]; p = '.env'; s = open(p).read()
def setv(s, k, v):
    if re.search(rf'(?m)^#?\s*{k}=.*$', s): return re.sub(rf'(?m)^#?\s*{k}=.*$', f'{k}={v}', s, count=1)
    return s + f'\n{k}={v}\n'
for k, v in (('GOOGLE_GENAI_USE_VERTEXAI', 'FALSE'), ('GOOGLE_API_KEY', key), ('GEMINI_API_KEY', key)):
    s = setv(s, k, v)
open(p, 'w').write(s)
PY
echo "✅ Key saved in agents/.env. Now run: ./start-all.sh"
