# Auditoria PWA, navegação, cliques e logout (2026-10-03)

Resultado da tarefa `docs/prompts/current/evolutus_pwa_performance_navegacao_auditoria.md`.
Nada foi commitado, enviado ou publicado.

## Política de cache do Service Worker (`scripts/service-worker.js`)

| Recurso | Estratégia | Limite |
|---|---|---|
| `index.html`, manifest, ícones | precache no `install`, cache versionado por build | substituído a cada versão |
| JS/CSS de boot (entry + imports estáticos + CSS) | precache no `install`, no cache de assets | — |
| `/assets/*` (chunks de tela, hash no nome) | cache-first, preenchido ao abrir a tela | 120 entradas (mais antigas saem) |
| `/img/*` | cache-first, revalida quando expira | 40 entradas, 30 dias |
| Navegação | network-first; `index.html` em cache só como fallback offline | — |
| Outra origem (Supabase Auth/REST/RPC/Realtime/Storage), não-GET | **não interceptado** | — |

`activate` apaga caches `treinos-shell-*` de versões anteriores e `claim()`; caches de terceiros não são tocados.
`skipWaiting` + `controllerchange` + aviso "Atualizar" (reload só após confirmação) foram mantidos.

## Política de navegação (`src/utils/navigation.js`)

| Situação | Regra |
|---|---|
| Abas principais | destino explícito, `replace` (Layout) |
| Lista → detalhe | push |
| Criação/edição → cancelar | `returnToOrigin`: `state.from` + índice de histórico > 0 → volta 1 entrada; senão vai a `from`/fallback com `replace`. Nunca `navigate(-1)` cru |
| Login concluído | `replace('/')` |
| Logout concluído | `<Navigate to="/login" replace>` do ProtectedRoute |
| Fluxo concluído (finalizar treino) | `replace` |
| Modal/menu | estado local, não toca no histórico |
| Atualização do PWA | reload controlado, com confirmação |

### `navigate`/`location` encontrados

| Arquivo | Ação | Antes | Risco | Depois |
|---|---|---|---|---|
| NewWorkout.jsx | Cancelar treino | `navigate(-1)` | Alto | `returnToOrigin(..., '/')` |
| NewWorkout.jsx | Finalizar treino | `navigate('/historico')` (push) | Médio | `replace` |
| Dashboard/History/ExerciseDetail/Layout (Treinar) | abrir treino | sem origem | Alto (par do cancelar) | `state: { from }` |
| CreateCommunity.jsx | Voltar (passo 0) | `navigate('/comunidades')` | Baixo | mantido (explícito) |
| CommunityDetail.jsx | excluir comunidade | `navigate('/comunidades', {replace})` | Baixo | mantido |
| Login/Register/CreateCommunity | pós-sucesso | `replace` | Baixo | mantido |

### `reload()` / `location` remanescentes (todos com motivo técnico)

| Arquivo | Motivo |
|---|---|
| PwaControls.jsx | trocar o bundle da aba após nova versão; só após confirmação |
| ErrorBoundary.jsx, index.html (12 s) | recuperação de erro/boot; ação explícita do usuário |
| ProtectedRoute.jsx, Register.jsx, LegalGate.jsx, LegalDocument.jsx, AccountDeletionBlockedGate.jsx | "Tentar novamente"/"Recarregar" após falha de carga de perfil/termos. Candidatos a refetch no lugar de reload (pendência) |
| share.js, ProfessionalListing.jsx | leitura de `location.origin/href` para links compartilháveis (não navega) |

## Logout

Fluxo único: `authService.logoutUser()` (single-flight) → `useLogout` (estado `Saindo…`, erro, destrava) → `LogoutButton` (gates) / `AccountMenu` (Layout).
Eventos: `SIGNED_OUT` → `AuthContext` zera perfil/termos/carteira/canais/caches (já existia) e agora também rascunhos de comentário → `ProtectedRoute` renderiza `<Navigate to="/login" replace>` (nenhuma tela privada renderiza) → Login mostra "Você saiu da conta.".

Escopo: "Sair da conta" (menu e todos os gates) usa `signOut({ scope: 'local' })`: encerra só esta sessão. "Sair de todos os dispositivos" (menu da conta, com confirmação explícita) é uma única ação visual em duas etapas: `signOut({ scope: 'others' })` revoga as outras sessões e mantém a atual; só se der certo roda o logout local acima. Se a etapa 1 falha, o usuário continua logado e vê "Não foi possível sair dos outros dispositivos. Tente novamente.". Os dois fluxos compartilham o mesmo single-flight e o mesmo estado `Saindo…`; `scope: 'global'` não é mais usado.

Falhas (verificado em `GoTrueClient._signOut`, auth-js 2.117, e em teste real com mock): se a revogação no servidor falha (rede, 5xx), o SDK **remove a sessão local mesmo assim** e só devolve o erro; por isso o logout local só trata como erro quando a sessão local continua existindo e, nos outros casos, devolve `{ revoked: false }`. No logout local isso é silencioso (só o refresh token desta sessão segue válido até expirar).

O cache do SW **não** é apagado no logout (só contém JS/CSS/imagens públicas).

## Armazenamento local

| Chave | Conteúdo | Sensível? | Limpar no logout? |
|---|---|---|---|
| `colorMode` (localStorage) | tema | não | não |
| `evolutus:done-exercises:<dia>` | ids de exercícios feitos hoje (UUIDs do usuário) | baixo | não: sem isso "Finalizar treino" some ao relogar no mesmo dia; ids não colidem entre contas |
| `evolutus:status-draft:v1:<uid>:...` | rascunho de publicação, por usuário | médio | não (escopo por uid) |
| `evolutus:comment-draft:<status>:<parent>` | rascunho de comentário, **sem uid** | médio | **sim — adicionado** (`clearAllCommentDrafts` em `SIGNED_OUT`) |
| `evolutus:logout-reason` (sessionStorage) | motivo do logout | não | consumido pelo Login |
| carteira (sessionStorage, por uid) | saldo em cache | médio | sim (`clearCachedWallet`, já existia) |
| `evolutus-exercise-catalog` (IndexedDB) | catálogo público ExerciseAPI, TTL 24 h | não | não |
| `evolutus:activity-ping:v1:<uid>` | instante do último envio de "último uso" (reserva anti-duplicidade entre abas) | não | sim (`SIGNED_OUT`): o próximo login registra o uso na hora |

## Último uso (`user_activity`)

Migration `20261011000001_user_activity.sql`: uma linha por usuário (`last_active_at`, `last_session_id`), sem policy e sem grant para `anon`/`authenticated`. A única porta de escrita é `touch_user_activity()` (security definer, **sem parâmetros**: `auth.uid()`, `auth.jwt()->>'session_id'` e `now()` do PostgreSQL), com teto de 1 gravação por minuto por usuário no servidor. Com dois aparelhos vale o instante mais recente (`greatest`), sem "dispositivo principal". O app chama ao abrir/retomar e no máximo a cada 10 min enquanto a página está visível (nenhum timer com a página escondida, nenhuma leitura periódica). A tela Contas mostra **Último uso** (`last_active_at`, "Sem registro" quando não há) e mantém `last_sign_in_at` como **Último login**.

Testes: `supabase/tests/user_activity_test.sql` (pgTAP), `supabase/tests/user_activity_concurrency.sh` (40 conexões simultâneas), `src/utils/activityPing.test.js`, `src/services/logoutScope.test.js`. O pgtest local precisa de `auth.jwt()` (o Supabase real já tem); ver nota na memória do projeto.
