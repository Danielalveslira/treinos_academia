import { useEffect, useState } from 'react'
import { listCatalogTaxonomy } from '../services/exerciseCatalogService.js'

// Músculos/equipamentos do nosso próprio catálogo (868 exercícios, fechado) -- distinct
// direto na tabela, cacheado em memória pela sessão (ver listCatalogTaxonomy). Falha
// aqui nunca impede a busca em si: os dropdowns só ficam vazios (usuário ainda busca por
// texto ou pelos outros filtros).
export function useExerciseCatalogTaxonomy() {
  const [muscles, setMuscles] = useState([])
  const [equipment, setEquipment] = useState([])

  useEffect(() => {
    let active = true
    listCatalogTaxonomy()
      .then((taxonomy) => {
        if (!active) return
        setMuscles(taxonomy.muscles)
        setEquipment(taxonomy.equipment)
      })
      .catch((error) => console.error('[useExerciseCatalogTaxonomy]', error))
    return () => {
      active = false
    }
  }, [])

  return { muscles, equipment }
}
