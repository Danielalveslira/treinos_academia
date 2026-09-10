import {
  Dumbbell,
  Kayak,
  Footprints,
  ArrowUpFromLine,
  BicepsFlexed,
  HandFist,
  Waves,
  PersonStanding,
  ChevronsUp,
  HeartPulse,
} from 'lucide-react'

// Ícones minimalistas (Lucide) por grupo muscular — reforço visual nos cards de
// "Treinar" (ver WorkoutForm.jsx), no lugar da inicial do nome. Não existe um ícone
// anatômico literal para a maioria dos grupos, então a escolha segue o movimento ou
// ferramenta mais associado a cada um (ex.: Kayak para Costas, pela puxada). Um grupo
// fora desta lista (personalizado, além de MUSCLE_GROUPS) cai no ícone padrão.
export const MUSCLE_GROUP_ICONS = {
  Peito: Dumbbell,
  Costas: Kayak,
  Pernas: Footprints,
  Ombros: ArrowUpFromLine,
  Bíceps: BicepsFlexed,
  Tríceps: HandFist,
  Abdômen: Waves,
  Glúteos: PersonStanding,
  Panturrilha: ChevronsUp,
  Cardio: HeartPulse,
}

export const DEFAULT_MUSCLE_GROUP_ICON = Dumbbell

export function getMuscleGroupIcon(group) {
  return MUSCLE_GROUP_ICONS[group] || DEFAULT_MUSCLE_GROUP_ICON
}
