import { Box, Button, Label, Text } from '@primer/react'
import { formatCentavosBRL } from '../utils/format'
import { buildCashPackagesPresentation } from '../utils/cashPackagePresentation'

// EvoCash -- cards de compra persuasivos e éticos (ver implementar_pacotes_evocash_
// design_persuasivo.md). Puramente apresentacional: recebe os pacotes já validados/
// filtrados por getCashPurchaseSettings e delega toda decisão de preço/quantidade a
// buildCashPackagesPresentation (cashPackagePresentation.js) -- este componente só
// desenha o que a camada de apresentação calculou, e chama onBuy(packageId) sem alterar
// em nada o fluxo de requestCashPurchase/resolveRequestId já existente em EvoCash.jsx.
export function CashPackageCards({ packages, buyingPackageId = null, disabled = false, onBuy }) {
  const views = buildCashPackagesPresentation(packages)

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 3,
          alignItems: 'stretch',
          justifyContent: ['stretch', 'stretch', 'center'],
        }}
      >
        {views.map((pkg) => (
          <Box
            key={pkg.packageId}
            data-testid="cash-package-card"
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              flex: ['1 1 100%', '1 1 220px', '0 1 230px'],
              minWidth: 220,
              p: 3,
              borderWidth: pkg.highlight ? 2 : 1,
              borderStyle: 'solid',
              borderColor: pkg.highlight ? 'accent.emphasis' : 'border.default',
              borderRadius: 2,
              bg: pkg.highlight ? 'accent.subtle' : 'canvas.subtle',
            }}
          >
            {pkg.badgeText && (
              <Label variant={pkg.recommended ? 'accent' : 'success'} sx={{ alignSelf: 'flex-start' }}>
                {pkg.badgeText}
              </Label>
            )}
            <Text as="h3" sx={{ fontSize: 1, fontWeight: 'bold', m: 0, textTransform: 'uppercase' }}>
              {pkg.title}
            </Text>
            <Text as="p" sx={{ fontSize: 4, fontWeight: 'bold', m: 0 }}>
              {pkg.cashAmount} EvoCash
            </Text>
            <Text as="p" sx={{ fontSize: 3, fontWeight: 'bold', m: 0 }}>
              {formatCentavosBRL(pkg.amountCentavos)}
            </Text>
            {pkg.tagline && (
              <Text as="p" sx={{ fontSize: 1, m: 0 }}>
                {pkg.tagline}
              </Text>
            )}
            {/* Box próprio em vez de sx={{ mt: 'auto' }} direto no Button: o Button do
                Primer renderiza o <button> dentro de um wrapper de loading
                (prc-Button-ConditionalWrapper) que não herda margin do sx do Button --
                sem este Box, o botão ficava "flutuando" logo após o conteúdo em vez de
                grudado no rodapé do card, deixando espaço em branco desalinhado entre
                cards com quantidades diferentes de texto. */}
            <Box sx={{ mt: 'auto', pt: 2 }}>
              <Button
                variant={pkg.highlight ? 'primary' : 'default'}
                block
                data-testid={`buy-${pkg.packageId}`}
                loading={buyingPackageId === pkg.packageId}
                disabled={disabled}
                onClick={() => onBuy(pkg.packageId)}
              >
                Comprar por {formatCentavosBRL(pkg.amountCentavos)}
              </Button>
            </Box>
          </Box>
        ))}
      </Box>
      <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mt: 3, textAlign: 'center' }}>
        Pagamento via PIX · crédito confirmado após validação do pagamento · EvoCash é um crédito interno do
        Evolutus.
      </Text>
    </Box>
  )
}
