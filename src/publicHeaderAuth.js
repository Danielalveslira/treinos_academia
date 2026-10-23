import { supabase } from './supabase/config'

// Cabeçalho público (nav em scripts/public-pages-template.mjs) é o mesmo HTML estático
// reaproveitado por /vitrine, /como-funciona, /para-empresas e /profissionais -- este
// módulo só alterna a aparência DESSE cabeçalho conforme a sessão já persistida pelo
// client único do app (../supabase/config), sem outro estado de login nem outro client.
// A Home fica fora (não é incluída pelo template pra path === '/'): ela já tem seu próprio
// redirecionamento completo (publicHomeRedirect.js) e nunca chega a exibir o cabeçalho de
// visitante pra quem está logado.
function applyAuthUI(authenticated) {
  document.documentElement.setAttribute('data-public-auth', authenticated ? 'authed' : 'guest')
  // PublicHeaderMenu.jsx (ilha React do menu mobile) lê o mesmo estado via este evento,
  // igual ao padrão já usado por boot-public-theme.js com 'public-theme-change'.
  window.dispatchEvent(new CustomEvent('public-auth-change', { detail: { authenticated } }))
}

async function syncHeaderAuth() {
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !sessionData.session) {
      applyAuthUI(false)
      return
    }
    // getSession só lê a sessão persistida local; getUser confirma que ela ainda é válida
    // no servidor (mesmo padrão de publicHomeRedirect.js) -- nenhum token chega ao DOM.
    const { data: userData, error: userError } = await supabase.auth.getUser()
    applyAuthUI(!userError && Boolean(userData.user))
  } catch {
    // Offline ou Supabase indisponível: mantém o cabeçalho de visitante (estado seguro).
    applyAuthUI(false)
  }
}

// O módulo persiste entre navegações Turbo (o cabeçalho é data-turbo-permanent e o script
// não é recarregado) -- a flag evita inscrever onAuthStateChange mais de uma vez; o
// listener de turbo:load resincroniza a cada navegação entre páginas públicas.
if (!window.__publicHeaderAuthBound) {
  window.__publicHeaderAuthBound = true
  syncHeaderAuth()
  supabase.auth.onAuthStateChange((_event, session) => applyAuthUI(Boolean(session?.user)))
  document.addEventListener('turbo:load', syncHeaderAuth)
}
