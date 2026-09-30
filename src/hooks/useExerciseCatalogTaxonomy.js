import { useEffect, useState } from 'react'
import { listCatalogTaxonomy } from '../services/exerciseCatalogService.js'

// Músculos/equipamentos/categorias/dificuldades do nosso próprio catálogo (868
// exercícios, fechado) -- distinct direto na tabela, nunca um enum hardcoded, e nunca um
// filtro vazio (só valores realmente presentes). A promise é cacheada em
// exerciseCatalogService (pela sessão inteira, não por componente) -- montar este hook
// em vários lugares ao mesmo tempo nunca dispara mais de uma consulta. Falha aqui nunca
// impede a busca em si: os dropdowns só ficam vazios (usuário ainda busca por texto ou
// pelos outros filtros).
export function useExerciseCatalogTaxonomy() {
  const [taxonomy, setTaxonomy] = useState({ muscles: [], equipment: [], categories: [], levels: [] })

  useEffect(() => {
    let active = true
    listCatalogTaxonomy()
      .then((result) => active && setTaxonomy(result))
      .catch((error) => console.error('[useExerciseCatalogTaxonomy]', error))
    return () => {
      active = false
    }
  }, [])

  return taxonomy
}
