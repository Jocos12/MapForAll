/**
 * HTML emails in the MapForAll style: table layout and inline styles so they
 * render in Gmail, Outlook and phone clients. The logo is the same "MF" badge
 * as the site, drawn in HTML so it shows even when images are blocked.
 */
import type { MailContent } from '@/lib/mailer'

export type MailLang = 'fr' | 'en' | 'rw'
type Role = 'client' | 'business_owner' | 'admin' | 'moderator'

export function mailLang(value: unknown): MailLang {
  return value === 'en' || value === 'rw' ? value : 'fr'
}

const ORANGE = '#E8672A'
const INK = '#1A1614'
const MUTED = '#6E5B50'
const CREAM = '#FBF3E7'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')
}

const WELCOME = {
  fr: {
    subject: 'Bienvenue sur MapForAll, {name} !',
    preheader: 'Votre compte est prêt. Connectez-vous pour commencer.',
    heading: 'Bienvenue, {name} !',
    intro: 'Merci d’avoir rejoint MapForAll — Ikarita ya Bose, la carte des commerces locaux et des lieux accessibles de Kigali.',
    roleTitle: 'Ce que vous pouvez faire',
    client: 'Trouvez des commerces locaux et accessibles près de vous, enregistrez vos lieux préférés et confirmez l’accessibilité d’un lieu pour aider les autres.',
    owner: 'Ajoutez votre commerce et faites-le connaître : créez votre fiche, suivez vos visites et répondez aux avis de vos clients.',
    cta: 'Se connecter',
    security: 'Pour votre sécurité, un code à 6 chiffres vous sera envoyé par email à chaque connexion.',
    footer: 'Vous recevez cet email car un compte MapForAll vient d’être créé avec cette adresse. Si ce n’est pas vous, ignorez simplement ce message.',
  },
  en: {
    subject: 'Welcome to MapForAll, {name}!',
    preheader: 'Your account is ready. Sign in to get started.',
    heading: 'Welcome, {name}!',
    intro: 'Thanks for joining MapForAll — Ikarita ya Bose, the map of local businesses and accessible places in Kigali.',
    roleTitle: 'What you can do',
    client: 'Find local, accessible businesses near you, save your favourite places, and confirm a place’s accessibility to help others.',
    owner: 'Add your business and get it known: create your listing, follow your visits and reply to your customers’ reviews.',
    cta: 'Sign in',
    security: 'For your security, a 6-digit code will be emailed to you each time you sign in.',
    footer: 'You are receiving this email because a MapForAll account was just created with this address. If this wasn’t you, simply ignore this message.',
  },
  // Kinyarwanda: approximate, to be reviewed by a native speaker.
  rw: {
    subject: 'Murakaza neza kuri MapForAll, {name}!',
    preheader: 'Konti yawe iriteguye. Injira utangire.',
    heading: 'Murakaza neza, {name}!',
    intro: 'Murakoze kwinjira muri MapForAll — Ikarita ya Bose, ikarita y’amaduka yo mu gace n’ahantu hagerwaho byoroshye i Kigali.',
    roleTitle: 'Ibyo ushobora gukora',
    client: 'Shakisha amaduka yo mu gace kandi agerwaho byoroshye hafi yawe, ubike ahantu ukunda, kandi wemeze niba ahantu hagerwaho kugira ngo ufashe abandi.',
    owner: 'Ongeraho ubucuruzi bwawe kandi ubumenyekanishe: kora ifishi yawe, ukurikirane abagusura, kandi usubize ibitekerezo by’abakiriya bawe.',
    cta: 'Injira',
    security: 'Kubw’umutekano wawe, uzajya wohererezwa kode y’imibare 6 kuri imeri igihe cyose winjira.',
    footer: 'Wakiriye iyi imeri kuko konti ya MapForAll imaze gufungurwa hakoreshejwe iyi aderesi. Niba atari wowe, wirengagize ubu butumwa.',
  },
} satisfies Record<MailLang, Record<string, string>>

