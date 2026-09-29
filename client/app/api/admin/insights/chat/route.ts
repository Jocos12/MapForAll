import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { buildInsightsContext, insightsSystemPrompt } from '@/lib/adminInsights'
import { generateWithFailover } from '@/lib/ai/providers'
import { detectMessageLang, type ReplyLang } from '@/lib/detectLang'
import { isMcpUnavailable } from '@/lib/mcp'

export const runtime = 'nodejs'
export const maxDuration = 60

const Body = z.object({
  message: z.string().min(2).max(1200),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4000),
  })).max(12).optional().default([]),
  /** UI locale — only used when the typed message is too short to detect reliably. */
  uiLang: z.enum(['en', 'fr', 'rw']).optional(),
})

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'insights-chat' })
  if (!gate.ok) return gate.response

  const json = await req.json().catch(() => null)
  const parsed = Body.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  }

  const replyLang = detectMessageLang(parsed.data.message, parsed.data.uiLang ?? 'en')

  let ctx
  try {
    ctx = await buildInsightsContext()
  } catch (err) {
    console.error('[admin/insights] context', err)
    if (isMcpUnavailable(err)) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Could not load insights context.' }, { status: 500 })
  }

  // Even with zero places, still answer from whatever facts we have.
  try {
    const system = insightsSystemPrompt(ctx)
    const historyBlock = parsed.data.history
      .slice(-8)
      .map((m) => `${m.role === 'user' ? 'Admin' : 'Assistant'}: ${m.content}`)
      .join('\n')
    const prompt = [
      historyBlock ? `Conversation so far:\n${historyBlock}\n` : '',
      `Admin question: ${parsed.data.message}`,
    ].join('\n')

    const result = await generateWithFailover(prompt, system, replyLang)
    if (!result) {
      const localReply = localFallbackReply(parsed.data.message, ctx, replyLang)
      if (localReply) {
        const res = NextResponse.json({
          reply: localReply,
          provider: 'local',
          lang: replyLang,
          context: {
            generatedAt: ctx.generatedAt,
            totals: ctx.totals,
            searchesAvailable: ctx.searchesAvailable,
          },
        })
        return withSessionRefresh(res, gate.refreshedCookie)
      }
      return NextResponse.json({
        error: 'No AI provider is available. Configure GROQ_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.',
        context: { totals: ctx.totals, searchesAvailable: ctx.searchesAvailable },
      }, { status: 503 })
    }

    const res = NextResponse.json({
      reply: result.text,
      provider: result.provider,
      lang: replyLang,
      context: {
        generatedAt: ctx.generatedAt,
        totals: ctx.totals,
        searchesAvailable: ctx.searchesAvailable,
      },
    })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    console.error('[admin/insights] generate', err)
    const localReply = localFallbackReply(parsed.data.message, ctx, replyLang)
    if (localReply) {
      const res = NextResponse.json({
        reply: localReply,
        provider: 'local',
        lang: replyLang,
        context: { generatedAt: ctx.generatedAt, totals: ctx.totals, searchesAvailable: ctx.searchesAvailable },
      })
      return withSessionRefresh(res, gate.refreshedCookie)
    }
    return NextResponse.json({ error: 'Insights request failed.' }, { status: 500 })
  }
}

type InsightsCtx = Awaited<ReturnType<typeof buildInsightsContext>>

