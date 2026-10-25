import path from 'node:path'

/** Start the embedding write after the search fields are saved. Never awaited by approve. */
export function scheduleSearchEmbedding(placeId: string, _text: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_:-]{1,120}$/.test(placeId)) return
  void import('node:child_process')
    .then(({ spawn }) => {
      const script = path.resolve(process.cwd(), '..', 'agents', 'scripts', 'embed_place.py')
      const child = spawn('py', ['-3.12', script, placeId], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()
    })
    .catch(() => undefined)
}
