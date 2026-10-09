// Paths determinísticos da mídia dos exercícios. Espelham allocate_exercise_visual_set (draft) e
// private.apply_published_visual_set (publicado) em supabase/migrations/20261020000001_exercise_visuals.sql.
// As Edge Functions NÃO confiam no path guardado no banco por tabela alheia: recalculam o esperado e
// exigem igualdade exata (sem "..", sem barras extras, sem outro exercício/conjunto).
export const FILE_NAMES: Record<string, string> = {
  start: 'start.webp',
  end: 'end.webp',
  thumbnail: 'thumb.webp',
}

export function draftPath(catalogId: string, visualSetId: string, role: string): string | null {
  const file = FILE_NAMES[role]
  return file ? `${catalogId}/${visualSetId}/${file}` : null
}

export function publishedPath(catalogId: string, version: number, role: string): string | null {
  const file = FILE_NAMES[role]
  return file && Number.isInteger(version) && version > 0 ? `${catalogId}/v${version}/${file}` : null
}
