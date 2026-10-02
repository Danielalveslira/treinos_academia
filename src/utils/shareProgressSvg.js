// Desenha um modelo de shareProgress.js como SVG (string). Formato 4:5 (1080x1350) -- cabe bem no feed e nos
// stories sem corte agressivo. Sempre escuro e independente do tema do app: a arte é o mesmo objeto no preview
// (<img src=data:svg>) e no PNG exportado. Só fontes de sistema (um SVG rasterizado via <img> não carrega
// webfonts) e nenhuma dependência.

export const SHARE_WIDTH = 1080
export const SHARE_HEIGHT = 1350

const C = {
  bg0: '#0b0f14',
  bg1: '#121820',
  panel: '#151a1f',
  panelBorder: '#242c34',
  ink: '#f2f5ed',
  muted: '#9ca895',
  accent: '#3fb950',
  accentStrong: '#56d364',
  accentDim: '#245a2f',
  cell: '#1d242c',
  cellFuture: '#161c22',
  onAccent: '#08110a',
}
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

// Marca do app (mesmos paths de BrandMark.jsx): seta em accent, letra em ink.
const BRAND_ARROW =
  'M 919 0 L 681 138 L 761 138 L 763 140 L 729 201 L 702 242 L 681 270 L 644 313 L 605 352 L 569 383 L 529 413 L 481 443 L 334 519 L 251 566 L 177 614 L 119 660 L 85 695 L 50 744 L 33 777 L 21 807 L 0 875 L 635 873 L 651 870 L 665 865 L 682 854 L 693 843 L 705 827 L 765 731 L 245 731 L 244 728 L 287 630 L 226 662 L 176 694 L 131 726 L 76 771 L 53 793 L 52 791 L 98 738 L 131 707 L 194 657 L 244 624 L 308 587 L 387 547 L 468 511 L 549 478 L 611 448 L 652 424 L 688 400 L 741 356 L 783 314 L 830 256 L 867 200 L 919 251 Z'
const BRAND_LETTER =
  'M 121 441 L 255 441 L 281 378 L 297 347 L 314 329 L 323 323 L 338 317 L 355 314 L 605 313 L 622 296 L 657 254 L 685 214 L 711 169 L 328 168 L 302 171 L 273 180 L 257 188 L 235 204 L 223 216 L 208 237 L 193 268 Z M 805 456 L 657 456 L 641 466 L 606 483 L 448 549 L 379 582 L 345 601 L 714 601 L 781 498 Z'

// Maior fonte (entre max e min) em que `content` cabe em `width`, estimando a largura de cada caractere.
export function fitFontSize(content, width, max, min, charRatio, spacing) {
  const length = String(content).length || 1
  for (let size = max; size > min; size -= 2) {
    if (length * (size * charRatio + spacing) <= width) return size
  }
  return min
}

export function escapeXml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]
  )
}

const num = (value) => Math.round(value * 100) / 100

function text(
  x,
  y,
  content,
  { size, weight = 600, fill = C.ink, anchor = 'start', spacing = 0, opacity = 1 }
) {
  return `<text x="${num(x)}" y="${num(y)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${spacing ? ` letter-spacing="${spacing}"` : ''}${opacity !== 1 ? ` opacity="${opacity}"` : ''}>${escapeXml(content)}</text>`
}

