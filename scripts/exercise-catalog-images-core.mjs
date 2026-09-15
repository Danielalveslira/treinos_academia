import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import sharp from 'sharp'

export const NORMAL_IMAGE_OPTIONS = { width: 960, quality: 82 }
export const THUMBNAIL_OPTIONS = { width: 280, quality: 75 }
export const DEFAULT_CONCURRENCY = 6
export const DEFAULT_SOURCE_BASE_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises'

const IMAGE_REF_PATTERN = /^[A-Za-z0-9_() .-]+\/[0-9]+\.jpg$/i

export class ImageSourceError extends Error {
  constructor(message, { status, retryable = false } = {}) {
    super(message)
    this.name = 'ImageSourceError'
    this.status = status
    this.retryable = retryable
  }
}

export function isValidImageRef(imageRef) {
  return (
    typeof imageRef === 'string' &&
    IMAGE_REF_PATTERN.test(imageRef) &&
    !imageRef.startsWith('/') &&
    !imageRef.includes('..') &&
    !imageRef.includes('\\')
  )
}

export function collectCatalogImageJobs(catalog) {
  if (!Number.isInteger(catalog?.version) || !Array.isArray(catalog?.exercises)) {
    throw new TypeError('Catálogo de exercícios inválido')
  }

  const seen = new Set()
  const duplicateRefs = []
  const invalidRefs = []
  const jobs = []

  for (const exercise of catalog.exercises) {
    if (!exercise?.id || !Array.isArray(exercise.imageRefs)) continue
    exercise.imageRefs.forEach((imageRef, position) => {
      if (!isValidImageRef(imageRef) || !imageRef.startsWith(`${exercise.id}/`)) {
        invalidRefs.push({ exerciseId: exercise.id, imageRef })
        return
      }
      if (seen.has(imageRef)) {
        duplicateRefs.push(imageRef)
        return
      }
      seen.add(imageRef)
      const sourceIndex = Number(imageRef.match(/\/([0-9]+)\.jpg$/i)?.[1])
      jobs.push({ exerciseId: exercise.id, imageRef, position, sourceIndex })
    })
  }

  return {
    version: catalog.version,
    totalExercises: catalog.exercises.length,
    totalImageRefs: catalog.exercises.reduce(
      (total, exercise) => total + (exercise.imageRefs?.length || 0),
      0
    ),
    jobs,
    duplicateRefs,
    invalidRefs,
  }
}

export function buildSourceImageUrl(baseUrl, imageRef) {
  const encodedRef = imageRef.split('/').map(encodeURIComponent).join('/')
  return `${baseUrl.replace(/\/$/, '')}/${encodedRef}`
}

export function imageOutputPaths(outputRoot, version, job) {
  const exerciseDirectory = join(outputRoot, `v${version}`, job.exerciseId)
  return {
    normal: join(exerciseDirectory, `${job.sourceIndex}.webp`),
    thumbnail: join(exerciseDirectory, 'thumb.webp'),
  }
}

export async function inspectWebp(path, sharpFactory = sharp) {
  try {
    const buffer = await readFile(path)
    if (!buffer.length) return { valid: false, size: 0 }
    const metadata = await sharpFactory(buffer).metadata()
    const valid =
      metadata.format === 'webp' &&
      Number.isInteger(metadata.width) &&
      metadata.width > 0 &&
      Number.isInteger(metadata.height) &&
      metadata.height > 0
    return { valid, size: buffer.length, width: metadata.width, height: metadata.height }
  } catch {
    return { valid: false, size: 0 }
  }
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  return results
}

async function atomicWrite(path, buffer) {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, buffer)
    await rm(path, { force: true })
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function toWebp(input, { width, quality }, sharpFactory = sharp) {
  const instance = sharpFactory(input, { failOn: 'error' }).rotate().resize({
    width,
    withoutEnlargement: true,
    fit: 'inside',
  })
  const output = await instance.webp({ quality }).toBuffer()
  const metadata = await sharpFactory(output).metadata()
  if (metadata.format !== 'webp' || !metadata.width || !metadata.height || output.length === 0) {
    throw new Error('Conversão WebP inválida')
  }
  return { output, width: metadata.width, height: metadata.height }
}

async function wait(milliseconds) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

export async function downloadImage(
  url,
  { fetchImpl = fetch, retries = 3, timeoutMs = 15_000, waitImpl = wait } = {}
) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (response.status === 404) {
        throw new ImageSourceError(`Imagem não encontrada: ${url}`, { status: 404 })
      }
      if (!response.ok) {
        throw new ImageSourceError(`HTTP ${response.status}: ${url}`, {
          status: response.status,
          retryable: response.status === 429 || response.status >= 500,
        })
      }
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.toLowerCase().startsWith('image/')) {
        throw new ImageSourceError(`Content-Type inválido (${contentType || 'ausente'}): ${url}`)
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      if (!buffer.length) throw new ImageSourceError(`Imagem vazia: ${url}`)
      return buffer
    } catch (error) {
      const retryable =
        error?.retryable || error?.name === 'TimeoutError' || error?.name === 'AbortError'
      if (!retryable || attempt === retries) throw error
      await waitImpl(250 * 2 ** attempt)
    }
  }
  throw new Error('Download interrompido')
}

