import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Enquete já tem o próprio mecanismo de voto (PollStatus, nas próprias opções, grátis) --
// voto econômico Apoio/Negativo (EconomyVoteBar) não deveria aparecer para esse tipo de
// conteúdo. Testa via renderToStaticMarkup (sem act()/TestRenderer -- StatusCard.jsx
// importa statusesService/economyService, que tocam supabase/config; combinar
// act()+TestRenderer com módulos assim travou `node --test` antes, ver
// PromoteDialog.test.js). Efeitos nunca rodam em SSR, então PollStatus/EconomyVoteBar só
// mostram estado "carregado" se a cache real (utils/pageCache.js, não mockada, mesmo
// módulo usado pelo componente) já tiver os dados ANTES do render -- exatamente o mesmo
// truque de useState(cached ?? ...) que o próprio componente já usa para pintar sem
// esperar o efeito, então isto não é um artifício do teste, é o comportamento real.
let directory
let render
let setPollCache
let setWorkoutCache

let counter = 0
function id(prefix) {
  return `${prefix}-${counter++}`
}

function makePollStatus(overrides = {}) {
  return {
    id: id('poll'),
    communityId: 'c1',
    authorId: 'author-1',
    type: 'poll',
    poll: {
      question: 'Qual treino hoje?',
      options: [
        { id: 'a', label: 'Peito' },
        { id: 'b', label: 'Costas' },
      ],
    },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60000),
    ...overrides,
  }
}

function makeTextStatus(overrides = {}) {
  return {
    id: id('text'),
    communityId: 'c1',
    authorId: 'author-1',
    type: 'text',
    text: 'Bom treino hoje!',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60000),
    positiveVoteCount: 2,
    negativeVoteCount: 1,
    ...overrides,
  }
}

