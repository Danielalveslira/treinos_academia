import { supabase } from '../supabase/config'

// Únicas escritas do recurso de mensagens da Home: sempre por RPC (a tabela users não aceita UPDATE direto do
// cliente) e só em ação real -- trocar a preferência e confirmar as boas-vindas UMA vez. Nenhuma leitura.

export async function setGreetingVoice(voice) {
  const { data, error } = await supabase.rpc('set_greeting_voice', { p_voice: voice })
  if (error) throw error
  return data
}

// Devolve o instante (do SERVIDOR) em que as boas-vindas foram confirmadas; idempotente entre aparelhos.
export async function acknowledgeGreetingWelcome() {
  const { data, error } = await supabase.rpc('ack_greeting_welcome')
  if (error) throw error
  return data
}
