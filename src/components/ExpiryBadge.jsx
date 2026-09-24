import { useId, useState } from 'react'
import { AnchoredOverlay, Box, IconButton, Text } from '@primer/react'
import { ClockIcon } from '@primer/octicons-react'
import { formatPublicationDateTime, formatRemainingTime, toMillis } from '../utils/expiry'

function validMillis(value) {
  const millis = toMillis(value)
  return Number.isFinite(millis) && millis > 0 ? millis : null
}

function DetailRow({ label, value }) {
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Text sx={{ color: 'fg.muted', fontSize: 0 }}>{label}</Text>
      <Text sx={{ color: 'fg.default', fontSize: 1 }}>{value}</Text>
    </Box>
  )
}

export function ExpiryBadge({ status, now }) {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const nowMs = validMillis(now) ?? Date.now()
  const createdAtMs = validMillis(status.createdAt)
  const expiresAtMs = validMillis(status.expiresAt)
  const promotedUntilMs = validMillis(status.promotedUntil)
  const promotionActive = status.promoted === true && promotedUntilMs > nowMs

  // A janela de 24h do feed não representa a validade do evento. Em treino marcado,
  // este controle só volta a existir quando comunica uma promoção realmente ativa.
  if (status.type === 'workout' && !promotionActive) return null
  if (!promotionActive && !expiresAtMs) return null

  const promotionRemaining = promotionActive
    ? formatRemainingTime(promotedUntilMs - nowMs, 'Promoção encerrada')
    : null
  const publicationRemaining = expiresAtMs
    ? formatRemainingTime(expiresAtMs - nowMs, 'Expirado')
    : null
  const showDistinctFeedExpiry =
    promotionActive && status.type !== 'workout' && expiresAtMs && expiresAtMs !== promotedUntilMs

  // Ambos os ramos são só o ícone -- o texto extenso ("74h28min restantes") nunca
  // fica visível no card: ele empurrava o cabeçalho (StatusHeader é flex, este botão
  // tem flexShrink:0) e sobrava pouco espaço pra `.status-author`, quebrando o
  // @username caractere por caractere no mobile. O tempo continua acessível — só que
  // dentro do popover (DetailRow "Tempo restante" abaixo) e via aria-label do ícone.
  const renderAnchor = (anchorProps) => (
    <IconButton
      {...anchorProps}
      type="button"
      icon={ClockIcon}
      variant="invisible"
      size="small"
      aria-label={
        promotionActive
          ? `${promotionRemaining}. Ver detalhes da promoção`
          : 'Ver informações de expiração da publicação'
      }
      sx={{ color: 'fg.muted' }}
    />
  )

  return (
    <AnchoredOverlay
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      renderAnchor={renderAnchor}
      align="end"
      side="outside-bottom"
      width="small"
      preventOverflow={false}
      displayCloseButton={false}
      overlayProps={{ 'aria-labelledby': titleId }}
    >
      <Box
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        sx={{
          display: 'grid',
          gap: 3,
          width: '100%',
          maxWidth: 'calc(100vw - 32px)',
          p: 3,
        }}
      >
        <Text id={titleId} sx={{ fontSize: 2, fontWeight: 'semibold' }}>
          {promotionActive ? 'Publicação promovida' : 'Publicação'}
        </Text>

        {promotionActive ? (
          <>
            <DetailRow
              label="Promoção ativa até"
              value={formatPublicationDateTime(promotedUntilMs)}
            />
            <DetailRow label="Tempo restante" value={promotionRemaining} />
            {showDistinctFeedExpiry && (
              <DetailRow
                label="Janela original do feed"
                value={`${formatPublicationDateTime(expiresAtMs)} · ${publicationRemaining}`}
              />
            )}
          </>
        ) : (
          <>
            {createdAtMs && (
              <DetailRow label="Criada em" value={formatPublicationDateTime(createdAtMs)} />
            )}
            <DetailRow label="Expira em" value={formatPublicationDateTime(expiresAtMs)} />
            <DetailRow label="Tempo restante" value={publicationRemaining} />
          </>
        )}
      </Box>
    </AnchoredOverlay>
  )
}
