import { translateAuthError } from './authErrors.js'
import { describeAccountAccessError } from './accountAccessErrors.js'

// Erros do cadastro/conclusão de perfil -> { field, message }. `field` aponta o campo que a pessoa
// precisa corrigir (o formulário mostra a mensagem junto dele e mantém todo o resto preenchido);
// sem `field`, é um erro geral. Antes, códigos das RPCs de perfil (USERNAME_TAKEN numa corrida
// entre a checagem e a gravação, por exemplo) caíam todos no "Ocorreu um erro" do translateAuthError.

export const NETWORK_ERROR_MESSAGE =
  'Sem conexão com o servidor. Verifique sua internet e tente novamente — seus dados continuam preenchidos.'

const FIELD_ERRORS = {
  USERNAME_TAKEN: { field: 'username', message: 'Esse nome de usuário já está em uso' },
  INVALID_USERNAME: {
    field: 'username',
    message: 'Use de 3 a 20 letras minúsculas, números ou _ (sem espaços ou acentos)',
  },
  INVALID_SEXO: { field: 'sexo', message: 'Selecione uma opção para Sexo' },
  INVALID_MUNICIPALITY: {
    field: 'city',
    message: 'Cidade não reconhecida. Escolha uma cidade da lista de sugestões.',
  },
}

export function isNetworkError(error) {
  if (!error) return false
  if (error.name === 'AuthRetryableFetchError') return true
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return /Failed to fetch|NetworkError|Load failed|Network request failed|fetch failed/i.test(
    String(error.message || '')
  )
}

export function describeRegistrationError(error) {
  const code = String(error?.message || '')
  if (FIELD_ERRORS[code]) return FIELD_ERRORS[code]
  if (isNetworkError(error)) return { field: null, message: NETWORK_ERROR_MESSAGE }
  const access = describeAccountAccessError(code)
  if (access) return { field: null, message: access }
  return { field: null, message: translateAuthError(error) }
}

// Meu Perfil -> "Cidade onde mora": a mensagem sempre deixa claro que a cidade anterior foi mantida.
export function residenceCitySaveErrorText(error) {
  if (error?.message === 'INVALID_MUNICIPALITY')
    return 'Cidade não reconhecida. Escolha uma cidade da lista de sugestões.'
  if (isNetworkError(error))
    return 'Sem conexão com o servidor. Sua cidade anterior foi mantida; tente novamente.'
  return (
    describeAccountAccessError(error?.message) ||
    'Não foi possível salvar sua cidade. A cidade anterior foi mantida; tente novamente.'
  )
}
