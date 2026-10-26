import { ReleaseError, requireFact, validSha, versionParts } from './core.mjs'

export class ApiError extends ReleaseError {
  constructor(status) {
    super(`API_HTTP_${status}`)
    this.status = status
  }
}
// No command execution, arbitrary origins, redirects or response bodies in errors.
export function createApi(origin, token, { fetchImpl = fetch, writable = false, repository } = {}) {
  return async (path, method = 'GET', body) => {
    requireFact(
      path.startsWith('/') && !path.startsWith('//') && !/[\r\n]/.test(path),
      'INVALID_API_PATH'
    )
    const url = new URL(path, origin)
    requireFact(url.origin === origin, 'INVALID_API_ORIGIN')
    if (origin === 'https://api.vercel.com') requireFact(method === 'GET', 'VERCEL_IS_READ_ONLY')
    if (method !== 'GET') {
      if (method === 'POST' && /\/releases\/generate-notes$/.test(url.pathname))
        requireFact(writable, 'OFFICIAL_NOTES_REQUIRE_WRITE_PERMISSION')
      const readQuery =
        method === 'POST' &&
        (/\/releases\/generate-notes$/.test(url.pathname) || url.pathname === '/graphql')
      if (method === 'POST' && url.pathname === '/graphql') {
        requireFact(
          typeof body?.query === 'string' &&
            /^\s*query\s*\{/.test(body.query) &&
            !/\bmutation\b/i.test(body.query),
          'GRAPHQL_MUST_BE_READ_ONLY'
        )
      }
      if (!readQuery) {
        requireFact(writable, 'READ_ONLY_MODE')
        requireFact(
          method === 'POST' &&
            repository &&
            [
              `/repos/${repository}/git/tags`,
              `/repos/${repository}/git/refs`,
              `/repos/${repository}/releases`,
            ].includes(url.pathname),
          'WRITE_NOT_ALLOWED'
        )
        if (url.pathname.endsWith('/git/refs')) {
          requireFact(
            body?.ref?.startsWith('refs/tags/') && validSha(body.sha),
            'INVALID_TAG_WRITE'
          )
          versionParts(body.ref.slice('refs/tags/'.length))
          requireFact(!Object.hasOwn(body, 'force'), 'TAG_FORCE_FORBIDDEN')
        } else if (url.pathname.endsWith('/git/tags'))
          requireFact(body?.type === 'commit' && validSha(body.object), 'INVALID_TAG_WRITE')
        else
          requireFact(
            validSha(body?.target_commitish) && body?.draft === false && body?.prerelease === false,
            'INVALID_RELEASE_WRITE'
          )
      }
    }
    const response = await fetchImpl(url, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).catch(() => {
      throw new ReleaseError('API_NETWORK_ERROR')
    })
    if (!response.ok) throw new ApiError(response.status)
    const text = await response.text()
    requireFact(text.length <= 8 * 1024 * 1024, 'API_RESPONSE_TOO_LARGE')
    try {
      return text ? JSON.parse(text) : null
    } catch {
      throw new ReleaseError('API_INVALID_JSON')
    }
  }
}
export async function optional(getter) {
  try {
    return await getter()
  } catch (e) {
    if (e.status === 404) return null
    throw e
  }
}
export async function pages(api, path, field) {
  const result = []
  for (let page = 1; page <= 20; page++) {
    const data = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
    const items = field ? data[field] : data
    requireFact(Array.isArray(items), 'API_UNEXPECTED_SHAPE')
    result.push(...items)
    if (items.length < 100) return result
  }
  throw new ReleaseError('API_PAGINATION_LIMIT')
}
