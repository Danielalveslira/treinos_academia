import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Box, Button, Spinner, Text, ThemeProvider } from '@primer/react'
import { CATALOG_GROUP_SIZE, CATALOG_PAGE_SIZE, CatalogError, fetchProductCatalog } from './publicProductCatalogService'
import { ProductFilters } from './ProductFilters'
import { ProductGrid } from './ProductGrid'
import { ProductGroups } from './ProductGroups'

const ProductDialog = lazy(() => import('./ProductDialog.jsx'))

function readUrlFilters() {
  const params = new URLSearchParams(location.search)
  return {
    search: (params.get('busca') || '').slice(0, 80),
    category: (params.get('categoria') || '').slice(0, 80),
    brand: (params.get('marca') || '').slice(0, 120),
  }
}

function writeUrlFilters({ search, category, brand }) {
  const params = new URLSearchParams()
  if (search.trim()) params.set('busca', search.trim())
  if (category) params.set('categoria', category)
  if (brand) params.set('marca', brand)
  const next = `${location.pathname}${params.size ? `?${params}` : ''}`
  if (next !== location.pathname + location.search) history.pushState(history.state, '', next)
}

// Sincronizado com `boot-public-theme.js` (ver public/boot-public-theme.js), que marca
// `data-color-mode` no <html> antes do primeiro paint e dispara este evento customizado em
// toda troca de tema.
function usePublicThemeMode() {
  const [mode, setMode] = useState(() => document.documentElement.dataset.colorMode || 'light')
  useEffect(() => {
    const update = () => setMode(document.documentElement.dataset.colorMode || 'light')
    window.addEventListener('public-theme-change', update)
    return () => window.removeEventListener('public-theme-change', update)
  }, [])
  return mode
}

function statusMessage({ status, errorCode, totalProducts, totalBrands }) {
  if (status === 'loading') return 'Carregando produtos…'
  if (status === 'loading-more') return 'Carregando mais produtos…'
  if (status === 'error') {
    return errorCode === 'PGRST202'
      ? 'A vitrine está temporariamente indisponível.'
      : 'Não foi possível carregar os produtos agora.'
  }
  return `${totalProducts} produto${totalProducts === 1 ? '' : 's'} encontrado${totalProducts === 1 ? '' : 's'} · ${totalBrands} marca${totalBrands === 1 ? '' : 's'} representada${totalBrands === 1 ? '' : 's'}.`
}

