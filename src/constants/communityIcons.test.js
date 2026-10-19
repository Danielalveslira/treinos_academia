import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  COMMUNITY_ICON_CATEGORIES,
  COMMUNITY_ICON_NAMES,
  COMMUNITY_ICON_OPTIONS,
  DEFAULT_COMMUNITY_ICON_NAME,
  getCommunityIcon,
  getCommunityIconOption,
} from './communityIcons.js'

const oldNames = [
  'users',
  'dumbbell',
  'heart-pulse',
  'flame',
  'trophy',
  'target',
  'zap',
  'star',
  'rocket',
  'mountain',
  'bike',
  'footprints',
]

test('preserva os identificadores antigos e oferece as cinco categorias', () => {
  for (const name of oldNames) assert.ok(COMMUNITY_ICON_NAMES.includes(name), name)
  assert.deepEqual(
    COMMUNITY_ICON_CATEGORIES.map(({ id }) => id),
    ['all', 'food', 'fitness', 'sports', 'health', 'other']
  )
  for (const category of COMMUNITY_ICON_CATEGORIES.slice(1)) {
    assert.ok(
      COMMUNITY_ICON_OPTIONS.some((option) => option.category === category.id),
      category.id
    )
  }
  assert.equal(new Set(COMMUNITY_ICON_NAMES).size, COMMUNITY_ICON_NAMES.length)
})

test('cada opção aponta para um ícone vetorial real e tem nome legível', () => {
  for (const option of COMMUNITY_ICON_OPTIONS) {
    assert.equal(typeof option.icon, 'object')
    assert.ok(option.label)
    assert.ok(option.purpose)
    assert.equal(getCommunityIcon(option.name), option.icon)
  }
  assert.equal(getCommunityIcon('desconhecido'), getCommunityIcon(DEFAULT_COMMUNITY_ICON_NAME))
  assert.equal(getCommunityIconOption('desconhecido').name, DEFAULT_COMMUNITY_ICON_NAME)
})

test('constraint do banco aceita exatamente os identificadores do catálogo', async () => {
  const sql = await readFile(
    new URL('../../supabase/migrations/20261106000001_expand_community_icons.sql', import.meta.url),
    'utf8'
  )
  const dbNames = [...sql.matchAll(/'([a-z][a-z0-9-]*)'/g)].map((match) => match[1])
  assert.deepEqual(dbNames.sort(), [...COMMUNITY_ICON_NAMES].sort())
})
