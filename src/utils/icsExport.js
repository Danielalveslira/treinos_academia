// "Adicionar ao calendário" (Treino Marcado V1) -- gera um arquivo .ics no próprio
// navegador, sem nenhuma Function/escrita no Firestore nem integração OAuth com Google
// Calendar. buildIcsEvent é puro (testável sem DOM); downloadIcsFile é o único ponto que
// toca o DOM (Blob + <a download>), isolado de propósito para o resto ficar testável.

// RFC 5545: vírgula, ponto e vírgula e barra invertida precisam de escape; quebras de
// linha viram \n literal dentro do valor.
function escapeIcsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

// Formato "basic" UTC exigido pelo RFC 5545 (YYYYMMDDTHHMMSSZ).
function toIcsUtc(dateMs) {
  return new Date(dateMs)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000

// { uid, title, startMs, endMs?, location?, description? } -> string .ics completo.
// endMs é opcional (o schema de treino marcado não tem duração, ver
// utils/scheduledWorkout.js) -- sem ele, assume DEFAULT_DURATION_MS, mesma duração
// estimada usada para o estado "Em andamento" do card. Esse fim estimado não representa
// confirmação de realização ou presença no treino.
export function buildIcsEvent({ uid, title, startMs, endMs, location, description }) {
  const start = toIcsUtc(startMs)
  const end = toIcsUtc(endMs ?? startMs + DEFAULT_DURATION_MS)
  const stamp = toIcsUtc(Date.now())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Evolutus//Treino Marcado//PT',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(title)}`,
  ]
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`)
  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  // CRLF é o quebra-linha exigido pelo RFC 5545, não \n puro.
  return lines.join('\r\n')
}

export function downloadIcsFile(filename, icsContent) {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
