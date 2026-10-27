// Com a escrita offline ligada, estas são as ÚNICAS telas que funcionam sem conexão: ler o que já está
// no aparelho e registrar/editar treino (a outbox sincroniza depois). Todo o resto exige servidor
// (EvoCash/InfinitePay, EvoCoins, comunidades, perfil, administração, vitrine...) e mostra um aviso em
// vez de tentar e falhar.
const OFFLINE_CAPABLE = [
  /^\/treinar\/?$/,
  /^\/app\/?$/,
  /^\/exercicios(\/[^/]+)?\/?$/,
  /^\/novo-treino\/?$/,
  /^\/historico\/?$/,
  /^\/progresso\/?$/,
]

export function isOfflineCapablePath(pathname) {
  return OFFLINE_CAPABLE.some((pattern) => pattern.test(pathname))
}
