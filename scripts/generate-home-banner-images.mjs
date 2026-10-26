// One-off script: generates the responsive AVIF/WebP variants (480/800/1024, same convention as
// ResponsivePicture.jsx) for the new Home dashboard banner rotation photos. Not part of the build;
// run manually whenever a new approved photo is added to imports/images-source/, then delete the
// temporary `sharp` install (`npm install --no-save sharp` before running this).
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const WIDTHS = [480, 800, 1024]
const SOURCES = [
  { file: 'imports/images-source/foto_anilha_source.png', name: 'home-banner-anilhas' },
  { file: 'imports/images-source/Treino em Equipe sob Luz Neon.png', name: 'home-banner-equipe' },
]

const root = resolve(import.meta.dirname, '..')
await mkdir(resolve(root, 'public/img'), { recursive: true })

for (const { file, name } of SOURCES) {
  const input = resolve(root, file)
  for (const width of WIDTHS) {
    const base = sharp(input).resize({ width, withoutEnlargement: true })
    await base.clone().avif({ quality: 55 }).toFile(resolve(root, `public/img/${name}-${width}.avif`))
    await base.clone().webp({ quality: 72 }).toFile(resolve(root, `public/img/${name}-${width}.webp`))
    console.log(`${name}-${width}: avif + webp`)
  }
}
