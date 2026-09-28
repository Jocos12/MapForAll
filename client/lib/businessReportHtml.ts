const ORANGE = '#E8672A'
const INK = '#1A1614'

export type BusinessReportStats = {
  place_id: string
  place_name: string
  generated_at: string
  views_total: number
  views_by_source: Record<string, number>
  reviews_total: number
  reviews_avg: number | null
  exists_confirmations: number
  status: string
}

export function businessReportHtml(stats: BusinessReportStats, title = 'MapForAll — Business report'): string {
  const sources = Object.entries(stats.views_by_source)
    .map(([k, v]) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;">${esc(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${v}</td></tr>`)
    .join('')
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; color: ${INK}; margin: 32px; }
    h1 { color: ${ORANGE}; font-size: 22px; }
    .meta { color: #6E5B50; font-size: 13px; margin-bottom: 24px; }
    table { border-collapse: collapse; width: 100%; max-width: 480px; }
    th { text-align: left; background: #F7F1E8; padding: 8px 12px; }
    .kpi { display: inline-block; margin-right: 24px; margin-bottom: 12px; }
    .kpi strong { font-size: 28px; display: block; color: ${ORANGE}; }
  </style>
</head>
<body>
  <h1>${esc(stats.place_name)}</h1>
  <p class="meta">ID: ${esc(stats.place_id)} · Status: ${esc(stats.status)} · Generated ${esc(stats.generated_at)}</p>
  <div class="kpi"><strong>${stats.views_total}</strong>Views</div>
  <div class="kpi"><strong>${stats.reviews_total}</strong>Reviews</div>
  <div class="kpi"><strong>${stats.reviews_avg != null ? stats.reviews_avg.toFixed(1) : '—'}</strong>Avg rating</div>
  <div class="kpi"><strong>${stats.exists_confirmations}</strong>Exists votes</div>
  <h2>Views by source</h2>
  <table><thead><tr><th>Source</th><th style="text-align:right">Count</th></tr></thead><tbody>
  ${sources || '<tr><td colspan="2" style="padding:12px;">No view data</td></tr>'}
  </tbody></table>
  <p class="meta" style="margin-top:32px;">MapForAll · Ikarita ya Bose</p>
</body>
</html>`
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}
