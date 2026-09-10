// Idade nunca é armazenada — sempre calculada a partir da data de nascimento no
// momento em que é necessária (aqui, ou no espelho server-side em
// functions/legal-core.js), porque um valor gravado ficaria desatualizado com o tempo.
export function calculateAge(birthDateString, now = new Date()) {
  const birth = new Date(`${birthDateString}T00:00:00`)
  let age = now.getFullYear() - birth.getFullYear()
  const hadBirthdayThisYear =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate())
  if (!hadBirthdayThisYear) age -= 1
  return age
}
