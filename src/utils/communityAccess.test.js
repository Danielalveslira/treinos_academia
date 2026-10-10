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

import {
  COMMUNITY_MESSAGES,
  accessAfterJoin,
  describeJoinFailure,
  exploreCardAction,
  normalizeJoinResult,
  splitCommunitiesByAccess,
  withCommunityAccess,
} from './communityAccess.js'

test('resultado de entrada vira o estado local; desconhecido não assume nada', () => {
  assert.equal(accessAfterJoin('joined'), 'member')
  assert.equal(accessAfterJoin('already_member'), 'member')
  assert.equal(accessAfterJoin('banned'), 'banned')
  assert.equal(accessAfterJoin('unavailable'), 'unavailable')
  for (const value of [undefined, null, '', 'COMMUNITY_BANNED', 'ok']) {
    assert.equal(accessAfterJoin(value), null)
    assert.equal(normalizeJoinResult(value), null)
  }
})

test('cartão do Explorar: Entrar só para not_member; banido e indisponível desabilitados; membro nunca', () => {
  assert.equal(exploreCardAction('not_member'), 'join')
  assert.equal(exploreCardAction(undefined), 'join')
  assert.equal(exploreCardAction('banned'), 'blocked')
  assert.equal(exploreCardAction('unavailable'), 'unavailable')
  assert.equal(exploreCardAction('member'), 'none')
  assert.equal(exploreCardAction('algo-novo'), 'unavailable')
})

test('mensagens: banimento não é erro e cada falha tem a sua mensagem', () => {
  assert.equal(COMMUNITY_MESSAGES.joinBlockedTitle, 'Você não pode entrar nesta comunidade')
  assert.equal(
    COMMUNITY_MESSAGES.joinBlockedText,
    'Seu acesso a esta comunidade foi bloqueado pelos administradores.'
  )
  assert.equal(COMMUNITY_MESSAGES.pageBlockedTitle, 'Acesso à comunidade bloqueado')
  assert.equal(
    COMMUNITY_MESSAGES.pageBlockedText,
    'Você não pode acessar o conteúdo desta comunidade.'
  )
  assert.equal(COMMUNITY_MESSAGES.unavailable, 'Esta comunidade não está disponível.')
  assert.equal(
    describeJoinFailure('connectivity'),
    'Não foi possível conectar. Verifique sua internet e tente novamente.'
  )
  assert.equal(
    describeJoinFailure('other'),
    'Não foi possível entrar na comunidade. Tente novamente.'
  )
  assert.equal(
    describeJoinFailure('auth'),
    'Não foi possível entrar na comunidade. Tente novamente.'
  )
  for (const text of Object.values(COMMUNITY_MESSAGES)) assert.doesNotMatch(text, /^Erro/)
})

test('tentativa recusada por banimento troca o cartão para bloqueado sem recarregar a lista', () => {
  const communities = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  let access = { a: 'member' }
  let { mine, explore } = splitCommunitiesByAccess(communities, access)
  assert.deepEqual(
    mine.map((c) => c.id),
    ['a']
  )
  assert.deepEqual(
    explore.map((c) => [c.id, c.access]),
    [
      ['b', 'not_member'],
      ['c', 'not_member'],
    ]
  )
  assert.equal(exploreCardAction(explore[0].access), 'join')
  // servidor responde 'banned' ao tentar entrar em b
  access = withCommunityAccess(access, 'b', accessAfterJoin('banned'))
  ;({ mine, explore } = splitCommunitiesByAccess(communities, access))
  assert.deepEqual(
    explore.map((c) => [c.id, c.access]),
    [
      ['b', 'banned'],
      ['c', 'not_member'],
    ]
  )
  assert.equal(exploreCardAction(explore[0].access), 'blocked')
  // o objeto original não foi mutado e sair/remover volta a not_member
  assert.deepEqual(access, { a: 'member', b: 'banned' })
  assert.deepEqual(withCommunityAccess(access, 'b', 'not_member'), { a: 'member' })
})

import { classifyReadError } from '../services/offline/readError.js'

test('falhas ao entrar: rede usa a mensagem de rede; o resto, a genérica (sem texto técnico)', () => {
  const network = [
    new TypeError('Failed to fetch'),
    { message: 'TypeError: Failed to fetch', code: '' },
    { message: 'Load failed', code: '' },
    { message: '', status: 503 },
  ]
  for (const error of network) {
    assert.equal(
      describeJoinFailure(classifyReadError(error, { online: true })),
      COMMUNITY_MESSAGES.network
    )
  }
  assert.equal(
    describeJoinFailure(classifyReadError({ message: '', code: '' }, { online: false })),
    COMMUNITY_MESSAGES.network
  )
  const unexpected = [
    { message: 'relation "x" does not exist', code: '42P01' },
    { message: 'join_community: resposta desconhecida' },
    { message: 'PERMISSION_DENIED', code: 'P0001' },
    new Error('boom'),
  ]
  for (const error of unexpected) {
    const text = describeJoinFailure(classifyReadError(error, { online: true }))
    assert.equal(text, COMMUNITY_MESSAGES.unexpected)
    assert.doesNotMatch(text, /relation|42P01|boom|PERMISSION/)
  }
})
