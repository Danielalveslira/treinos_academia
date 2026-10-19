import {
  Activity,
  Apple,
  Bike,
  BicepsFlexed,
  BookOpen,
  Brain,
  CalendarDays,
  Carrot,
  ChefHat,
  CircleDot,
  Coffee,
  CookingPot,
  Dumbbell,
  Egg,
  Fish,
  Flag,
  Flame,
  Flower2,
  Footprints,
  GlassWater,
  Goal,
  HandHeart,
  Heart,
  HeartPulse,
  Leaf,
  Medal,
  MessagesSquare,
  Moon,
  Mountain,
  Move,
  Rocket,
  Route,
  Salad,
  Scale,
  Star,
  Sun,
  Target,
  Timer,
  Trophy,
  Users,
  Utensils,
  Waves,
  Wheat,
  Zap,
} from 'lucide-react'

// Os IDs são gravados em communities.icon_name. Os 12 IDs originais permanecem
// intactos; rótulos, categorias e componentes vêm desta mesma fonte.
export const COMMUNITY_ICON_CATEGORIES = [
  { id: 'all', label: 'Todos' },
  { id: 'food', label: 'Alimentação' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'sports', label: 'Esportes' },
  { id: 'health', label: 'Saúde' },
  { id: 'other', label: 'Outros' },
]

