import { Box, Text } from '@primer/react'
import { formatCentavosBRL } from '../utils/format'
import { resolvePixKeyTypeLabel, abbreviateProtocol } from '../utils/cashPurchaseFlow'
import { CopyButton } from './CopyButton'

// Reutilizado em dois lugares (EvoCash.jsx): logo após requestCashPurchase resolver, e
// dentro de cada card de "Minhas compras" enquanto status === 'pending'. Nunca renderiza
// nada se pixPayment não estiver carregado/válido -- fail-safe de exibição, nunca inventa
// uma instrução de pagamento sem dado real (o backend já bloqueou a CRIAÇÃO do pedido
// nesse caso, ver isValidPixPayment em cash-purchase-core.js; isto aqui é só defesa
// adicional caso settings.pixPayment ainda não tenha carregado no momento do render).
//
// Todo texto que pode ser longo e imprevisível (chave PIX, protocolo) usa
// wordBreak/overflowWrap + minWidth:0 nos containers flex, pra nunca estourar a largura
// do card em telas pequenas -- não é uma solução ajustada aos dados de hoje, funciona
// para qualquer chave aleatória/protocolo por mais longos que sejam.
export function PixPaymentInstructions({ purchaseId, packageLabel, cashAmount, amountCentavos, pixPayment }) {
  if (!pixPayment) return null

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
        Pagamento via PIX
      </Text>
      <Text as="p" sx={{ m: 0, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
        {packageLabel} — {cashAmount} EvoCash
      </Text>
      <Text as="p" sx={{ m: 0 }}>
        Valor: <Text sx={{ fontWeight: 'bold' }}>{formatCentavosBRL(amountCentavos)}</Text>
      </Text>

      <Box sx={{ minWidth: 0 }}>
        <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
          Chave PIX ({resolvePixKeyTypeLabel(pixPayment.keyType)})
        </Text>
        <Text
          as="p"
          sx={{ fontWeight: 'bold', m: 0, wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 0 }}
        >
          {pixPayment.key}
        </Text>
        <Box sx={{ mt: 1 }}>
          <CopyButton value={pixPayment.key} label="Copiar chave" successMessage="Chave PIX copiada" testId="copy-pix-key" />
        </Box>
      </Box>

      <Text as="p" sx={{ m: 0, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
        Recebedor: <Text sx={{ fontWeight: 'bold' }}>{pixPayment.recipientName}</Text>
      </Text>

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
        Após realizar o PIX, aguarde a confirmação do pagamento. O EvoCash será creditado somente após a aprovação.
        Envie exatamente o valor indicado no pedido.
      </Text>
    </Box>
  )
}
