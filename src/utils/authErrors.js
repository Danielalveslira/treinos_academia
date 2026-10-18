// Códigos em error.code vêm do GoTrue (Supabase Auth), não de strings livres --
// ver node_modules/@supabase/auth-js/src/lib/error-codes.ts para a lista completa.
const MESSAGES = {
  // Uma conta em exclusão continua reservando o e-mail no Auth até a etapa final do job
  // (auth.admin.deleteUser, ver run_deletion_job na migration do deletion worker) -- que
  // nunca roda enquanto o job estiver bloqueado por revisão financeira (só um admin
  // resolve isso). Sem esta pista, quem tentasse recadastrar com o mesmo e-mail ficaria
  // preso num "já está cadastrado" sem nenhum caminho a seguir.
  user_already_exists:
    'Este e-mail já está cadastrado. Se você solicitou a exclusão desta conta e ela ainda não foi concluída, aguarde ou entre em contato pelo atendimento antes de tentar novamente.',
  email_exists:
    'Este e-mail já está cadastrado. Se você solicitou a exclusão desta conta e ela ainda não foi concluída, aguarde ou entre em contato pelo atendimento antes de tentar novamente.',
  email_address_invalid: 'E-mail inválido.',
  weak_password: 'A senha deve ter pelo menos 8 caracteres, com letras e números.',
  // GoTrue nunca distingue "não existe" de "senha errada" num login (só invalid_credentials),
  // ao contrário do Firebase Auth que tinha um código pra cada caso.
  invalid_credentials: 'E-mail ou senha incorretos.',
  over_request_rate_limit: 'Muitas tentativas. Tente novamente mais tarde.',
  over_email_send_rate_limit: 'Muitas tentativas. Tente novamente mais tarde.',
  // A conta é desativada (banida) assim que a exclusão é solicitada (queue_deletion,
  // síncrono) -- uma tentativa de login logo em seguida já bate nesse código, não em
  // "senha incorreta".
  user_banned: 'Esta conta não está mais disponível.',
  email_not_confirmed: 'Confirme seu e-mail para entrar. Enviamos um código de confirmação no cadastro.',
  otp_expired: 'Código inválido ou expirado. Solicite um novo.',
  same_password: 'A nova senha precisa ser diferente da atual.',
}

export function translateAuthError(error) {
  return MESSAGES[error?.code] || 'Ocorreu um erro. Tente novamente.'
}
