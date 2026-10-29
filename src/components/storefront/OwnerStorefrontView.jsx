import { useEffect, useRef, useState } from 'react'
import { Box, Button, Flash, Heading, Spinner, Text } from '@primer/react'
import { listStorefronts } from '../../services/storefrontService'
import { storefrontError } from '../../utils/storefront'
import StorefrontStatusCard from './StorefrontStatusCard'
import StorefrontDialog from './StorefrontDialog'

export default function OwnerStorefrontView() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const request = useRef(0)

  async function load(before = null) {
    const revision = ++request.current
    setLoading(true)
    try {
      const next = await listStorefronts(false, before)
      if (revision !== request.current) return
      setData((prev) => (before && prev ? { ...next, items: [...prev.items, ...next.items] } : next))
      setError('')
    } catch (e) {
      if (revision === request.current) setError(storefrontError(e))
    } finally {
      if (revision === request.current) setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 2 }}>
        <Heading as="h2" sx={{ fontSize: 3 }}>
          {data?.items.length === 1 ? 'Minha vitrine' : 'Minhas vitrines'}
        </Heading>
        <Button variant="primary" disabled={loading || !data?.limits?.maxStorefronts} onClick={() => setCreating(true)}>
          Criar vitrine
        </Button>
      </Box>
      {error && (
        <Flash variant="danger" sx={{ mb: 3 }}>
          {error}
        </Flash>
      )}
      {loading && !data && <Spinner aria-label="Carregando vitrines" />}
      {data?.items.length === 0 && (
        <Text as="p">Você ainda não criou uma vitrine. Toque em "Criar vitrine" para começar.</Text>
      )}
      {data?.items.map((item) => (
        // Keyed by id alone (never revision): a reload after saving must never remount
        // the card, or "Ver detalhes"/open dialogs would silently collapse right after
        // the owner's own edit.
        <StorefrontStatusCard key={item.id} item={item} tariff={data.price} onChange={load} />
      ))}
      {data?.nextCursor && (
        <Button disabled={loading} onClick={() => load(data.nextCursor)}>
          Mais vitrines
        </Button>
      )}
      {creating && (
        <StorefrontDialog
          onCancel={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false)
            await load()
          }}
        />
      )}
    </Box>
  )
}
