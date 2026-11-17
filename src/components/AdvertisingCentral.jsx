import { useCallback, useEffect, useState } from 'react'
import { Box, Button, Flash, Spinner, Text } from '@primer/react'
import { getAdvertisingCampaigns } from '../services/advertisingService'
import { commercialError } from '../utils/commercial'
import AdStatusCard from './advertising/AdStatusCard'
import CreateAdWizard from './advertising/CreateAdWizard'

export default function AdvertisingCentral({ accountId, accountName }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [wizard, setWizard] = useState(null) // null | { editing: campaign|null }

  const refresh = useCallback(async () => {
    try {
      const current = await getAdvertisingCampaigns(accountId)
      setRows(current)
      setError('')
      return current
    } catch (e) {
      setError(commercialError(e))
      throw e
    }
  }, [accountId])

  useEffect(() => {
    let live = true
    setRows(null)
    setError('')
    getAdvertisingCampaigns(accountId)
      .then((data) => live && setRows(data))
      .catch((e) => live && setError(commercialError(e)))
    return () => {
      live = false
    }
  }, [accountId])

  if (wizard) {
    return (
      <CreateAdWizard
        accountId={accountId}
        accountName={accountName}
        existingDraft={wizard.editing}
        onCancel={() => setWizard(null)}
        onDone={async () => {
          setWizard(null)
          await refresh()
        }}
      />
    )
  }

  return (
    <Box sx={{ mt: 3, minWidth: 0, maxWidth: 800, mx: 'auto' }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        <Button variant="primary" onClick={() => setWizard({ editing: null })}>
          Criar anúncio
        </Button>
      </Box>
      {error && (
        <Flash variant="danger" sx={{ mt: 3 }}>
          {error}
        </Flash>
      )}
      {!rows && !error && <Spinner aria-label="Carregando seus anúncios" sx={{ mt: 3 }} />}
      {rows?.length === 0 && (
        <Text as="p" sx={{ mt: 3 }}>
          Você ainda não criou nenhum anúncio. Toque em "Criar anúncio" para começar.
        </Text>
      )}
      {rows?.map((row) => (
        <AdStatusCard
          key={`${row.ad_id}:${row.version}:${row.moderation_state}`}
          campaign={row}
          onChange={refresh}
          onEdit={(campaign) => setWizard({ editing: campaign })}
        />
      ))}
      {rows?.length > 0 && rows.length % 20 === 0 && (
        <Button
          onClick={async () => {
            try {
              const more = await getAdvertisingCampaigns(accountId, rows.at(-1).ad_id)
              setRows([...rows, ...more])
            } catch (e) {
              setError(commercialError(e))
            }
          }}
        >
          Carregar mais anúncios
        </Button>
      )}
    </Box>
  )
}
