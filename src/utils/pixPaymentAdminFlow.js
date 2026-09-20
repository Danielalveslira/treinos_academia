// Administração de chaves PIX (aba "Configuração PIX" de /admin/compras-evocash) --
// lógica pura extraída de PixPaymentSettings.jsx pra ser testável sem renderizar nada
// (mesmo espírito de cashPurchaseFlow.js).

export const PIX_KEY_TYPE_OPTIONS = [
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefone' },
  { value: 'cpf', label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'random', label: 'Chave aleatória' },
]

// Mesmo teto que o backend exige (isValidPixMethodFields/isValidPixMethodLabel em
// pix-payment-core.js) -- aqui só evita gastar uma chamada que sabidamente falharia.
export function isValidPixMethodForm({ label, key, keyType, recipientName }) {
  return (
    typeof label === 'string' &&
    label.trim().length > 0 &&
    label.length <= 80 &&
    typeof key === 'string' &&
    key.trim().length > 0 &&
    key.length <= 200 &&
    PIX_KEY_TYPE_OPTIONS.some((option) => option.value === keyType) &&
    typeof recipientName === 'string' &&
    recipientName.trim().length > 0 &&
    recipientName.length <= 140
  )
}

// A chave ATIVA nunca pode ser excluída direto (o backend também recusa, ver
// pix-payment-admin-service.js) -- o admin precisa ativar outra primeiro. Isto só decide
// se o botão "Excluir" fica habilitado, a garantia real está no servidor.
export function canDeletePixMethod(method, activeMethodId) {
  return method.id !== activeMethodId
}
