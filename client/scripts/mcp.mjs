// Starts the MongoDB MCP sidecar for local development: `npm run mcp`.
//
// - Reads MONGODB_URI from .env.local, so there is no connection string to
//   paste into the shell.
// - Pins mongodb-mcp-server to 1.14.0. From 2.x on, every data tool requires a
//   `connectionId` argument that lib/mcp.ts does not send, so an unpinned
//   `npx mongodb-mcp-server` (which pulls the latest) makes every sign-in fail
//   with "Invalid arguments for tool find: connectionId".
import { readFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'

const MCP_VERSION = '1.14.0'
const PORT = process.env.MCP_PORT || '3100'

function readEnvLocal() {
  if (!existsSync('.env.local')) return {}
  const vars = {}
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return vars
}

const uri = process.env.MDB_MCP_CONNECTION_STRING || process.env.MONGODB_URI || readEnvLocal().MONGODB_URI
if (!uri) {
  console.error('MONGODB_URI is missing: add it to client/.env.local (see .env.local.example).')
  process.exit(1)
}

console.log(`Starting mongodb-mcp-server@${MCP_VERSION} on http://localhost:${PORT}/mcp`)
const child = spawn(
  'npx',
  ['-y', `mongodb-mcp-server@${MCP_VERSION}`, '--transport', 'http', `--httpPort=${PORT}`],
  { stdio: 'inherit', shell: true, env: { ...process.env, MDB_MCP_CONNECTION_STRING: uri } },
)
child.on('exit', (code) => process.exit(code ?? 0))
