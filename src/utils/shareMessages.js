// Mensagem por resultado do compartilhamento. 'cancelled' é silencioso (fechar a folha não é erro).
export const SHARE_RESULT_MESSAGES = {
  shared: { kind: 'info', text: 'Compartilhado!' },
  cancelled: { kind: '', text: '' },
  fallback_copied: { kind: 'info', text: 'Imagem baixada e mensagem copiada.' },
  fallback_downloaded: {
    kind: 'info',
    text: 'Imagem baixada. Não foi possível copiar a mensagem automaticamente.',
  },
}
