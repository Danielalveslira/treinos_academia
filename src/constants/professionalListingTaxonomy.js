export const LISTING_KIND_OPTIONS = [
  { value: 'professional', label: 'Profissional' },
  { value: 'space', label: 'Espaço' },
]

export const CATEGORY_OPTIONS = [
  ['personal_trainer', 'Personal trainer'],
  ['coach', 'Treinador(a)'],
  ['fisioterapia', 'Fisioterapia'],
  ['nutricao', 'Nutrição'],
  ['academia', 'Academia'],
  ['box', 'Box'],
  ['studio', 'Estúdio'],
  ['assessoria', 'Assessoria esportiva'],
  ['outros', 'Outros'],
].map(([value, label]) => ({ value, label }))

export const MODALITY_OPTIONS = [
  ['musculacao', 'Musculação'],
  ['corrida', 'Corrida'],
  ['cross_training', 'Cross training'],
  ['funcional', 'Treino funcional'],
  ['ciclismo', 'Ciclismo'],
  ['natacao', 'Natação'],
  ['lutas', 'Lutas'],
  ['yoga', 'Yoga'],
  ['pilates', 'Pilates'],
  ['triatlo', 'Triatlo'],
  ['danca', 'Dança'],
  ['outros', 'Outros'],
].map(([value, label]) => ({ value, label }))

export const SERVICE_MODE_OPTIONS = [
  { value: 'in_person', label: 'Presencial' },
  { value: 'online', label: 'Online' },
  { value: 'hybrid', label: 'Híbrido' },
]

export const BRAZIL_STATES = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
]

export function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label || value || '—'
}
