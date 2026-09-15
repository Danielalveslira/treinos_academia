import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let render

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'form-shell-tests-'))
  const outfile = join(directory, 'form-shell.cjs')
  await build({
    stdin: {
      contents: `
        import { renderToStaticMarkup } from 'react-dom/server'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { FormShell } from './FormShell.jsx'
        export const render = (submitting) => renderToStaticMarkup(
          <ThemeProvider>
            <BaseStyles>
              <FormShell submitting={submitting} onSubmit={() => {}} onCancel={() => {}}>
                <input name="name" />
              </FormShell>
            </BaseStyles>
          </ThemeProvider>
        )
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
      loader: 'jsx',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
  })
  ;({ render } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('save and cancel are natively disabled while the form is submitting', () => {
  const html = render(true)
  assert.match(html, /type="button" disabled=""/)
  assert.match(html, /type="submit" disabled=""/)
})
