import { NextRequest, NextResponse } from 'next/server'
import { genai, genaiConfigured, genaiMissingHint } from '@/lib/genaiServer'

// Speech-to-text via the Gemini SDK (Vertex AI or Developer API — see
// lib/genaiServer.ts). Audio is sent inline and Gemini returns a verbatim
// transcript. Credentials stay server-side, never shipped to the browser.
export const runtime = 'nodejs'

const STT_MODEL = process.env.GEMINI_STT_MODEL ?? 'gemini-3.5-flash'

export async function POST(req: NextRequest) {
  if (!genaiConfigured()) {
    return NextResponse.json({ error: genaiMissingHint() }, { status: 501 })
  }
  let body: { audioBase64?: string; mimeType?: string; lang?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { audioBase64, mimeType, lang } = body
  if (!audioBase64) {
    return NextResponse.json({ error: 'Missing audioBase64' }, { status: 400 })
  }

  const hint =
    lang === 'rw'
      ? 'The speaker is using Kinyarwanda. Transcribe verbatim in Kinyarwanda with Latin letters. Do not translate into English. If the speech is French, transcribe in French.'
      : lang === 'en'
        ? 'The speaker is using English. Transcribe verbatim in English.'
        : 'The speaker is using French. Transcribe verbatim in French. Do not translate into English.'

  try {
    const res = await genai().models.generateContent({
      model: STT_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: mimeType ?? 'audio/wav', data: audioBase64 } },
            {
              text:
                `${hint} Return ONLY the transcript, with no quotes, labels, or commentary. ` +
                'If there is no clear speech, return an empty string.',
            },
          ],
        },
      ],
    })
    const text = (res.text ?? '').trim()
    return NextResponse.json({ text })
  } catch (e) {
    console.error('transcribe failed:', e)
    return NextResponse.json({ error: 'Transcription failed' }, { status: 502 })
  }
}