export const COMMUNITY_ICON_OPTIONS = [
  { name: 'apple', label: 'Maçã', purpose: 'Alimentação saudável', category: 'food', icon: Apple },
  {
    name: 'carrot',
    label: 'Cenoura',
    purpose: 'Vegetais e alimentação natural',
    category: 'food',
    icon: Carrot,
  },
  {
    name: 'salad',
    label: 'Salada',
    purpose: 'Dietas e receitas saudáveis',
    category: 'food',
    icon: Salad,
  },
  {
    name: 'utensils',
    label: 'Talheres',
    purpose: 'Alimentação em geral',
    category: 'food',
    icon: Utensils,
  },
  {
    name: 'cooking-pot',
    label: 'Panela',
    purpose: 'Culinária e receitas',
    category: 'food',
    icon: CookingPot,
  },
  {
    name: 'chef-hat',
    label: 'Chapéu de chef',
    purpose: 'Gastronomia',
    category: 'food',
    icon: ChefHat,
  },
  { name: 'fish', label: 'Peixe', purpose: 'Alimentação proteica', category: 'food', icon: Fish },
  { name: 'egg', label: 'Ovo', purpose: 'Proteínas', category: 'food', icon: Egg },
  {
    name: 'glass-water',
    label: 'Copo de água',
    purpose: 'Hidratação',
    category: 'food',
    icon: GlassWater,
  },
  { name: 'coffee', label: 'Café', purpose: 'Hábitos alimentares', category: 'food', icon: Coffee },
  {
    name: 'wheat',
    label: 'Trigo',
    purpose: 'Cereais e alimentação',
    category: 'food',
    icon: Wheat,
  },
  { name: 'scale', label: 'Balança', purpose: 'Controle de peso', category: 'food', icon: Scale },

  {
    name: 'dumbbell',
    label: 'Halteres',
    purpose: 'Musculação',
    category: 'fitness',
    icon: Dumbbell,
  },
  {
    name: 'biceps-flexed',
    label: 'Braço flexionado',
    purpose: 'Hipertrofia',
    category: 'fitness',
    icon: BicepsFlexed,
  },
  { name: 'zap', label: 'Raio', purpose: 'Treinos intensos', category: 'fitness', icon: Zap },
  { name: 'flame', label: 'Chama', purpose: 'Queima calórica', category: 'fitness', icon: Flame },
  {
    name: 'target',
    label: 'Alvo',
    purpose: 'Objetivos fitness',
    category: 'fitness',
    icon: Target,
  },
  {
    name: 'timer',
    label: 'Cronômetro',
    purpose: 'Treinos intervalados',
    category: 'fitness',
    icon: Timer,
  },
  { name: 'medal', label: 'Medalha', purpose: 'Conquistas', category: 'fitness', icon: Medal },
  { name: 'trophy', label: 'Troféu', purpose: 'Competições', category: 'fitness', icon: Trophy },

  {
    name: 'route',
    label: 'Corrida',
    purpose: 'Corrida e percursos',
    category: 'sports',
    icon: Route,
  },
  { name: 'bike', label: 'Bicicleta', purpose: 'Ciclismo', category: 'sports', icon: Bike },
  {
    name: 'footprints',
    label: 'Pegadas',
    purpose: 'Caminhada',
    category: 'sports',
    icon: Footprints,
  },
  {
    name: 'mountain',
    label: 'Montanha',
    purpose: 'Trilhas e aventuras',
    category: 'sports',
    icon: Mountain,
  },
  { name: 'goal', label: 'Futebol', purpose: 'Futebol', category: 'sports', icon: Goal },
  {
    name: 'circle-dot',
    label: 'Basquete',
    purpose: 'Basquete e esportes com bola',
    category: 'sports',
    icon: CircleDot,
  },
  { name: 'waves', label: 'Ondas', purpose: 'Natação', category: 'sports', icon: Waves },
  { name: 'move', label: 'Movimento', purpose: 'Mobilidade', category: 'sports', icon: Move },

  {
    name: 'heart-pulse',
    label: 'Coração com pulso',
    purpose: 'Saúde cardiovascular',
    category: 'health',
    icon: HeartPulse,
  },
  { name: 'heart', label: 'Coração', purpose: 'Autocuidado', category: 'health', icon: Heart },
  { name: 'brain', label: 'Cérebro', purpose: 'Saúde mental', category: 'health', icon: Brain },
  { name: 'moon', label: 'Lua', purpose: 'Sono e descanso', category: 'health', icon: Moon },
  { name: 'leaf', label: 'Folha', purpose: 'Vida saudável', category: 'health', icon: Leaf },
  {
    name: 'flower-2',
    label: 'Flor',
    purpose: 'Equilíbrio e bem-estar',
    category: 'health',
    icon: Flower2,
  },
  { name: 'sun', label: 'Sol', purpose: 'Qualidade de vida', category: 'health', icon: Sun },
  {
    name: 'activity',
    label: 'Atividade',
    purpose: 'Condicionamento físico',
    category: 'health',
    icon: Activity,
  },

  {
    name: 'users',
    label: 'Pessoas',
    purpose: 'Comunidades gerais',
    category: 'other',
    icon: Users,
  },
  {
    name: 'messages-square',
    label: 'Mensagens',
    purpose: 'Conversas',
    category: 'other',
    icon: MessagesSquare,
  },
  { name: 'star', label: 'Estrela', purpose: 'Motivação', category: 'other', icon: Star },
  {
    name: 'rocket',
    label: 'Foguete',
    purpose: 'Evolução pessoal',
    category: 'other',
    icon: Rocket,
  },
  { name: 'flag', label: 'Bandeira', purpose: 'Desafios', category: 'other', icon: Flag },
  {
    name: 'calendar-days',
    label: 'Calendário',
    purpose: 'Rotinas',
    category: 'other',
    icon: CalendarDays,
  },
  { name: 'book-open', label: 'Livro', purpose: 'Conhecimento', category: 'other', icon: BookOpen },
  {
    name: 'hand-heart',
    label: 'Mãos com coração',
    purpose: 'Apoio mútuo',
    category: 'other',
    icon: HandHeart,
  },
]

export const COMMUNITY_ICONS = Object.fromEntries(
  COMMUNITY_ICON_OPTIONS.map(({ name, icon }) => [name, icon])
)
export const COMMUNITY_ICON_NAMES = COMMUNITY_ICON_OPTIONS.map(({ name }) => name)
export const DEFAULT_COMMUNITY_ICON_NAME = 'users'

const optionsByName = new Map(COMMUNITY_ICON_OPTIONS.map((option) => [option.name, option]))

export function getCommunityIconOption(name) {
  return optionsByName.get(name) || optionsByName.get(DEFAULT_COMMUNITY_ICON_NAME)
}

export function getCommunityIcon(name) {
  return getCommunityIconOption(name).icon
}
