import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  Flash,
  FormControl,
  Heading,
  Label,
  Spinner,
  Text,
  TextInput,
  Textarea,
} from '@primer/react'
import {
  ArchiveIcon,
  ClockIcon,
  EyeIcon,
  PlusIcon,
  RocketIcon,
  ShieldLockIcon,
  SyncIcon,
} from '@primer/octicons-react'
import {
  listStorefronts,
  saveStorefront,
  saveStorefrontProduct,
  archiveStorefrontProduct,
  setStorefrontEditorial,
  listStorefrontOrders,
  listStorefrontProducts,
  setStorefrontLimits,
  uploadStorefrontImage,
  discardStorefrontImage,
  isStorefrontImageLinked,
} from '../../services/storefrontService'
import { saveWithImage } from '../../utils/storefrontImageSave'
import { reauthenticatePricingAdmin } from '../../services/evocashPricingService'
import { AuthCaptcha } from '../AuthCaptcha'
import { authCaptchaRequired, takeCaptchaToken } from '../../utils/authCaptcha'
import { editorialLabels, publicationLabels, storefrontError } from '../../utils/storefront'
import { commercialDate } from '../../utils/commercial'
import StorefrontImage from '../StorefrontImage'
import { RowActionsMenu } from '../RowActionsMenu'

