import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let directory
let StatusCard

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'status-card-interactions-'))
  const outfile = join(directory, 'status-card.cjs')
  await build({
    stdin: {
      contents: `export { StatusCard } from './StatusCard.jsx'`,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    plugins: [
      {
        name: 'status-card-interaction-fixtures',
        setup(context) {
          context.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, ({ path }) => ({
            path: require.resolve(path),
            external: true,
          }))
          context.onResolve({ filter: /^@primer\/react$/ }, () => ({
            path: 'primer',
            namespace: 'stub',
          }))
          context.onResolve({ filter: /^@primer\/octicons-react$/ }, () => ({
            path: 'icons',
            namespace: 'stub',
          }))
          context.onResolve({ filter: /^react-router-dom$/ }, () => ({
            path: 'router',
            namespace: 'stub',
          }))
          context.onResolve({ filter: /\/services\/economyService$/ }, () => ({
            path: 'economy',
            namespace: 'stub',
          }))
          context.onResolve({ filter: /\/services\/statusesService$/ }, () => ({
            path: 'statuses',
            namespace: 'stub',
          }))
          context.onResolve(
            {
              filter:
                /\/(AchievementSummary|MarkdownViewer|PhotoStatus|ProfileAvatar|ShareMenu|PromoteDialog|ExpiryBadge|WorkoutParticipantsDialog)$/,
            },
            ({ path }) => ({ path, namespace: 'component-stub' })
          )
          context.onLoad({ filter: /^primer$/, namespace: 'stub' }, () => ({
            loader: 'jsx',
            contents: `
            export const Box = ({as: Tag='div', sx, children, ...props}) => <Tag {...props}>{children}</Tag>
            export const Text = ({as: Tag='span', sx, children, ...props}) => <Tag {...props}>{children}</Tag>
            export const Button = ({sx, leadingVisual, children, ...props}) => <button {...props}>{children}</button>
            export const IconButton = ({icon, sx, ...props}) => <button {...props} />
            export const Flash = ({children, ...props}) => <div {...props}>{children}</div>
            export const Link = ({children, ...props}) => <a {...props}>{children}</a>
            export const Spinner = () => null
            export const Label = ({children, ...props}) => <span {...props}>{children}</span>
            export const Dialog = ({children}) => <div>{children}</div>
            Dialog.Header = ({children}) => <div>{children}</div>
          `,
          }))
          context.onLoad({ filter: /^icons$/, namespace: 'stub' }, () => ({
            contents: `
            export const TrashIcon=()=>null; export const PersonIcon=()=>null; export const LocationIcon=()=>null;
            export const ClockIcon=()=>null; export const ShieldCheckIcon=()=>null; export const CheckIcon=()=>null;
            export const CalendarIcon=()=>null; export const PeopleIcon=()=>null; export const ThumbsupIcon=()=>null;
            export const ThumbsdownIcon=()=>null; export const XIcon=()=>null;
          `,
          }))
          context.onLoad({ filter: /^router$/, namespace: 'stub' }, () => ({
            loader: 'jsx',
            contents: `export const Link = ({children, to, ...props}) => <a href={to} {...props}>{children}</a>`,
          }))
          context.onLoad({ filter: /^economy$/, namespace: 'stub' }, () => ({
            contents: `
            export const castVote = (statusId, value) => globalThis.__statusVote(statusId, value)
            export const listPostSupporters = async () => ({ supporters: [], nextCursor: null })
          `,
          }))
          context.onLoad({ filter: /^statuses$/, namespace: 'stub' }, () => ({
            contents: `
            export const getMyVote=async()=>null; export const getPollResults=async()=>({}); export const voteOnPoll=async()=>{};
            export const amIParticipant=async()=>false; export const countParticipants=async()=>0;
            export const joinWorkout=async()=>{}; export const leaveWorkout=async()=>{};
          `,
          }))
          context.onLoad({ filter: /.*/, namespace: 'component-stub' }, ({ path }) => {
            const name = path.split('/').at(-1)
            return { loader: 'jsx', contents: `export const ${name} = () => null` }
          })
        },
      },
    ],
    logLevel: 'silent',
  })
  ;({ StatusCard } = require(outfile))
})

