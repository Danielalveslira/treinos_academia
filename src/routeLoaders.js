// Loaders das páginas com item fixo na navegação: a mesma função serve tanto para o
// code-splitting (lazy, em App.jsx) quanto para o pré-carregamento no hover/foco do link
// (Layout.jsx), antes do clique — assim a maior parte das trocas de página nunca chega a
// suspender de verdade. Fica num módulo à parte para as duas pontas nunca se duplicarem
// nem divergirem, e para evitar import circular entre App e Layout.
export const routeLoaders = {
  '/': () => import('./pages/Dashboard'),
  '/novo-treino': () => import('./pages/NewWorkout'),
  '/historico': () => import('./pages/History'),
  '/exercicios': () => import('./pages/Exercises'),
  '/comunidades': () => import('./pages/Communities'),
}

export function preloadRoute(path) {
  const connection = globalThis.navigator?.connection
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return
  // Import failures are retried by the route itself; hover must not cause an unhandled rejection.
  routeLoaders[path]?.().catch(() => {})
}