// Um bloquinho. completed = cheio com check; planned = tracejado; rest = traço; none/future = apagado.
function blockSvg(cellData, x, y, size, { showLabel }) {
  if (!cellData) return ''
  const radius = Math.max(4, Math.round(size * 0.22))
  const state = cellData.state
  const half = size / 2
  let body
  if (state === 'completed') {
    body = `<rect x="${num(x)}" y="${num(y)}" width="${num(size)}" height="${num(size)}" rx="${radius}" fill="${C.accent}"/>`
    if (size >= 30) {
      const s = size * 0.3
      body += `<path d="M ${num(x + half - s)} ${num(y + half + s * 0.05)} l ${num(s * 0.7)} ${num(s * 0.7)} l ${num(s * 1.3)} ${num(-s * 1.4)}" fill="none" stroke="${C.onAccent}" stroke-width="${num(Math.max(3, size * 0.09))}" stroke-linecap="round" stroke-linejoin="round"/>`
    }
  } else if (state === 'planned' || state === 'in_progress') {
    // planejado e ainda por fazer: tracejado; planejado no futuro fica mais discreto (não polui a grade)
    body = `<rect x="${num(x + 2)}" y="${num(y + 2)}" width="${num(size - 4)}" height="${num(size - 4)}" rx="${radius}" fill="${C.cell}" stroke="${C.accentDim}" stroke-width="3" stroke-dasharray="${num(size * 0.14)} ${num(size * 0.1)}"${cellData.isFuture ? ' opacity="0.55"' : ''}/>`
  } else if (state === 'rest') {
    body = `<rect x="${num(x)}" y="${num(y)}" width="${num(size)}" height="${num(size)}" rx="${radius}" fill="${C.cell}"/>`
    // traço de descanso: só em blocos grandes; com número no bloco, vai embaixo (nunca riscando o número)
    if (size >= 56) {
      const barY = showLabel && cellData.label ? y + size * 0.78 : y + half - 2
      body += `<rect x="${num(x + size * 0.32)}" y="${num(barY)}" width="${num(size * 0.36)}" height="4" rx="2" fill="${C.muted}" opacity="0.5"/>`
    }
  } else {
    body = `<rect x="${num(x)}" y="${num(y)}" width="${num(size)}" height="${num(size)}" rx="${radius}" fill="${cellData.isFuture ? C.cellFuture : C.cell}"/>`
  }
  if (cellData.isToday) {
    body += `<rect x="${num(x - 3)}" y="${num(y - 3)}" width="${num(size + 6)}" height="${num(size + 6)}" rx="${radius + 3}" fill="none" stroke="${C.ink}" stroke-width="3"/>`
  }
  if (showLabel && cellData.label && state !== 'completed') {
    body += text(x + half, y + half + size * (state === 'rest' ? 0.02 : 0.1), cellData.label, {
      size: Math.round(size * 0.3),
      weight: 600,
      fill: C.muted,
      anchor: 'middle',
      opacity: cellData.isFuture ? 0.5 : 0.9,
    })
  }
  if (showLabel && cellData.label && state === 'completed' && size >= 60) {
    // dia do mês dentro do bloco cheio fica no canto, pequeno, para não competir com o check
    body += text(x + size - 9, y + 22, cellData.label, {
      size: Math.round(size * 0.2),
      weight: 700,
      fill: C.onAccent,
      anchor: 'end',
      opacity: 0.7,
    })
  }
  return body
}

// Layout da grade dentro do painel (px dentro de 1080x1350). Devolve o SVG e a altura ocupada.
function gridSvg(grid, box) {
  const { x, y, w, h } = box
  const rows = grid.rows
  if (grid.kind === 'row') {
    const cells = rows[0]
    const count = cells.length
    const gap = 14
    const size = Math.min((w - gap * (count - 1)) / count, h - 64)
    const total = size * count + gap * (count - 1)
    const startX = x + (w - total) / 2
    const top = y + (h - size) / 2 + 20
    let out = ''
    cells.forEach((c, i) => {
      const cx = startX + i * (size + gap)
      out += text(cx + size / 2, top - 22, c.label || '', {
        size: 26,
        weight: 700,
        fill: C.muted,
        anchor: 'middle',
      })
      out += blockSvg(c, cx, top, size, { showLabel: false })
    })
    return out
  }
  if (grid.kind === 'calendar') {
    const gap = 12
    const headerH = 44
    const sizeByW = (w - gap * 6) / 7
    const sizeByH = (h - headerH - gap * (rows.length - 1)) / rows.length
    const size = Math.min(sizeByW, sizeByH)
    const totalW = size * 7 + gap * 6
    const totalH = headerH + size * rows.length + gap * (rows.length - 1)
    const startX = x + (w - totalW) / 2
    const startY = y + (h - totalH) / 2
    let out = ''
    grid.headers.forEach((label, i) => {
      out += text(startX + i * (size + gap) + size / 2, startY + 28, label, {
        size: 24,
        weight: 700,
        fill: C.muted,
        anchor: 'middle',
      })
    })
    rows.forEach((week, r) => {
      week.forEach((c, i) => {
        out += blockSvg(c, startX + i * (size + gap), startY + headerH + r * (size + gap), size, {
          showLabel: true,
        })
      })
    })
    return out
  }
  // heatmap: colunas = semanas, linhas = dias da semana (segunda no topo)
  const cols = rows.length
  const gap = 8
  const headerH = 40
  const sizeByW = (w - gap * (cols - 1)) / cols
  const sizeByH = (h - headerH - gap * 6) / 7
  const size = Math.min(sizeByW, sizeByH)
  const totalW = size * cols + gap * (cols - 1)
  const totalH = headerH + size * 7 + gap * 6
  const startX = x + (w - totalW) / 2
  const startY = y + (h - totalH) / 2
  let out = ''
  rows.forEach((week, col) => {
    const label = grid.headers[col]
    if (label)
      out += text(startX + col * (size + gap), startY + 26, label, {
        size: 24,
        weight: 700,
        fill: C.muted,
      })
    week.forEach((c, row) => {
      out += blockSvg(c, startX + col * (size + gap), startY + headerH + row * (size + gap), size, {
        showLabel: false,
      })
    })
  })
  return out
}

