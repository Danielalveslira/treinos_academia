# Prompt completo — Construção da Economia Evolutus (EvoCoins + EvoCash)

## Contexto

Esta é a **primeira implementação desta feature**.

Não existe implementação anterior de EvoCoins/EvoCash no projeto e não há outro documento obrigatório para consultar.

Este arquivo contém a arquitetura, regras de negócio e plano de implementação necessários para começar do zero, respeitando a arquitetura atual do Evolutus.

**Não faça commit, push, deploy ou alterações em produção sem autorização.**

---

# 1. Objetivo

Construir uma economia interna do Evolutus com duas unidades:

```text
EvoCoins
→ participação, reputação e ações sociais

EvoCash
→ créditos premium e monetização
```

A implementação deve priorizar:

- simplicidade;
- segurança;
- baixo custo de Firestore;
- boa performance;
- idempotência;
- prevenção de abuso;
- crescimento de longo prazo;
- reutilização da arquitetura atual do projeto.

---

# 2. Antes de codificar: audite o projeto atual

Primeiro analise:

```text
Auth
users
posts/status
votos/reactions
communities
admin
Firestore Rules
Cloud Functions
App Check
rate limiting
deleteAccount
anúncios existentes ou planejados
```

Identifique:

- como votos funcionam hoje;
- como comunidades são criadas;
- como Functions estão organizadas;
- como transações Firestore são feitas;
- como admin é validado;
- como rate limiting funciona;
- como exclusão de conta funciona.

Não crie sistemas paralelos se já existir algo reaproveitável.

Entregue primeiro:

```text
ESTADO ATUAL
- componentes reutilizáveis;
- conflitos;
- arquivos envolvidos;
- riscos.

PLANO
- collections;
- Functions;
- Rules;
- transações;
- custo estimado por ação;
- hotspots;
- fases.
```

Só depois implemente.

---

# 3. EvoCoins

EvoCoins representam participação/reputação.

Manter:

```text
coinBalance
lifetimeCoinsEarned
```

Regras:

```text
não compráveis
não transferíveis
não sacáveis
podem ser gastos
lifetimeCoinsEarned nunca diminui
```

`coinBalance` é saldo disponível.

`lifetimeCoinsEarned` representa reputação histórica.

---

# 4. EvoCash

EvoCash é crédito premium.

Manter:

```text
cashBalance
```

Regras:

```text
pode ser comprado
não transferível
não sacável
não converte para dinheiro
não converte diretamente de EvoCoins
```

Usos previstos:

```text
criação de comunidade
promoção de conteúdo
anúncios
destaques
recursos premium
```

---

# 5. Wallet

Criar:

```text
users/{uid}/wallet/current
```

Exemplo:

```js
{
  coinBalance: 0,
  lifetimeCoinsEarned: 0,
  cashBalance: 0,
  updatedAt
}
```

Regras:

- frontend pode ler;
- frontend não pode escrever;
- backend/Admin SDK é autoridade;
- saldo nunca pode ficar negativo.

---

# 6. Ledger

Criar:

```text
users/{uid}/economyTransactions/{transactionId}
```

Exemplo:

```js
{
  asset: "coin" | "cash",
  direction: "credit" | "debit",
  amount,
  reason,
  referenceType,
  referenceId,
  idempotencyKeyHash,
  createdAt
}
```

Regras:

```text
append-only
client write false
leitura paginada
não recalcular saldo lendo ledger
```

Wallet contém saldo atual.

Ledger existe para auditoria.

---

# 7. Configuração econômica

Criar:

```text
economyConfig/current
```

Configuração inicial:

```js
{
  dailyActivity: {
    requiredMinutes: 30,
    rewardCoins: 3
  },

  voting: {
    costCoins: 3,
    maxVotesPerUserDay: 10,
    rewardCoinsPerPositiveVote: 1,
    maxRewardCoinsPerPostDay: 10,
    maxRewardCoinsPerAuthorDay: 30,
    maxRewardedVotesSameAuthorPerVoterDay: 3
  },

  privileges: {
    createCommunity: {
      minimumLifetimeCoins: 200,
      cashCost: 50
    }
  },

  version: 1,
  updatedAt
}
```

