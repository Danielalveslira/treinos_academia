# Evolutus — Guia de funcionamento da economia (EvoCoins e EvoCash)

**Destinatário:** Claude, ao trabalhar no repositório `treinos_academia`  
**Natureza:** documento de contexto técnico e funcional, não autorização de alteração  
**Data de referência:** 26/09/2026  
**Prioridade de evidência:** código da `main` atual > configuração efetiva `economyConfig/current` > testes > relatórios técnicos recentes > prompts históricos.

> **Atenção:** este guia combina a arquitetura documentada, a auditoria técnica de 21/09 e o estudo posterior da exclusão financeira. Ele **não substitui a leitura do código atual**. Há regras e valores abaixo que nasceram como *configuração inicial* ou *proposta*; não os apresente como valores atuais de produção sem verificar `economyConfig/current` e os serviços correspondentes. Não implemente novos “poderes” apenas porque constam como possibilidades futuras.

## 1. Visão geral: duas unidades, propósitos distintos

| Unidade | Papel | Saldo/indicador | Origem e utilização |
|---|---|---|---|
| **EvoCoins** | Participação, engajamento e reputação histórica | `coinBalance` e `lifetimeCoinsEarned` | Ganhos por atividade qualificada e recompensas econômicas elegíveis; saldo disponível pode ser gasto em ações sociais, como o primeiro voto pago. |
| **EvoCash** | Crédito premium interno ligado à monetização | `cashBalance` | No código auditado, entra somente após aprovação administrativa de uma compra por PIX; é consumido na criação de comunidade e em promoções de conteúdo. |

**Não confundir:** EvoCoins não se convertem em EvoCash. As duas unidades não são saldos intercambiáveis; não existe mecanismo de transferência P2P ou saque no desenho implementado. A inexistência de saque técnico **não decide**, por si, os eventuais direitos do comprador sobre crédito adquirido não utilizado, estorno ou reembolso.

## 2. EvoCoins: como funcionam e quais poderes dão

### 2.1 Saldo disponível versus reputação

- `coinBalance`: EvoCoins atualmente disponíveis. Pode aumentar por recompensa e diminuir por gastos.
- `lifetimeCoinsEarned`: total histórico conquistado, usado como sinal de reputação/participação. Gastar EvoCoins **não reduz** esse acumulado.
- EvoCoins não são comprados com dinheiro, não são transferidos entre contas e não são sacáveis no modelo documentado.

### 2.2 Atividade qualificada

A arquitetura inicial definiu **30 minutos de atividade qualificada no dia → 3 EvoCoins**, no máximo uma recompensa diária. O backend valida os checkpoints, intervalo, limite e concessão prévia; aba aberta, cronômetro local ou minutos arbitrários enviados pelo frontend não bastam. O controle diário está associado a `users/{uid}/economyDaily/{YYYY-MM-DD}`.

**Verificação necessária:** consultar `economyConfig/current.dailyActivity` e `registerQualifiedActivity` para informar os números efetivamente vigentes; 30/3 são valores documentados como iniciais, não garantia de configuração atual.

### 2.3 Votos econômicos e recompensa de autores

No desenho original, o **primeiro voto cobrado** em uma publicação custa EvoCoins, seja positivo ou negativo. Alterar o sentido do voto não deveria cobrar novamente, e remover o voto não deveria devolver os Coins. É permitida uma escolha ativa por usuário/publicação. O custo inicial documentado era **3 EvoCoins**, com limite inicial de **10 primeiros votos pagos/dia**, sujeito à configuração atual.

Um voto positivo elegível pode gerar recompensa de EvoCoins para o autor; os Coins debitados do votante não são uma transferência direta ao autor. O desenho inicial documentou **+1 EvoCoin** por voto positivo elegível, com limites por post, autor e par votante→autor, processados assincronamente/em lote. Voto negativo não gera recompensa econômica ao autor. A interação social aparece sem depender da liquidação econômica imediata.

**Verificação necessária:** conferir `voteOnPostV2`, `vote-service.js`, `reward-settlement-service.js`, Scheduler e `economyConfig/current.voting`. Não confundir um valor de exemplo com a regra que está publicada.

