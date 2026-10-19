# Pendências conhecidas e aceitas

Retrato consolidado das auditorias de segurança pré-lançamento de 2026-09-12 e
2026-09-14. Documenta o que ficou em aberto **conscientemente** neste momento, e por
quê — para revisitar depois do lançamento sem precisar reconstruir o raciocínio a
partir do histórico de chat.

## Resolvido em 2026-09-14 (auditoria `auditoria_projeto_treinos_para_claude.csv`)

| ID | Achado | Correção |
|---|---|---|
| AUD-001/002 | Exclusão de conta não apagava `bodyMeasurements` nem `rateLimitCounters/{uid}` | Adicionados à lista de limpeza em `functions/deletion-service.js` |
| AUD-003/004 | `authorUsername` não era travado no update de um status; conteúdo de uma publicação já existente podia ser reescrito via acesso direto ao Firestore | `allow update: if false` em `statuses/{statusId}` — o app nunca chamava update mesmo, só create/delete |
| AUD-005 | Schema de status sem allowlist completa de campos | `keys().hasOnly([...])` por tipo em `isValidStatusContent()` |
| AUD-006 | Estatísticas públicas (`entries`/`sets`) calculadas e gravadas pelo próprio cliente | Cálculo movido para a Cloud Function `refreshPublicStatistics` (Admin SDK, agregação real); create/update bloqueado nas regras |
| AUD-007 | Denúncia de foto não preservava a imagem — evidência sumia quando a publicação expirava/era excluída; e, uma vez copiada, não tinha nenhuma política de retenção | `submitSupportRequest` copia o arquivo para `moderationEvidence/{requestId}.webp`, fora do ciclo de vida da publicação; leitura restrita a superadmin. Retenção explícita ligada à decisão do chamado (`evidenceExpiresAt`): 30 dias enquanto pendente, 7 dias se cancelado/`no_action`, indefinida (decisão deliberada) se uma penalidade real foi aplicada. `purgeExpiredModerationEvidence` (scheduled, a cada 24h) executa o prazo já decidido — nunca decide reter/apagar por conta própria |
| AUD-008 | Política de Privacidade não listava medidas corporais entre os dados coletados | `functions/legal/documents.json` atualizado; versão do manifesto subida (força novo aceite) |
| AUD-010 | Troca de @ em dois commits distintos do cliente — falha entre eles deixava o novo @ reservado sem dono; e as Firestore Rules ainda permitiam reconstruir esse mesmo fluxo não-atômico via escrita direta, contornando a Cloud Function | Cloud Function `renameUsername` (Admin SDK, transação única e atômica) **e** `firestore.rules` reescritas para bloquear qualquer troca direta: `users`/`publicProfiles` só aceitam a PRIMEIRA reivindicação de um @ (username antes nulo); `usernames/{x}` só aceita reserva direta de quem ainda não tem @ nenhum. Testado explicitamente em `tests/username-rename-rules.test.mjs`, incluindo a tentativa de bypass com uma reserva válida em mãos |
| AUD-022 | Build/lint/emulator não totalmente validados — faltava rodar em ambiente limpo `npm ci`, lint, testes unitários, testes de Functions e dos emuladores de Firestore/Storage, e `vite build` | Validado nesta rodada: build limpo, `npm run lint` sem erros (0), 142/142 testes de frontend, 26/26 de Functions, 18+24+13+7+6+3 = 71/71 testes de Firestore/Storage Rules — todos rodados de fato contra o emulador (`--project demo`), não apenas assumidos por já terem passado antes |
| AUD-011 | Voto em enquete não conferia se `optionId` existia de fato entre as opções | `pollOptionExists()` em `canVote()` |
| AUD-012 | Nada impedia deploy de produção sem App Check configurado | `scripts/check-production-config.mjs` como `hosting.predeploy` |
| AUD-013 | Imagens de parceiro/comunidade carregadas sem controle de referrer | `referrerPolicy="no-referrer"` + `loading="lazy"` em `SponsoredAdCard`/`CommunityIcon` |
| AUD-014 | Faltavam headers de hardening web | `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` em `firebase.json` |
| AUD-017/018/019 | Doc citando função removida (`confirmPayment`); cache de fotos não limpo no logout; timer não cancelado em `useStatusPhoto` | Correções pontuais — ver `docs/admin-maintenance.md`, `photoBlobCache.js`, `useStatusPhoto.js` |

