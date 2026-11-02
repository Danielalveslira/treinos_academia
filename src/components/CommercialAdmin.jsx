import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, Button, Heading, Spinner, Text, UnderlineNav } from '@primer/react'
import { supabase } from '../supabase/config'
import { validatePartnerProduct } from '../utils/validators'
import { useToast } from '../hooks/useToast'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { ToastFlash } from './ToastFlash'
import { listLegacyProducts } from '../services/storefrontService'
import StorefrontMaintenance from './StorefrontMaintenance'
import StorefrontManager from './StorefrontManager'
import { PartnerProductForm } from './PartnerProductForm'
import { PartnerProductList } from './PartnerProductList'

const empty = {
  name: '',
  brand: '',
  description: '',
  category: '',
  image_url: '',
  store_url: '',
  sponsored: false,
  approved: false,
  starts_at: '',
  ends_at: '',
}
// store_url/image_url/ends_at usam nomes diferentes em validatePartnerProduct
// (storeUrl/imageUrl/endsAt) -- este mapa só traduz as chaves de erro de volta pros
// campos do formulário (que seguem o nome das colunas de partner_products).
const ERROR_KEY_BY_FIELD = { store_url: 'storeUrl', image_url: 'imageUrl', ends_at: 'endsAt' }

// As três categorias têm regras e donos de dados diferentes (leads de contato,
// vitrines modernas com direito de publicação, cadastros administrativos antigos) --
// nunca devem aparecer misturadas na mesma tela sem distinção.
const SUB_TABS = [
  ['leads', 'Propostas comerciais'],
  ['storefronts', 'Vitrines de produtos'],
  ['legacy', 'Produtos legados'],
]

