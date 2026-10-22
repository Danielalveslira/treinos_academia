// Gera gráficos SVG a partir dos resumos k6 persistidos; sem bibliotecas extras.
import { readFile, mkdir, writeFile } from 'node:fs/promises'

const levels = [5, 10, 25, 50, 100]
const evidence = await Promise.all(levels.map(async (vu) => JSON.parse(await readFile(`docs/performance/evidence/sustained-${vu}-60s-evidence.json`, 'utf8'))))
const data = evidence.map((e) => ({
  vu: e.vus,
  overall: e.summary.metrics.http_req_duration['p(95)'],
  read: e.summary.metrics['http_req_duration{scenario:read}']['p(95)'],
  rps: e.summary.metrics.http_reqs.rate,
  errors: e.summary.metrics.http_req_failed.value * 100,
}))
const dir = 'docs/performance/charts'
await mkdir(dir, { recursive: true })
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

function chart({ title, unit, series, max, ticks, filename }) {
  const width = 800, height = 360, left = 74, right = 24, top = 60, bottom = 54
  const plotW = width - left - right, plotH = height - top - bottom
  const x = (i) => left + 42 + i * (plotW - 84) / (levels.length - 1)
  const y = (v) => top + plotH - v / max * plotH
  const grid = ticks.map((tick) => `<line x1="${left}" y1="${y(tick)}" x2="${width - right}" y2="${y(tick)}" stroke="#334155" stroke-width="1"/><text x="${left - 12}" y="${y(tick) + 4}" text-anchor="end" fill="#94a3b8" font-size="13">${tick}${unit}</text>`).join('')
  const labels = levels.map((vu, i) => `<text x="${x(i)}" y="${height - 20}" text-anchor="middle" fill="#cbd5e1" font-size="14">${vu}</text>`).join('')
  const lines = series.map(({ label, color, key }, index) => {
    const coords = data.map((d, i) => `${x(i)},${y(d[key])}`).join(' ')
    const points = data.map((d, i) => `<circle cx="${x(i)}" cy="${y(d[key])}" r="5" fill="${color}"/><text x="${x(i)}" y="${y(d[key]) - 11 - index * 15}" text-anchor="middle" fill="${color}" font-size="12">${d[key].toFixed(key === 'errors' ? 1 : 0)}${unit}</text>`).join('')
    return `<polyline points="${coords}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>${points}<rect x="${width - right - 220 + index * 110}" y="16" width="12" height="12" fill="${color}"/><text x="${width - right - 202 + index * 110}" y="27" fill="#cbd5e1" font-size="12">${esc(label)}</text>`
  }).join('')
  return writeFile(`${dir}/${filename}`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${esc(title)}</title><desc id="desc">Medição local com 5, 10, 25, 50 e 100 usuários virtuais por 60 segundos.</desc><rect width="100%" height="100%" fill="#0f172a"/><text x="${left}" y="32" fill="#f8fafc" font-size="20" font-family="Arial,sans-serif">${esc(title)}</text><g font-family="Arial,sans-serif">${grid}${labels}${lines}</g><text x="${width / 2}" y="${height - 3}" text-anchor="middle" fill="#94a3b8" font-family="Arial,sans-serif" font-size="12">usuários virtuais simultâneos</text></svg>`)
}
await Promise.all([
  chart({ title: 'Latência p95 local', unit: ' ms', series: [{ label: 'Todas', color: '#38bdf8', key: 'overall' }, { label: 'Leituras', color: '#a78bfa', key: 'read' }], max: 200, ticks: [0, 50, 100, 150, 200], filename: 'latencia.svg' }),
  chart({ title: 'Throughput local', unit: ' RPS', series: [{ label: 'HTTP', color: '#34d399', key: 'rps' }], max: 50, ticks: [0, 10, 20, 30, 40, 50], filename: 'throughput.svg' }),
  chart({ title: 'Falhas HTTP locais', unit: '%', series: [{ label: 'Falhas', color: '#fb7185', key: 'errors' }], max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], filename: 'erros.svg' }),
])
console.log(`Gráficos gerados: ${dir}`)
