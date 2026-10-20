import { useEffect, useState } from 'react'
import { supabase } from '../supabase/config'

const empty = { name: '', brand: '', description: '', category: '', image_url: '', store_url: '', sponsored: false, approved: false, starts_at: '', ends_at: '' }
const safeUrl = (value) => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && /\.[a-z]{2,}$/i.test(url.hostname) && !/^[\d.]+$/.test(url.hostname) }
  catch { return false }
}

export default function CommercialAdmin() {
  const [leads, setLeads] = useState([])
  const [products, setProducts] = useState([])
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const [leadResult, productResult] = await Promise.all([
      supabase.from('commercial_leads').select('id,company,contact,email,whatsapp,segment,website,modality,message,status,created_at').order('created_at', { ascending: false }).limit(100),
      supabase.from('partner_products').select('*').order('created_at', { ascending: false }).limit(100),
    ])
    if (leadResult.error || productResult.error) setMessage('Não foi possível carregar os dados comerciais. Confira a migração e suas permissões.')
    else { setLeads(leadResult.data); setProducts(productResult.data); setMessage('') }
  }
  useEffect(() => { refresh() }, [])

  async function changeStatus(id, status) {
    setBusy(true)
    const { error } = await supabase.from('commercial_leads').update({ status }).eq('id', id)
    setBusy(false)
    if (error) setMessage('Não foi possível atualizar o lead.')
    else refresh()
  }

  async function saveProduct(event) {
    event.preventDefault()
    if (!safeUrl(form.store_url) || (form.image_url && !safeUrl(form.image_url))) { setMessage('Use URLs HTTPS válidas, sem credenciais.'); return }
    setBusy(true)
    const payload = Object.fromEntries(Object.keys(empty).map((key) => [key, form[key]]))
    payload.image_url = form.image_url || null
    payload.starts_at = form.starts_at || null
    payload.ends_at = form.ends_at || null
    const { error } = editing
      ? await supabase.from('partner_products').update(payload).eq('id', editing)
      : await supabase.from('partner_products').insert(payload)
    setBusy(false)
    if (error) { setMessage('Não foi possível salvar o produto. Verifique os campos e suas permissões.'); return }
    setForm(empty); setEditing(null); refresh()
  }

  async function removeProduct(id) {
    if (!window.confirm('Excluir este produto da vitrine?')) return
    setBusy(true)
    const { error } = await supabase.from('partner_products').delete().eq('id', id)
    setBusy(false)
    if (error) setMessage('Não foi possível excluir o produto.')
    else refresh()
  }

  return <div className="commercial-admin">
    <p role="status">{message}</p>
    <h2>Propostas comerciais</h2>
    {leads.length === 0 && <p>Nenhuma proposta recebida.</p>}
    {leads.map((lead) => <article key={lead.id} className="commercial-admin-card">
      <h3>{lead.company} · {lead.modality}</h3>
      <p>{lead.contact} · <a href={`mailto:${lead.email}`}>{lead.email}</a>{lead.whatsapp ? ` · ${lead.whatsapp}` : ''}</p>
      <p>{lead.segment} · <a href={lead.website} target="_blank" rel="noopener noreferrer">Site informado ↗</a></p>
      <p>{lead.message}</p>
      <label>Status <select value={lead.status} disabled={busy} onChange={(event) => changeStatus(lead.id, event.target.value)}><option value="novo">Novo</option><option value="em_contato">Em contato</option><option value="encerrado">Encerrado</option></select></label>
    </article>)}
    <h2>Produtos da vitrine</h2>
    <p>Somente produtos aprovados e no período definido aparecem publicamente. A compra ocorre na loja do parceiro.</p>
    <form onSubmit={saveProduct} className="commercial-admin-form">
      {['name', 'brand', 'description', 'category', 'store_url', 'image_url'].map((field) => <label key={field}>{({ name: 'Produto', brand: 'Marca', description: 'Descrição', category: 'Categoria', store_url: 'URL da loja (HTTPS)', image_url: 'URL da imagem (HTTPS, opcional)' })[field]}<input required={field !== 'image_url'} maxLength={field === 'description' ? 500 : field.includes('url') ? 500 : 120} minLength={field === 'description' ? 10 : 2} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })}/></label>)}
      <label>Início (opcional)<input type="datetime-local" value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })}/></label>
      <label>Fim (opcional)<input type="datetime-local" value={form.ends_at} onChange={(event) => setForm({ ...form, ends_at: event.target.value })}/></label>
      <label><input type="checkbox" checked={form.sponsored} onChange={(event) => setForm({ ...form, sponsored: event.target.checked })}/> Patrocinado</label>
      <label><input type="checkbox" checked={form.approved} onChange={(event) => setForm({ ...form, approved: event.target.checked })}/> Aprovado para publicação</label>
      <button type="submit" disabled={busy}>{editing ? 'Salvar alterações' : 'Cadastrar produto'}</button>
      {editing && <button type="button" onClick={() => { setEditing(null); setForm(empty) }}>Cancelar edição</button>}
    </form>
    {products.map((product) => <article key={product.id} className="commercial-admin-card"><h3>{product.name} · {product.brand}</h3><p>{product.approved ? 'Aprovado' : 'Rascunho'} · {product.sponsored ? 'Patrocinado' : 'Editorial'} · {product.category}</p><button type="button" disabled={busy} onClick={() => { setEditing(product.id); setForm({ ...product, starts_at: product.starts_at?.slice(0, 16) || '', ends_at: product.ends_at?.slice(0, 16) || '' }) }}>Editar</button> <button type="button" disabled={busy} onClick={() => removeProduct(product.id)}>Excluir</button></article>)}
  </div>
}