export default function CommercialAdmin() {
  const [params, setParams] = useSearchParams()
  const sub = SUB_TABS.some(([key]) => key === params.get('sub')) ? params.get('sub') : 'leads'
  const [leads, setLeads] = useState([])
  const [products, setProducts] = useState([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [hasMoreProducts, setHasMoreProducts] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [form, setForm] = useState(empty)
  const [legacyTarget, setLegacyTarget] = useState(null)
  const [editing, setEditing] = useState(null)
  const [productErrors, setProductErrors] = useState({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const { toasts, showToast } = useToast()
  const confirmDelete = useConfirmDelete()

  async function refreshLeads() {
    const { data, error } = await supabase
      .from('commercial_leads')
      .select(
        'id,company,contact,email,whatsapp,segment,website,modality,message,status,created_at'
      )
      .order('created_at', { ascending: false })
      .limit(100)
    if (error)
      setMessage('Não foi possível carregar as propostas. Confira a migração e suas permissões.')
    else {
      setLeads(data)
      setMessage('')
    }
  }
  async function refreshProducts() {
    setProductsLoading(true)
    try {
      const data = await listLegacyProducts()
      setProducts(data)
      setHasMoreProducts(data.length === 20)
      setMessage('')
    } catch {
      setMessage(
        'Não foi possível carregar os produtos legados. Confira a migração e suas permissões.'
      )
    } finally {
      setProductsLoading(false)
    }
  }
  // Cada categoria carrega só quando é aberta -- a página nunca busca as três de uma vez.
  useEffect(() => {
    setMessage('')
    if (sub === 'leads') refreshLeads()
    else if (sub === 'legacy') refreshProducts()
  }, [sub])

  async function changeStatus(id, status) {
    setBusy(true)
    const { error } = await supabase.from('commercial_leads').update({ status }).eq('id', id)
    setBusy(false)
    if (error) setMessage('Não foi possível atualizar o lead.')
    else refreshLeads()
  }

  function onFieldChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    const errorKey = ERROR_KEY_BY_FIELD[field] || field
    setProductErrors((prev) => (prev[errorKey] ? { ...prev, [errorKey]: undefined } : prev))
  }

  function cancelEdit() {
    setEditing(null)
    setForm(empty)
    setProductErrors({})
  }

  function startEdit(product) {
    setEditing(product.id)
    // image_url é a única coluna de texto opcional (nullable) de partner_products que o
    // formulário controla direto por valor -- produtos legados sem imagem chegam aqui com
    // null, e PartnerProductForm chama .trim() nela para montar a prévia. Normaliza pra ''
    // igual já se fazia com starts_at/ends_at, pra abrir/cancelar nunca derrubar a rota.
    setForm({
      ...product,
      image_url: product.image_url || '',
      starts_at: product.starts_at?.slice(0, 16) || '',
      ends_at: product.ends_at?.slice(0, 16) || '',
    })
    setProductErrors({})
  }

  async function saveProduct(event) {
    event.preventDefault()
    // Imagem é obrigatória para todo cadastro novo e para qualquer publicação (approved),
    // mesmo editando um produto legado sem imagem -- espelha o trigger
    // enforce_partner_product_image (autoridade final no servidor).
    const requireImage = !editing || form.approved
    const validationErrors = validatePartnerProduct({
      name: form.name,
      brand: form.brand,
      category: form.category,
      description: form.description,
      storeUrl: form.store_url,
      imageUrl: form.image_url,
      startsAt: form.starts_at,
      endsAt: form.ends_at,
      requireImage,
    })
    setProductErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) return

    setBusy(true)
    const payload = Object.fromEntries(Object.keys(empty).map((key) => [key, form[key]]))
    payload.image_url = form.image_url || null
    payload.starts_at = form.starts_at || null
    payload.ends_at = form.ends_at || null
    const { error } = editing
      ? await supabase.from('partner_products').update(payload).eq('id', editing)
      : await supabase.from('partner_products').insert(payload)
    setBusy(false)
    if (error) {
      showToast(
        'Não foi possível salvar o produto. Verifique os campos e suas permissões.',
        'danger'
      )
      return
    }
    showToast(editing ? 'Produto atualizado.' : 'Produto cadastrado.')
    setForm(empty)
    setEditing(null)
    setProductErrors({})
    refreshProducts()
  }

  async function removeProduct(product) {
    const confirmed = await confirmDelete({
      title: `Excluir "${product.name}"?`,
      content: 'O produto deixa de aparecer imediatamente na Vitrine pública.',
    })
    if (!confirmed) return
    setBusy(true)
    const { error } = await supabase.from('partner_products').delete().eq('id', product.id)
    setBusy(false)
    if (error) {
      showToast('Não foi possível excluir o produto.', 'danger')
      return
    }
    showToast('Produto excluído.')
    if (editing === product.id) cancelEdit()
    refreshProducts()
  }

  function selectSub(key) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('sub', key)
        return next
      },
      { replace: true }
    )
  }

  return (
    <div className="commercial-admin">
      <p role="status">{message}</p>
      <UnderlineNav aria-label="Categorias comerciais">
        {SUB_TABS.map(([key, label]) => (
          <UnderlineNav.Item
            key={key}
            as="button"
            aria-current={sub === key ? 'page' : undefined}
            onSelect={() => selectSub(key)}
          >
            {label}
          </UnderlineNav.Item>
        ))}
      </UnderlineNav>
      {sub === 'leads' && (
        <>
          <h2>Propostas comerciais</h2>
          {leads.length === 0 && <p>Nenhuma proposta recebida.</p>}
          {leads.map((lead) => (
            <article key={lead.id} className="commercial-admin-card">
              <h3>
                {lead.company} · {lead.modality}
              </h3>
              <p>
                {lead.contact} · <a href={`mailto:${lead.email}`}>{lead.email}</a>
                {lead.whatsapp ? ` · ${lead.whatsapp}` : ''}
              </p>
              <p>
                {lead.segment} ·{' '}
                {lead.website ? (
                  <a href={lead.website} target="_blank" rel="noopener noreferrer">
                    Site informado ↗
                  </a>
                ) : (
                  'Site não informado'
                )}
              </p>
              <p>{lead.message}</p>
              <label>
                Status{' '}
                <select
                  value={lead.status}
                  disabled={busy}
                  onChange={(event) => changeStatus(lead.id, event.target.value)}
                >
                  <option value="novo">Novo</option>
                  <option value="em_contato">Em contato</option>
                  <option value="encerrado">Encerrado</option>
                </select>
              </label>
            </article>
          ))}
        </>
      )}

      {sub === 'storefronts' && (
        <Box sx={{ mt: 3 }}>
          <StorefrontManager admin />
          <StorefrontMaintenance
            legacy={legacyTarget}
            onCloseLegacy={() => setLegacyTarget(null)}
            onAssociated={refreshProducts}
          />
        </Box>
      )}

      {sub === 'legacy' && (
        <Box sx={{ mt: 3 }}>
          <Heading as="h2" sx={{ fontSize: 2, mb: 3 }}>
            Produtos legados (somente administração)
          </Heading>
          <Text as="p" sx={{ color: 'fg.muted' }}>
            Registros administrativos anteriores ao modelo atual de vitrines, preservados por
            compatibilidade. Novos cadastros comerciais usam Vitrines de produtos.
          </Text>

          <ToastFlash toasts={toasts} />

          <PartnerProductForm
            form={form}
            errors={productErrors}
            editing={Boolean(editing)}
            requireImage={!editing || form.approved}
            busy={busy}
            onFieldChange={onFieldChange}
            onSubmit={saveProduct}
            onCancel={cancelEdit}
          />

          {productsLoading ? (
            <Spinner sx={{ display: 'block', mx: 'auto', my: 4 }} />
          ) : (
            <PartnerProductList
              products={products}
              busy={busy}
              onEdit={startEdit}
              onDelete={removeProduct}
              onAssociate={(product) =>
                setLegacyTarget({ ...product, requestId: crypto.randomUUID() })
              }
            />
          )}
          {hasMoreProducts && (
            <Button
              disabled={loadingMore || busy}
              onClick={async () => {
                setLoadingMore(true)
                try {
                  const next = await listLegacyProducts(products.at(-1).id)
                  setProducts((prev) => [...prev, ...next])
                  setHasMoreProducts(next.length === 20)
                } catch {
                  setMessage('Não foi possível carregar mais registros legados.')
                } finally {
                  setLoadingMore(false)
                }
              }}
            >
              Mais produtos legados
            </Button>
          )}
        </Box>
      )}
    </div>
  )
}
