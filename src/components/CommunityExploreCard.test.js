import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// O cartão do Explorar reflete o estado de acesso que o SERVIDOR devolveu junto com a listagem. Banido nunca vê
// "Participar" (nem um clique que sabidamente será recusado); a segurança em si é coberta pelos testes SQL.
let directory
let render
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'community-explore-card-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { CommunityExploreCard } from './CommunityExploreCard.jsx'

        export const render = (props) => {
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({
            matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
          }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let component
          act(() => {
            component = TestRenderer.create(createElement(ThemeProvider, null,
              createElement(BaseStyles, null, createElement(CommunityExploreCard, props))))
          })
          return component
        }
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
    plugins: [
      {
        // Evita puxar communitiesService -> supabase/config (precisa de env vars reais)
        // só porque o cartão agora mostra uma capa opcional -- aqui ela nunca é testada.
        name: 'explore-card-dependencies',
        setup(context) {
          context.onResolve({ filter: /\/CommunityCoverImage(\.jsx)?$/ }, () => ({
            path: 'cover',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^cover$/, namespace: 'stub' }, () => ({
            contents: `export const CommunityCoverImage = () => null`,
          }))
        },
      },
    ],
  })
  ;({ render } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const textContent = (instance) =>
  instance.children
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('')
const buttons = (component) => component.root.findAll((node) => node.type === 'button')
const labelled = (component, pattern) =>
  buttons(component).filter((b) => pattern.test(textContent(b)))
const community = (access) => ({
  id: 'c1',
  name: 'Corredores',
  description: 'Treino de rua',
  memberCount: 12,
  iconName: 'people',
  access,
})

test('not_member: mostra Participar e dispara a entrada', () => {
  const joined = []
  const component = render({ community: community('not_member'), onJoin: (c) => joined.push(c.id) })
  const participar = labelled(component, /^Participar$/)
  assert.equal(participar.length, 1)
  assert.equal(participar[0].props.disabled, undefined)
  participar[0].props.onClick()
  assert.deepEqual(joined, ['c1'])
})

test('sem estado informado conta como not_member', () => {
  const component = render({ community: community(undefined), onJoin() {} })
  assert.equal(labelled(component, /^Participar$/).length, 1)
})

test('member: nunca mostra Participar', () => {
  const component = render({ community: community('member'), onJoin() {} })
  assert.equal(labelled(component, /Participar/).length, 0)
})

test('banned: mostra "Acesso bloqueado" desabilitado e nenhum Participar', () => {
  const component = render({
    community: community('banned'),
    onJoin() {
      throw new Error('não deveria tentar entrar')
    },
  })
  assert.equal(labelled(component, /Participar/).length, 0)
  const blocked = labelled(component, /Acesso bloqueado/)
  assert.equal(blocked.length, 1)
  assert.equal(blocked[0].props.disabled, true)
  // o nome e a descrição públicos continuam visíveis
  assert.match(textContent(component.root), /Corredores/)
  assert.match(textContent(component.root), /Treino de rua/)
})

test('banned: o aviso contextual só aparece depois de uma tentativa recusada, com a mensagem de produto', () => {
  const quiet = render({ community: community('banned'), onJoin() {} })
  assert.doesNotMatch(textContent(quiet.root), /bloqueado pelos administradores/)
  const noticed = render({
    community: community('banned'),
    onJoin() {},
    error: { kind: 'banned' },
  })
  const text = textContent(noticed.root)
  assert.match(text, /Você não pode entrar nesta comunidade/)
  assert.match(text, /Seu acesso a esta comunidade foi bloqueado pelos administradores\./)
  assert.doesNotMatch(text, /Erro/)
})

test('erro genérico (rede/inesperado): mostra o título no próprio cartão, nunca o texto fixo de banimento', () => {
  const component = render({
    community: community('not_member'),
    onJoin() {},
    error: { kind: 'error', title: 'Não foi possível conectar. Verifique sua internet e tente novamente.' },
  })
  const text = textContent(component.root)
  assert.match(text, /Não foi possível conectar/)
  assert.doesNotMatch(text, /bloqueado pelos administradores/)
})

test('unavailable: mensagem própria, desabilitado e sem Participar', () => {
  const component = render({ community: community('unavailable'), onJoin() {} })
  assert.equal(labelled(component, /^Participar$/).length, 0)
  const chip = labelled(component, /Indisponível/)
  assert.equal(chip.length, 1)
  assert.equal(chip[0].props.disabled, true)
})
