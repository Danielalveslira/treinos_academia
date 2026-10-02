import { useId } from 'react'

// Id estável (e válido para aria-labelledby) para o título da folha.
export function useSheetTitleId() {
  return `sheet-title-${useId().replace(/:/g, '')}`
}
