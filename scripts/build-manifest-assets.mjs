// Resolve the real CSS graph instead of depending on manual chunk filenames.
export function resolveManifestEntry(manifest, key) {
  const entry = manifest[key]
  if (!entry?.isEntry || !entry.file) throw new Error('Build entry missing: ' + key)
  const seen = new Set(),
    css = new Set()
  function visit(name) {
    if (seen.has(name)) return
    seen.add(name)
    const chunk = manifest[name]
    if (!chunk) throw new Error('Build dependency missing: ' + name)
    for (const imported of chunk.imports || []) visit(imported)
    for (const file of chunk.css || []) css.add(file)
  }
  for (const imported of entry.imports || []) visit(imported)
  return { file: entry.file, importedCss: [...css], css: entry.css || [] }
}