function ProductCatalog() {
  const initial = useRef(readUrlFilters()).current
  const [searchInput, setSearchInput] = useState(initial.search)
  const [committedSearch, setCommittedSearch] = useState(initial.search)
  const [category, setCategory] = useState(initial.category)
  const [brand, setBrand] = useState(initial.brand)
  const [categories, setCategories] = useState([])
  const [groups, setGroups] = useState([])
  const [items, setItems] = useState([])
  const [totalProducts, setTotalProducts] = useState(0)
  const [totalBrands, setTotalBrands] = useState(0)
  const [offset, setOffset] = useState(0)
  const [status, setStatus] = useState('loading')
  const [errorCode, setErrorCode] = useState(null)
  const [zoomProduct, setZoomProduct] = useState(null)
  const zoomTriggerRef = useRef(null)
  const requestIdRef = useRef(0)
  const controllerRef = useRef(null)
  const offsetRef = useRef(0)

  const grouped = !committedSearch.trim() && !category && !brand
  const hasFilters = Boolean(searchInput || category || brand)

  const load = useCallback((append) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const requestId = ++requestIdRef.current
    const nextOffset = append ? offsetRef.current : 0
    setStatus(append ? 'loading-more' : 'loading')
    setErrorCode(null)
    fetchProductCatalog(
      {
        mode: grouped ? 'groups' : 'items',
        search: committedSearch.trim(),
        category,
        brand,
        offset: nextOffset,
        limit: grouped ? CATALOG_GROUP_SIZE : CATALOG_PAGE_SIZE,
      },
      controller.signal
    )
      .then((page) => {
        if (requestId !== requestIdRef.current) return
        const list = grouped ? page.groups : page.items
        const count = Array.isArray(list) ? list.length : 0
        if (grouped) setGroups((prev) => (append ? [...prev, ...(list || [])] : list || []))
        else setItems((prev) => (append ? [...prev, ...(list || [])] : list || []))
        setTotalProducts(Number(page.totalProducts) || 0)
        setTotalBrands(Number(page.totalBrands) || 0)
        offsetRef.current = nextOffset + count
        setOffset(offsetRef.current)
        setStatus('ready')
      })
      .catch((error) => {
        if (error.name === 'AbortError' || requestId !== requestIdRef.current) return
        setErrorCode(error instanceof CatalogError ? error.code : 'UNKNOWN')
        setStatus('error')
      })
  }, [grouped, committedSearch, category, brand])

  // Nova busca ao trocar qualquer filtro (sempre do zero, offset volta a 0). `load` muda de
  // identidade com os mesmos filtros, então não entra nas deps para não duplicar o disparo.
  useEffect(() => {
    offsetRef.current = 0
    setOffset(0)
    load(false)
    writeUrlFilters({ search: committedSearch, category, brand })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped, committedSearch, category, brand])

  // Debounce curto da digitação antes de confirmar a busca (dispara o efeito acima).
  useEffect(() => {
    const id = setTimeout(() => setCommittedSearch(searchInput), 250)
    return () => clearTimeout(id)
  }, [searchInput])

  useEffect(() => {
    const controller = new AbortController()
    fetchProductCatalog({ mode: 'categories' }, controller.signal)
      .then((values) => { if (Array.isArray(values)) setCategories(values) })
      .catch(() => { /* a busca por categoria cai de volta para "Todas as categorias" */ })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const onPopState = () => {
      const next = readUrlFilters()
      setSearchInput(next.search)
      setCommittedSearch(next.search)
      setCategory(next.category)
      setBrand(next.brand)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => () => controllerRef.current?.abort(), [])

  function clearFilters() {
    setSearchInput('')
    setCommittedSearch('')
    setCategory('')
    setBrand('')
  }

  function openZoom(product, triggerEl) {
    zoomTriggerRef.current = triggerEl
    setZoomProduct(product)
  }

  const showGroups = grouped && groups.length > 0
  const showItems = !grouped && items.length > 0
  const showEmpty = status === 'ready' && !showGroups && !showItems
  const canLoadMore = grouped ? groups.length < totalBrands && groups.length > 0 : items.length < totalProducts && items.length > 0

  return (
    <Box>
      <ProductFilters
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        category={category}
        onCategoryChange={setCategory}
        categories={categories}
        hasFilters={hasFilters}
        onClear={clearFilters}
      />
      <Box role="status" aria-live="polite" sx={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 1, color: 'fg.muted', mt: 3, mb: 3, minHeight: 20 }}>
        {(status === 'loading' || status === 'loading-more') && <Spinner size="small" />}
        <span>{statusMessage({ status, errorCode, totalProducts, totalBrands })}</span>
      </Box>
      {status === 'error' && (
        <Box sx={{ mb: 3 }}>
          <Button onClick={() => load(offset > 0)}>Tentar de novo</Button>
        </Box>
      )}
      {showEmpty && (
        <Text sx={{ color: 'fg.muted' }}>Nenhum produto encontrado. Ajuste a busca ou a categoria.</Text>
      )}
      {showGroups && <ProductGroups groups={groups} onZoom={openZoom} onViewAllBrand={setBrand} />}
      {showItems && <ProductGrid items={items} onZoom={openZoom} allowPriority />}
      {canLoadMore && (
        <Box sx={{ textAlign: 'center', mt: 4 }}>
          <Button onClick={() => load(true)} disabled={status === 'loading-more'}>
            {grouped ? 'Carregar mais marcas' : 'Carregar mais'}
          </Button>
        </Box>
      )}
      {zoomProduct && (
        <Suspense fallback={null}>
          <ProductDialog product={zoomProduct} onClose={() => setZoomProduct(null)} returnFocusRef={zoomTriggerRef} />
        </Suspense>
      )}
    </Box>
  )
}

export function PublicProductsIsland() {
  const mode = usePublicThemeMode()
  return (
    <ThemeProvider colorMode={mode === 'dark' ? 'night' : 'day'} dayScheme="light" nightScheme="dark">
      <ProductCatalog />
    </ThemeProvider>
  )
}
