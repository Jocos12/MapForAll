/**
 * Lightweight FR / EN / RW detection from the user's typed message.
 * UI locale is only a fallback for very short / ambiguous text ("ok", "merci").
 */

export type ReplyLang = 'en' | 'fr' | 'rw'

const FR_TOKEN =
  /\b(le|la|les|un|une|des|du|de|et|est|sont|pour|avec|dans|sur|qui|que|quoi|comment|où|ou|quel|quelle|quels|quelles|plus|moins|taux|lieux|lieu|commerces|commerce|consultés|consultes|signalements|bonjour|merci|svp|s'il|sil|vous|nous|cette|ces|mon|ma|mes|ton|ta|tes|son|sa|ses|aussi|encore|aujourd|hier|demain|combien|pourquoi|parce|quand|depuis|vers|chez|entre|sans|très|tres|bien|mal|oui|non)\b/gi

const EN_TOKEN =
  /\b(the|a|an|is|are|was|were|be|been|which|what|where|when|how|why|who|most|least|viewed|views|businesses|business|places|place|reports|report|please|thanks|thank|hello|hi|also|still|today|yesterday|tomorrow|many|much|more|less|can|could|would|should|about|from|with|without|into|onto|over|under|between|among|this|that|these|those|my|your|our|their|yes|no|ok)\b/gi

const RW_TOKEN =
  /\b(amakuru|muraho|ndabashimira|murakoze|hehe|iki|ubuhe|none|ndabyifuzaga|shakisha|ibirego|iyemeza|ubumuga|ibikorwa|ahantu|ubucuruzi|imivugire|murabeho|yego|oya|ndabizi|ntabwo|kandi|cyangwa|kubera|kuki|ryari|nde|iki|urusobe)\b/gi

function score(re: RegExp, text: string): number {
  const matches = text.match(re)
  return matches?.length ?? 0
}

/** Detect reply language from the message; `uiFallback` for short/ambiguous input. */
export function detectMessageLang(text: string, uiFallback: ReplyLang = 'en'): ReplyLang {
  const raw = text.trim()
  if (raw.length < 3) return uiFallback

  const hasLatinAccents = /[àâäæçéèêëîïôœùûüÿÀÂÄÆÇÉÈÊËÎÏÔŒÙÛÜŸ]/.test(raw)
  const fr = score(FR_TOKEN, raw) + (hasLatinAccents ? 2 : 0)
  const en = score(EN_TOKEN, raw)
  const rw = score(RW_TOKEN, raw)

  // Very short: trust UI unless a clear language signal exists.
  if (raw.split(/\s+/).length <= 2 && fr + en + rw < 2) return uiFallback

  if (rw > fr && rw > en) return 'rw'
  if (fr > en && fr >= rw) return 'fr'
  if (en > fr && en >= rw) return 'en'
  if (hasLatinAccents) return 'fr'
  return uiFallback
}

export function replyLangLabel(lang: ReplyLang): string {
  if (lang === 'fr') return 'French'
  if (lang === 'rw') return 'Kinyarwanda'
  return 'English'
}
