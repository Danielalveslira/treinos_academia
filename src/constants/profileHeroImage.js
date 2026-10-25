// Existing athlete assets, shared with the Home rotation. Stable objects keep ordinary
// workout/cache updates from changing image identity. Unknown values never imply a sex.
const MALE = {
  name: 'capa',
  width: 1145,
  height: 1374,
  alt: 'Atleta fazendo barra fixa em uma academia',
  frame: 'portrait',
}
const FEMALE = {
  name: 'sexo_mulher',
  width: 1024,
  height: 1536,
  alt: 'Atleta fazendo levantamento terra em uma academia',
  frame: 'portrait',
}
const NEUTRAL = {
  name: 'home-banner-anilhas',
  width: 1024,
  height: 576,
  alt: 'Anilhas de musculação enfileiradas em um rack de academia',
}

// Same metadata contract (name/width/height/alt); explicit neutral fallback also applies
// to legacy callers. Values match users.sexo and the registration/profile controls.
export function getProfileHeroImage(sexo) {
  if (sexo === 'masculino') return MALE
  if (sexo === 'feminino') return FEMALE
  return NEUTRAL
}
