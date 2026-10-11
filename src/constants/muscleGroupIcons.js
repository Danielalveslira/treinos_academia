import {
  Dumbbell,
  Kayak,
  Footprints,
  ArrowUpFromLine,
  ArrowDownFromLine,
  ArrowBigUp,
  BicepsFlexed,
  HandFist,
  Waves,
  PersonStanding,
  ChevronsUp,
  ChevronUp,
  ChevronDown,
  HeartPulse,
  Grip,
  Ellipsis,
  UnfoldHorizontal,
  FoldHorizontal,
  Rows2,
  Rows3,
  Layers,
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
  Antebraços: Grip,
  Pescoço: ArrowBigUp,
  Cardio: HeartPulse,
  Outros: Ellipsis,
}

export const DEFAULT_MUSCLE_GROUP_ICON = Dumbbell

export function getMuscleGroupIcon(group) {
  return MUSCLE_GROUP_ICONS[group] || DEFAULT_MUSCLE_GROUP_ICON
}

// Ícones por músculo CRU do catálogo (os 17 valores de primaryMuscle/secondaryMuscle de
// imports/exercicios_ptbr.json, ver exerciseCatalog.js) -- mais finos que o ícone do grupo
// da biblioteca: várias dessas chaves caem no mesmo grupo (ex. dorsais/trapezio/pescoco
// todas em "Costas"), mas no Catálogo Evolutus (filtro/ficha de exercício) vale distinguir
// visualmente a região anatômica específica, não só o grupo de destino. Usado só como
// apoio visual -- o nome do músculo (formatCatalogLabel) nunca deixa de aparecer.
export const MUSCLE_ICONS = {
  abdominais: Waves,
  abdutores: UnfoldHorizontal,
  adutores: FoldHorizontal,
  antebracos: Grip,
  biceps: BicepsFlexed,
  dorsais: Rows3,
  gluteos: PersonStanding,
  'inferior-das-costas': ArrowDownFromLine,
  isquiotibiais: ChevronDown,
  'meio-das-costas': Rows2,
  ombros: ArrowUpFromLine,
  panturrilhas: ChevronsUp,
  peito: Dumbbell,
  pescoco: ArrowBigUp,
  quadriceps: ChevronUp,
  trapezio: Layers,
  triceps: HandFist,
}

export function getMuscleIcon(rawMuscle) {
  const key = rawMuscle?.toLowerCase()
  return (key && MUSCLE_ICONS[key]) || DEFAULT_MUSCLE_GROUP_ICON
}
