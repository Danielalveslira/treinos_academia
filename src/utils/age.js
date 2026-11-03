import { businessDayKey } from './businessDate.js'

// Idade nunca é armazenada — sempre calculada a partir da data de nascimento no momento em
// que é necessária. "Hoje" é o dia civil de America/Sao_Paulo (businessDayKey), o mesmo do
// servidor (accept_legal_documents/set_birth_info usam (now() at time zone 'America/Sao_Paulo')::date
// e age()); o fuso do aparelho nunca decide. Aniversário em 29/02 conta a partir de 01/03 nos anos
// não bissextos, como age() do PostgreSQL.
export function calculateAge(birthDateString, now = new Date()) {
  const [birthYear, birthMonth, birthDay] = String(birthDateString)
    .slice(0, 10)
    .split('-')
    .map(Number)
  const [year, month, day] = businessDayKey(now).split('-').map(Number)
  let age = year - birthYear
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1
  return age
}
