import { useRef, useState } from 'react'
import { Box, Button, Dialog, Flash, Heading, Label, Text } from '@primer/react'
import {
  archiveStorefrontProduct,
  setStorefrontEditorial,
  listStorefrontOrders,
  listStorefrontProducts,
} from '../../services/storefrontService'
import { storefrontError } from '../../utils/storefront'
import { commercialDate } from '../../utils/commercial'
import { deriveStorefrontStatus } from '../../utils/storefrontStatus'
import { formatCentavosBRL } from '../../utils/format'
import StorefrontImage from '../StorefrontImage'
import CommercialLeasePurchase from '../CommercialLeasePurchase'
import StorefrontDialog from './StorefrontDialog'
import ProductDialog from './ProductDialog'

const orderLabels = { quoted: 'Cotação', fulfilled: 'Contratado', reversed: 'Revertido' }
const BADGE_VARIANT = {
  draft: 'secondary',
  submitted: 'accent',
  rejected: 'danger',
  approved_unpaid: 'attention',
  live: 'success',
  blocked: 'severe',
  suspended: 'severe',
  ended: 'secondary',
  archived: 'secondary',
}

// One storefront's full card: status visible at a glance (no click required, same
// philosophy as AdStatusCard.jsx for ads), with editing/products/history behind "Ver
// detalhes".
export default function StorefrontStatusCard({ item, tariff, onChange }) {
  const status = deriveStorefrontStatus(item, { tariff })
  const [expanded, setExpanded] = useState(false)
  const [preview, setPreview] = useState(false)
  const [dialog, setDialog] = useState(null) // null | 'edit-storefront' | { kind: 'product', product }
  const [showHistory, setShowHistory] = useState(false)
  const [orders, setOrders] = useState(null)
  const [moreProducts, setMoreProducts] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)

  const products = [...(item.products || []), ...moreProducts]

  async function run(action) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await action()
      await onChange()
    } catch (e) {
      setError(storefrontError(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function history(before = null) {
    try {
      const next = await listStorefrontOrders(item.id, before)
      setOrders((prev) => (before ? [...prev, ...next] : next))
    } catch (e) {
      setError(storefrontError(e))
    }
  }

  function primaryButton() {
    const action = status.primaryAction
    if (!action) return null
    if (action.type === 'edit')
      return (
        <Button variant="primary" onClick={() => setDialog('edit-storefront')}>
          {action.label}
        </Button>
      )
    if (action.type === 'view')
      return (
        <Button as="a" variant="primary" href={`/vitrine/${item.id}`} target="_blank" rel="noopener noreferrer">
          {action.label}
        </Button>
      )
    if (action.type === 'wait') return <Button disabled>{action.label}</Button>
    return (
      <Button variant={action.type === 'contract' ? 'primary' : 'default'} onClick={() => setExpanded(true)}>
        {action.label}
      </Button>
    )
  }

  return (
    <Box
      data-testid={`storefront-card-${item.id}`}
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: 3,
        my: 3,
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}
    >
      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
        {item.logoMediaId ? (
          <StorefrontImage id={item.logoMediaId} alt={item.name} size={64} />
        ) : (
          <Box
            sx={{ width: 64, height: 64, flexShrink: 0, borderRadius: 2, bg: 'canvas.subtle', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            aria-hidden="true"
          >
            <Text sx={{ fontSize: 0, color: 'fg.muted' }}>sem logo</Text>
          </Box>
        )}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Text as="p" sx={{ fontWeight: 'bold', fontSize: 2 }}>
            {item.name}
          </Text>
          <Text as="p" sx={{ fontSize: 0, color: 'fg.muted' }}>
            {item.productCount} produto(s)
          </Text>
          <Label
            variant={BADGE_VARIANT[status.key] || 'default'}
            sx={{ mt: 1, display: 'inline', whiteSpace: 'normal', maxWidth: '100%' }}
          >
            {status.label}
          </Label>
          {status.remainingDays != null && (
            <Text as="p" sx={{ fontSize: 0, mt: 1 }}>
              {status.remainingDays} dia(s) restante(s)
            </Text>
          )}
        </Box>
      </Box>

      {error && (
        <Flash variant="danger" sx={{ mt: 2 }}>
          {error}
        </Flash>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 3 }}>
        {primaryButton()}
        <Button onClick={() => setExpanded((v) => !v)}>{expanded ? 'Ver menos' : 'Ver detalhes'}</Button>
      </Box>

      {expanded && (
        <Box sx={{ mt: 3, pt: 3, borderTop: '1px solid', borderColor: 'border.default' }}>
          {status.detail && <Text as="p">{status.detail}</Text>}
          {status.pendingRevisionNote && (
            <Text as="p" sx={{ color: 'attention.fg' }}>
              {status.pendingRevisionNote}
            </Text>
          )}
          {item.expiresAt && <Text as="p">Vencimento: {commercialDate(item.expiresAt)}</Text>}

          {status.primaryAction?.type === 'contract' && (
            <CommercialLeasePurchase
              key={`${item.id}:${item.revision}`}
              resourceId={item.id}
              resourceName={item.name}
              tariff={tariff}
              expiresAt={item.expiresAt}
              onComplete={onChange}
            />
          )}

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 3 }}>
            <Button disabled={busy} onClick={() => setPreview(true)}>
              Prévia — como seus clientes verão
            </Button>
            <Button disabled={busy} onClick={() => setDialog('edit-storefront')}>
              Editar vitrine
            </Button>
            <Button disabled={busy} onClick={() => setDialog({ kind: 'product', product: null })}>
              Adicionar produto
            </Button>
            {!['submitted', 'suspended', 'approved'].includes(item.editorialState) && (
              <Button disabled={busy} onClick={() => run(() => setStorefrontEditorial(item, 'submitted'))}>
                Enviar para aprovação
              </Button>
            )}
            {item.editorialState !== 'archived' && item.editorialState !== 'suspended' && (
              <Button disabled={busy} onClick={() => run(() => setStorefrontEditorial(item, 'archived'))}>
                Arquivar vitrine
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() => {
                const opening = !showHistory
                setShowHistory(opening)
                if (opening && !orders) history()
              }}
            >
              Histórico de contratações
            </Button>
          </Box>

          {showHistory && (
            <Box sx={{ mt: 3 }}>
              <Heading as="h4" sx={{ fontSize: 2 }}>
                Contratações
              </Heading>
              {orders?.length === 0 && <Text as="p">Nenhuma contratação.</Text>}
              {orders?.map((o) => (
                <Text as="p" key={o.id}>
                  {o.durationDays} dias · {o.totalCash} EvoCash · {orderLabels[o.status] || o.status} ·{' '}
                  {commercialDate(o.periodStart)} → {commercialDate(o.periodEnd)}
                </Text>
              ))}
              {orders?.length > 0 && orders.length % 20 === 0 && (
                <Button onClick={() => history(orders.at(-1).createdAt)}>Mais contratos</Button>
              )}
            </Box>
          )}

          <Heading as="h4" sx={{ fontSize: 2, mt: 3 }}>
            Produtos ({item.productCount})
          </Heading>
          {products.length === 0 && <Text as="p">Nenhum produto ainda.</Text>}
          <Box sx={{ display: 'grid', gap: 3, my: 3 }}>
            {products.map((p) => (
              <Box
                key={p.id}
                sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid', borderColor: 'border.default', pb: 2 }}
              >
                {p.mediaId ? (
                  <StorefrontImage id={p.mediaId} />
                ) : (
                  <Box sx={{ width: 48, height: 48, flexShrink: 0, borderRadius: 2, bg: 'canvas.subtle' }} aria-hidden="true" />
                )}
                <Box sx={{ flex: 1, minWidth: 120 }}>
                  <Text as="p" sx={{ m: 0, fontWeight: 'bold' }}>
                    {p.name || 'Produto em rascunho'}
                  </Text>
                  <Text sx={{ fontSize: 1 }}>
                    {p.priceCentavos ? formatCentavosBRL(Number(p.priceCentavos)) : 'Sem preço'}
                    {!p.mediaId ? ' · Imagem pendente' : ''}
                  </Text>
                </Box>
                <Button disabled={busy} onClick={() => setDialog({ kind: 'product', product: p })}>
                  Editar
                </Button>
                <Button disabled={busy} onClick={() => run(() => archiveStorefrontProduct(item, p.id))}>
                  Arquivar
                </Button>
              </Box>
            ))}
          </Box>
          {products.length < item.productCount && (
            <Button
              onClick={async () => {
                try {
                  const next = await listStorefrontProducts(item.id, products.length)
                  setMoreProducts((prev) => [...prev, ...next])
                } catch (e) {
                  setError(storefrontError(e))
                }
              }}
            >
              Mais produtos
            </Button>
          )}
        </Box>
      )}

      {preview && (
        <Dialog title="Como seus clientes verão" onClose={() => setPreview(false)} width="large">
          <Box sx={{ p: 3, overflowWrap: 'anywhere' }}>
            {item.logoMediaId && <StorefrontImage id={item.logoMediaId} alt={item.name} size={80} />}
            <Heading as="h3" sx={{ fontSize: 2 }}>
              {item.name}
            </Heading>
            <Text as="p">{item.description}</Text>
            <Text as="p">{item.contact}</Text>
            <Text as="p" sx={{ fontSize: 0, color: 'fg.muted' }}>
              Esta prévia não publica nem contrata a vitrine.
            </Text>
            {products.map((product) => (
              <Box key={product.id} sx={{ mb: 3, mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'border.default' }}>
                {product.mediaId && <StorefrontImage id={product.mediaId} size={160} />}
                <Text as="p" sx={{ fontWeight: 'bold' }}>
                  {product.name || 'Produto em rascunho'}
                </Text>
                <Text as="p">{product.description}</Text>
                {product.priceCentavos && <Text as="p">{formatCentavosBRL(Number(product.priceCentavos))}</Text>}
                {product.storeUrl && (
                  <Button as="a" href={product.storeUrl} target="_blank" rel="noopener noreferrer" sx={{ mt: 1 }}>
                    Ver na loja
                  </Button>
                )}
              </Box>
            ))}
          </Box>
        </Dialog>
      )}
      {dialog === 'edit-storefront' && (
        <StorefrontDialog
          storefront={item}
          onCancel={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null)
            await onChange()
          }}
        />
      )}
      {dialog?.kind === 'product' && (
        <ProductDialog
          storefront={item}
          product={dialog.product}
          onCancel={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null)
            await onChange()
          }}
        />
      )}
    </Box>
  )
}
