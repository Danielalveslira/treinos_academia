// Only an explicit server refusal invalidates cached execution data. Network,
// gateway, token-refresh and unknown failures do not prove that a sheet changed.
export function sheetSnapshotInvalidation(error, sheetId) {
  const code = String(error?.message || '').trim()
  if (['SESSION_REVOKED', 'APP_ACCESS_DENIED'].includes(code)) return null
  if (['SHEET_NOT_FOUND', 'SHEET_NOT_READY', 'SHEET_EXERCISE_UNAVAILABLE'].includes(code))
    return sheetId
  return undefined
}
