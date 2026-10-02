// Mensagem por resultado do compartilhamento nativo. 'cancelled' é silencioso (fechar a folha não é erro).
export const SHARE_RESULT_MESSAGES = {
  shared: { kind: 'info', text: 'Compartilhado!' },
  shared_text: {
    kind: 'info',
    text: 'Seu aparelho não compartilha imagens — enviamos o texto e o link. Use "Baixar imagem" para salvar o card.',
  },
  cancelled: { kind: '', text: '' },
  unsupported: {
    kind: 'error',
    text: 'O compartilhamento não é suportado neste navegador.',
    canCopyLink: true,
  },
}
