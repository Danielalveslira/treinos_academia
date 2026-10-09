import { createClient } from '@supabase/supabase-js'
import { observeServerDate } from '../utils/serverClock'

// fetch próprio só para ler o cabeçalho `Date` de cada resposta (ver utils/serverClock.js). Nunca altera
// requisição nem resposta; qualquer falha na leitura é ignorada.
async function fetchWithServerClock(input, init) {
  const response = await fetch(input, init)
  try {
    if (response.ok) observeServerDate(response.headers.get('date'))
  } catch {
    // cabeçalho inacessível (CORS): segue com o relógio do aparelho
  }
  return response
}

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { global: { fetch: fetchWithServerClock } }
)