Esses valores são iniciais e ajustáveis.

Não espalhar valores fixos pelo código.

Nas Functions, usar cache em memória com TTL para evitar leitura da config em toda ação.

---

# 8. Recompensa diária por atividade

Regra inicial:

```text
30 minutos de atividade qualificada no dia
→ +3 EvoCoins
```

No máximo uma vez ao dia.

Não considerar apenas aba aberta.

Contar atividade real, como:

```text
navegação
registro de treino
consulta de progresso
interação com comunidade
ações reais no app
```

Criar:

```text
users/{uid}/economyDaily/{YYYY-MM-DD}
```

Exemplo:

```js
{
  activeMinutes,
  lastQualifiedActivityAt,
  activityRewardGranted,
  votesCharged,
  voteCoinsSpent,
  updatedAt
}
```

---

# 9. Performance da atividade

Não criar heartbeat frequente.

Meta:

```text
2–3 checkpoints relevantes por usuário/dia
```

Exemplo:

```text
15 minutos
30 minutos
checkpoint extra somente se necessário
```

Depois que o reward for concedido:

```text
parar de enviar checkpoints naquele dia
```

O backend valida timestamps e intervalos.

Nunca confiar em minutos enviados pelo frontend.

---

# 10. API interna

Não criar servidor separado.

Usar Firebase Cloud Functions.

Organização sugerida:

```text
functions/economy/
  config-service.js
  wallet-service.js
  ledger-service.js
  activity-service.js
  vote-service.js
  reward-settlement-service.js
  purchase-service.js
  privilege-service.js
  metrics-service.js
```

`index.js` deve apenas registrar/exportar Functions.

---

# 11. Idempotência

Toda operação econômica precisa ser idempotente.

Exemplos:

```text
daily-activity:{uid}:{date}
vote:{uid}:{postId}:charge
purchase-credit:{purchaseId}
community-create:{requestId}
```

Usar hash/ID seguro quando necessário.

Testar:

```text
duplo clique
retry
timeout
requisições simultâneas
reexecução da Function
```

Nunca duplicar crédito, débito ou ledger.

---

# 12. Sistema de votos

Reutilizar o sistema de votos existente, se houver.

Regras:

```text
primeiro voto em um post → -3 EvoCoins
positivo → -3
negativo → -3
troca positivo/negativo → sem nova cobrança
remoção do voto → sem reembolso
```

Limite inicial:

```text
10 votos pagos por usuário/dia
```

Um usuário só pode ter um voto ativo por post.

Sem auto-voto.

---

# 13. Voto atômico

Criar/adaptar callable Function:

```text
voteOnPost
```

Fluxo:

```text
Auth
App Check quando aplicável
rate limiting
post existe?
usuário pode votar?
voto atual?
wallet?
economyDaily?
↓
transaction
```

No primeiro voto:

```text
- debitar Coins
- atualizar wallet
- incrementar limite diário
- criar/atualizar voto
- criar ledger
```

Na troca:

```text
- atualizar voto
- não cobrar novamente
```

Saldo nunca negativo.

---

# 14. Documento de voto

Preferir lookup direto com ID determinístico.

Exemplo:

```text
posts/{postId}/votes/{uid}
```

ou estrutura equivalente já existente.

Campos:

```js
{
  userId,
  authorId,
  value: 1 | -1,
  charged: true,
  firstChargedAt,
  updatedAt,
  rewardState: "pending" | "processed" | "ineligible"
}
```

Evitar query para descobrir voto existente.

---

# 15. Recompensa do autor

Os 3 Coins gastos pelo votante são queimados.

Eles não vão diretamente para o autor.

Voto positivo elegível pode gerar:

```text
+1 EvoCoin para o autor
```

Voto negativo:

```text
0 recompensa
```

Não remover saldo do autor por voto negativo.

---

# 16. Reward do autor deve ser assíncrono