after(async () => {
  delete globalThis.__statusVote
  if (directory) await rm(directory, { recursive: true, force: true })
})

// O auto-dismiss do erro (ACTION_ERROR_AUTO_DISMISS_MS em StatusCard.jsx) usa
// window.setTimeout/clearTimeout -- este teste roda no Node puro (sem jsdom), então
// window não existe a menos que seja provido aqui, como já é feito em
// MyProfessionalListing.test.js.
const previousWindow = globalThis.window
globalThis.window = { setTimeout, clearTimeout }
after(() => {
  globalThis.window = previousWindow
})

function status(id) {
  return {
    id,
    communityId: 'community-1',
    authorId: 'author-1',
    authorUsername: 'author',
    type: 'text',
    text: id,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  }
}

test('an action error stays below its post, is isolated, and clears after a successful retry', async () => {
  globalThis.__statusVote = async (statusId) => {
    if (statusId === 'post-1') throw new Error('Falha específica do post 1.')
    return { voted: true }
  }
  let renderer
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(StatusCard, {
          status: status('post-1'),
          currentUserId: 'viewer',
          now: Date.now(),
          myEconomyVote: null,
          onDelete: async () => true,
        }),
        React.createElement(StatusCard, {
          status: status('post-2'),
          currentUserId: 'viewer',
          now: Date.now(),
          myEconomyVote: null,
          onDelete: async () => true,
        })
      )
    )
  })

  const positiveButtons = renderer.root.findAllByProps({ 'aria-label': 'Curtir' })
  await act(async () => positiveButtons[0].props.onClick())
  const articles = renderer.root.findAllByType('article')
  assert.ok(articles[0].findAllByProps({ className: 'status-action-error' }).length > 0)
  assert.equal(articles[1].findAllByProps({ className: 'status-action-error' }).length, 0)

  globalThis.__statusVote = async () => ({ voted: true })
  await act(async () => positiveButtons[0].props.onClick())
  assert.equal(articles[0].findAllByProps({ className: 'status-action-error' }).length, 0)
  renderer.unmount()
})

test('the action error auto-dismisses on its timer, can be dismissed manually, and never leaks a duplicate timer', async () => {
  globalThis.__statusVote = async () => {
    throw new Error('Falha ao votar.')
  }
  const scheduled = []
  const clearedIds = []
  let nextTimerId = 1
  const previousWindow = globalThis.window
  globalThis.window = {
    setTimeout: (callback, delay) => {
      const id = nextTimerId++
      scheduled.push({ id, callback, delay })
      return id
    },
    clearTimeout: (id) => clearedIds.push(id),
  }

  let renderer
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(StatusCard, {
          status: status('post-timer'),
          currentUserId: 'viewer',
          now: Date.now(),
          myEconomyVote: null,
          onDelete: async () => true,
        })
      )
    })
    const positiveButton = renderer.root.findAllByProps({ 'aria-label': 'Curtir' })[0]

    await act(async () => positiveButton.props.onClick())
    assert.ok(renderer.root.findAllByProps({ className: 'status-action-error' }).length > 0)
    assert.equal(scheduled.length, 1, 'exactly one timer scheduled for the error')

    // Dispensa manual: some na hora e cancela o timer pendente -- sem isso, o timer
    // velho dispararia depois no vazio (não é um leak de memória grave, mas é um
    // setTimeout fantasma que este teste garante que não sobra).
    const dismissButton = renderer.root.findByProps({ 'aria-label': 'Dispensar aviso' })
    await act(async () => dismissButton.props.onClick())
    assert.equal(renderer.root.findAllByProps({ className: 'status-action-error' }).length, 0)
    assert.deepEqual(clearedIds, [scheduled[0].id])

    // Um novo erro depois do dismiss agenda exatamente UM novo timer (nunca dois
    // concorrentes) e, ao disparar sozinho, some sem exigir clique nenhum.
    await act(async () => positiveButton.props.onClick())
    assert.equal(scheduled.length, 2)
    await act(async () => scheduled[1].callback())
    assert.equal(renderer.root.findAllByProps({ className: 'status-action-error' }).length, 0)
  } finally {
    renderer?.unmount()
    globalThis.window = previousWindow
  }
})