const OTP = {
  fr: {
    subject: '{code} est votre code de connexion MapForAll',
    preheader: 'Code valable {minutes} minutes.',
    heading: 'Votre code de connexion',
    intro: 'Bonjour {name}, voici votre code pour terminer la connexion à MapForAll :',
    expiry: 'Ce code expire dans {minutes} minutes et ne peut être utilisé qu’une seule fois.',
    warning: 'Ne partagez jamais ce code : l’équipe MapForAll ne vous le demandera jamais. Si vous n’avez pas essayé de vous connecter, changez votre mot de passe.',
    footer: 'Email automatique, merci de ne pas y répondre.',
  },
  en: {
    subject: '{code} is your MapForAll sign-in code',
    preheader: 'Code valid for {minutes} minutes.',
    heading: 'Your sign-in code',
    intro: 'Hello {name}, here is your code to finish signing in to MapForAll:',
    expiry: 'This code expires in {minutes} minutes and can only be used once.',
    warning: 'Never share this code: the MapForAll team will never ask for it. If you didn’t try to sign in, change your password.',
    footer: 'Automated email, please do not reply.',
  },
  // Kinyarwanda: approximate, to be reviewed by a native speaker.
  rw: {
    subject: '{code} ni kode yawe yo kwinjira muri MapForAll',
    preheader: 'Kode imara iminota {minutes}.',
    heading: 'Kode yawe yo kwinjira',
    intro: 'Muraho {name}, dore kode yo kurangiza kwinjira muri MapForAll:',
    expiry: 'Iyi kode irangira mu minota {minutes} kandi ikoreshwa rimwe gusa.',
    warning: 'Ntuzigere usangiza abandi iyi kode: itsinda rya MapForAll ntirizigera riyigusaba. Niba atari wowe wagerageje kwinjira, hindura ijambo ry’ibanga ryawe.',
    footer: 'Iyi ni imeri yikora, ntuyisubize.',
  },
} satisfies Record<MailLang, Record<string, string>>

