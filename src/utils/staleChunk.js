// A falha de importação de um chunk lazy (rota carregada sob demanda) sempre aparece
// assim: o arquivo com hash já não existe mais no servidor porque um novo deploy
// substituiu os assets. Isolado do ErrorBoundary (que é .jsx e depende do React/Primer)
// para poder ser testado como função pura, sem precisar montar nada.
export function isStaleChunkError(error) {
  const message = String(error?.message || '')
  return (
    error?.name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
      message
    )
  )
}
