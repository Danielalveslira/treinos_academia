import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const BOOLEAN_FLAGS = [
  'VITE_OFFLINE_READ_ENABLED',
  'VITE_OFFLINE_WRITE_ENABLED',
  'VITE_OFFLINE_COLD_START_ENABLED',
]
const OBSOLETE_PERCENT_FLAGS = [
  'VITE_OFFLINE_WRITE_ROLLOUT_PERCENT',
  'VITE_OFFLINE_COLD_START_ROLLOUT_PERCENT',
]

export function validateOfflineReleaseConfig(env) {
  const errors = []

  for (const key of BOOLEAN_FLAGS) {
    if (env[key] !== undefined && env[key] !== '' && !['true', 'false'].includes(env[key]))
      errors.push(`${key} deve ser true ou false`)
  }
  for (const key of OBSOLETE_PERCENT_FLAGS) {
    if (env[key] !== undefined && env[key] !== '')
      errors.push(`${key} é obsoleta: configurar rollout no Supabase`)
  }

  if (typeof env.VITE_SUPABASE_URL !== 'string' || !/^https:\/\/[^/]+/.test(env.VITE_SUPABASE_URL))
    errors.push('VITE_SUPABASE_URL precisa ser uma URL HTTPS')
  if (!env.VITE_SUPABASE_ANON_KEY) errors.push('VITE_SUPABASE_ANON_KEY ausente')
  for (const key of Object.keys(env)) {
    if (/^VITE_.*(?:SERVICE_ROLE|SECRET|PASSWORD|PRIVATE)/i.test(key))
      errors.push(`${key} não pode ser exposta em um build Vite`)
  }
  return errors
}

export function loadProductionReleaseEnv(cwd = process.cwd()) {
  return { ...loadEnv('production', cwd, 'VITE_'), ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith('VITE_'))
  ) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = validateOfflineReleaseConfig(loadProductionReleaseEnv())
  if (errors.length) {
    for (const error of errors) console.error(`CONFIG ERROR: ${error}`)
    process.exitCode = 1
  } else {
    console.log('Build offline seguro: percentuais e kill switch são controlados no Supabase.')
  }
}