function layout({ lang, preheader, content, footer }: { lang: MailLang; preheader: string; content: string; footer: string }): string {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>MapForAll</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="padding:0 4px 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:40px;height:40px;border-radius:20px;background:${ORANGE};color:#ffffff;font:700 13px ${FONT};text-align:center;vertical-align:middle;">MF</td>
        <td style="padding-left:12px;font-family:${FONT};">
          <div style="font-size:17px;font-weight:600;color:${INK};line-height:1.2;">MapForAll</div>
          <div style="font-size:12px;color:${MUTED};line-height:1.3;">Ikarita ya Bose</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#ffffff;border-radius:20px;border-top:4px solid ${ORANGE};padding:32px 28px;font-family:${FONT};color:${INK};">
      ${content}
    </td></tr>
    <tr><td style="padding:18px 8px 0;font:12px/1.5 ${FONT};color:${MUTED};text-align:center;">
      ${esc(footer)}<br>© MapForAll · Kigali
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;"><tr>
  <td style="border-radius:999px;background:${ORANGE};">
    <a href="${esc(href)}" style="display:inline-block;padding:14px 28px;font:600 15px ${FONT};color:#ffffff;text-decoration:none;border-radius:999px;">${esc(label)} &rarr;</a>
  </td>
</tr></table>`
}

export function welcomeEmail({ name, role, lang, loginUrl }: { name: string; role: Role; lang: MailLang; loginUrl: string }): MailContent {
  const s = WELCOME[lang]
  const vars = { name }
  const roleLine = role === 'business_owner' ? s.owner : s.client
  const content = `
      <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;">${esc(fill(s.heading, vars))}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3A2E28;">${esc(s.intro)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FDE8DC;border-radius:14px;">
        <tr><td style="padding:16px 18px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#B8441A;">${esc(s.roleTitle)}</div>
          <div style="margin-top:6px;font-size:15px;line-height:1.55;color:${INK};">${esc(roleLine)}</div>
        </td></tr>
      </table>
      ${button(loginUrl, s.cta)}
      <p style="margin:12px 0 0;font-size:13px;line-height:1.55;color:${MUTED};">${esc(s.security)}</p>`
  return {
    subject: fill(s.subject, vars),
    html: layout({ lang, preheader: s.preheader, content, footer: s.footer }),
    text: [fill(s.heading, vars), '', s.intro, '', `${s.roleTitle} : ${roleLine}`, '', `${s.cta} : ${loginUrl}`, '', s.security, '', s.footer].join('\n'),
  }
}

const PLACE_VALIDATED = {
  fr: {
    subject: 'Votre lieu « {place} » est en ligne sur MapForAll',
    preheader: 'La modération a approuvé votre fiche.',
    heading: 'Fiche approuvée',
    intro: 'Bonjour {name}, bonne nouvelle : « {place} » est maintenant visible sur MapForAll.',
    cta: 'Voir sur la carte',
    footer: 'Vous recevez cet email car vous avez ajouté ou revendiqué ce lieu sur MapForAll.',
  },
  en: {
    subject: 'Your place “{place}” is live on MapForAll',
    preheader: 'Moderation approved your listing.',
    heading: 'Listing approved',
    intro: 'Hello {name}, good news: “{place}” is now visible on MapForAll.',
    cta: 'View on the map',
    footer: 'You are receiving this email because you added or claimed this place on MapForAll.',
  },
  rw: {
    subject: 'Ahantu hawe « {place} » hashyizwe ku MapForAll',
    preheader: 'Abagenzura bemeranyije ifishi yawe.',
    heading: 'Ifishi yemejwe',
    intro: 'Muraho {name}, amakuru meza: « {place} » ubu iboneka kuri MapForAll.',
    cta: 'Reba ku ikarita',
    footer: 'Wakiriye iyi imeri kuko wongeyeho cyangwa wemeje iri ahantu kuri MapForAll.',
  },
} satisfies Record<MailLang, Record<string, string>>

const PLACE_REJECTED = {
  fr: {
    subject: 'Mise à jour pour « {place} » sur MapForAll',
    preheader: 'Votre fiche n’a pas été publiée.',
    heading: 'Fiche non publiée',
    intro: 'Bonjour {name}, nous n’avons pas pu publier « {place} » pour le moment.',
    reasonTitle: 'Motif',
    reasonEmpty: 'Les informations ne correspondaient pas à nos critères de qualité.',
    cta: 'Corriger et renvoyer',
    footer: 'Vous recevez cet email car vous avez soumis ce lieu sur MapForAll.',
  },
  en: {
    subject: 'Update about “{place}” on MapForAll',
    preheader: 'Your listing was not published.',
    heading: 'Listing not published',
    intro: 'Hello {name}, we could not publish “{place}” at this time.',
    reasonTitle: 'Reason',
    reasonEmpty: 'The details did not meet our quality guidelines.',
    cta: 'Fix and resubmit',
    footer: 'You are receiving this email because you submitted this place on MapForAll.',
  },
  rw: {
    subject: 'Amakuru kuri « {place} » kuri MapForAll',
    preheader: 'Ifishi yawe ntiyashyizwe ahagaragara.',
    heading: 'Ifishi ntiyashyizwe ahagaragara',
    intro: 'Muraho {name}, ntitwashoboye gushyira « {place} » ahagaragara muri iki gihe.',
    reasonTitle: 'Impamvu',
    reasonEmpty: 'Amakuru ntahuye n’ibisabwa by’ubuziranenge.',
    cta: 'Kosora ongera uohereze',
    footer: 'Wakiriye iyi imeri kuko wohereje iri ahantu kuri MapForAll.',
  },
} satisfies Record<MailLang, Record<string, string>>

export function placeValidatedEmail({
  name,
  placeName,
  lang,
  appUrl,
}: {
  name: string
  placeName: string
  lang: MailLang
  appUrl: string
}): MailContent {
  const s = PLACE_VALIDATED[lang]
  const vars = { name, place: placeName }
  const content = `
      <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;">${esc(fill(s.heading, vars))}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3A2E28;">${esc(fill(s.intro, vars))}</p>
      ${button(appUrl, s.cta)}`
  return {
    subject: fill(s.subject, vars),
    html: layout({ lang, preheader: s.preheader, content, footer: s.footer }),
    text: [fill(s.intro, vars), '', `${s.cta}: ${appUrl}`, '', s.footer].join('\n'),
  }
}

const PLACE_SUSPENDED = {
  fr: {
    subject: 'Suspension temporaire de « {place} » sur MapForAll',
    preheader: 'Votre fiche commerce est masquée.',
    heading: 'Fiche suspendue',
    intro: 'Bonjour {name}, « {place} » a été temporairement retirée de la carte.',
    reasonTitle: 'Motif',
    reasonEmpty: 'Non-respect des conditions d’utilisation ou signalements répétés.',
    cta: 'Contacter le support',
    footer: 'Vous recevez cet email car vous gérez ce commerce sur MapForAll.',
  },
  en: {
    subject: 'Temporary suspension of “{place}” on MapForAll',
    preheader: 'Your business listing is hidden.',
    heading: 'Listing suspended',
    intro: 'Hello {name}, “{place}” has been temporarily removed from the map.',
    reasonTitle: 'Reason',
    reasonEmpty: 'Terms of use or repeated reports.',
    cta: 'Contact support',
    footer: 'You are receiving this email because you manage this business on MapForAll.',
  },
  rw: {
    subject: '« {place} » yahagaritswe by’agateganyo kuri MapForAll',
    preheader: 'Ifishi y’ubucuruzi yihishijwe.',
    heading: 'Ifishi yahagaritswe',
    intro: 'Muraho {name}, « {place} » yakuwe ku ikarita by’agateganyo.',
    reasonTitle: 'Impamvu',
    reasonEmpty: 'Kutubahiriza amabwiriza cyangwa raporo nyinshi.',
    cta: 'Vugana n’itsinda',
    footer: 'Wakiriye iyi imeri kuko ucunga ubu bucuruzi kuri MapForAll.',
  },
} satisfies Record<MailLang, Record<string, string>>

export function placeSuspendedEmail({
  name,
  placeName,
  reason,
  lang,
  appUrl,
}: {
  name: string
  placeName: string
  reason: string
  lang: MailLang
  appUrl: string
}): MailContent {
  const s = PLACE_SUSPENDED[lang]
  const vars = { name, place: placeName }
  const reasonLine = reason.trim() || s.reasonEmpty
  const content = `
      <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;">${esc(fill(s.heading, vars))}</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3A2E28;">${esc(fill(s.intro, vars))}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FDE8DC;border-radius:14px;">
        <tr><td style="padding:16px 18px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#B8441A;">${esc(s.reasonTitle)}</div>
          <div style="margin-top:6px;font-size:15px;line-height:1.55;color:${INK};">${esc(reasonLine)}</div>
        </td></tr>
      </table>
      ${button(appUrl, s.cta)}`
  return {
    subject: fill(s.subject, vars),
    html: layout({ lang, preheader: s.preheader, content, footer: s.footer }),
    text: [fill(s.intro, vars), '', `${s.reasonTitle}: ${reasonLine}`, '', `${s.cta}: ${appUrl}`, '', s.footer].join('\n'),
  }
}

const REPORT_RESOLVED = {
  fr: {
    subject: 'Votre signalement MapForAll a été traité',
    preheader: 'Merci pour votre vigilance.',
    heading: 'Signalement traité',
    intro: 'Bonjour, nous avons examiné votre signalement concernant « {place} ».',
    body: 'Notre équipe a pris les mesures nécessaires. Merci d’aider la communauté MapForAll.',
    footer: 'Email automatique — merci de ne pas répondre.',
  },
  en: {
    subject: 'Your MapForAll report was handled',
    preheader: 'Thank you for helping the community.',
    heading: 'Report handled',
    intro: 'Hello, we reviewed your report about “{place}”.',
    body: 'Our team took appropriate action. Thank you for helping the MapForAll community.',
    footer: 'Automated email — please do not reply.',
  },
  rw: {
    subject: 'Raporo yawe ya MapForAll yitaweho',
    preheader: 'Murakoze gufasha abaturage.',
    heading: 'Raporo yitaweho',
    intro: 'Muraho, twisuzumiye raporo yawe kuri « {place} ».',
    body: 'Itsinda ryacu ryafashe ingamba zikwiye. Murakoze gufasha abaturage ba MapForAll.',
    footer: 'Imeri yikora — ntusubize.',
  },
} satisfies Record<MailLang, Record<string, string>>

export function reportResolvedEmail({
  placeName,
  lang,
}: {
  placeName: string
  lang: MailLang
}): MailContent {
  const s = REPORT_RESOLVED[lang]
  const vars = { place: placeName }
  const content = `
      <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;">${esc(s.heading)}</h1>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3A2E28;">${esc(fill(s.intro, vars))}</p>
      <p style="margin:0;font-size:15px;line-height:1.6;color:#3A2E28;">${esc(s.body)}</p>`
  return {
    subject: s.subject,
    html: layout({ lang, preheader: s.preheader, content, footer: s.footer }),
    text: [s.heading, '', fill(s.intro, vars), '', s.body, '', s.footer].join('\n'),
  }
}

export function placeRejectedEmail({
  name,
  placeName,
  reason,
  lang,
  appUrl,
}: {
  name: string
  placeName: string
  reason: string
  lang: MailLang
  appUrl: string
}): MailContent {
  const s = PLACE_REJECTED[lang]
  const vars = { name, place: placeName }
  const reasonLine = reason.trim() || s.reasonEmpty
  const content = `
      <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;">${esc(fill(s.heading, vars))}</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3A2E28;">${esc(fill(s.intro, vars))}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FDE8DC;border-radius:14px;">
        <tr><td style="padding:16px 18px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#B8441A;">${esc(s.reasonTitle)}</div>
          <div style="margin-top:6px;font-size:15px;line-height:1.55;color:${INK};">${esc(reasonLine)}</div>
        </td></tr>
      </table>
      ${button(appUrl, s.cta)}`
  return {
    subject: fill(s.subject, vars),
    html: layout({ lang, preheader: s.preheader, content, footer: s.footer }),
    text: [fill(s.intro, vars), '', `${s.reasonTitle}: ${reasonLine}`, '', `${s.cta}: ${appUrl}`, '', s.footer].join('\n'),
  }
}

export function otpEmail({ name, code, lang, minutes }: { name: string; code: string; lang: MailLang; minutes: number }): MailContent {
  const s = OTP[lang]
  const vars = { name, code, minutes: String(minutes) }
  const spaced = `${code.slice(0, 3)}&nbsp;${code.slice(3)}`
  const content = `
      <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;">${esc(s.heading)}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3A2E28;">${esc(fill(s.intro, vars))}</p>
      <div style="margin:0 0 20px;padding:18px 12px;border-radius:14px;background:#FDE8DC;text-align:center;font:700 34px/1 'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;letter-spacing:0.18em;color:${INK};">${spaced}</div>
      <p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:${INK};">${esc(fill(s.expiry, vars))}</p>
      <p style="margin:0;font-size:13px;line-height:1.55;color:${MUTED};">${esc(s.warning)}</p>`
  return {
    subject: fill(s.subject, vars),
    html: layout({ lang, preheader: fill(s.preheader, vars), content, footer: s.footer }),
    text: [s.heading, '', fill(s.intro, vars), '', code, '', fill(s.expiry, vars), '', s.warning].join('\n'),
  }
}

export type MailOverrideKind = 'welcome' | 'otp' | 'validate' | 'reject'

/**
 * Apply admin Settings email overrides (subject/body) when present.
 * Body overrides become a simple branded HTML + plain-text message; `{name}`, `{place}`, `{code}` etc. are substituted.
 */
export async function withAdminMailOverrides(
  kind: MailOverrideKind,
  content: MailContent,
  vars: Record<string, string> = {},
  lang: MailLang = 'fr',
): Promise<MailContent> {
  try {
    const { getAppSettings } = await import('@/lib/adminSettings')
    const email = (await getAppSettings()).email
    if (!email) return content

    const subjectKey = `${kind}_subject` as const
    const bodyKey = `${kind}_body` as const
    const subjectRaw = email[subjectKey]
    const bodyRaw = email[bodyKey]
    if (!subjectRaw && !bodyRaw) return content

    const subject = subjectRaw ? fill(subjectRaw, vars) : content.subject
    if (!bodyRaw) return { ...content, subject }

    const bodyFilled = fill(bodyRaw, vars)
    const htmlBody = esc(bodyFilled).replace(/\n/g, '<br/>')
    const html = layout({
      lang,
      preheader: subject,
      content: `<p style="margin:0;font-size:15px;line-height:1.6;color:#3A2E28;">${htmlBody}</p>`,
      footer: '',
    })
    return { subject, html, text: bodyFilled }
  } catch {
    return content
  }
}
