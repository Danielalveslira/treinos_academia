import { Users, Dumbbell, HeartPulse, Flame, Trophy, Target, Zap, Star, Rocket, Mountain, Bike, Footprints } from 'lucide-react'

// Mesmo padrão de muscleGroupIcons.js: mapa de nome (gravado em communities.icon_name)
// para o componente do ícone, com um padrão seguro
// pra comunidades de antes deste campo existir (getCommunityIcon nunca retorna
// undefined). A lista de chaves (COMMUNITY_ICON_NAMES) é a mesma usada tanto pra montar
// a grade do seletor quanto validar no cliente.
export const COMMUNITY_ICONS = {
  users: Users,
  dumbbell: Dumbbell,
  'heart-pulse': HeartPulse,
  flame: Flame,
  trophy: Trophy,
  target: Target,
  zap: Zap,
  star: Star,
  rocket: Rocket,
  mountain: Mountain,
  bike: Bike,
  footprints: Footprints,
}

export const COMMUNITY_ICON_NAMES = Object.keys(COMMUNITY_ICONS)

export const DEFAULT_COMMUNITY_ICON_NAME = 'users'

export function getCommunityIcon(name) {
  return COMMUNITY_ICONS[name] || COMMUNITY_ICONS[DEFAULT_COMMUNITY_ICON_NAME]
}
