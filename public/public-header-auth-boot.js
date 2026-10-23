// Roda no head antes da primeira pintura. Só espia o storage (mesma técnica de
// public-home-boot.js) pra decidir se escondemos os botões de visitante até a checagem
// real (publicHeaderAuth.js) confirmar a sessão -- sem isso, quem já está autenticado veria
// "Entrar"/"Criar conta" por um instante a cada carregamento de página pública.
try {
  var script = document.currentScript
  var ref = script.dataset.authRef
  if (ref && localStorage.getItem(`sb-${ref}-auth-token`)) {
    document.documentElement.setAttribute('data-public-auth', 'pending')
  }
} catch {
  // Navegação privada ou storage indisponível: mantém o cabeçalho de visitante.
}
