import { getProfileHeroImage } from '../../constants/profileHeroImage.js'

// All sequence and fallback configuration lives here. Only metadata is imported: images
// are fetched by ResponsivePicture for the selected day, never by this registry.
const ANILHAS = getProfileHeroImage(null)
const EQUIPE = {
  name: 'home-banner-equipe',
  alt: 'Grupo de pessoas comemorando um treino em equipe em uma academia',
  width: 1024,
  height: 576,
}
export const DASHBOARD_BANNER_PHOTOS = [ANILHAS, EQUIPE]
const MALE = getProfileHeroImage('masculino')
const FEMALE = getProfileHeroImage('feminino')
const SEQUENCES = {
  [MALE.name]: [MALE, ANILHAS, MALE, EQUIPE],
  [FEMALE.name]: [FEMALE, ANILHAS, FEMALE, EQUIPE],
  [ANILHAS.name]: [ANILHAS, EQUIPE, ANILHAS, EQUIPE],
}
export function getDashboardBannerSequence(sexo) {
  return SEQUENCES[getProfileHeroImage(sexo).name]
}
export function getDashboardBannerFallbacks(selected) {
  return [selected, ...DASHBOARD_BANNER_PHOTOS.filter((photo) => photo.name !== selected.name)]
}