**AUD-009 revisitado e mantido como estava**: a decisão de manter `RATE_LIMIT_ENFORCE = false`
foi reconfirmada nesta rodada (não é um esquecimento) — ainda não há dados reais de
produção para calibrar o limiar sem risco de falso positivo. Ver detalhe original
abaixo, item 2 de "Pendências aceitas".

**Não corrigido nesta rodada, escopo deliberadamente menor** (ver resumo entregue ao
usuário para o raciocínio completo de cada um): AUD-015 (suíte Playwright/E2E ampla —
cobertura de regras foi ampliada, E2E de UI não), AUD-016/021 (README — parcialmente
corrigido, não reescrito por completo), AUD-020 (dividir `functions/index.js` e
`WorkoutForm.jsx` em módulos menores — refatoração grande, sem bug funcional
associado, risco de regressão maior que o benefício imediato).

## Resolvido em 2026-09-12

| # | Achado | Commit(s) |
|---|---|---|
| 1 | XSS via `ctaTarget` em anúncios patrocinados — `href="javascript:..."` executava no clique. Allowlist de esquema (`https://` para externo, uma barra só para interno) aplicada em `validateSponsoredAd()` e `isValidSponsoredAd()`. | `5a88814` |
| 2 | Conta desativada (`accountStatus: 'disabled'`) não força logout — `setAccountStatus` nunca revoga o token do Auth, então não vira "sessão fantasma" detectável. `DisabledAccountGate` bloqueia em `ProtectedRoute` antes de qualquer outro gate. (Substituído por `AccountBlockedGate`, que generaliza o mesmo bloqueio para deleting/suspensa/banida — ver tarefa de UI de conta bloqueada pós-F1/F1.2.) | `069f549` |
| 3 | Sem rate limit de publicações — ver detalhe abaixo. | `502e8cc`, `c927e98`, `b68df3c`, `9b79a26` |

## Pendências aceitas

### 1. Rate limit de publicações é assíncrono, não preventivo em tempo real

A mitigação do achado #3 é um gatilho `onCreate` em `statuses/{statusId}`
(`functions/rate-limit-service.js`), não uma Cloud Function síncrona no caminho de
escrita. Ele roda **depois** da publicação já ter sido gravada — contém abuso
sustentado, mas não impede os primeiros posts de um flood dentro da janela de detecção
(8 posts / 10 min).

Uma versão síncrona (`onCall` bloqueando a escrita antes de acontecer) resolveria isso de
verdade, mas exige reescrever os pontos de criação em `statusesService.js`, simplificar
`firestore.rules`, e aceitar a latência de rede de uma Cloud Function em cada post. Fica
registrada como melhoria futura, sem data definida.

Por que não foi feito nas regras (a alternativa mais simples, `postLimits/{uid}` com um
`get()`/`exists()` extra em `canCreateStatus()`): confirmado no emulador que o pior caso
combinado (enquete de 6 opções + `authorUsername` preenchido + o próprio throttle) excede
o teto de chamadas `get()`/`exists()` por avaliação de regra do Firestore, negando a
publicação de qualquer usuário com username definido — não é uma borda rara, é o caminho
comum.

### 2. Rate limit sobe em modo só-log — precisa de uma ação humana para entrar em vigor

`RATE_LIMIT_ENFORCE = false` em `functions/rate-limit-service.js`. O limiar (mais de 8
posts em 10 minutos → suspensão automática de 30 min) foi calibrado olhando o código
(toda publicação exige um toque manual, sem fluxo de criação em lote), não com dados reais
de uso.

**Pendência explícita**: acompanhar os logs (`rate-limit threshold crossed (log-only)`)
por alguns dias de uso real pós-lançamento, confirmar que não há falso positivo, e então
trocar a constante para `true` e fazer deploy. Sem essa ação, nenhuma restrição é
aplicada de verdade, independente de quanto alguém publique.

### 3. Sem painel admin para listar restrições ativas

Não existe (antes e depois desta mudança) uma tela que liste `accountRestrictions` ou
`moderationDecisions` proativamente — `AdminModeration.jsx` só aparece a partir de uma
denúncia em `supportRequests`. A única forma de um admin saber de uma restrição aplicada
automaticamente é o próprio usuário recorrer (usando o protocolo do `notice`, em
`/atendimento`) ou alguém denunciar o padrão de uso. Não é uma regressão desta feature —
restrições aplicadas manualmente por um admin já tinham essa mesma limitação — mas a
restrição automática adiciona um caso a mais que só se descobre reativamente.

### 4. Content-Type do Storage confia no cabeçalho declarado, não no conteúdo real do arquivo