Não aumentar o custo do caminho crítico do voto.

O voto apenas registra:

```text
rewardState = pending
```

Depois um processador trabalha em lote.

Criar serviço:

```text
reward-settlement-service.js
```

O processador deve:

1. buscar votos positivos pendentes;
2. paginar;
3. agrupar por post, autor e relação votante→autor;
4. aplicar limites;
5. consolidar recompensa por autor;
6. atualizar wallet do autor;
7. criar ledger consolidado;
8. marcar votos processados.

---

# 17. Limites anti-farming

Aplicar:

```text
máximo de recompensa por post/dia
máximo por autor/dia
máximo votante→mesmo autor/dia
```

Valores vêm de `economyConfig`.

O voto social pode continuar existindo depois do limite econômico.

Não criar contador global.

---

# 18. Performance do reward

Preferir:

```text
8 votos elegíveis
→ +8 Coins
→ 1 wallet update
→ 1 ledger
```

em vez de:

```text
8 wallet updates
8 ledgers
```

Isso é especialmente importante para autores populares.

---

# 19. Hotspots proibidos

Não criar documentos como:

```text
globalVoteCounter
globalCoinCounter
globalCashCounter
globalEconomyDaily
```

atualizados a cada ação.

`wallet/current` por usuário é aceitável.

`economyDaily` por usuário é aceitável.

Reward de autor popular deve ser consolidado.

---

# 20. EvoCash

Depois do núcleo de EvoCoins funcionar, implementar compras manuais.

Criar:

```text
cashPurchases/{purchaseId}
```

Campos:

```js
{
  userId,
  packageId,
  amountBRL,
  cashAmount,
  configVersion,
  status: "pending" | "credited" | "cancelled",
  paymentMethod: "manual_pix",
  createdAt,
  creditedAt,
  creditedBy
}
```

---

# 21. Solicitação de compra

Criar:

```text
requestCashPurchase
```

Frontend envia somente:

```text
packageId
```

Backend busca preço e quantidade oficial.

Nunca confiar em:

```text
amountBRL
cashAmount
```

vindos do cliente.

Salvar snapshot dos valores no pedido.

---

# 22. Confirmação de compra

Criar callable admin:

```text
confirmCashPurchase
```

Fluxo:

```text
admin válido?
pedido pending?
↓
transaction
↓
wallet
ledger
purchase
↓
+ EvoCash
purchase = credited
```

A mesma compra nunca pode ser creditada duas vezes.

---

# 23. Painel admin

Adicionar:

```text
compras pending
detalhes da compra
confirmar pagamento
cancelar compra
consultar wallet
consultar ledger
```

Qualquer ajuste manual deve:

```text
passar por Function
ter motivo obrigatório
ter admin identificado
gerar ledger
```

---

# 24. Criar comunidade com EvoCash

Depois de EvoCash estabilizado, adaptar criação de comunidade.

Exemplo inicial:

```text
200 lifetime EvoCoins
+
idade mínima da conta
+
email verificado
+
conta regular
+
50 EvoCash
```

Valores vêm da configuração.

A operação deve ser atômica/segura.

Se criar a comunidade falhar:

```text
Cash não pode ser perdido
```

---

# 25. Promoções e anúncios

Preparar a arquitetura, mas não construir sistema complexo agora.

Primeira abordagem:

```text
X EvoCash
→ promoção por período definido
```

Não implementar inicialmente:

```text
CPC
CPM
leilão
marketplace
saque
P2P
```

---

# 26. Firestore Rules

Atualizar e testar.

Direção:

```text
wallet
owner → read
client → write false

economyTransactions
owner → read
client → write false

economyDaily
owner → read se necessário
client → write false

cashPurchases
owner → read próprio
client → write false

economyConfig
read conforme necessidade
client → write false
```

Não afrouxar Rules existentes.

---

# 27. App Check e rate limiting

Reaproveitar infraestrutura existente.

Aplicar onde fizer sentido:

```text
registerQualifiedActivity
voteOnPost
requestCashPurchase
confirmCashPurchase
```

