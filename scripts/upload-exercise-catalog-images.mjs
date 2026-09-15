import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getStorage } from 'firebase-admin/storage'

const ROOT = resolve(import.meta.dirname, '..')
const GENERATED_ROOT = resolve(ROOT, '.generated/exercise-catalog-images')
const CACHE_CONTROL = 'public,max-age=31536000,immutable'
const DEFAULT_CONCURRENCY = 6

function parseArguments(args) {
  const dryRun = args.includes('--dry-run')
  const apply = args.includes('--apply')
  if (dryRun === apply) throw new Error('Informe exatamente uma opção: --dry-run ou --apply')
  const bucketIndex = args.indexOf('--bucket')
  const bucket =
    (bucketIndex >= 0 ? args[bucketIndex + 1] : '') ||
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET
  if (!bucket) throw new Error('Informe --bucket ou FIREBASE_STORAGE_BUCKET')
  return { mode: dryRun ? 'dry-run' : 'apply', bucket }
}

async function listWebpFiles(directory) {
  const files = []
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name.endsWith('.webp')) files.push(path)
    }
  }
  try {
    await visit(directory)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return files.sort()
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  return results
}

export function storagePathForLocalFile(localPath, generatedRoot = GENERATED_ROOT) {
  const path = relative(generatedRoot, localPath).split(sep).join('/')
  if (!/^v\d+\/[A-Za-z0-9_() .-]+\/(thumb|\d+)\.webp$/.test(path)) {
    throw new Error(`Path local inválido: ${path}`)
  }
  return `exercise-catalog/${path}`
}

export function remoteFileIsCurrent(metadata, sha256, size) {
  return (
    metadata?.contentType === 'image/webp' &&
    metadata?.cacheControl === CACHE_CONTROL &&
    metadata?.metadata?.catalogSha256 === sha256 &&
    Number(metadata?.size) === size
  )
}

async function sha256File(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

async function readRemoteMetadata(file) {
  try {
    const [metadata] = await file.getMetadata()
    return metadata
  } catch (error) {
    if (error.code === 404 || error.code === 'storage/object-not-found') return null
    throw error
  }
}

export async function runUpload({ mode, bucket, concurrency = DEFAULT_CONCURRENCY } = {}) {
  if (!['dry-run', 'apply'].includes(mode)) throw new Error('Use mode dry-run ou apply')
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error('Concorrência deve ser um inteiro entre 1 e 16')
  }

  const localFiles = await listWebpFiles(GENERATED_ROOT)
  if (!localFiles.length)
    throw new Error('Nenhuma imagem gerada. Execute o pipeline --apply primeiro.')

  if (!getApps().length) initializeApp({ credential: applicationDefault(), storageBucket: bucket })
  const storageBucket = getStorage().bucket(bucket)
  const results = await mapLimit(localFiles, concurrency, async (localPath) => {
    const destination = storagePathForLocalFile(localPath)
    const localStat = await stat(localPath)
    const sha256 = await sha256File(localPath)
    const remoteFile = storageBucket.file(destination)
    const metadata = await readRemoteMetadata(remoteFile)
    if (remoteFileIsCurrent(metadata, sha256, localStat.size)) {
      return { destination, status: 'unchanged', size: localStat.size }
    }
    if (mode === 'dry-run') return { destination, status: 'would-upload', size: localStat.size }

    await storageBucket.upload(localPath, {
      destination,
      resumable: false,
      validation: 'crc32c',
      metadata: {
        contentType: 'image/webp',
        cacheControl: CACHE_CONTROL,
        metadata: { catalogSha256: sha256 },
      },
    })
    const uploadedMetadata = await readRemoteMetadata(remoteFile)
    if (!remoteFileIsCurrent(uploadedMetadata, sha256, localStat.size)) {
      throw new Error(`Falha na validação após upload: ${destination}`)
    }
    return { destination, status: 'uploaded', size: localStat.size }
  })

  const report = {
    mode,
    bucket,
    localFiles: localFiles.length,
    unchanged: results.filter(({ status }) => status === 'unchanged').length,
    wouldUpload: results.filter(({ status }) => status === 'would-upload').length,
    uploaded: results.filter(({ status }) => status === 'uploaded').length,
    totalBytes: results.reduce((total, result) => total + result.size, 0),
  }
  if (mode === 'apply') {
    await writeFile(
      join(GENERATED_ROOT, 'upload-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8'
    )
  }
  return report
}

export async function main(args = process.argv.slice(2)) {
  const { mode, bucket } = parseArguments(args)
  const concurrency = Number(process.env.EXERCISE_CATALOG_UPLOAD_CONCURRENCY || 6)
  const report = await runUpload({ mode, bucket, concurrency })
  console.log(JSON.stringify(report, null, 2))
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || '')) await main()
