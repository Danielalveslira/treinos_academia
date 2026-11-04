let mountedForm = null
let cleanup = null

const messages = {
  company: 'Informe o nome da empresa (2 a 120 caracteres).',
  contact: 'Informe o nome do responsável (2 a 120 caracteres).',
  email: 'Informe um e-mail válido.',
  segment: 'Informe o segmento do negócio (2 a 80 caracteres).',
  modality: 'Selecione uma opção de divulgação.',
  message: 'Escreva uma mensagem com 20 a 2.000 caracteres.',
  whatsapp: 'Use apenas números, espaços, +, parênteses e hífen (até 30 caracteres).',
  website: 'Informe um endereço HTTPS válido, como https://exemplo.com.br.',
}

const setError = (form, name, message = '') => {
  const control = form.elements.namedItem(name)
  const label = form.querySelector(`#lead-${name}-error`)
  if (!control || !label) return
  label.textContent = message
  if (message) control.setAttribute('aria-invalid', 'true')
  else control.removeAttribute('aria-invalid')
}

const validWebsite = (value) => {
  if (!value) return true
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::[0-9]+)?(?:[/?#][^\s]*)?$/i.test(value)) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const validate = (form) => {
  const value = (name) => form.elements.namedItem(name).value.trim()
  const invalid = {
    company: value('company').length < 2 || value('company').length > 120,
    contact: value('contact').length < 2 || value('contact').length > 120,
    email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('email')) || value('email').length > 254,
    segment: value('segment').length < 2 || value('segment').length > 80,
    modality: !['Publicidade', 'Vitrine de produtos', 'Ambos'].includes(value('modality')),
    message: value('message').length < 20 || value('message').length > 2000,
    whatsapp:
      !!value('whatsapp') &&
      (value('whatsapp').length > 30 || !/^[+() 0-9-]+$/.test(value('whatsapp'))),
    website: value('website').length > 500 || !validWebsite(value('website')),
  }
  for (const [name, failed] of Object.entries(invalid))
    setError(form, name, failed ? messages[name] : '')
  const first = Object.keys(invalid).find((name) => invalid[name])
  if (first === 'whatsapp' || first === 'website')
    form.querySelector('.business-optional').open = true
  if (first) form.elements.namedItem(first).focus()
  return !first
}

export function mountCommercialLeadForm() {
  const form = document.getElementById('commercial-lead-form')
  if (!form || form === mountedForm) return
  cleanup?.()
  mountedForm = form
  const status = form.querySelector('#commercial-lead-status')
  const button = form.querySelector('.business-submit')
  let pending = false
  let active = true

  const clearField = (event) => {
    const name = event.target.name
    if (name in messages) setError(form, name)
    if (status.dataset.state === 'error') {
      status.textContent = ''
      delete status.dataset.state
    }
  }
  const submit = async (event) => {
    event.preventDefault()
    if (pending || !validate(form)) return
    pending = true
    button.disabled = true
    button.textContent = 'Enviando…'
    status.textContent = 'Enviando proposta…'
    delete status.dataset.state
    const value = (name) => form.elements.namedItem(name).value.trim()
    const payload = {
      p_company: value('company'),
      p_contact: value('contact'),
      p_email: value('email'),
      p_segment: value('segment'),
      p_modality: value('modality'),
      p_message: value('message'),
      p_whatsapp: value('whatsapp') || null,
      p_website: value('website'),
      p_honeypot: value('honeypot'),
    }
    try {
      const { supabase } = await import('../../supabase/config')
      const { error } = await supabase.rpc('submit_commercial_lead', payload)
      if (!active) return
      if (error) {
        status.textContent =
          error.code === 'P0001'
            ? 'Limite de propostas atingido. Tente novamente mais tarde.'
            : error.code === '22023'
              ? 'Confira os dados informados e tente novamente.'
              : 'Não foi possível enviar a proposta. Tente novamente em instantes.'
        status.dataset.state = 'error'
        return
      }
      form.reset()
      form.querySelector('.business-optional').open = false
      status.textContent = 'Proposta enviada. Nossa equipe avaliará sua solicitação.'
      status.dataset.state = 'success'
      status.focus?.()
    } catch {
      if (!active) return
      status.textContent =
        'Não foi possível enviar a proposta. Verifique sua conexão e tente novamente.'
      status.dataset.state = 'error'
    } finally {
      pending = false
      if (active) {
        button.disabled = false
        button.textContent = 'Enviar proposta'
      }
    }
  }
  form.addEventListener('submit', submit)
  form.addEventListener('input', clearField)
  form.addEventListener('change', clearField)
  button.disabled = false
  form.dataset.ready = 'true'
  cleanup = () => {
    active = false
    button.disabled = true
    delete form.dataset.ready
    form.removeEventListener('submit', submit)
    form.removeEventListener('input', clearField)
    form.removeEventListener('change', clearField)
    if (mountedForm === form) mountedForm = null
  }
}

document.addEventListener('turbo:before-render', () => cleanup?.())
