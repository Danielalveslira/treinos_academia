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
| 2 | Conta desativada (`accountStatus: 'disabled'`) não força logout — `setAccountStatus` nunca revoga o token do Auth, então não vira "sessão fantasma" detectável. `DisabledAccountGate` bloqueia em `ProtectedRoute` antes de qualquer outro gate. | `069f549` |
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
