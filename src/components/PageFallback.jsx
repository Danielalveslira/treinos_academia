import { Box, Spinner } from '@primer/react'

// Usado dentro de cada <Suspense> de rota (nunca envolvendo o header/nav fixos, só o
// conteúdo que está de fato trocando) — por isso a altura mínima é modesta: ele aparece
// dentro de um container que já tem seu próprio espaçamento estável.
export function PageFallback() {
  return (
    <Box
      sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '40vh' }}
    >
      <Spinner />
    </Box>
  )
}
