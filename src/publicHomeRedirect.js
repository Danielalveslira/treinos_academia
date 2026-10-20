import { supabase } from './supabase/config'

// The static homepage remains complete for visitors and crawlers. This entry only
// runs on / and uses the same Supabase client and persisted session as the app.
async function redirectSignedInVisitor() {
  let redirected = false
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    if (!sessionError && sessionData.session) {
      // getSession reads local storage; getUser checks that the session is still valid.
      const { data, error } = await supabase.auth.getUser()
      if (!error && data.user) {
        redirected = true
        window.location.replace('/app')
      }
    }
  } catch {
    // Offline or unavailable auth: show the public page.
  } finally {
    if (!redirected) document.documentElement.classList.remove('home-auth-pending')
  }
}

redirectSignedInVisitor()