`storage.rules` exige `request.resource.contentType == 'image/webp'` no upload de fotos
de publicação, mas isso valida o cabeçalho que o cliente declara, não os bytes de fato.
Um upload malicioso poderia declarar `image/webp` e enviar conteúdo arbitrário. Aceito sem
ação por enquanto — o arquivo só é servido vinculado a um `statusId` já autorizado pelas
regras do Firestore (nunca por path arbitrário), o que limita o raio de alcance.

### 5. Imprecisão aceita no contador de rate limit

Gatilhos Firestore são "pelo menos uma vez" (at-least-once) — uma rara reexecução do
evento completo (não da transação em si, que já tem sua própria retentativa por
contenção) poderia contar o mesmo post duas vezes na janela deslizante. Não muda a
conclusão de um heurístico calibrado em "mais de 8": um erro de +1 é irrelevante.

### 6. Sem suíte de regras dedicada para `canCreateStatus()`/`statusAccountOk()`/`statusCommunityOk()`

Gap de cobertura pré-existente, encontrado de passagem durante a investigação do
achado #3 (não introduzido por ele). `tests/statuses-rules.test.mjs` cobre apenas o elo
específico de que o rate limit depende (restrição automática bloqueia o próximo post);
não é uma suíte completa da função de criação de publicações.

### 7. Perfil do cadastro incompleto — causa raiz corrigida, gate de segurança adicionado (`options.data` avaliado e rejeitado)

**Causa raiz real** (não "fechou a aba", como se pensava inicialmente): `syncSignupPassword`
chamava `updateUser({password})` com a MESMA senha que o `signUp` acabara de gravar — o
caso comum, sem reload e sem ataque nenhum. O GoTrue rejeita isso com
`422 same_password` ("New password should be different from the old password"),
confirmado em produção e reproduzido localmente. O código tratava qualquer erro aqui como
falha fechada (`PASSWORD_SYNC_FAILED`, sessão encerrada, passo `'locked'`) — ou seja, o
cadastro normal praticamente sempre caía nesse estado, e `completeProfile`
(username/data de nascimento/sexo/usageProfile/display name) nunca chegava a rodar.
**Corrigido**: `same_password` agora é tratado como sucesso em `syncSignupPassword`
(prova que a senha é a certa, não o contrário) — qualquer outro erro continua fail-closed.

**Gate de segurança adicionado** (para qualquer OUTRA interrupção futura, não só esta):
`ProfileCompletionGate.jsx`, montado em `ProtectedRoute.jsx` depois das guardas de
bloqueio/exclusão, bloqueia contas com sessão válida mas `username` nulo até a própria
pessoa completar o formulário (mesmos campos do cadastro, sem e-mail/senha). A sequência
de RPCs foi extraída para `completeUserProfile` (`services/profileCompletion.js`) e
REORDENADA: `setUsername` agora é a ÚLTIMA chamada de propósito, para que sua presença em
`public.users.username` prove que todas as etapas anteriores (perfil, nascimento, display
name) já rodaram — antes, `setUsername` era a segunda chamada, então username presente
não garantia nada sobre o resto.

**`options.data` no `signUp` avaliado e rejeitado** (não é mais a melhoria futura
proposta): `user_metadata` vem do cliente, no corpo da própria chamada `signUp` — um
atacante que pré-cadastra o e-mail da vítima poderia plantar ali valores que sobrevivem a
um re-`signUp` da vítima (o GoTrue não limpa `user_metadata` nessa reconfirmação). Gravar
qualquer dado de perfil a partir desse metadata abriria uma variante do risco de
pre-account hijacking do item 8. A gravação continua exigindo sessão autenticada, via RPC
— nunca a partir de dados que vieram do corpo do `signUp`.

### 8. Risco residual de pre-account hijacking: janela entre verifyOtp e a troca de senha falhar

Contexto: um atacante que sabe o e-mail da vítima pode se cadastrar primeiro com uma
senha própria; um segundo `signUp` da vítima para o MESMO e-mail (ainda não confirmado)
não é bloqueado pelo GoTrue — ele devolve 200 e reenvia o código, mas **mantém a senha do
primeiro cadastro** (a do atacante). Reproduzido localmente contra o GoTrue (`supabase
start`): sem nenhuma mitigação, o login do atacante com a senha antiga continua
funcionando depois da vítima confirmar o próprio e-mail. Evidência é a reprodução local
em si (script ad hoc, não comitado); não há um relato público do Supabase confirmando
este comportamento especificamente — só a observação direta feita aqui.

