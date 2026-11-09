import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { build } from 'esbuild'

const root = new URL('../', import.meta.url)
const compiled = await build({
  stdin: {
    loader: 'jsx',
    contents: `
      import React, { useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import { MemoryRouter } from 'react-router-dom'
      import { ThemeProvider, BaseStyles } from '@primer/react'
      import { InfoStep } from './src/components/communityCreation/CreationSteps.jsx'
      function Harness() {
        const [values, setValues] = useState({ name: '', description: '', iconName: 'users', coverBlob: null })
        const eligibility = { eligible: true, emailVerified: true, accountStanding: 'regular', activeOwnedCommunities: 0, communityLimit: 3 }
        return <MemoryRouter><ThemeProvider><BaseStyles><div className="profile-page community-wizard">
          <InfoStep values={values} eligibility={eligibility} onChange={(key, value) => setValues(current => ({ ...current, [key]: value }))} onBack={() => {}} onNext={() => {}} />
        </div></BaseStyles></ThemeProvider></MemoryRouter>
      }
      createRoot(document.getElementById('root')).render(<Harness />)
    `,
    resolveDir: root.pathname,
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  write: false,
  loader: { '.css': 'empty' },
  logLevel: 'silent',
})
const css = (await Promise.all([
  readFile(new URL('../src/styles/app.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/community-creation.css', import.meta.url), 'utf8'),
])).join('\n')
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
try {
  for (const width of [320, 360, 390, 430, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.setContent('<div id="root"></div>')
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: compiled.outputFiles[0].text })
    await page.getByRole('button', { name: 'Adicionar capa' }).waitFor()
    const png = Buffer.from((await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 1200
      canvas.height = 600
      canvas.getContext('2d').fillRect(0, 0, 1200, 600)
      return canvas.toDataURL('image/png').split(',')[1]
    })), 'base64')
    await page.locator('input[type=file]').setInputFiles({ name: 'capa.png', mimeType: 'image/png', buffer: png })
    await page.getByRole('dialog', { name: 'Ajustar capa' }).waitFor()
    assert.equal(await page.locator('.community-cover-original').count(), 0)
    await page.getByRole('button', { name: 'Usar esta capa' }).click()
    await page.getByAltText('Prévia da capa selecionada').waitFor()
    const boxes = await page.evaluate(() => {
      const rect = (selector) => {
        const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect()
        return { x, y, width, height }
      }
      return {
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        form: rect('.community-wizard-card'),
        cover: rect('.community-wizard-cover-preview'),
        image: rect('.community-wizard-cover-preview img'),
        actions: rect('.community-wizard-cover-actions'),
      }
    })
    assert.ok(boxes.scrollWidth <= width, `${width}px: horizontal overflow ${JSON.stringify(boxes)}`)
    assert.ok(boxes.cover.x >= boxes.form.x && boxes.cover.x + boxes.cover.width <= boxes.form.x + boxes.form.width, `${width}px: cover escaped form`)
    assert.ok(boxes.image.width <= boxes.cover.width && boxes.image.height <= boxes.cover.height, `${width}px: image escaped cover`)
    assert.ok(boxes.cover.y + boxes.cover.height <= boxes.actions.y, `${width}px: cover overlaps buttons`)
    assert.ok(boxes.cover.width <= 320 && boxes.cover.height <= 160, `${width}px: cover too large`)
    await page.getByRole('button', { name: 'Remover capa' }).click()
    await page.getByAltText('Prévia da capa selecionada').waitFor({ state: 'detached' })
    assert.equal(await page.getByAltText('Prévia da capa selecionada').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Adicionar capa' }).count(), 1)
    await page.close()
  }
  console.log('Capa OK em 320, 360, 390, 430, 768 e 1280 px: crop, prévia contida, sem overflow, remoção.')
} finally {
  await browser.close()
}
