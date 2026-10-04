import { supabase } from '../supabase/config'

// RPC sem parâmetros: usuário (auth.uid()), sessão (claim session_id do JWT) e horário (now() do
// PostgreSQL) são decididos no servidor -- o cliente não pode informá-los.
export async function touchUserActivity() {
  const { error } = await supabase.rpc('touch_user_activity')
  if (error) throw error
}
