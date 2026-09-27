import { Box, Link, Text } from '@primer/react'
import { formatCentavosBRL } from '../utils/format'
import { abbreviateProtocol } from '../utils/cashPurchaseFlow'
import { CopyButton } from './CopyButton'

// Reutilizado em dois lugares (EvoCash.jsx): logo após requestCashPurchase resolver, e
// dentro de cada card de "Minhas compras" enquanto status === 'pending'. Nunca renderiza
// nada sem QR code -- fail-safe de exibição (o Mercado Pago sempre devolve um pagamento
// PIX com QR code; se por algum motivo faltar, é melhor não mostrar nada do que uma
// instrução incompleta).
//
// Diferença do fluxo antigo (PIX manual): não existe mais "chave PIX/recebedor" fixos --
// cada compra tem seu próprio QR code/código copia-e-cola gerado pelo Mercado Pago, e a
// confirmação é automática (webhook), nunca depende de um admin conferir manualmente.
export function PixPaymentInstructions({ purchaseId, packageLabel, cashAmount, amountCentavos, qrCode, qrCodeBase64, ticketUrl }) {
  if (!qrCode) return null

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 0,
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: 3,
      }}
    >
      <Text as="p" sx={{ fontWeight: 'bold', m: 0 }}>
        Pagamento via PIX (Mercado Pago)
      </Text>
      <Text as="p" sx={{ m: 0, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
        {packageLabel} — {cashAmount} EvoCash
      </Text>
      <Text as="p" sx={{ m: 0 }}>
        Valor: <Text sx={{ fontWeight: 'bold' }}>{formatCentavosBRL(amountCentavos)}</Text>
      </Text>

      {qrCodeBase64 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <img
            src={`data:image/png;base64,${qrCodeBase64}`}
            alt="QR code para pagamento PIX"
            style={{ width: 220, height: 220 }}
          />
        </Box>
      )}

      <Box sx={{ minWidth: 0 }}>
        <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
          Código PIX copia e cola
        </Text>
        <Text
          as="p"
          sx={{ fontFamily: 'mono', fontSize: 0, m: 0, wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 0 }}
        >
          {qrCode}
        </Text>
        <Box sx={{ mt: 1 }}>
          <CopyButton value={qrCode} label="Copiar código PIX" successMessage="Código PIX copiado" testId="copy-pix-code" />
        </Box>
      </Box>

      {ticketUrl && (
        <Link href={ticketUrl} target="_blank" rel="noreferrer">
          Abrir comprovante do Mercado Pago
        </Link>
      )}

      <Box sx={{ minWidth: 0 }}>
        <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
          Protocolo
        </Text>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <Text
            as="span"
            title={purchaseId}
            sx={{ fontFamily: 'mono', wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 0 }}
          >
            {abbreviateProtocol(purchaseId)}
          </Text>
          <CopyButton value={purchaseId} label="Copiar" successMessage="Protocolo copiado" testId="copy-protocol" />
        </Box>
      </Box>

      <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
        Após pagar, a confirmação é automática — o EvoCash é creditado assim que o Mercado Pago aprovar o pagamento,
        geralmente em poucos segundos.
      </Text>
    </Box>
  )
}
