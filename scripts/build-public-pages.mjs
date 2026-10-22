import { readFileSync, writeFileSync } from 'node:fs'
import { loadEnv } from 'vite'
import { publicPages, renderPublicPage, renderRobots, renderSitemap } from './public-pages-template.mjs'

const env = loadEnv('production', process.cwd(), 'VITE_')
writeFileSync('dist/app-shell.html', readFileSync('dist/index.html', 'utf8'))
for (const page of publicPages) writeFileSync(`dist/${page.file}`, renderPublicPage(page.path, env))
writeFileSync('dist/robots.txt', renderRobots())
writeFileSync('dist/sitemap.xml', renderSitemap())
