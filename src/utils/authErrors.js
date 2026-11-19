// Códigos em error.code vêm do GoTrue (Supabase Auth), não de strings livres --
// ver node_modules/@supabase/auth-js/src/lib/error-codes.ts para a lista completa.
const MESSAGES = {
  // Fallback neutro para qualquer fluxo que receba estes códigos diretamente.
  // A interface de cadastro trata ambos como retorno sem sessão em registerUser.
  user_already_exists:
    'Não foi possível concluir esta tentativa. Você pode entrar, recuperar o acesso ou conferir o e-mail informado.',
  email_exists:
    'Não foi possível concluir esta tentativa. Você pode entrar, recuperar o acesso ou conferir o e-mail informado.',
  email_address_invalid: 'E-mail inválido.',
  weak_password: 'A senha não atende à política de segurança. Use pelo menos 15 caracteres.',
  // GoTrue nunca distingue "não existe" de "senha errada" num login (só invalid_credentials),
  // ao contrário do Firebase Auth que tinha um código pra cada caso.
  invalid_credentials: 'E-mail ou senha incorretos.',
  over_request_rate_limit: 'Muitas tentativas. Tente novamente mais tarde.',
  over_email_send_rate_limit: 'Muitas tentativas. Tente novamente mais tarde.',
  // A conta é desativada (banida) assim que a exclusão é solicitada (queue_deletion,
  // síncrono) -- uma tentativa de login logo em seguida já bate nesse código, não em
  // "senha incorreta".
  user_banned: 'Esta conta não está mais disponível.',
  email_not_confirmed:
    'Confirme seu e-mail para entrar. Se houver confirmação pendente, solicite um código.',
  otp_expired: 'Código inválido ou expirado. Solicite um novo.',
  same_password: 'A nova senha precisa ser diferente da atual.',
  captcha_failed: 'A verificação de segurança não foi aceita. Conclua uma nova verificação.',
  CAPTCHA_REQUIRED: 'Conclua a verificação de segurança para continuar.',
  CAPTCHA_EXPIRED: 'A verificação expirou. Conclua-a novamente.',
  CAPTCHA_CONFIGURATION_MISSING:
    'A verificação de segurança não está disponível neste ambiente. Tente novamente mais tarde.',
  CAPTCHA_CONFIGURATION_CONFLICT:
    'A verificação de segurança não está configurada corretamente neste ambiente. Tente novamente mais tarde.',
}

export function translateAuthError(error) {
  return MESSAGES[error?.code] || 'Ocorreu um erro. Tente novamente.'
}