async function buildPlan(inspection, outputRoot, sharpFactory) {
  return mapLimit(inspection.jobs, DEFAULT_CONCURRENCY, async (job) => {
    const paths = imageOutputPaths(outputRoot, inspection.version, job)
    const normal = await inspectWebp(paths.normal, sharpFactory)
    const thumbnail =
      job.sourceIndex === 0
        ? await inspectWebp(paths.thumbnail, sharpFactory)
        : { valid: true, size: 0 }
    return {
      ...job,
      paths,
      normal,
      thumbnail,
      needsDownload: !normal.valid,
      needsThumbnail: job.sourceIndex === 0 && !thumbnail.valid,
    }
  })
}

export async function runImageBuild({
  catalog,
  outputRoot,
  mode,
  sourceBaseUrl = DEFAULT_SOURCE_BASE_URL,
  concurrency = DEFAULT_CONCURRENCY,
  fetchImpl = fetch,
  sharpFactory = sharp,
  writeReport = true,
} = {}) {
  if (!['dry-run', 'apply'].includes(mode)) throw new Error('Use mode dry-run ou apply')
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error('Concorrência deve ser um inteiro entre 1 e 16')
  }

  const inspection = collectCatalogImageJobs(catalog)
  const plan = await buildPlan(inspection, outputRoot, sharpFactory)
  const report = {
    mode,
    version: inspection.version,
    totalExercises: inspection.totalExercises,
    totalImageRefs: inspection.totalImageRefs,
    uniqueImageRefs: inspection.jobs.length,
    duplicateRefs: inspection.duplicateRefs,
    invalidRefs: inspection.invalidRefs,
    existingImages: plan.filter((item) => item.normal.valid).length,
    existingThumbnails: plan.filter((item) => item.sourceIndex === 0 && item.thumbnail.valid)
      .length,
    wouldDownload: plan.filter((item) => item.needsDownload).length,
    wouldGenerateThumbnails: plan.filter((item) => item.needsThumbnail).length,
    downloaded: 0,
    processed: 0,
    generatedThumbnails: 0,
    missing: [],
    failures: [],
    sourceBytes: 0,
    outputBytes: plan.reduce((total, item) => {
      const normalSize = item.normal.valid ? item.normal.size : 0
      const thumbnailSize = item.sourceIndex === 0 && item.thumbnail.valid ? item.thumbnail.size : 0
      return total + normalSize + thumbnailSize
    }, 0),
  }

  if (mode === 'dry-run') return report

  const pending = plan.filter((item) => item.needsDownload || item.needsThumbnail)
  const results = await mapLimit(pending, concurrency, async (item) => {
    try {
      let source
      let downloaded = false
      if (item.needsDownload) {
        source = await downloadImage(buildSourceImageUrl(sourceBaseUrl, item.imageRef), {
          fetchImpl,
        })
        downloaded = true
      } else if (item.needsThumbnail) {
        source = await readFile(item.paths.normal)
      }

      let normalBytes = 0
      let thumbnailBytes = 0
      if (item.needsDownload) {
        const normal = await toWebp(source, NORMAL_IMAGE_OPTIONS, sharpFactory)
        await atomicWrite(item.paths.normal, normal.output)
        normalBytes = normal.output.length
      }
      if (item.needsThumbnail) {
        const thumbnail = await toWebp(source, THUMBNAIL_OPTIONS, sharpFactory)
        await atomicWrite(item.paths.thumbnail, thumbnail.output)
        thumbnailBytes = thumbnail.output.length
      }

      return {
        status: 'processed',
        downloaded,
        sourceBytes: downloaded ? source.length : 0,
        normalBytes,
        thumbnailBytes,
        generatedThumbnail: item.needsThumbnail,
      }
    } catch (error) {
      if (error?.status === 404) return { status: 'missing', imageRef: item.imageRef }
      return { status: 'failed', imageRef: item.imageRef, message: error.message }
    }
  })

  for (const result of results) {
    if (result.status === 'missing') report.missing.push(result.imageRef)
    else if (result.status === 'failed') report.failures.push(result)
    else {
      report.processed += 1
      report.downloaded += Number(result.downloaded)
      report.generatedThumbnails += Number(result.generatedThumbnail)
      report.sourceBytes += result.sourceBytes
      report.outputBytes += result.normalBytes + result.thumbnailBytes
    }
  }

  if (writeReport) {
    const reportPath = join(outputRoot, `v${inspection.version}`, 'build-report.json')
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  return report
}

export async function readCatalog(catalogPath) {
  return JSON.parse(await readFile(resolve(catalogPath), 'utf8'))
}