App Check não substitui validação de negócio.

---

# 28. Exclusão de conta

Auditar `deleteAccount`.

Definir tratamento para:

```text
wallet
economyDaily
ledger
cashPurchases
votes
reward states
```

Não apagar ledger/auditoria automaticamente sem antes definir política.

Não alterar saldo de terceiros indevidamente ao excluir conta.

---

# 29. Performance e custo

Antes de finalizar cada fase, medir operações reais.

Meta inicial:

| Ação | Reads | Writes | Frequência |
|---|---:|---:|---:|
| Checkpoint atividade | ~1 | ~1 | 2–3/dia |
| Reward diário | poucas | poucas | 1/dia |
| Primeiro voto | ~4 | ~4 | máx. 10/dia |
| Troca de voto | ~2–3 | ~1 | limitada |
| Reward autor | consolidado | 1 wallet + 1 ledger por lote | assíncrono |
| Solicitar compra | ~0–1 | 1 | raro |
| Confirmar compra | ~2 | ~3 | raro |

Se uma ação simples precisar de operações demais, simplificar antes de prosseguir.

---

# 30. Paginação

Obrigatória para:

```text
ledger
compras
listas administrativas
listas grandes de votos
```

Nunca carregar collection inteira.

---

# 31. Índices

Criar somente índices exigidos pelas queries reais.

Evitar índices especulativos.

Avaliar desabilitar indexação de campos nunca consultados quando seguro.

---

# 32. Observabilidade

Adicionar logs estruturados para:

```text
reward diário
voto debitado
saldo insuficiente
limite atingido
reward consolidado
compra criada
compra creditada
falha de idempotência
```

Não registrar dados sensíveis desnecessários.

Não atualizar métrica global em cada ação.

---

# 33. Implementação por fases

## Fase 1

```text
wallet
ledger
economyConfig
atividade diária
reward EvoCoins
Rules
testes
UI de saldo
```

Ao terminar:

```text
PARE E ENTREGUE PARA REVISÃO
```

## Fase 2

```text
voto pago
limite diário
ledger do voto
```

Pare novamente.

## Fase 3

```text
reward assíncrono
limites antifarming
consolidação
```

Pare novamente.

## Fase 4

```text
EvoCash
pedido de compra
admin
confirmação
```

Pare novamente.

## Fase 5

```text
criação de comunidade com reputação + EvoCash
```

Pare novamente.

## Fase 6

```text
promoções/anúncios
```

Somente após validação das fases anteriores.

---

# 34. Testes obrigatórios

Cobrir:

```text
wallet inicial
reward diário
reward duplicado
heartbeat repetido
idempotência
saldo insuficiente
saldo negativo impossível
voto positivo
voto negativo
troca de voto
remoção de voto
auto-voto
limite diário
retry
concorrência
reward por post
reward por autor
reward votante→autor
reward consolidado
compra pending
compra duplicada
confirmação duplicada
EvoCash
comunidade sem saldo
comunidade com saldo
falha transacional
Rules
deleteAccount
legacy
```

Rodar:

```bash
npm test
npm run lint
npm run build
git diff --check
```

Também rodar Functions/Rules no emulator.

---

# 35. Entrega por fase

Informar:

```text
Arquivos alterados
Collections criadas
Functions criadas
Rules alteradas
Índices adicionados
Reads/writes por ação
Hotspots avaliados
Testes executados
Impacto de custo
Riscos
Pendências
```

Finalizar com:

```text
FASE PRONTA PARA REVISÃO
```

Não iniciar automaticamente a próxima fase.

---

# Restrições finais

Não fazer commit.
Não fazer push.
Não fazer deploy.
Não alterar produção.
Não criar recurso pago sem autorização.
Não executar backfill real.
Não integrar gateway de pagamento.
Não permitir saque.
Não permitir transferência entre usuários.
Não permitir escrita direta de saldo pelo frontend.
Não duplicar sistema de voto existente.
Não criar contadores globais no caminho crítico.
Não iniciar a fase seguinte sem autorização.