Mitigado na rota do Register: `confirmSignupAndSyncPassword` confirma o código e SÓ
ENTÃO tenta alinhar a senha da conta com a do formulário (`syncSignupPassword`, que agora
lança em vez de engolir erro). Na rota do ConfirmEmail (sem senha conhecida de antemão):
`setPasswordAfterConfirmation` sempre força uma senha nova.

**Risco residual explícito**: existe uma janela entre o `verifyOtp` (que já confirma o
e-mail e cria sessão) e a chamada a `updateUser` que troca a senha. Se `updateUser`
falhar nesse meio-tempo (rede, rate limit, etc.) — não por causa de um ataque, só uma
falha transitória — a conta fica **confirmada** mas ainda com a senha do atacante até a
vítima agir. A mitigação nesse caso é: `confirmSignupAndSyncPassword` encerra a sessão
imediatamente (nunca deixa a conta logada nesse estado) e `Register.jsx` entra no passo
`'locked'`, direcionando explicitamente para "Esqueci minha senha" — que troca a senha de
novo (dessa vez por um link enviado ao e-mail, não dependente do formulário) e chama
`endOtherSessions()`, revogando qualquer sessão que o atacante tenha aberto com a senha
antiga. Ou seja: a janela existe, mas sempre termina em "a vítima precisa redefinir a
senha pelo fluxo de recuperação" — nunca em acesso silencioso concedido ao atacante.

### 9. `signUp` para e-mail já confirmado: comportamento diverge entre GoTrue local e o Supabase hospedado

Confirmado contra o GoTrue local (`supabase start`): um segundo `signUp` para um e-mail
JÁ CONFIRMADO, com "Confirm email" ligado, devolve `422 user_already_exists` — erro
explícito, nenhum e-mail enviado.

Confirmado nos **logs de Auth de produção** (evento "User repeated signup", e o `resend`
correspondente): o mesmo cenário no Supabase **hospedado** devolve `200`, **sem erro**,
usuário ofuscado (sem sessão, `identities` vazio) — também sem enviar e-mail, mas sem
nenhum sinal de erro para o cliente. São comportamentos diferentes para o mesmo cenário,
dependendo do ambiente (versão do GoTrue local vs. plataforma hospedada).

**Por que isso não quebra nada aqui**: `registerUser`/`Register.jsx` nunca ramificam por
`identities` ou por um erro específico de "já existe" — só por `hasSession`, que vem
`false` nos dois casos (local E hospedado). A tela de código seguinte é neutra por
construção (ver item 3 da Fase 2 do trabalho de auth), não por uma checagem explícita de
qual dos dois comportamentos aconteceu. Testar contra o GoTrue local continua útil para
tudo que NÃO é este caso específico (confirmação por código, recuperação de senha,
hijacking) — só este cenário precisa ser lido nos logs do painel, não reproduzido local.

### 10. Testes instáveis na suíte completa (`npm test` sem filtro) — hipótese NÃO provada

Observado repetidas vezes durante o trabalho de auth: `npm test` (glob completo,
`node --test "src/**/*.test.js"`) falha de forma não determinística — em cada tentativa,
um teste DIFERENTE falha (às vezes em `authColdStart.test.js`, às vezes em outro arquivo
sem relação nenhuma, ex. um teste de agrupamento de autores em feed), e repetir a mesma
suíte sem nenhuma mudança no código produz resultados diferentes (falha, depois limpo,
depois falha de novo em outro lugar). Isolar o arquivo que falhou (`node --test
<arquivo>.test.js`) sempre passou 100% das vezes em que foi tentado durante este trabalho.

**Hipótese (não provada)**: contenção de recursos no ambiente de execução — múltiplos
processos `node --test` concorrentes (o próprio glob gera um processo por arquivo),
possivelmente combinados com flags de depuração (`--inspect`) que aparecem injetadas nos
processos filhos sem terem sido pedidas por `package.json` nem por `NODE_OPTIONS`
(origem não identificada — suspeita de alguma integração do ambiente/IDE que anexa um
depurador a processos Node recém-criados). Essa hipótese nunca foi comprovada com uma
causa raiz isolada (ex.: não foi capturado um `strace`/profiling do momento exato da
falha) — é só a explicação mais consistente com o padrão observado (sempre um teste
diferente, sempre limpo isolado, sempre limpo ao repetir a suíte completa mais uma vez).

**Pendência explícita**: investigar a causa raiz de verdade (ou aceitar formalmente que
`npm test` precisa ser reexecutado quando falha, sem abrir um item isolado para investigar
cada teste que aparecer na lista) antes de confiar em uma única rodada de `npm test` como
critério de aceite em CI ou em qualquer automação sem repetição.