// Administrative moderation, limits and the raw technical view over product storefronts.
// Kept intentionally close to its pre-refactor shape: the owner-facing experience was
// extracted into OwnerStorefrontView.jsx, but every admin power (moderation, limits,
// audit, technical IDs) here is unchanged, including behaviors that were never gated by
// an explicit `admin` check before (submit/archive/history/public-link buttons) — this
// view does not newly restrict anything the admin could already do.
const orderLabels = { quoted: 'Cotação', fulfilled: 'Contratado', reversed: 'Revertido' }
const emptyProduct = {
  name: '',
  brand: '',
  category: '',
  description: '',
  storeUrl: '',
  mediaId: null,
  priceCentavos: '',
  displayOrder: 0,
}
export default function AdminStorefrontView() {
  const [preview, setPreview] = useState(false)
  const [data, setData] = useState(null),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [dialog, setDialog] = useState(null),
    [form, setForm] = useState({}),
    [file, setFile] = useState(null),
    [orders, setOrders] = useState(null),
    [moreProducts, setMoreProducts] = useState([]),
    [reason, setReason] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(false)
  const lock = useRef(false),
    request = useRef(0)
  const captcha = useRef(null)
  const [captchaVerified, setCaptchaVerified] = useState(!authCaptchaRequired)
  const item = data?.items.find((s) => s.id === selected)
  async function load(before = null) {
    const revision = ++request.current
    setLoading(true)
    try {
      const next = await listStorefronts(true, before)
      if (revision !== request.current) return
      setData(next)
      setError('')
      setMoreProducts([])
    } catch (e) {
      if (revision === request.current) setError(storefrontError(e))
    } finally {
      if (revision === request.current) setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])
  function open(kind, values = {}) {
    setDialog({ kind, requestId: crypto.randomUUID() })
    setForm({ ...values })
    setFile(null)
    setError('')
    setReason('')
    setPassword('')
    setConfirm(false)
  }
  async function action(fn) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await fn()
      setDialog(null)
      setPassword('')
      setOrders(null)
      await load()
    } catch (e) {
      setError(storefrontError(e))
    } finally {
      captcha.current?.reset()
      lock.current = false
      setBusy(false)
    }
  }
  async function save() {
    await action(async () => {
      if (dialog.kind === 'limits') {
        await reauthenticatePricingAdmin(password, takeCaptchaToken(captcha))
        await setStorefrontLimits(form, data.limits.revision, reason, confirm)
      } else if (dialog.kind === 'moderate') {
        await reauthenticatePricingAdmin(password, takeCaptchaToken(captcha))
        await setStorefrontEditorial(item, form.targetState, reason)
      } else {
        const product = dialog.kind !== 'storefront'
        await saveWithImage({
          file,
          upload: (image) => uploadStorefrontImage(item.id, image),
          save: (uploaded) =>
            product
              ? saveStorefrontProduct(item, { ...form, mediaId: uploaded || form.mediaId })
              : saveStorefront(item, { ...form, logoMediaId: uploaded || form.logoMediaId }),
          isLinked: (id) => isStorefrontImageLinked(item.id, id, { admin: true, product }),
          discard: discardStorefrontImage,
          previousMediaId: product ? form.mediaId : form.logoMediaId,
        })
      }
    })
  }
  async function history(before = null) {
    try {
      const next = await listStorefrontOrders(item.id, before)
      setOrders((prev) => (before ? [...prev, ...next] : next))
    } catch (e) {
      setError(storefrontError(e))
    }
  }
  const products = [...(item?.products || []), ...moreProducts]
  return (
    <Box sx={{ minWidth: 0 }}>
      <Heading as="h2" sx={{ fontSize: 3 }}>
        Moderação de vitrines de produtos
      </Heading>
      <Text as="p">
        Prepare gratuitamente. A publicação exige aprovação e contratação vigente em EvoCash.
      </Text>
      {import.meta.env.DEV && import.meta.env.VITE_FINANCE_LOCAL_PREVIEW === 'true' && (
        <Flash sx={{ my: 2 }}>Ambiente isolado · dados e pagamentos sintéticos.</Flash>
      )}
      {error && (
        <Flash variant="danger" sx={{ my: 3 }}>
          {error}
        </Flash>
      )}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', my: 3 }}>
        <Button disabled={busy || loading} onClick={() => load()}>
          Atualizar vitrines
        </Button>
        <Button onClick={() => open('limits', data?.limits || {})}>Configurar limites</Button>
      </Box>
      {loading ? (
        <Spinner aria-label="Carregando vitrines" />
      ) : (
        <>
          {!data?.items.length && <Text as="p">Nenhuma vitrine cadastrada.</Text>}
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
            {data?.items.map((s) => (
              <Button
                key={s.id}
                aria-pressed={selected === s.id}
                onClick={() => {
                  setSelected(s.id)
                  setOrders(null)
                  setMoreProducts([])
                }}
              >
                {s.name}
              </Button>
            ))}
          </Box>
          {data?.nextCursor && (
            <Button
              disabled={busy}
              onClick={() => {
                setSelected(null)
                load(data.nextCursor)
              }}
            >
              Mais vitrines
            </Button>
          )}
          {item && (
            <Box
              sx={{
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: 'border.default',
                borderRadius: 2,
                p: 3,
                overflowWrap: 'anywhere',
              }}
            >
              <StorefrontImage id={item.logoMediaId} alt={item.name} />
              <Heading as="h3" sx={{ fontSize: 2 }}>
                {item.name}
              </Heading>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', my: 2 }}>
                <Label>{editorialLabels[item.editorialState]}</Label>
                <Label>{publicationLabels[item.publicationState]}</Label>
              </Box>
              <Text as="p">
                Proprietário: {item.ownerUserId} · ID da vitrine: {item.id}
              </Text>
              <Text as="p">
                Revisão em edição: {item.revision} · versão pública:{' '}
                {item.publishedRevision || 'ainda não aprovada'}.
              </Text>
              <Text as="p">{item.description}</Text>
              <Text as="p">{item.contact}</Text>
              {item.expiresAt && (
                <Text as="p">
                  Vencimento: {commercialDate(item.expiresAt)} ·{' '}
                  {Math.ceil(Number(item.remainingSeconds || 0) / 86400)} dias restantes.
                </Text>
              )}
              {item.lastDecision && <Text as="p">Última decisão: {item.lastDecision}</Text>}
              <Text as="p">
                A última versão aprovada continua pública durante a revisão das alterações, enquanto
                o contrato estiver vigente.
              </Text>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3, alignItems: 'center' }}>
                <Button disabled={busy} onClick={() => open('storefront', item)}>
                  Editar vitrine
                </Button>
                {item.publicationState === 'active' && (
                  <Button as="a" href={`/vitrine/${item.id}`}>
                    Ver vitrine pública
                  </Button>
                )}
                <RowActionsMenu
                  disabled={busy}
                  actions={[
                    {
                      key: 'preview',
                      label: 'Prévia privada',
                      icon: EyeIcon,
                      onSelect: () => setPreview(true),
                    },
                    {
                      key: 'add-product',
                      label: 'Adicionar produto',
                      icon: PlusIcon,
                      onSelect: () => open('product', emptyProduct),
                    },
                    ...(!['submitted', 'suspended', 'approved'].includes(item.editorialState)
                      ? [
                          {
                            key: 'submit',
                            label: 'Enviar para aprovação',
                            icon: RocketIcon,
                            onSelect: () => action(() => setStorefrontEditorial(item, 'submitted')),
                          },
                        ]
                      : []),
                    {
                      key: 'history',
                      label: 'Histórico de contratações',
                      icon: ClockIcon,
                      onSelect: () => history(),
                    },
                    item.editorialState === 'suspended'
                      ? {
                          key: 'resume',
                          label: 'Retomar vitrine',
                          icon: SyncIcon,
                          onSelect: () => open('moderate', { targetState: 'draft' }),
                        }
                      : {
                          key: 'suspend',
                          label: 'Suspender vitrine',
                          icon: ShieldLockIcon,
                          variant: 'danger',
                          onSelect: () => open('moderate', { targetState: 'suspended' }),
                        },
                    ...(item.editorialState !== 'archived' && item.editorialState !== 'suspended'
                      ? [
                          {
                            key: 'archive',
                            label: 'Arquivar vitrine',
                            icon: ArchiveIcon,
                            variant: 'danger',
                            onSelect: () => action(() => setStorefrontEditorial(item, 'archived')),
                          },
                        ]
                      : []),
                  ]}
                />
              </Box>
              <Heading as="h4" sx={{ fontSize: 2 }}>
                Produtos ({item.productCount})
              </Heading>
              <Box sx={{ display: 'grid', gap: 3, my: 3 }}>
                {products.map((p) => (
                  <Box
                    key={p.id}
                    sx={{
                      display: 'flex',
                      gap: 2,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      borderBottom: '1px solid',
                      borderColor: 'border.default',
                      pb: 2,
                    }}
                  >
                    <StorefrontImage id={p.mediaId} />
                    <Box sx={{ flex: 1, minWidth: 120 }}>
                      <Text as="p" sx={{ m: 0, fontWeight: 'bold' }}>
                        {p.name || 'Produto em rascunho'}
                      </Text>
                      <Text sx={{ fontSize: 1 }}>
                        {p.brand} · {p.category}
                        {!p.mediaId ? ' · Imagem pendente' : ''}
                      </Text>
                    </Box>
                    <Button disabled={busy} onClick={() => open('product', p)}>
                      Editar produto
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => action(() => archiveStorefrontProduct(item, p.id))}
                    >
                      Arquivar produto
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
              {orders && (
                <Box sx={{ mt: 3 }}>
                  <Heading as="h4" sx={{ fontSize: 2 }}>
                    Contratações
                  </Heading>
                  {!orders.length && <Text as="p">Nenhuma contratação.</Text>}
                  {orders.map((o) => (
                    <Text as="p" key={o.id}>
                      {o.id} · {o.durationDays} dias · {o.totalCash} EvoCash ·{' '}
                      {orderLabels[o.status] || o.status} · {commercialDate(o.periodStart)} →{' '}
                      {commercialDate(o.periodEnd)}
                    </Text>
                  ))}
                  {orders.length > 0 && orders.length % 20 === 0 && (
                    <Button onClick={() => history(orders.at(-1).createdAt)}>Mais contratos</Button>
                  )}
                </Box>
              )}
              <Text as="p">
                Preços, publicações contratadas, pagamentos e histórico de operações permanecem em
                Preços e contratações.
              </Text>
            </Box>
          )}
        </>
      )}
      {preview && item && (
        <Dialog title="Prévia privada da vitrine" onClose={() => setPreview(false)} width="large">
          <Box sx={{ p: 3, overflowWrap: 'anywhere' }}>
            <Heading as="h3" sx={{ fontSize: 2 }}>
              {item.name}
            </Heading>
            <Text as="p">{item.description}</Text>
            <Text as="p">{item.contact}</Text>
            <Text as="p">Esta prévia não publica nem contrata a vitrine.</Text>
            {products.map((product) => (
              <Box key={product.id} sx={{ mb: 3 }}>
                <StorefrontImage id={product.mediaId} size={160} />
                <Text as="h4">{product.name || 'Produto em rascunho'}</Text>
                <Text as="p">{product.description}</Text>
                {product.priceCentavos && (
                  <Text as="p">
                    R$ {(BigInt(product.priceCentavos) / 100n).toString()},
                    {(BigInt(product.priceCentavos) % 100n).toString().padStart(2, '0')}
                  </Text>
                )}
              </Box>
            ))}
          </Box>
        </Dialog>
      )}
      {dialog && (
        <Dialog
          title={
            dialog.kind === 'product'
              ? 'Produto da vitrine'
              : dialog.kind === 'moderate'
                ? form.targetState === 'draft'
                  ? 'Retomar vitrine'
                  : 'Suspender vitrine'
                : dialog.kind === 'limits'
                  ? 'Limites comerciais'
                  : 'Dados da vitrine'
          }
          onClose={() => {
            if (!busy) {
              setDialog(null)
              setPassword('')
            }
          }}
          width="large"
        >
          <Box
            as="form"
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
            sx={{ p: 3 }}
          >
            {dialog.kind === 'moderate' ? (
              <Text as="p">
                {form.targetState === 'draft'
                  ? 'A vitrine volta ao fluxo normal. Aprovação e publicação continuam exigindo revisão e contratação vigentes, feitas na Central de Aprovações.'
                  : 'A vitrine deixa de ficar disponível para novas aprovações e publicação até ser retomada. Aprovar ou reprovar o conteúdo enviado continua na Central de Aprovações.'}
              </Text>
            ) : dialog.kind === 'limits' ? (
              <>
                {[
                  ['maxProducts', 'Produtos por vitrine'],
                  ['maxStorefronts', 'Vitrines por proprietário'],
                ].map(([key, label]) => (
                  <FormControl key={key} sx={{ mb: 2 }}>
                    <FormControl.Label>{label}</FormControl.Label>
                    <TextInput
                      block
                      inputMode="numeric"
                      value={form[key] ?? ''}
                      onChange={(e) => {
                        setForm({ ...form, [key]: e.target.value })
                        setConfirm(false)
                      }}
                    />
                  </FormControl>
                ))}
              </>
            ) : (
              <>
                {(dialog.kind === 'product'
                  ? [
                      ['name', 'Nome do produto', 120],
                      ['brand', 'Marca', 120],
                      ['category', 'Categoria', 80],
                      ['description', 'Descrição do produto', 500],
                      ['storeUrl', 'URL da loja', 500],
                      ['priceCentavos', 'Preço em centavos (opcional)', 12],
                      ['displayOrder', 'Ordem de exibição', 5],
                    ]
                  : [
                      ['name', 'Nome comercial', 120],
                      ['description', 'Descrição da vitrine', 1000],
                      ['contact', 'Contato público', 300],
                    ]
                ).map(([key, label, max]) => (
                  <FormControl key={key} sx={{ mb: 2 }}>
                    <FormControl.Label>{label}</FormControl.Label>
                    {key === 'description' ? (
                      <Textarea
                        block
                        maxLength={max}
                        value={form[key] ?? ''}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      />
                    ) : (
                      <TextInput
                        block
                        maxLength={max}
                        value={form[key] ?? ''}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      />
                    )}
                  </FormControl>
                ))}
                <FormControl sx={{ my: 2 }}>
                  <FormControl.Label>
                    {dialog.kind === 'product'
                      ? 'Imagem do produto'
                      : 'Logotipo da vitrine (opcional)'}
                  </FormControl.Label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setFile(e.target.files[0] || null)}
                    style={{ maxWidth: '100%' }}
                  />
                  <FormControl.Caption>
                    Imagem otimizada antes do envio; rascunhos podem ficar sem imagem.
                  </FormControl.Caption>
                </FormControl>
                <StorefrontImage id={form.mediaId || form.logoMediaId} />
              </>
            )}
            {['moderate', 'limits'].includes(dialog.kind) && (
              <>
                <FormControl sx={{ my: 2 }}>
                  <FormControl.Label>Motivo obrigatório</FormControl.Label>
                  <Textarea
                    block
                    maxLength={500}
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value)
                      setConfirm(false)
                    }}
                  />
                </FormControl>
                <FormControl>
                  <FormControl.Label>Confirme sua senha</FormControl.Label>
                  <TextInput
                    block
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </FormControl>
                <AuthCaptcha ref={captcha} onVerifiedChange={setCaptchaVerified} />
                <FormControl sx={{ my: 2 }}>
                  <Checkbox checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                  <FormControl.Label>Confirmo esta alteração auditada</FormControl.Label>
                </FormControl>
              </>
            )}
            {error && (
              <Flash variant="danger" sx={{ my: 2 }}>
                {error}
              </Flash>
            )}
            <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
              <Button
                disabled={busy}
                onClick={() => {
                  setDialog(null)
                  setPassword('')
                }}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  busy ||
                  (['moderate', 'limits'].includes(dialog.kind) &&
                    (!confirm || !password || !captchaVerified || reason.trim().length < 5))
                }
              >
                {busy ? 'Salvando…' : 'Salvar'}
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}
    </Box>
  )
}
