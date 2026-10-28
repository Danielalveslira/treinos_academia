import { useEffect, useState } from 'react'
import { Box, Button, Dialog, Flash, Spinner, Text } from '@primer/react'
import {
  prepareCommercialPromotion,
  resubmitCommercialPromotion,
} from '../services/promotionsService'
import CommercialLeasePurchase from './CommercialLeasePurchase'
import CommercialOrderHistory from './CommercialOrderHistory'
import { getAdvertisingOrders } from '../services/advertisingService'
import { commercialError } from '../utils/commercial'

export function PromoteDialogBody({ targetType, targetId, onPromoted }) {
  const [promotion, setPromotion] = useState(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let live = true
    setPromotion(null)
    prepareCommercialPromotion(targetType, targetId)
      .then((data) => {
        if (live) setPromotion(data)
      })
      .catch((e) => {
        if (live) setError(commercialError(e))
      })
    return () => {
      live = false
    }
  }, [targetType, targetId, revision])
  return (
    <Box>
      <Text as="p">
        O destaque preserva a autoria e o conteúdo original. A cobrança é por dias de 24 horas, sem
        promessa de visualizações ou cliques. Não há renovação automática.
      </Text>
      {error && <Flash variant="danger">{error}</Flash>}
      {!promotion && !error && <Spinner aria-label="Preparando impulsionamento" />}
      {promotion && (
        <>
          <Text as="p">
            {promotion.state === 'submitted'
              ? 'Enviado para análise. Nenhum EvoCash foi debitado.'
              : `Situação editorial: ${promotion.state}`}
          </Text>
          <Button
            onClick={async () => {
              try {
                await resubmitCommercialPromotion(promotion.resourceId)
                setError('')
                setRevision((n) => n + 1)
              } catch (e) {
                setError(commercialError(e))
              }
            }}
            disabled={['suspended', 'archived', 'submitted'].includes(promotion.state)}
          >
            Solicitar nova análise
          </Button>
          <Button onClick={() => setRevision((n) => n + 1)}>Atualizar situação</Button>
          {promotion.state === 'approved' && (
            <CommercialLeasePurchase
              key={promotion.resourceId}
              resourceId={promotion.resourceId}
              tariff={promotion.tariff}
              expiresAt={promotion.expiresAt}
              subjectLabel="destaque"
              onComplete={async (order) => {
                onPromoted?.({
                  id: promotion.resourceId,
                  expiresAt: order.periodEnd,
                  cashAmount: order.totalCash,
                  durationDays: order.durationDays,
                })
                setRevision((n) => n + 1)
              }}
            />
          )}
          <CommercialOrderHistory
            resourceId={promotion.resourceId}
            load={getAdvertisingOrders}
            revision={revision}
          />
        </>
      )}
    </Box>
  )
}
export function PromoteDialog({ targetType, targetId, title, onClose, onPromoted }) {
  return (
    <Dialog
      title={title || 'Impulsionar'}
      subtitle="Contratação por dias com EvoCash, após aprovação"
      onClose={onClose}
      width="medium"
    >
      <PromoteDialogBody
        key={`${targetType}:${targetId}`}
        targetType={targetType}
        targetId={targetId}
        onPromoted={onPromoted}
      />
    </Dialog>
  )
}