### 2.4 Requisito de reputação em privilégios

A criação paga de comunidade foi projetada para exigir **ambos**:

1. reputação histórica mínima (`lifetimeCoinsEarned`, além dos demais critérios da conta); e
2. saldo suficiente de EvoCash para o custo da operação.

Esse é um uso de EvoCoins como **critério de elegibilidade**, e não necessariamente como débito de Coins. O modelo inicial exemplificava 200 Coins históricos e 50 Cash, mas **os valores de produção devem ser lidos da configuração atual**; não hardcode nem altere esses requisitos por esta documentação.

## 3. EvoCash: os poderes efetivamente identificados

### 3.1 Aquisição via compra

No estudo técnico posterior, `creditCash()` em `wallet-service.js` tinha **um único ponto de chamada no backend**: `confirmCashPurchase` em `cash-purchase-service.js`, após confirmação administrativa de PIX. Não foi encontrada fonte de EvoCash gratuito, bônus ou troca de EvoCoins por EvoCash. Isso se refere à implementação auditada, não a uma garantia eterna para futuras versões.

Fluxo conceitual existente:

```text
Usuário escolhe pacote
  → requestCashPurchase
  → cashPurchases/{purchaseId}: pending
  → pagamento PIX conferido por administrador
  → confirmCashPurchase
  → transação: valida pedido + credita carteira + lança no ledger
  → compra: credited
```

Há também `cancelCashPurchase`, que altera um pedido **pendente** para `cancelled`, sem creditar EvoCash. Confirmar uma compra aumenta o saldo; cancelar uma compra ainda pendente não retira saldo já creditado. Duplicações e repetição de chamadas devem ser tratadas com idempotência.

Preços e pacotes vêm de `economyConfig/current.cashPackages`; o backend deve obter o pacote oficial e persistir o snapshot do preço/quantidade, não confiar em valores enviados pelo cliente. Valores mencionados em prompts antigos — inclusive R$ 5,90 por 25 EvoCash — não são prova de configuração vigente.

### 3.2 Criar comunidade

**Poder comprovado no estudo do código:** a criação de comunidade consome EvoCash por `privilege-service.js` (`debitCash`, motivo `create_community`). É um privilégio condicionado a saldo, reputação histórica e requisitos da conta, revalidados no backend.

A operação deve ser transacional: verificar elegibilidade, debitar a carteira, registrar o lançamento e criar comunidade/vínculo do titular de modo consistente. Se a transação falhar, não pode existir débito isolado sem a comunidade correspondente. Valor e critérios exatos: verificar `economyConfig/current.privileges.createCommunity` e código atual.

### 3.3 Promover publicação ou comunidade

**Poder comprovado no estudo do código:** `promotion-service.js` chama `debitCash` com `reason: 'promotion_purchase'`. O motor de promoções documentado contempla publicação (`post`/`status`) e comunidade; o alvo recebe sinalização de destaque/validade, como `promoted` e `promotedUntil`, conforme a implementação.

O desenho prevê pacotes configuráveis por tipo e duração em `economyConfig/current.promotionPackages`, validação do titular, saldo suficiente, ausência de conflito de promoção ativa e operação transacional de débito + ledger + promoção + atualização do alvo. Conferir o código atual para as categorias efetivamente aceitas; um documento de proposta não prova que Vitrine, catálogo ou outro tipo de alvo já foi habilitado.

### 3.4 O que NÃO afirmar como funcionalidade concluída

Os materiais de arquitetura mencionam anúncios, destaques adicionais e recursos premium como **possibilidades/roadmap**. Não presuma que qualquer anúncio patrocinado, item de Vitrine, perfil profissional, assinatura ou serviço tenha checkout em EvoCash sem localizar a callable, o débito no `wallet-service`, o lançamento e os testes correspondentes. O sistema de `SponsoredAds` ou parcerias pode ter modelo próprio; não misture os fluxos só pelo nome “anúncio”.

## 4. Implementação técnica compartilhada

### 4.1 Carteira (saldo materializado)

Caminho do documento:

```text
users/{uid}/wallet/current
```

Campos centrais documentados:

