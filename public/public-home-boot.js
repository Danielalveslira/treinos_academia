// The static Home stays immediate for visitors. A stored session is only a hint:
// keep Home out of view until the Supabase client verifies it with the server.
;(() => {
  const script = document.currentScript
  const ref = script?.dataset.authRef
  const redirectSrc = script?.dataset.redirectSrc
  let checking = false
  let slowTimer

  function hasCandidate() {
    try {
      return Boolean(ref && localStorage.getItem(`sb-${ref}-auth-token`))
    } catch {
      return false
    }
  }

  function release() {
    clearTimeout(slowTimer)
    document.getElementById('home-auth-wait')?.remove()
    document.documentElement.classList.remove('home-auth-pending')
  }
  window.evolutusReleaseHomeAuth = release

  function showSlowState() {
    if (!checking || location.pathname !== '/' || !document.body) return
    const panel = document.createElement('div')
    panel.id = 'home-auth-wait'
    panel.setAttribute('role', 'status')
    const message = document.createElement('p')
    message.textContent = 'Verificando seu acesso. A conexão pode estar lenta.'
    const appLink = document.createElement('a')
    appLink.href = '/app'
    appLink.textContent = 'Abrir aplicativo'
    panel.append(message, appLink)
    document.body.append(panel)
  }

  window.evolutusCheckHomeAuth = function checkHomeAuth() {
    if (location.pathname !== '/' || checking) return
    if (!hasCandidate() || navigator.onLine === false) {
      release()
      return
    }
    document.documentElement.classList.add('home-auth-pending')
    checking = true
    slowTimer = setTimeout(showSlowState, 8000)
    import(redirectSrc)
      .then(() => window.evolutusRedirectHome())
      .catch(release)
      .finally(() => {
        clearTimeout(slowTimer)
        checking = false
      })
  }

  window.evolutusCheckHomeAuth()
})()
