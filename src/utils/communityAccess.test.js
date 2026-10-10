import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  communityAccessView,
  communityContentCachePrefixes,
  mergeMembersWithBanned,
  normalizeCommunityAccess,
  shouldPurgeCommunityState,
} from './communityAccess.js'

test('os quatro estados do servidor viram a tela certa', () => {
  assert.equal(communityAccessView('member'), 'feed')
  assert.equal(communityAccessView('not_member'), 'join')
  assert.equal(communityAccessView('banned'), 'banned')
  assert.equal(communityAccessView('unavailable'), 'unavailable')
})

test('estado desconhecido nega acesso (fail-closed)', () => {
  for (const value of [undefined, null, '', 'owner', 'MEMBER', 1, {}]) {
    assert.equal(normalizeCommunityAccess(value), 'unavailable')
    assert.equal(communityAccessView(value), 'unavailable')
  }
})

test('só perder o acesso dispara a limpeza de conteúdo', () => {
  assert.equal(shouldPurgeCommunityState('member', 'banned'), true)
  assert.equal(shouldPurgeCommunityState('member', 'not_member'), true)
  assert.equal(shouldPurgeCommunityState('member', 'unavailable'), true)
  assert.equal(shouldPurgeCommunityState('member', 'member'), false)
  assert.equal(shouldPurgeCommunityState('not_member', 'not_member'), false)
  assert.equal(shouldPurgeCommunityState('not_member', 'member'), false)
  assert.equal(shouldPurgeCommunityState('banned', 'banned'), false)
  assert.equal(shouldPurgeCommunityState('member', 'lixo'), true)
})

test('prefixos de cache cobrem feed, anúncios e as chaves da comunidade/lista da conta', () => {
  const prefixes = communityContentCachePrefixes('u1', 'c1')
  assert.deepEqual(prefixes, ['communityFeed:u1:c1', 'sponsoredAds:c1', 'communities:u1'])
  // as chaves reais usadas pela página e pelos destaques começam por communities:{uid}
  for (const key of ['communities:u1:page:c1', 'communities:u1:featured:c1', 'communities:u1']) {
    assert.ok(prefixes.some((prefix) => key.startsWith(prefix)))
  }
})

test('moderação lista membros + banidos; removido e desbanido não aparecem', () => {
  const members = [
    { id: 'c_a', communityId: 'c', userId: 'a', joinedAt: 't' },
    { id: 'c_b', communityId: 'c', userId: 'b', joinedAt: 't' },
  ]
  const restrictions = [{ id: 'c_x', communityId: 'c', userId: 'x' }]
  const merged = mergeMembersWithBanned(members, restrictions)
  assert.deepEqual(
    merged.map((item) => item.userId),
    ['a', 'b', 'x']
  )
  // depois de remover b (sem ban): sai da lista
  assert.deepEqual(
    mergeMembersWithBanned([members[0]], restrictions).map((i) => i.userId),
    ['a', 'x']
  )
  // depois de desbanir x: não volta como membro
  assert.deepEqual(
    mergeMembersWithBanned([members[0]], []).map((i) => i.userId),
    ['a']
  )
  // restrição de quem (por dado legado) ainda é membro não duplica a linha
  assert.deepEqual(
    mergeMembersWithBanned(members, [{ id: 'c_a', communityId: 'c', userId: 'a' }]).length,
    2
  )
})