```js
{
  coinBalance,         // saldo consumível de EvoCoins
  lifetimeCoinsEarned, // total histórico conquistado
  cashBalance,         // saldo consumível de EvoCash
  updatedAt
}
```

O frontend pode **ler** a carteira autorizada, mas não escrever saldos. A autoridade da mutação é o backend via Cloud Functions/Admin SDK; não pode haver saldo negativo. `WalletContext` tem listener de leitura e precisa interrompê-lo quando o estado de exclusão/bloqueio da conta for identificado.

### 4.2 Ledger de movimentações

Caminho:

```text
users/{uid}/economyTransactions/{transactionId}
```

Campos-base documentados:

```js
{
  asset: 'coin' | 'cash',
  direction: 'credit' | 'debit',
  amount,
  reason,
  referenceType,
  referenceId,
  idempotencyKeyHash,
  createdAt
}
```

O ledger é **append-only**, com IDs/chaves determinísticas ou hash para idempotência. O saldo mostrado ao usuário vem do documento da carteira: não se deve recalculá-lo varrendo todo o ledger em cada tela. Histórico/listagens são paginados. Nunca editar um lançamento antigo para “corrigir” uma transação; eventuais operações de compensação exigem um desenho próprio e novos lançamentos auditáveis.

Motivos de EvoCash explicitamente encontrados no estudo recente: crédito por confirmação de compra; débitos `create_community` e `promotion_purchase`. Outros motivos devem ser confirmados na `main` antes de documentar como existentes.

### 4.3 Configuração da economia

```text
economyConfig/current
```

Blocos relacionados: `dailyActivity`, `voting`, `privileges.createCommunity`, `cashPackages`, `promotionPackages` (verificar schema efetivo na `main`). Preço, custo, duração, recompensa e limites não devem depender de constantes duplicadas no frontend. A configuração de compra/privilégio inválida ou ausente deve bloquear a operação (*fail-closed*), sem inventar preço de fallback.

### 4.4 Documentos de apoio

```text
users/{uid}/economyDaily/{YYYY-MM-DD}  // atividade/recompensa/votos do dia
cashPurchases/{purchaseId}             // pedidos de compra PIX
promotions/{promotionId}               // impulsionamentos
users/{uid}/economyTransactions/{id}   // auditoria individual
```

As transações financeiras devem suportar duplo clique, retry, execução repetida, falha intermediária e concorrência sem duplicar crédito ou débito. O cliente não é autorizado a escrever diretamente a carteira ou o ledger.

### 4.5 Mapa para leitura de código (confirmar nomes/caminhos na main)

- `functions/economy/wallet-service.js`: saldos e operações `creditCash`, `debitCash`, e respectivas funções de Coins.
- `functions/economy/ledger-service.js`: lançamentos e idempotência.
- `functions/economy/config-service.js`: configuração e validações.
- `functions/economy/activity-service.js`: recompensa de atividade.
- `functions/economy/vote-service.js` e `reward-settlement-service.js`: votos e recompensa assíncrona.
- `functions/economy/cash-purchase-service.js`: `requestCashPurchase`, `confirmCashPurchase`, `cancelCashPurchase`.
- `functions/economy/privilege-service.js`: gasto de Cash na criação de comunidade.
- `functions/economy/promotion-service.js`: promoção e débito de Cash.
- `functions/index.js`: exportação de callables/agendamentos.
- `src/contexts/WalletContext.jsx`, telas de compra e administração: exibição/interação, sem escrita direta de saldo.

Este é um **mapa de referência**, não lista exaustiva; localizar implementações reais no checkout atual.

## 5. Exclusão de conta e importância do EvoCash

O caso recente de `deletionJobs/account_{uid}` mostrou:

```text
state: blocked_financial_review
blockReason: positive_cash_balance
stage: 0
```

Ou seja: com saldo positivo, o fluxo atual de exclusão não prossegue automaticamente; isso protege o crédito e impede a eliminação da carteira antes de uma resolução. O PR #55 (`feat/admin-account-deletion-review`) trouxe visibilidade administrativa e **revalidação do bloqueio**, mas revalidar **não** zera Cash nem resolve saldo comprado.

