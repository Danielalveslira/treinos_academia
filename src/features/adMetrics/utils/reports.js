export const DEFINITIONS =
  'Dias em America/Sao_Paulo. Alcance agregado soma deduplicações diárias por campanha/posicionamento/contexto; não são pessoas únicas no período. CTR qualificado = cliques com impressão previamente registrada / impressões visíveis. CTR bruto = cliques / impressões. Não são vendas ou conversões. Ausência de registro não é zero. A cobertura histórica da coleta é desconhecida; depende de cliente habilitado, autenticação, elegibilidade, ausência de oposição e entrega dos eventos.'
const fields = [
  'visible_impressions',
  'unique_viewers',
  'clicks',
  'qualified_clicks',
  'unqualified_clicks',
  'ctr_qualified',
  'ctr_raw',
]
export function csvCell(value) {
  let text = value == null ? '' : String(value)
  // eslint-disable-next-line no-control-regex -- CSV injection can follow ASCII control characters.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text
  return '"' + text.replaceAll('"', '""') + '"'
}
export function reportCsv(snapshot) {
  const rows = [
    ['Evolutus', snapshot.account?.name || 'Administração'],
    ['Período', snapshot.period.from, snapshot.period.to, snapshot.period.timezone],
    ['Snapshot', snapshot.generated_at],
    ['Filtros', JSON.stringify(snapshot.filters)],
    ['Definições', DEFINITIONS],
    [
      'grupo',
      'identificação',
      'dia',
      ...fields.map((f) => (f === 'unique_viewers' ? 'aggregate_reach' : f)),
    ],
  ]
  for (const [group, data, id] of [
    ['resumo', [snapshot.summary], () => 'Total'],
    ['diário', snapshot.daily, (r) => r.day],
    ['campanha', snapshot.by_campaign, (r) => `${r.ad_id} ${r.title || r.partner_name || ''}`],
    ['posicionamento', snapshot.by_placement, (r) => r.placement],
    [
      'comunidade',
      snapshot.by_context,
      (r) => `${r.placement} ${r.community_name || r.context_id}`,
    ],
  ])
    for (const row of data) rows.push([group, id(row), row.day || '', ...fields.map((f) => row[f])])
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

// Minimal real PDF 1.4 writer: ASCII transliteration, standard Helvetica, paginated text.
// No remote assets, HTML injection, third-party runtime or fake .pdf extension.
export function reportPdf(snapshot) {
  const clean = (text) =>
    String(text ?? 'indisponível')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, ' ')

  const lines = [
    'EVOLUTUS | Relatorio de anuncios',
    snapshot.account?.name || 'Administracao',
    `Periodo: ${snapshot.period.from} a ${snapshot.period.to} | ${snapshot.period.timezone}`,
    `Snapshot: ${snapshot.generated_at} | Emissao: ${new Date().toISOString()}`,
    `Filtros: ${JSON.stringify(snapshot.filters)}`,
    '',
    ...fields.map(
      (f) =>
        `${{ visible_impressions: 'Impressoes visiveis', unique_viewers: 'Alcance agregado', clicks: 'Cliques', qualified_clicks: 'Cliques qualificados', unqualified_clicks: 'Cliques sem impressao', ctr_qualified: 'CTR qualificado (%)', ctr_raw: 'CTR bruto (%)' }[f]} (${f}): ${snapshot.summary[f] ?? 'indisponivel'}`
    ),
    '',
    ...[
      ['Diario', snapshot.daily, (r) => r.day],
      ['Campanhas', snapshot.by_campaign, (r) => r.title || r.partner_name || r.ad_id],
      ['Posicionamentos', snapshot.by_placement, (r) => r.placement],
      ['Comunidades', snapshot.by_context, (r) => r.community_name || r.context_id],
    ].flatMap(([title, rows, id]) => [
      title,
      ...rows.map(
        (r) =>
          `${id(r)} | imp ${r.visible_impressions} | alcance agregado ${r.unique_viewers} | cliques ${r.clicks} | qualificados ${r.qualified_clicks} | CTR qual. ${r.ctr_qualified ?? 'indisponivel'}% | CTR bruto ${r.ctr_raw ?? 'indisponivel'}%`
      ),
      '',
    ]),
    DEFINITIONS,
  ].flatMap((line) => clean(line).match(/.{1,94}/g) || [''])
  const pages = []
  for (let i = 0; i < lines.length; i += 48) pages.push(lines.slice(i, i + 48))
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const kids = []
  for (const page of pages) {
    const pageId = objects.length + 1,
      streamId = pageId + 1
    kids.push(`${pageId} 0 R`)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`
    )
    const stream =
      'BT /F1 10 Tf 40 795 Td 15 TL\n' +
      page.map((line) => `(${line.replace(/[\\()]/g, '\\$&')}) Tj T*`).join('\n') +
      '\nET'
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`
  let pdf = '%PDF-1.4\n',
    offsets = [0]
  objects.forEach((object, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf +=
    `xref\n0 ${offsets.length}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
      .join('')
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}

export function reportUrl(filters, origin = window.location.origin) {
  const url = new URL(filters.accountId ? '/meus-anuncios' : '/admin/parcerias', origin)
  if (!filters.accountId) url.searchParams.set('report', 'metrics')
  for (const [key, value] of Object.entries(filters))
    if (
      ['accountId', 'adId', 'communityId', 'placement', 'days', 'from', 'to'].includes(key) &&
      value != null
    )
      url.searchParams.set(key, value)
  return url.href
}
export function downloadReport(content, format) {
  const url = URL.createObjectURL(
    new Blob([content], { type: format === 'pdf' ? 'application/pdf' : 'text/csv;charset=utf-8' })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `evolutus-anuncios.${format}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
