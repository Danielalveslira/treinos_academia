import { useEffect, useState } from 'react'
import { Box, Button, Dialog, Flash, Spinner, Text } from '@primer/react'
import {
  prepareCommercialPromotion,
  resubmitCommercialPromotion,
  getDirectPostBoostOffer,
  prepareDirectPostBoost,
} from '../services/promotionsService'
import CommercialLeasePurchase from './CommercialLeasePurchase'
import CommercialOrderHistory from './CommercialOrderHistory'
import { getAdvertisingOrders } from '../services/advertisingService'
import { commercialDate, commercialError } from '../utils/commercial'

export function PromoteDialogBody({ targetType, targetId, onPromoted }) {
  const [promotion, setPromotion] = useState(null)
  const [success, setSuccess] = useState(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let live = true
    setPromotion(null)
    setError('')
    const load =
      targetType === 'post'
        ? getDirectPostBoostOffer(targetId)
        : prepareCommercialPromotion(targetType, targetId)
    load
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
    <Box sx={{ maxWidth: '100%', minWidth: 0 }}>
      {targetType === 'post' ? (
        <>
          {error && (
            <Flash variant="danger" sx={{ display: 'grid', gap: 2 }}>
              <Text as="p" sx={{ m: 0 }}>
                {error}
              </Text>
              <Box>
                <Button size="small" onClick={() => setRevision((n) => n + 1)}>
                  Tentar novamente
                </Button>
              </Box>
            </Flash>
          )}
          {!promotion && !error && <Spinner aria-label="Consultando promoção" />}
          {success ? (
            <Box role="status" sx={{ display: 'grid', gap: 2, py: 3 }}>
              <Text as="h3" sx={{ fontSize: 3 }}>
                Promoção ativada!
              </Text>
              <Text as="p">Sua publicação ficará em destaque até {success}.</Text>
            </Box>
          ) : (
            promotion && (
              <CommercialLeasePurchase
                resourceId={promotion.resourceId}
                prepareResource={() => prepareDirectPostBoost(targetId)}
                tariff={promotion.tariff}
                expiresAt={promotion.expiresAt}
                subjectLabel="publicação"
                compact
                onComplete={(order) => {
                  const expiresAt = order.periodEnd
                  setSuccess(commercialDate(expiresAt))
                  try {
                    onPromoted?.({
                      id: promotion.resourceId || order.resourceId,
                      expiresAt,
                      cashAmount: order.totalCash,
                      durationDays: order.durationDays,
                    })
                  } catch {
                    // A campanha já foi paga; falha de atualização do card não reabre a cobrança.
                  }
                }}
              />
            )
          )}
        </>
      ) : (
        <>
          <Text as="p">
            O destaque preserva a autoria e o conteúdo original. A cobrança é por dias de 24 horas,
            sem promessa de visualizações ou cliques. Não há renovação automática.
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
        </>
      )}
    </Box>
  )
}
export function PromoteDialog({ targetType, targetId, title, onClose, onPromoted }) {
  return (
    <Dialog
      title={targetType === 'post' ? 'Promover publicação' : title || 'Impulsionar'}
      subtitle={
        targetType === 'post'
          ? 'Destaque sua publicação por mais tempo.'
          : 'Contratação por dias com EvoCash, após aprovação'
      }
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