O estudo subsequente aprovou **como direção técnica** a separação futura da conta operacional e de um processo financeiro restrito. Essa mudança exige implementação, política formal, testes e autorização específica antes da ativação. **Não documentar como função já publicada**, nem alterar `cashBalance`, `cashPurchases`, ledger ou estado do job para contornar o portão. Confirmar/cancelar compra não equivale a reembolsar EvoCash já adquirido.

O estudo encontrou que o ledger e as compras podem sobreviver à exclusão operacional; a política de retenção financeira e o tratamento de saldo remanescente ainda precisam de definição formal. “Não existe saque na interface” não significa “o cliente perde seu crédito ao excluir a conta”.

## 6. Matriz de implementação versus planejamento

| Função | Situação segundo os materiais disponíveis | O que verificar no código atual |
|---|---|---|
| EvoCoins por atividade qualificada | Arquitetura e auditoria técnica descrevem implementação | `registerQualifiedActivity`, config, limite diário |
| EvoCoins em voto e recompensa ao autor | Arquitetura e auditoria descrevem implementação | `voteOnPostV2`, settlement agendado, antifarming |
| EvoCoins como requisito de reputação | Descrito no privilégio de comunidade | `lifetimeCoinsEarned`, validações atuais |
| Compra de EvoCash por PIX manual | Confirmada no estudo do backend | `requestCashPurchase`, confirmação/cancelamento, ledger |
| EvoCash para criar comunidade | Confirmado no estudo do backend | `createCommunityWithCash`, config e lançamento |
| EvoCash para promoção | Confirmado no estudo do backend | `createPromotion`, tipos e pacotes ativos |
| EvoCash para qualquer anúncio/Vitrine/assinatura | **Não comprovado genericamente** | Só afirmar se achar débito e fluxo publicado específicos |
| Saque, transferência P2P, conversão Coins→Cash | Não implementados no modelo documentado | Conferir antes de propor mudança |
| Reembolso, ajuste financeiro, congelamento separado de saldo | Lacuna técnica/política reconhecida no estudo | Não inventar função ou tratar como existente |

## 7. Instrução ao Claude para usar este documento

Ao receber uma tarefa relacionada a EvoCoins/EvoCash:

1. Leia este guia para entender as intenções e as funcionalidades identificadas.
2. Leia a `main`/branch de trabalho e a configuração real antes de declarar valores atuais, recursos ativos ou nomes de funções.
3. Em sua resposta, separe **implementado e comprovado**, **parâmetro configurável**, **planejado** e **decisão jurídica/financeira pendente**.
4. Trace qualquer mudança econômica desde a UI até callable, validação, transação, wallet, ledger, Rules e testes. Preserve a economia global ao tocar em comunidades, promoções, anúncios, Vitrine ou exclusão de conta.
5. Não criar emissão gratuita de EvoCash, conversão, transferência, saque, reembolso ou ajuste manual sem decisão de negócio expressa e desenho financeiro auditável.
6. Não fazer commit, push, merge, deploy, mudança de saldo ou intervenção em contas reais com base apenas neste guia; solicite autorização específica para a tarefa operacional.
7. Preserve `docs/prompts/` e alterações não relacionadas. Se o documento for usado para uma implementação, entregue o diff, testes e riscos antes de qualquer publicação.

## 8. Fontes de referência utilizadas para compor este guia

- `prompt_unico_economia_evolutus_primeira_implementacao.md` — desenho inicial; muitos números são parâmetros **iniciais**, não valores de produção.
- `arquitetura_economia_evolutus_v2_performance.md` — wallet/ledger, processamento assíncrono, baixo custo e idempotência.
- `Auditoria Tecnica Completa — Evolutus.md` (21/09/2026) — leitura estática do projeto com fluxos econômicos implementados.
- Estudo **“exclusão operacional com pendência financeira separada”** fornecido na conversa — inspeção direcionada de `creditCash`, `debitCash`, `cashPurchases`, retenção e portão financeiro; nenhuma mudança de código nessa etapa.

**Limitação explícita:** não foi disponibilizado nesta conversa um checkout completo e atualizado do repositório. O guia é uma síntese fundamentada nos documentos e relatórios fornecidos e deve ser reconciliado com a versão atual do código pelo Claude antes de decisões de implementação.
