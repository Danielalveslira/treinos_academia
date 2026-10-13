export const REJECTION_REASONS = [
  'Avatar inconsistente',
  'Posição incorreta',
  'Equipamento incorreto',
  'Imagem sem relação com exercício',
  'Fundo/texto',
  'Outro',
]

export function canDeleteVisualVersion(set) {
  return (
    ['allocated', 'draft', 'review', 'rejected', 'failed'].includes(set.status) &&
    !set.published_at &&
    !set.approved_at
  )
}

export function visualFileIssues(set) {
  const assets = set.assets || []
  const errors = []
  for (const role of [
    'start',
    'end',
    ...(assets.some((a) => a.role === 'thumbnail') ? ['thumbnail'] : []),
  ]) {
    const asset = assets.find((a) => a.role === role)
    if (!asset || !set.previewUrls?.[role])
      errors.push(`Arquivo ${role.toUpperCase()} ausente ou indisponível.`)
    if (
      asset &&
      (asset.mime_type !== 'image/webp' ||
        !(asset.byte_size > 0) ||
        asset.byte_size > 2 * 1024 * 1024 ||
        !(
          asset.width >= 64 &&
          asset.height >= 64 &&
          asset.width <= (role === 'thumbnail' ? 512 : 1024) &&
          asset.height <= (role === 'thumbnail' ? 512 : 1024)
        ))
    )
      errors.push(`Formato ou dimensões de ${role.toUpperCase()} inválidos.`)
  }
  return errors
}