function localFallbackReply(message: string, ctx: InsightsCtx, lang: ReplyLang): string | null {
  const q = message.toLowerCase()
  const { totals, approvalRate, topViewed, sectorsLackingAccess, searchesAvailable, recentSearches, activity7d } = ctx

  if (/taux|validation|approval|rate|iyemeza/.test(q)) {
    if (lang === 'en') {
      return [
        `Current approval rate: **${approvalRate}%**.`,
        `- Validated places: ${totals.validated}`,
        `- Pending: ${totals.pending}`,
        `- Rejected: ${totals.rejected}`,
        `- Total (excl. archived): ${totals.places}`,
      ].join('\n')
    }
    if (lang === 'rw') {
      return [
        `Igipimo cyemeza ubu: **${approvalRate}%**.`,
        `- Ahantu byemejwe: ${totals.validated}`,
        `- Bitegereje: ${totals.pending}`,
        `- Byanzwe: ${totals.rejected}`,
        `- Igiteranyo (hatariye byabitswe): ${totals.places}`,
      ].join('\n')
    }
    return [
      `Taux de validation actuel : **${approvalRate}%**.`,
      `- Lieux validés : ${totals.validated}`,
      `- En attente : ${totals.pending}`,
      `- Refusés : ${totals.rejected}`,
      `- Total (hors archivés) : ${totals.places}`,
    ].join('\n')
  }

  if (/signalement|report|ibirego/.test(q)) {
    if (lang === 'en') return `Open reports: **${totals.openReports}**.`
    if (lang === 'rw') return `Ibirego bifunguye: **${totals.openReports}**.`
    return `Signalements ouverts : **${totals.openReports}**.`
  }

  if (/local|commerce|consult|view|vu|reba/.test(q) && topViewed.length) {
    const lines = topViewed.slice(0, 5).map((p, i) => {
      if (lang === 'en') return `${i + 1}. ${p.name} — ${p.views} views`
      if (lang === 'rw') return `${i + 1}. ${p.name} — ${p.views} reba`
      return `${i + 1}. ${p.name} — ${p.views} vues`
    })
    if (lang === 'en') {
      return `Most viewed places:\n${lines.join('\n')}\n\nLocal businesses: ${totals.local} · Formal: ${totals.formal}.`
    }
    if (lang === 'rw') {
      return `Ahantu arebwa cyane:\n${lines.join('\n')}\n\nUbucuruzi bw'aho: ${totals.local} · Formels: ${totals.formal}.`
    }
    return `Lieux les plus consultés :\n${lines.join('\n')}\n\nCommerces locaux : ${totals.local} · Formels : ${totals.formal}.`
  }

  if (/accessible|accessib|ubumuga|quartier|sector|secteur/.test(q)) {
    if (!sectorsLackingAccess.length) {
      if (lang === 'en') return `Accessible places: **${totals.accessible}** of ${totals.places}. No sector below the alert threshold (accessibility < 35%).`
      if (lang === 'rw') return `Ahantu bishoboka kubageraho: **${totals.accessible}** kuri ${totals.places}. Nta sector iri munsi y'igipimo cy'uburangare (< 35%).`
      return `Lieux accessibles : **${totals.accessible}** sur ${totals.places}. Aucun secteur sous le seuil d’alerte (accessibilité < 35%).`
    }
    const lines = sectorsLackingAccess.map((s) => {
      if (lang === 'en') return `- ${s.sector}: ${s.accessible}/${s.places} accessible`
      if (lang === 'rw') return `- ${s.sector}: ${s.accessible}/${s.places} bishoboka`
      return `- ${s.sector} : ${s.accessible}/${s.places} accessibles`
    })
    if (lang === 'en') return `Sectors with few accessible places:\n${lines.join('\n')}`
    if (lang === 'rw') return `Sectors zifite ahantu bike bishoboka kubageraho:\n${lines.join('\n')}`
    return `Secteurs avec peu de lieux accessibles :\n${lines.join('\n')}`
  }

  if (/recherche|search|shakisha/.test(q)) {
    if (!searchesAvailable) {
      if (lang === 'en') return 'Search logs (`search_logs`) are not available yet. They will fill as /chat conversations happen.'
      if (lang === 'rw') return 'Inyandiko z\'ishakisha (`search_logs`) ntabwo zihari. Bizuzura uko ibiganiro bya /chat bigenda.'
      return 'Les logs de recherche (`search_logs`) ne sont pas encore disponibles. Ils se rempliront au fur et à mesure des conversations /chat.'
    }
    const top = recentSearches.slice(0, 8).map((s) => `- ${s.query}`).join('\n')
    if (lang === 'en') return `Recent searches:\n${top}`
    if (lang === 'rw') return `Ishakisha rya vuba:\n${top}`
    return `Recherches récentes :\n${top}`
  }

  if (/7|semaine|activity|activité|ibikorwa|week/.test(q)) {
    if (!activity7d.length) {
      if (lang === 'en') return 'No admin activity recorded in the last 7 days.'
      if (lang === 'rw') return 'Nta gikorwa cy\'ubuyobozi cyanditswe mu minsi 7 ishize.'
      return 'Aucune activité admin enregistrée sur les 7 derniers jours.'
    }
    const lines = activity7d.map((a) => `- ${a.action} : ${a.count}`).join('\n')
    if (lang === 'en') return `Activity (7 days):\n${lines}`
    if (lang === 'rw') return `Ibikorwa (iminsi 7):\n${lines}`
    return `Activité (7 jours) :\n${lines}`
  }

  if (lang === 'en') {
    return [
      `MapForAll snapshot (Kigali):`,
      `- Places: ${totals.places} (validated ${totals.validated}, pending ${totals.pending})`,
      `- Approval rate: ${approvalRate}%`,
      `- Local / formal / accessible: ${totals.local} / ${totals.formal} / ${totals.accessible}`,
      `- Open reports: ${totals.openReports}`,
      `- Users: ${totals.users}`,
      '',
      '(Local reply — configure an AI key for richer answers.)',
    ].join('\n')
  }
  if (lang === 'rw') {
    return [
      `Incamake ya MapForAll (Kigali):`,
      `- Ahantu: ${totals.places} (byemejwe ${totals.validated}, bitegereje ${totals.pending})`,
      `- Igipimo cyemeza: ${approvalRate}%`,
      `- Aho / formels / bishoboka: ${totals.local} / ${totals.formal} / ${totals.accessible}`,
      `- Ibirego bifunguye: ${totals.openReports}`,
      `- Abakoresha: ${totals.users}`,
      '',
      '(Igisubizo cyaho — shyiraho urufunguzo rwa AI kugira ngo ubone ibisubizo byuzuye.)',
    ].join('\n')
  }
  return [
    `Instantané MapForAll (Kigali) :`,
    `- Lieux : ${totals.places} (validés ${totals.validated}, pending ${totals.pending})`,
    `- Taux de validation : ${approvalRate}%`,
    `- Locaux / formels / accessibles : ${totals.local} / ${totals.formal} / ${totals.accessible}`,
    `- Signalements ouverts : ${totals.openReports}`,
    `- Utilisateurs : ${totals.users}`,
    '',
    '(Réponse locale — configurez une clé AI pour des réponses plus riches.)',
  ].join('\n')
}
