import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MUSCLE_GROUPS } from './muscleGroups.js'
import {
  DEFAULT_MUSCLE_GROUP_ICON,
  MUSCLE_GROUP_ICONS,
  MUSCLE_ICONS,
  getMuscleGroupIcon,
  getMuscleIcon,
} from './muscleGroupIcons.js'

test('getMuscleGroupIcon cobre todos os 13 grupos fixos da biblioteca, cada um com ícone próprio', () => {
  for (const group of MUSCLE_GROUPS) {
    assert.ok(MUSCLE_GROUP_ICONS[group], `grupo "${group}" sem ícone`)
    assert.equal(getMuscleGroupIcon(group), MUSCLE_GROUP_ICONS[group])
  }
})

test('getMuscleGroupIcon cai no ícone padrão pra grupo personalizado desconhecido', () => {
  assert.equal(getMuscleGroupIcon('Mobilidade'), DEFAULT_MUSCLE_GROUP_ICON)
  assert.equal(getMuscleGroupIcon(undefined), DEFAULT_MUSCLE_GROUP_ICON)
})

// Os 17 valores reais de primaryMuscle/secondaryMuscle do catálogo (ver
// exerciseCatalog.test.js) -- cada um deve ter ícone próprio no mapa de músculo cru,
// nenhum deve depender só do fallback.
const REAL_MUSCLES = [
  'abdominais', 'abdutores', 'adutores', 'antebracos', 'biceps', 'dorsais', 'gluteos',
  'inferior-das-costas', 'isquiotibiais', 'meio-das-costas', 'ombros', 'panturrilhas',
  'peito', 'pescoco', 'quadriceps', 'trapezio', 'triceps',
]

test('getMuscleIcon cobre os 17 músculos reais do catálogo, cada um com ícone próprio', () => {
  for (const muscle of REAL_MUSCLES) {
    assert.ok(MUSCLE_ICONS[muscle], `músculo "${muscle}" sem ícone`)
    assert.equal(getMuscleIcon(muscle), MUSCLE_ICONS[muscle])
  }
})

test('getMuscleIcon normaliza caixa e cai no ícone padrão pra músculo desconhecido/ausente', () => {
  assert.equal(getMuscleIcon('PEITO'), MUSCLE_ICONS.peito)
  assert.equal(getMuscleIcon('musculo-novo-nao-mapeado'), DEFAULT_MUSCLE_GROUP_ICON)
  assert.equal(getMuscleIcon(undefined), DEFAULT_MUSCLE_GROUP_ICON)
  assert.equal(getMuscleIcon(null), DEFAULT_MUSCLE_GROUP_ICON)
})

test('nenhum ícone de grupo/músculo se repete em mais da metade dos grupos -- evita ícone genérico pra quase tudo', () => {
  const counts = new Map()
  for (const icon of Object.values(MUSCLE_GROUP_ICONS)) {
    counts.set(icon, (counts.get(icon) || 0) + 1)
  }
  const maxRepeats = Math.max(...counts.values())
  assert.ok(maxRepeats <= Math.ceil(MUSCLE_GROUPS.length / 2), `um ícone se repete ${maxRepeats} vezes`)
})