function makeWorkoutStatus(overrides = {}) {
  return {
    id: id('workout'),
    communityId: 'c1',
    authorId: 'author-1',
    authorUsername: 'ana',
    type: 'workout',
    workout: {
      title: 'Treino de pernas',
      date: new Date(Date.now() + 2 * 60 * 60 * 1000),
      location: 'Academia X',
    },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() - 60 * 1000),
    ...overrides,
  }
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'status-card-tests-'))
  const outfile = join(directory, 'status-card.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { StatusCard } from './StatusCard.jsx'
        import { setCached } from '../utils/pageCache'
        const noop = () => {}
        export const setPollCache = (statusId, currentUserId, counts, myOptionId) =>
          setCached(\`pollStatus:\${statusId}:\${currentUserId}\`, { counts, myOptionId })
        export const setWorkoutCache = (statusId, currentUserId, count, amParticipant) =>
          setCached(\`workoutStatus:\${statusId}:\${currentUserId}\`, { count, amParticipant })
        export const render = (props) => renderToStaticMarkup(createElement(ThemeProvider, null,
          createElement(BaseStyles, null, createElement(MemoryRouter, null, createElement(StatusCard, {
            currentUserId: 'viewer-1',
            canDelete: false,
            onDelete: noop,
            now: Date.now(),
            showToast: noop,
            myEconomyVote: null,
            onEconomyVoted: noop,
            onPromoted: noop,
            ...props,
          })))))
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
    // StatusCard.jsx importa statusesService/economyService/pageCache no topo do arquivo
    // -- o módulo inteiro é avaliado, incluindo a cadeia até supabase/config.js. Mesmo
    // bloco de WalletHeaderBadges.test.js/SuperAdminRoute.test.js -- só createClient()
    // precisa não explodir ao carregar; como o teste nunca dispara nenhum efeito (SSR) e
    // pré-popula a cache real antes de renderizar, nenhuma chamada de rede é feita.
    define: {
      'import.meta.env': JSON.stringify({
        VITE_SUPABASE_URL: 'https://test.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'test',
        DEV: false,
      }),
    },
    plugins: [
      {
        name: 'avatar-prop-stub',
        setup(context) {
          context.onResolve({ filter: /\/ProfileAvatar$/ }, () => ({
            path: 'avatar',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^avatar$/, namespace: 'stub' }, () => ({
            resolveDir: new URL('../../', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
            contents: `import { createElement } from 'react'; export const ProfileAvatar = ({path}) => createElement('span', {'data-author-avatar': path || ''})`,
          }))
        },
      },
    ],
  })
  ;({ render, setPollCache, setWorkoutCache } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('enquete não renderiza EconomyVoteBar: sem Apoio/Negativo, sem botões de voto econômico, sem "Você apoiou/discordou"', () => {
  const status = makePollStatus()
  setPollCache(status.id, 'viewer-1', { a: 1, b: 1 }, null)
  const html = render({ status })
  assert.doesNotMatch(html, /apoio|curti/i)
  assert.doesNotMatch(html, /Não curtir|Não apoiar/i)
  assert.doesNotMatch(html, /Você curtiu|Você apoiou|Você discordou/)
  assert.doesNotMatch(html, /Ver quem curtiu|>Curtir</)
  assert.doesNotMatch(html, /class="status-footer"/)
})

test('o cabeçalho recebe apenas o avatar público elegível do autor e mantém fallback sem ele', () => {
  const status = makeTextStatus()
  assert.match(
    render({ status, authorAvatarPath: 'profileAvatars/author-1/active.webp' }),
    /data-author-avatar="profileAvatars\/author-1\/active.webp"/
  )
  assert.match(render({ status, authorAvatarPath: null }), /data-author-avatar=""/)
})

test('enquete continua permitindo voto nas opções: pergunta, opções e botões clicáveis (sem voto ainda) renderizam normalmente', () => {
  const status = makePollStatus()
  setPollCache(status.id, 'viewer-1', { a: 0, b: 0 }, null)
  const html = render({ status })
  assert.match(html, /Qual treino hoje\?/)
  assert.match(html, />Peito</)
  assert.match(html, />Costas</)
  // counts && !myOptionId -> Box renderiza como <button> clicável (ver PollStatus)
  assert.match(html, /<button[^>]*>[\s\S]*Peito/)
})

test('total da enquete continua correto: percentuais e contagem total batem com os counts', () => {
  const status = makePollStatus()
  setPollCache(status.id, 'viewer-1', { a: 3, b: 1 }, null)
  const html = render({ status })
  assert.match(html, /75% \(3\)/)
  assert.match(html, /25% \(1\)/)
  assert.match(html, />4 votos</)
})

test('já votado na enquete: a opção escolhida não é mais um botão clicável, mas o total continua correto', () => {
  const status = makePollStatus()
  setPollCache(status.id, 'viewer-1', { a: 2, b: 2 }, 'a')
  const html = render({ status })
  assert.match(html, />4 votos</)
  assert.doesNotMatch(html, /Ver quem curtiu|Não apoiar/i)
})

test('post normal continua mostrando Apoio/Negativo, com o rodapé de voto econômico presente', () => {
  const status = makeTextStatus()
  const html = render({ status, myEconomyVote: null, canDelete: true })
  assert.match(html, /class="status-footer"/)
  assert.match(html, /Ver quem curtiu \(2\)/)
  assert.match(html, />Curtir</)
  assert.match(html, /Não curtir/)
  assert.doesNotMatch(html, /quem n[ãa]o curtiu/i)
  assert.match(html, /Ver informações de expiração da publicação/)
  assert.match(html, /Compartilhar publicação/)
  assert.match(html, /Excluir publicação/)
})

test('comentários usam o mesmo ID canônico em todos os tipos de publicação', () => {
  const statuses = [
    makeTextStatus(),
    makeWorkoutStatus(),
    makePollStatus(),
    { ...makeTextStatus(), type: 'achievement', achievement: null, text: undefined },
    { ...makeTextStatus(), type: 'photo', photoPath: null, caption: 'Foto', text: undefined },
  ]

  for (const status of statuses) {
    const html = render({ status })
    assert.match(html, />Comentar</)
    assert.match(
      html,
      new RegExp(`id="${status.type === 'workout' ? 'treino' : 'publicacao'}-${status.id}"`)
    )
  }
})

test('conquista mantém Apoio/Negativo', () => {
  const status = { ...makeTextStatus(), type: 'achievement', achievement: null }
  status.text = undefined
  const html = render({ status })
  assert.match(html, /class="status-footer"/)
  assert.match(html, /Ver quem curtiu/)
})

test('treino futuro mantém participação ativa após expirar no feed e identifica evento e organizador', () => {
  const status = makeWorkoutStatus()
  setWorkoutCache(status.id, 'viewer-1', 3, false)
  const html = render({ status, communityName: 'Corrida SP' })
  assert.match(html, new RegExp(`id="treino-${status.id}"`))
  assert.match(html, /Treino marcado/)
  assert.match(html, /Organizado por @ana/)
  assert.match(html, /Começa em 2h/)
  assert.match(html, /3 confirmados · Ver participantes/)
  assert.match(html, /Vou participar/)
  assert.match(html, /Adicionar ao calendário/)
  assert.doesNotMatch(html, /Ver informações de expiração da publicação/)
  assert.doesNotMatch(html, /class="status-footer"/)
  assert.doesNotMatch(html, />Curtir<|Não curtir|Ver quem curtiu/)
})

test('treino concluído bloqueia nova participação, mas mantém calendário disponível', () => {
  const status = makeWorkoutStatus({
    workout: {
      title: 'Treino encerrado',
      date: new Date(Date.now() - 3 * 60 * 60 * 1000),
      location: 'Academia X',
    },
  })
  setWorkoutCache(status.id, 'viewer-1', 2, false)
  const html = render({ status })
  assert.match(html, /Concluído/)
  assert.doesNotMatch(html, /Vou participar/)
  assert.match(html, /Adicionar ao calendário/)
})

test('participante confirmado pode cancelar mesmo depois do início do treino', () => {
  const status = makeWorkoutStatus({
    workout: {
      title: 'Treino em andamento',
      date: new Date(Date.now() - 30 * 60 * 1000),
      location: 'Academia X',
    },
  })
  setWorkoutCache(status.id, 'viewer-1', 1, true)
  const html = render({ status })
  assert.match(html, /Em andamento/)
  assert.match(html, /Cancelar participação/)
})
