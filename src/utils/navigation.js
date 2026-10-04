// Política de navegação do Evolutus (uma só, para não decidir caso a caso):
//
//  - seções principais (abas)            -> destino explícito, com `replace` (ver Layout.jsx)
//  - lista -> detalhe                    -> push normal
//  - detalhe -> voltar                   -> a lista correspondente (rota explícita)
//  - criação/edição -> cancelar          -> `returnToOrigin`: a origem registrada em
//                                           location.state.from; sem ela, o fallback da tela
//  - login concluído                     -> navigate(..., { replace: true })
//  - logout concluído                    -> <Navigate to="/login" replace> do ProtectedRoute
//                                           (a sessão sumiu; nenhuma tela privada renderiza)
//  - exclusão/conclusão de fluxo         -> destino explícito (com replace quando o fluxo não
//                                           deve ser reaberto pelo botão Voltar)
//  - ação administrativa                 -> nunca depende do histórico
//  - modal/drawer/menu                   -> fechar é estado local; NÃO navega nem empilha histórico
//  - atualização do PWA                  -> reload controlado, só após confirmação (PwaControls)
//
// navigate(-1) cru NÃO é usado em fluxos importantes: num PWA instalado, deep link, refresh ou
// rota aberta direto, o item anterior do histórico pode ser outro app/site ou nada.

// Aceita só caminhos internos (começam com uma única "/"): `from` vem de location.state e
// nunca deve virar um redirecionamento para fora do app.
export function isInternalPath(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
}

// Estado a enviar ao abrir uma tela de criação/edição para ela saber de onde veio.
export function originState(location) {
  return { from: `${location.pathname}${location.search || ''}` }
}

export function originOf(location) {
  const from = location?.state?.from
  if (!isInternalPath(from)) return null
  // Origem igual à tela atual (ex.: tocar em "Treinar" estando em Treinar) não é uma origem.
  return from === `${location.pathname}${location.search || ''}` ? null : from
}

// Cancelar/sair de uma tela de criação ou edição.
//  - Origem conhecida e entrada de histórico criada por navegação interna (history idx > 0):
//    o item anterior é, por construção, a própria origem -> voltar nele não duplica histórico.
//  - Origem conhecida sem histórico anterior (ex.: PWA reaberto): vai para a origem com replace.
//  - Origem desconhecida (deep link, refresh sem state): vai para o fallback com replace.
export function returnToOrigin(
  navigate,
  location,
  fallback = '/',
  historyState = globalThis.history?.state
) {
  const from = originOf(location)
  if (from && typeof historyState?.idx === 'number' && historyState.idx > 0) {
    navigate(-1)
    return
  }
  navigate(from || fallback, { replace: true })
}
