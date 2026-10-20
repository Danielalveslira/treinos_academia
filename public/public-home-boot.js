// Runs in the head before paint. Visitors without a stored session load no auth bundle.
try {
  const script = document.currentScript
  const ref = script.dataset.authRef
  if (ref && localStorage.getItem(`sb-${ref}-auth-token`)) {
    document.documentElement.classList.add('home-auth-pending')
    const redirect = document.createElement('script')
    redirect.type = 'module'
    redirect.src = script.dataset.redirectSrc
    document.head.append(redirect)
    setTimeout(() => document.documentElement.classList.remove('home-auth-pending'), 5000)
  }
} catch {
  document.documentElement.classList.remove('home-auth-pending')
}
