# Pendências conhecidas e aceitas

Retrato consolidado da auditoria de segurança pré-lançamento de 2026-09-12. Documenta o
que ficou em aberto **conscientemente** neste momento, e por quê — para revisitar depois
do lançamento sem precisar reconstruir o raciocínio a partir do histórico de chat.

## Resolvido nesta rodada

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