export function buildShareSvg(model) {
  const W = SHARE_WIDTH
  const H = SHARE_HEIGHT
  const pad = 72
  // Painel por tipo de grade: a linha de 7 dias é baixa e fica centralizada; o calendário mensal usa mais altura.
  const kind = model.grid.kind
  const panel =
    kind === 'row'
      ? { x: pad, y: 540, w: W - pad * 2, h: 420 }
      : kind === 'calendar'
        ? { x: pad, y: 440, w: W - pad * 2, h: 606 }
        : { x: pad, y: 470, w: W - pad * 2, h: 580 }
  const metricCount = model.metrics.length
  const metricW = (W - pad * 2) / metricCount

  const metrics = model.metrics
    .map((metric, i) => {
      const cx = pad + metricW * i + metricW / 2
      const label = metric.label.toUpperCase()
      // cabe na coluna: reduz a fonte do rótulo/valor conforme o tamanho do texto (estimativa de largura)
      const labelSize = fitFontSize(label, metricW * 0.94, 26, 20, 0.62, 1.5)
      const valueSize = fitFontSize(metric.value, metricW * 0.94, 96, 52, 0.62, 0)
      return (
        text(cx, 1166, metric.value, {
          size: valueSize,
          weight: 800,
          fill: C.ink,
          anchor: 'middle',
        }) +
        text(cx, 1210, label, {
          size: labelSize,
          weight: 700,
          fill: C.muted,
          anchor: 'middle',
          spacing: 1.5,
        })
      )
    })
    .join('')

  const subtitle = model.subtitle
    ? text(pad, 392, model.subtitle, { size: 42, weight: 500, fill: C.muted })
    : ''
  const handle = model.handle
    ? text(W - pad, 1296, model.handle, { size: 32, weight: 600, fill: C.muted, anchor: 'end' })
    : ''

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(model.alt || model.title)}">`,
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg0}"/></linearGradient>`,
    `<radialGradient id="glow" cx="0.85" cy="0" r="0.7"><stop offset="0" stop-color="${C.accent}" stop-opacity="0.22"/><stop offset="1" stop-color="${C.accent}" stop-opacity="0"/></radialGradient></defs>`,
    `<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>`,
    // cabeçalho: marca + nome
    `<g transform="translate(${pad} 70) scale(0.075)"><path d="${BRAND_ARROW}" fill="${C.accent}"/><path d="${BRAND_LETTER}" fill="${C.ink}"/></g>`,
    text(pad + 92, 128, 'Evolutus', { size: 44, weight: 800, fill: C.ink }),
    // título
    text(pad, 252, model.eyebrow.toUpperCase(), {
      size: 30,
      weight: 800,
      fill: C.accentStrong,
      spacing: 5,
    }),
    text(pad, 340, model.title, {
      size: model.title.length > 14 ? 76 : 92,
      weight: 800,
      fill: C.ink,
    }),
    subtitle,
    // painel da grade
    `<rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="40" fill="${C.panel}" stroke="${C.panelBorder}" stroke-width="2"/>`,
    gridSvg(model.grid, { x: panel.x + 36, y: panel.y + 28, w: panel.w - 72, h: panel.h - 56 }),
    metrics,
    // rodapé
    `<rect x="${pad}" y="1246" width="${W - pad * 2}" height="2" fill="${C.panelBorder}"/>`,
    text(pad, 1296, 'Seu diário de evolução', { size: 32, weight: 600, fill: C.muted }),
    handle,
    '</svg>',
  ].join('')
}

export function svgToDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
