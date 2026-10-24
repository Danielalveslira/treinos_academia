export async function advertiserRpc(name, args = {}) {
  const { supabase } = await import('../../../supabase/config')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}

// Explicit bounded pagination. A failure never returns a partial export/catalog.
export async function readCatalog(name, args = {}) {
  const rows = []
  for (let offset = 0; offset <= 100000; offset += 100) {
    const page = await advertiserRpc(name, { ...args, p_offset: offset })
    rows.push(...page)
    if (page.length < 100) return rows
  }
  throw new Error('Limite do catálogo atingido. Refine a consulta.')
}
