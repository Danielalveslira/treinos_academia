# EVOLUTUS — Plano mestre de reestruturação comercial e financeira

**Versão:** 1.0 — 27/10/2026  
**Natureza:** planejamento técnico e funcional; **não é implementação**  
**Base auditada:** arquivo `treinos_academia-main (2).zip` enviado nesta conversa  
**Stack:** React + Vite + Primer React; Supabase/Postgres (RLS/RPC/Edge Functions); InfinitePay; Vercel  
**Diretrizes:** segurança financeira, mínimo de código, reutilização comprovada, manutenção, performance mobile-first, SEO, migrações aditivas, auditoria e testes focados.

> **Status da evidência:** as conclusões abaixo descrevem o código do ZIP, **não uma inspeção do banco em produção**. O repositório contém migrations com nomes datados até novembro/2026, posteriores à data deste plano. Antes de executar, identificar quais migrations foram de fato aplicadas, diferenças de schema, feature flags, rotas e configuração ativa. Não assumir que a existência de um arquivo SQL significa que ele está instalado na produção.

---

## 1. Objetivo e decisões fechadas

Criar uma plataforma comercial autônoma na qual pessoas e empresas possam comprar EvoCash sob demanda, contratar publicidade por posição e número de dias, manter vitrines de produtos, estabelecimentos e perfis profissionais no ar por períodos pagos, e adquirir futuramente fichas premium **vendidas exclusivamente pelo Evolutus**.

**Decisões inegociáveis:**

1. **Só o Evolutus vende fichas.** Nenhuma API, tela, permissão, comissão, saque ou repasse para profissionais venderem fichas.
2. **EvoCash sob demanda:** comprador informa a quantidade inteira de créditos e visualiza a quantia em reais antes do checkout InfinitePay. Pacotes deixam de ser a modalidade comercial ativa após migração segura.
3. **Preço do EvoCash administrável** em `/admin/compras-evocash`, com histórico imutável, auditoria, confirmação, validação rigorosa e vigência versionada. Alterações não afetam saldos nem pedidos já formalizados.
4. **Publicidade por dias e posicionamento:** comunidade, Home e pacote de posições elegíveis da plataforma; preços independentes e configurados pelo administrador. Pacote global explicitamente versionado, não uma permissão irrestrita para qualquer tela futura.
5. **Vitrines pagas por período:** vitrine de produtos, estabelecimento (`space`) e perfil profissional (`professional`) usam o **mesmo motor comercial** de cobrança, vigência, renovação, expiração e controle público; preservam seus modelos editoriais específicos.
6. **Expiração automática:** no fim do período, o conteúdo deixa de ser publicamente acessível e continua editável/renovável em área privada. Sem cobrança automática ou renovação silenciosa.
7. **Publicidade adicional ≠ publicação básica:** o período pago de uma vitrine permite sua presença pública; um impulsionamento opcional compra posicionamento extra e possui prazo próprio. O destaque não prorroga a publicação-base.
8. **EvoCoins continuam separados:** proibir intercâmbio com EvoCash, saque, transferência entre usuários ou conversão em dinheiro nesta fase.
9. **Sem venda por terceiros:** não construir infraestrutura de marketplace, split, comissões ou carteira sacável para esse cenário.
10. **Nunca abandonar histórico financeiro nem controles operacionais existentes** para simplificar migrations.

### 1.1 Não objetivos

- Transformar EvoCash em moeda, investimento, ativo com cotação de mercado ou saldo resgatável.
- Cobrança por clique, impressão ou alcance garantido na primeira entrega.
- Assinatura com cobrança recorrente, renovação automática e cobrança sem confirmação.
- Venda de produtos físicos pelo Evolutus; a vitrine exibe itens e pode direcionar à loja externa do empreendedor.
- Criar “taxa de anúncio universal” que ignore capacidade, contexto ou restrições de acesso.
- Reescrever a economia existente, mover tudo para novas carteiras ou limpar tabelas financeiras históricas.

---

## 2. Auditoria do estado real encontrado no ZIP

| Área | Artefatos atuais | Achado e decisão |
|---|---|---|
| EvoCash | `src/pages/EvoCash.jsx`, `src/components/CashPackageCards.jsx`, `src/services/cashPurchaseService.js` | Fluxo por `packageId`, lido de `economy_config.config.cashPackages`; substituir somente interface e caminho de nova compra, preservando leitura de históricos antigos. |
| Backend de compra | `supabase/functions/infinitepay-create-checkout/{index.ts,core.js}`; `reserve_infinitepay_cash_purchase` | Valida `packageId`, reserva compra e cria URL. Precisa receber cotação/quantidade de forma controlada e preservar idempotência, locks e tratamento de timeout incerto. |
| Confirmação | `infinitepay-webhook`, `infinitepay-check-payment`, `infinitepay-admin-reconcile`, `confirm_infinitepay_cash_purchase` | Reaproveitar a confirmação autoritativa, conciliação, verificações de pedido/valor, estorno e regras para conta desativada. Não duplicar motores de crédito. |
| Ledger | `wallets`, `economy_transactions`, `_wallet_credit_cash`, `_wallet_debit_cash`, `_ledger_record` | Usar o mesmo ledger e locks. `cash_balance` é por **usuário** e não suporta contas empresariais como proprietárias sem mudança arquitetural. |
| Promoções | `promotions`, `promotionPackages`, `create_promotion`, `src/services/promotionsService.js` | Impulsionamentos de postagem/comunidade já debitam EvoCash. Migrar a precificação e a experiência por etapas, não apagar promoções existentes. |
| Anúncios | `sponsored_ads`, `src/services/sponsoredAdsService.js`, `AdminSponsoredAds.jsx` | Criação/edição por superadmin; `is_global`, `community_ids` e `display_mode` já modelam posicionamentos. Precisam de fluxo comercial e aprovação sem liberar insert/update irrestritos a anunciantes. |
| Capacidade | `enforce_sponsored_ad_caps` | Trigger limita quantidade por comunidade e global, **contando inclusive anúncios expirados**. Corrigir modelo de capacidade para vigências antes de abrir publicidade self-service. |
| Métricas | `sponsored_ad_daily_stats`, `advertiser_accounts`, `advertiser_members`, `advertiser_campaigns` | Há métricas e atribuição por conta, com permissões originalmente restritas à leitura. Reutilizar relatórios; ampliar papéis sem quebrar a trilha de atribuição histórica. |
| Produtos de vitrine | `partner_products`, `CommercialAdmin.jsx`, `PartnerProductList.jsx` | CRUD atual exclusivo do superadmin; produtos não têm vínculo com uma vitrine/empreendedor. Criar proprietário e agrupamento, conservando registros administrativos existentes. |
| Perfis/estabelecimentos | `professional_listings`, `professional_listing_drafts`, `published_professional_listings`, `professionalListingsService.js` | `kind` já diferencia `professional` e `space`; fluxos de rascunho/publicação/arquivamento devem permanecer. Adicionar elegibilidade comercial centralizada. |
| Diretório público | `public_list_professionals`, `public_get_professional`, `public_professional_avatar_visible` | RPCs `SECURITY DEFINER` e política de Storage requerem **o mesmo** filtro de vigência, incluindo visualização direta e fotos. |
| Compras administrativas | `src/pages/AdminCashPurchases.jsx`, rota `/admin/compras-evocash` | Já integra cancelamentos, revisão e conciliação. Adicionar abas **Compras / Precificação / Histórico de preços** no mesmo local. |
| Economia e contas | `economy_config`, políticas de RLS, `has_app_access`, `is_session_active`, `is_superadmin` | Reutilizar, verificar as versões efetivas e manter controle financeiro separado das preferências de UI. |

**Dependências obrigatórias de compatibilidade:** `cash_purchases`, `account_financial_cases`, reversões/chargebacks, cancelamentos tardios, `cash_purchase_reminder_emails`, Realtime da carteira, exclusão de conta, operações offline/sync, ações de moderação e logs. Os fluxos de contas suspensas/excluídas não podem deixar de reconhecer compras históricas.

**Atenção específica:** o script `20261108000001_public_commercial.sql` cria `partner_products` sob políticas de leitura pública e escrita administrativa. O `20261110000001_public_professional_directory.sql` publica informações via RPCs. A simples adição de `expires_at` em componentes React **não** restringiria todos esses caminhos.

---

## 3. Domínios e limites de responsabilidade

Organizar em módulos separados com **um motor comum de contratação**:

```text
Identidade e permissão (Supabase Auth / status da conta)
       |
       +-- Conta comercial / membros / papéis
       |       +-- Criativos e conteúdos (anúncio, vitrine, perfil, estabelecimento)
       |
       +-- Economia financeira existente (usuário -> carteira -> ledger)
               +-- Precificação EvoCash BRL
               +-- Cotação e compra EvoCash -> InfinitePay -> confirmação
               +-- Tabela comercial de serviços em EvoCash
               +-- Pedido comercial / débito atômico / direito de exibição
                       +-- Publicidade por posicionamento
                       +-- Vitrine de produtos
                       +-- Perfil profissional / estabelecimento
                       +-- Ficha premium oficial (futuro; compra única)
```

**Não unir tabelas de conteúdo com tabelas de dinheiro.** O conteúdo pode ser editado/arquivado, mas transações, preços aplicados, direitos concedidos, decisões administrativas e histórico não devem ser modificados silenciosamente.

### 3.1 Conta comercial vs. carteira de usuário

- **Etapa inicial segura:** `commercial_accounts`/conta de anunciante define **proprietário do conteúdo**, equipe e campanhas; `payer_user_id` identifica o usuário autenticado cuja carteira pessoal forneceu o EvoCash. O serviço pertence à conta comercial; o débito e o lançamento permanecem rastreáveis ao usuário pagante. Isso **não equivale** a carteira compartilhada.
- Reaproveitar `advertiser_accounts` e `advertiser_members` **se** os contratos, FKs e funções atuais puderem ser estendidos sem ambiguidade. Evitar criar uma segunda entidade “empresa” com identidade duplicada. `advertiser_campaigns` continuará registrando atribuição histórica.
- Papéis propostos: `owner` (titular, equipe), `manager` (conteúdo/campanhas), `finance` (contratações/pagamentos), `viewer` (relatórios). Permissão de debitar requer papel específico **e** autorização do titular da carteira pagante; papel de empresa sozinho não autoriza movimentar fundos de outra pessoa.
- **Carteira corporativa compartilhada** só em fase posterior, mediante projeto próprio de razão por titular empresarial, dupla entrada/transferência e conciliação; não adaptar `wallets.user_id` como se fosse ID de empresa. Se for requisito para liberar empresas com múltiplos pagantes, tratar como dependência bloqueante dessa fase, não fazer remendo.

### 3.2 Produto e tipo de direito

- `visibility_lease`: direito temporário de exibição de anúncio, vitrine ou perfil.
- `content_entitlement`: acesso duradouro à ficha oficial comprada; não utilizar `expires_at` para vendas permanentes.
- `placement_addon`: destaque publicitário opcional que depende da publicação-base estar válida.
- A decisão de exibir deve ser **calculada no servidor** a partir de publicação moderada, assinatura de direito ativa, elegibilidade do proprietário, capacidade e contexto de acesso.

---

## 4. EvoCash sob demanda e precificação administrativa

### 4.1 Modelo de preço

- Preço administrado em **centavos de BRL por unidade inteira de EvoCash**. Para valores menores que R$ 0,01 por unidade no futuro, criar fração racional com numerador/denominador inteiros; **não** introduzir `float` ou arredondamento em JavaScript.
- Cálculo v1: `total_centavos = quantidade_inteira * preco_unitario_centavos`, com `NUMERIC`/`BIGINT` no SQL, validação de overflow e coerção tipada na borda. Nunca usar `Number` como fonte de verdade financeira.
- Quantidade mínima/máxima por pedido, teto diário e total por usuário, validade da cotação e preço mínimo são **configurações administrativas**, definidas no rollout (não inventar valores comerciais como se estivessem aprovados).
- Preço efetivo por versão, nunca alterado in-place; preço corrente = versão aprovada, ativa e dentro da vigência. Falha na leitura => **compra bloqueada**.
- Um novo preço afeta **somente novas cotações**, nunca carteira já creditada, compras feitas, links existentes, parcelamento ou reversões.

### 4.2 Experiência do comprador (`/evocash`)

1. Seleciona a quantidade (inteiro), vê preço unitário, valor total em reais, termos comerciais e método(s) aceitos pelo provedor.
2. Solicita **cotação ao servidor** e recebe `quote_id`, quantidade, preço, total e expiração. O frontend apenas renderiza.
3. Confirma explicitamente a cotação e solicita checkout usando `quote_id` + chave de idempotência; não envia valor total autoritativo.
4. Backend valida usuário, sessão, elegibilidade, cotação, limites, versão e compra pendente; reserva pedido com valores imutáveis.
5. Edge Function gera link InfinitePay no servidor com pedido único, valor em centavos, retorno e notificação. Credenciais nunca aparecem no navegador.
6. Redireciona ao checkout **somente após** persistir a URL validada. A página de retorno exibe “em verificação” até pagamento confirmado.
7. Conciliação confirma pedido, origem, identificador do provedor e valor; credita EvoCash **uma única vez** em transação SQL com ledger. Notificar o usuário sem criar nova mutação financeira no frontend.

**Falhas cobertas:** abandono do checkout, duplo clique, duas abas, timeout após criação remota, resposta ambígua, link expirado, callback duplicado/fora de ordem, pedido cancelado pago tardiamente, pagamento parcial/divergente, conta bloqueada e chargeback posterior. Manter reconciliação administrativa e fluxos de caso financeiro.

### 4.3 Estrutura proposta de dados (nomes a ajustar após inspeção do schema vivo)

| Entidade | Campos principais / invariantes |
|---|---|
| `evocash_price_versions` | `id`, `unit_price_centavos`, `active_from`, `created_by`, `created_at`, `reason`, `previous_version_id`, estado de publicação; imutabilidade do conteúdo publicado. |
| `evocash_purchase_quotes` | `id`, `user_id`, `quantity`, `unit_price_centavos`, `total_centavos`, `price_version_id`, `expires_at`, status; leitura só pelo dono; validade breve. |
| `cash_purchases` (**evoluir**) | `purchase_mode` (`legacy_package`/`quantity`), `quantity`/`cash_amount`, `price_version_id`, `quote_id`, preço travado, pedido/identidades do provedor, status; histórico de `package_id` preservado. |
| `commercial_price_versions` | Preços por serviço/posição, unidade `EvoCash/dia` (ou `EvoCash/unidade` para fichas), vigência e auditoria. |
| `admin_price_audit` | Ator, versão antiga/nova, justificativa, aprovação e metadados não sensíveis; histórico append-only. |

**Compatibilidade do schema:** `cash_purchases.package_id` e `package_label` são `NOT NULL` no modelo atual. Para a compra por quantidade, criar migration **aditiva** que permite `NULL` exclusivamente em `purchase_mode='quantity'`, introduz `CHECK` por modalidade e preserva registros legados. Não falsificar novas compras com um `package_id` artificial sem documentar e testar a transição. Não alterar RPCs antigas in-place se clientes ativos ainda puderem utilizá-las; oferecer função v2 e migrar chamadores antes de descontinuar a versão anterior.

**Controle de concorrência:** serializar publicação de preço e cotação corrente; impedir duas versões vigentes com sobreposição efetiva. A alteração concorrente usa número de revisão/compare-and-swap ou lock transacional. Todo evento registra usuário superadmin, motivação e instante.

### 4.4 Admin — `/admin/compras-evocash`

Abas do Primer React:

1. **Compras:** manter filtros, conciliações, anomalias, revisão financeira, cancelamentos, lembretes e histórico existentes.
2. **Precificação:** preço vigente (R$/EvoCash), simulação de várias quantidades, comparação com preço anterior, impacto percentual, limites e data de vigência; “Publicar novo preço” abre confirmação explícita, exige justificativa e revalidação de privilégios/sessão recente.
3. **Histórico de preços:** tabela paginada e auditável de versões, autor, razão, horário, estado, pedidos afetados apenas em caráter agregado.

Backend: RPC/Edge Function restrita a `is_superadmin()` + acesso ativo/revalidação, com `SECURITY DEFINER` com `search_path` fixo, schema qualificado, `REVOKE EXECUTE` padrão e `GRANT` mínimos. Tratar segredo como segredo e não salvar credenciais nas tabelas de preço.

**Regra especial:** mudança grande de preço pode exigir confirmação adicional/segunda aprovação segundo limiar configurável; criar política de emergência para pausar novas compras sem revogar pedidos já aceitos. Nunca criar opção “zerar saldo” associada a precificação.

---

## 5. Catálogo comercial e preços por dia

Catálogo único para **o que pode ser contratado**, mantendo conteúdo e preço separados.

| Código lógico (sugestão) | Cobrança | Entrega |
|---|---|---|
| `ad_community` | EvoCash × dias × comunidades/posições contratadas | Anúncio em comunidade(s) autorizada(s), condicionado à elegibilidade |
| `ad_home` | EvoCash × dias | Área patrocinada da Home |
| `ad_network` | EvoCash × dias | Conjunto **versionado e explícito** de posicionamentos disponíveis |
| `post_boost` | EvoCash × dias | Impulsionamento de postagem existente, quando elegível |
| `community_boost` | EvoCash × dias | Destaque de comunidade existente |
| `product_storefront` | EvoCash × dias | Vitrine de produtos e seus itens vinculados |
| `professional_profile` | EvoCash × dias | Perfil público `kind='professional'` |
| `establishment_profile` | EvoCash × dias | Estabelecimento `kind='space'` |
| `official_workout_sheet` (futuro) | EvoCash × compra | Acesso pessoal à ficha oficial da plataforma |

**Preço contratado = snapshot imutável:** `unit_rate_cash × duration_days`, mais multiplicador explícito de escopo **apenas se** validado no backend e exibido antes de confirmar. Sem cobrança surpresa por impressões/cliques. Tarifas de publicidade devem ser **independentes** do preço BRL de compra do EvoCash.

O administrador poderá ativar/desativar produtos, ajustar faixas de prazo e versões de preço em seção comercial própria. Nunca permitir que uma alteração de tarifa recalcule direito já comprado.

### 5.1 Capacidade e inventário de posições

- Modelar posições: `home_banner`, `community_feed`, `community_banner` e outras **somente após serem implementadas**. Validar convenções existentes de `display_mode` e métricas; não inventar posições que nenhuma tela renderiza.
- `ad_network` aponta para uma versão do conjunto de posições elegíveis; nova página do app não passa a fazer parte retroativamente de campanhas pagas.
- Exibição de anúncio na Home requer área compatível com o layout inteligente existente; não deve impedir painel de ficha, operações de treino ou navegação principal.
- Fixar teto de criativos/ocupação por slot e janela; reservar capacidade para os períodos efetivos. Rejeitar antes de debitar se esgotado.
- **Revisar e substituir cuidadosamente** o trigger `enforce_sponsored_ad_caps`, que hoje conta campanhas vencidas. Fazer contagem de reservas **vigentes e sobrepostas**, com locks contra corrida de duas compras simultâneas; não apenas `SELECT COUNT` sem serialização.
- Se a disponibilidade for por compartilhamento rotativo, informar que contratar dias garante **elegibilidade de exibição**, não 100% do tempo, posição fixa ou audiência mínima.
- Métricas são relatórios, **não mecanismo de cobrança** nesta fase; preservar a política de privacidade da coleta e verificar `sponsored_ad_metrics_settings` no ambiente real.

---

## 6. Motor de pedidos e direitos temporários

### 6.1 Modelo de tabelas

| Entidade | Finalidade |
|---|---|
| `commercial_offerings` | Registro estável do tipo de serviço, regras e elegibilidade; referenciado pela versão comercial. |
| `commercial_price_versions` | Taxa, unidade, condição de vigência, autor, motivo, snapshot. |
| `commercial_orders` | Pedido por comprador/conta comercial, alvo, duração, orçamento/tarifa final, preço, estado, idempotência e timestamps. |
| `commercial_order_events` | Histórico append-only das mudanças de estado, decisões e erros seguros. |
| `visibility_entitlements` | Direito concedido, `subject_type/id`, posicionamento/scope, `starts_at`, `expires_at`, `paid_order_id`, estado administrativo; relação auditável. |
| `commercial_moderation` | Revisão de criativo/alterações, reprovado/aprovado, motivo e revisor. |
| `commercial_accounts` **ou extensão de `advertiser_accounts`** | Proprietário comercial, status, membros e permissões; decidir após checar FKs e uso atual. |
| `commercial_account_audit` | Mudança de proprietário, membro, publicação, orçamento, suspensão e acesso. |

**Evitar excesso de tabelas:** consolidar `commercial_order_events` e auditoria de ações quando a semântica e retenção forem realmente iguais. Módulos de apresentação (`ad`, `storefront`, `profile`) permanecem separados; só o financeiro e o lifecycle compartilham o motor.

### 6.2 Máquina de estados recomendada

```text
CRIATIVO: draft -> submitted -> approved -> archived
                             \-> rejected -> draft

PEDIDO: quoted -> committing -> paid -> fulfilled
          |           |          \-> remediation_required
          |           \-> failed (sem débito)
          \-> expired (sem débito)

DIREITO: scheduled -> active -> expired
                         \-> suspended / revoked
```

**Implementação deliberada para evitar escrow inicial:** primeiro validar/moderar conteúdo e conferir capacidade; **depois** confirmar pedido e debitar EvoCash em uma transação SQL que grava compra e concessão de direito. Não consumir dias enquanto o conteúdo aguarda revisão. Revalidar aprovação, versão do criativo, capacidade e proprietário **na transação de cobrança**, pois podem mudar entre o preview e a confirmação.

Para um fluxo futuro “pagar antes de moderar”, exigir saldo **reservado** em subledger/escrow separado e devolução atômica; não inserir esse risco silenciosamente na v1.

### 6.3 Regras temporais e renovação

- “1 dia” = **24 horas exatas**, contadas em `timestamptz`/UTC, exibidas em `America/Sao_Paulo` com fuso na interface; não comparar datas locais do celular.
- Contratação imediata: `starts_at=now()` do banco; `expires_at=starts_at + 24h × dias` com aritmética em segundos/UTC.
- Contratação antecipada: não oferecer no MVP sem suporte real a inventário de datas; preparar contrato para expansão posterior.
- Renovar **antes** de vencer: `new_expires_at = greatest(current_expires_at, now()) + 24h × dias`. Renovar **depois**: inicia período novo em `now()` e preserva o mesmo conteúdo/identidade pública.
- Nunca criar períodos sobrepostos faturados duas vezes por repetição de chamada. `order.idempotency_key` vinculada ao usuário/conta e ao payload; retries da mesma operação devolvem o mesmo resultado.
- Ao chegar a `expires_at`, exibição cessa **imediatamente** por predicado do servidor. Um cron opcional consolida status administrativo e avisa, mas **não controla** a segurança de publicação.
- Arquivar/expirar não apaga imagens, itens, avaliações, campanhas, históricos nem referências financeiras. O proprietário pode editar no privado e recontratar pelo preço vigente.
- Política de interrupção: bloqueio por violação das regras **não** estende prazo automaticamente; erro operacional do Evolutus pode gerar prorrogação gratuita auditada ou crédito compensatório via ledger, conforme política aprovada. Cancelamento voluntário e devolução seguem os termos publicados e legislação aplicável.

### 6.4 Transação monetária atômica — requisito

Na mesma transação PostgreSQL, sob locks na carteira, pedido, objeto e inventário:

1. Autenticar/revalidar acesso do pagante e permissão sobre conta/alvo.
2. Validar produto ativo, preço congelado, duração, moderação e capacidade.
3. Verificar idempotência e ausência de direito conflitante.
4. Garantir saldo suficiente, chamar a primitiva existente `_wallet_debit_cash`.
5. Escrever entrada única e correlacionada em `economy_transactions` via `_ledger_record`.
6. Gravar pedido finalizado, concessão de direito e eventos de auditoria.
7. Confirmar commit **só se tudo foi concluído**; falha causa rollback completo, sem cobrança isolada.

Nenhum endpoint do frontend deve conseguir fazer `UPDATE` direto no saldo, preço aceito, direito ou estado de pedido. Retorno duplicado deve devolver o pedido existente sem novo débito. Consumo de serviço deve ter chave natural estável por pedido.

---

## 7. Vitrine de produtos para empreendedores

### 7.1 Modelo editorial

- **Vitrine** = identidade comercial (título, descrição, imagem de capa, contato, política, status e proprietário) + coleção de produtos.
- **Produto** = item de catálogo associado a `storefront_id`, com imagem obrigatória (preservar validação existente), preço/URL de loja/descrição/categoria e status de moderação.
- Uma contratação paga **a visibilidade da vitrine inteira pelo período**; não cobrar novamente por cada produto, salvo produto comercial futuro explicitamente distinto.
- Adicionar limite claro de produtos, tamanho de mídia e taxas de edição; controles definidos por regra administrativa e verificáveis no servidor.
- Conteúdo rascunho pode ser salvo gratuitamente. Só se torna público se a vitrine e seus produtos estiverem aprovados e o direito estiver vigente.
- Proprietário renova a **mesma** vitrine sem perder produtos, URLs estáveis ou configurações.

### 7.2 Migração de `partner_products`

1. Inventariar linhas existentes e distinguir material oficial/administrativo de itens de empreendedores.
2. Criar entidade de vitrine e coluna de vínculo opcional no início; preservar produtos antigos durante transição.
3. Implementar isolamento de propriedade e CRUD autenticado via RPCs/RLS limitadas à própria vitrine, com mídia protegida e validação de URLs externas.
4. Migrar tela pública para consultar vitrine elegível e seus produtos sem N+1; paginar itens, projetar apenas campos necessários.
5. Definir política explícita de **conteúdo legado sem vínculo**: manter em área administrativa até decisão, sem conceder publicação perpétua nem remover dados arbitrariamente.
6. Remover caminhos `insert/update/delete` de superadmin **somente se** substituídos por serviços novos e ainda oferecer ferramenta moderadora compatível.

**Não utilizar `partner_products.sponsored` como autorização de cobrança.** “Patrocinado” deve decorrer de `placement_addon` vigente e aprovado, não de booleano editável.

---

## 8. Perfil profissional e vitrine de estabelecimento

Reaproveitar a mesma estrutura editorial existente:

- `professional_listings.kind='professional'` = perfil profissional;
- `professional_listings.kind='space'` = estabelecimento/local;
- Rascunhos, publicação, legal/termos, revisão, avatar publicado, suspensões e moderação preservados.

**Mudança estrutural:** ligar `listing_id` a `visibility_entitlements` vigente. Ser `lifecycle_state='published'` passa a ser necessário, **mas insuficiente**, para leitura pública.

Aplicar o filtro **no servidor** em todos os caminhos:

1. `public_list_professionals` — busca/listagens para visitantes;
2. `public_get_professional` — acesso direto a URL de perfil/local;
3. `list_published_professional_listings` — busca autenticada legada;
4. `published_professional_listings` — política RLS de leitura quando aplicável;
5. `public_professional_avatar_visible` — autorização das imagens privadas no Storage;
6. outros RPCs, views, mapas/sitemaps, metadados SEO, APIs e caches identificados na varredura.

Quando expirar, perfil/local não aparece na busca nem por URL direta, e a foto publicada não deve manter autorização de acesso como ativo. A foto pode continuar armazenada e visível ao **dono autorizado** pelo fluxo privado; bloquear a leitura pública não significa apagar arquivo.

**Dependência a verificar:** a função `prepare_professional_listing_publish` e o fluxo de `finalize-professional-listing-publish` contêm regras e versões jurídicas próprias. Preservar essas regras. A cobrança deve ocorrer **após** conteúdo elegível/validado e **antes** de liberar leitura pública; automatizar compensação/retry caso o processo editorial de publicação (inclusive cópia de avatar) não finalize. Não criar um intervalo visível e não pago.

**Limite editorial legado:** a tabela `professional_listings` possui `unique(owner_id)` (uma vitrine profissional/estabelecimento por usuário). Manter inicialmente e documentar a limitação, ou alterar apenas com decisão explícita sobre múltiplos locais, titular empresarial e permissões. **Não remover essa constraint silenciosamente.**

---

## 9. Publicidade self-service e impulsionamentos

### 9.1 Central comercial

O empreendedor deve poder:

1. Escolher conta comercial autorizada.
2. Criar rascunho (imagem, título, texto, destino, contexto, CTA) com pré-visualização mobile.
3. Selecionar **comunidade**, **Home** ou **pacote global**; mostrar onde aparecerá exatamente.
4. Escolher número de dias e ler preço final em EvoCash, saldo e eventual diferença a comprar.
5. Submeter anúncio à moderação automatizada e revisão humana quando necessário.
6. Após aprovação, confirmar gasto e ativar. Se sem saldo, oferecer compra de EvoCash separada e retornar à contratação **sem débito automático**.
7. Acompanhar publicação, vencimento, renovação, métricas disponíveis e histórico comercial.

**Impulsionamentos existentes (`promotions`)** permanecem funcionais durante a transição. Mapear cada `promotionPackages` para oferta equivalente e introduzir duração variável pelo novo motor, sem quebrar resultados antigos. Não mesclar fisicamente tabelas `promotions` e `sponsored_ads` só por terem a mesma interface de compra: são **formatos de distribuição e regras distintas**.

### 9.2 Segurança editorial e qualidade

- Criar anúncios mediante RPCs vinculadas ao anunciante; **não** afrouxar `sponsored_ads_insert/update/delete` para autorizar gravações livres por usuários.
- Segmentar comunidade apenas onde conteúdo e conta são elegíveis, respeitando associação e regras da comunidade. `is_global` não deve permitir ignorar permissões dos espectadores.
- Validar imagem, tamanho, MIME real, extensão segura, conteúdo HTML/Markdown e destinos permitidos. URL externa exige HTTPS e política anti-redirecionamento malicioso; URL interna deve usar rotas válidas e evitar `//` e barra invertida.
- Conteúdo identificado como **Publicidade/Patrocinado**, com controles de denúncia, suspensão e revisão; não disfarçar campanha como publicação orgânica.
- Mudança material de anúncio aprovado cria **revisão nova**; não editar silenciosamente o conteúdo já aprovado. Manter versão ativa aprovada ou suspender conforme política.
- Limites por conta, publicação, comunidade e usuário para evitar spam; nunca comprar prioridade que burle bloqueios de conteúdo ou moderação.
- Pagamentos por dias garantem tempo **elegível**, não total de views, resultados de venda ou exclusividade de espaço.

### 9.3 Métricas confiáveis

Reutilizar `advertiser_accounts`/`advertiser_campaigns` e `sponsored_ad_daily_stats`, preservando o histórico quando anúncio for arquivado. Mostrar métricas com definição, data e limitações. Não inventar alcance; não calcular faturamento com base nelas enquanto a cobrança for por dias.

Como o schema inicial define coleta desligada por padrão, **verificar a configuração real** antes de exibir gráficos como “em tempo real”. Relatórios devem respeitar membros, papéis e privacidade; analistas não recebem automaticamente autorização financeira.

---

## 10. Fichas premium — fase futura e exclusiva

- Apenas superadmin/equipe oficial com papel próprio poderá cadastrar, versionar e precificar fichas oficiais.
- O catálogo comercial exporá `official_workout_sheet` com preço **único** em EvoCash; pagamento atômico gera `content_entitlement` pessoal e imutável por pedido.
- O comprador acessará a ficha adquirida dentro do fluxo normal de **Fichas**, sem criar “Treino Livre” ou duplicar catálogo de exercícios.
- Reutilizar serviços de ficha e referências do catálogo oficial; armazenar versão do produto e política de futuras atualizações, sem alterar o histórico da compra.
- Permissão de leitura da ficha premium deve ser validada no servidor, inclusive em endpoints offline/exportação e caches; download autorizado segue regras de licença.
- Reembolso ou fraude poderá revogar direito, mediante evento auditado e processo coerente com recuperação de EvoCash/legislação.
- **Proibido:** permitir profissional publicar/vender ficha, criar split, comissão ou saque; não deixar funções inacessíveis “para depois” com permissão frouxa.

---

## 11. Segurança transversal e prevenção de fraude

### 11.1 Identidade, permissões, isolamento

- Verificar JWT **no servidor**, `has_app_access`, `is_session_active`, status/restrições e `is_superadmin` quando aplicável; RLS em cada tabela sensível e `SECURITY DEFINER` somente com necessidade comprovada.
- Autorização em toda RPC por **usuário, conta comercial, entidade e ação**; UUID conhecido não confere permissão.
- Proibir manipulação direta de `user_id`, `commercial_account_id`, `payer_user_id`, preços congelados, propriedade, datas pagas e flags de aprovação por endpoints públicos.
- `search_path` restrito (idealmente vazio com schemas explícitos); revogar execução de funções internas a `anon/authenticated`; usar service role exclusivamente nas Edge Functions apropriadas.
- Alteração de membros, transferência de propriedade e suspensão de conta exige trilha auditável; revalidar permissões em contratos recorrentes.
- Proteger rate limits também no backend: cotação, checkout, tentativas de confirmação, contratação, upload, troca de preço, convite de membros e denúncias.

### 11.2 Ledger, reembolso e divergências

- Toda operação de EvoCash precisa de **chave de idempotência**, razão (ledger) e referência ao objeto de negócio.
- Nunca creditar com webhook não validado; confirmar pedido e valor na InfinitePay. Eventos atrasados/duplicados devem ser seguros. Credenciais e segredos só no servidor.
- Preservar controles existentes de **refund/chargeback**, saldo negativo proibido, eventual débito compensatório, conta em caso financeiro e pagamentos após cancelamento. Não supor que dinheiro gasto é recuperável com simples `UPDATE wallets`.
- Custo de estorno de compra de EvoCash e devolução de serviço em EvoCash são operações distintas; definir política por tipo e não lançar crédito sem rastreio do débito original.
- Para períodos inutilizados por responsabilidade da plataforma, política configurada de prorrogação/restauração de créditos; cada concessão referenciada e auditada.
- Incluir relatório de conciliação: compras pagas vs creditadas, soma de débitos comerciais vs pedidos cumpridos, eventos de estorno vs recuperação e direitos vigentes sem pedido válido.

### 11.3 Privacidade, proteção e abuso

- Mínimo necessário de dados em anúncios, métricas e relatórios. Respeitar retenção e limitação de acesso; não expor e-mails/dados financeiros nas páginas públicas.
- Uploads privados enquanto rascunho; divulgação de mídia apenas em publicação aprovada, com vigência; impedir exposição por bucket público sem controle de expiração.
- Cabeçalhos anti-cache para operações financeiras e respostas personalizadas; não salvar saldo ou tokens em cache público.
- Limitar SSRF em previews/validação de URLs externas; nunca fazer fetch de destino livre em backend sem política de hosts/IPs.
- Definir termos de EvoCash, expiração de anúncios, moderação, reembolso/cancelamento e uso de mídia. Validar com assessoria jurídica/contábil e com os termos comerciais InfinitePay **antes** do lançamento de vendas.

---

## 12. Performance, cache, SEO e UX

### 12.1 Desempenho de banco

- Reutilizar consultas paginadas existentes com cursores; evitar `select('*')` em listas, `N+1` por produto/campanha ou leitura de carteira a cada render da Home.
- Índices compostos/parciais nos predicados de leitura pública mais frequentes, incluindo tipo/alvo, status, `starts_at`, `expires_at`, `account_id`, owner e contexto de posicionamento. Criar `EXPLAIN (ANALYZE, BUFFERS)` com massa de dados representativa antes de decidir índices definitivos.
- Paginação por cursor estável em consultas volumosas; métricas agregadas por dia; nunca carregar 100% das campanhas em memória do navegador.
- Separar cache de conteúdo (público, curto e com validade) de dados de carteira/pedidos (privados); invalidar por mutação de criação/renovação/expiração/cancelamento.
- **Cache nunca amplia o direito:** se o resultado é pré-computado, limitar TTL ao vencimento mais próximo e revalidar elegibilidade no servidor em links diretos/RPCs. Revogar URLs assinadas com prazo compatível, ou não usar URL longa para mídia sujeita a expiração.
- Job de limpeza apenas para status/índices/relatórios, não como única garantia de término de contrato. Monitorar lag do job sem permitir visibilidade indevida.

### 12.2 Frontend

- Primer React e componentes compartilhados, sem CSS `!important`, sem reconstruir navegação/hambúrguer; aderência à identidade atual.
- Mobile-first, telas leves, campos grandes e teclado numérico para quantidades; totais claros, prazo e data de expiração visíveis, estados vazios e de erro objetivos.
- Painel comercial com **Meus anúncios / Minha vitrine / Perfil ou estabelecimento / Compras e saldo**, organizado de acordo com serviços habilitados; não abrir dezenas de rotas novas sem necessidade.
- Compra de EvoCash desacoplada de contratação de anúncio: usuário volta a uma prévia da campanha, **revalida cotação e confirma** após recarregar saldo.
- Sem bloqueio de interação ou animação pesada na Home; publicidade não deve prejudicar desempenho e Core Web Vitals.

### 12.3 SEO e expiração

- Listagens de profissionais, locais e vitrines com URLs legíveis, metadados e conteúdo somente enquanto publicáveis.
- Conteúdo expirado deve sair de resultados, sitemap, feeds, share previews e metadados, de preferência respondendo como indisponível e não indexável. Verificar abordagem HTTP (404/410) em relação à política de reativação da mesma URL; não emitir 200 com dados de anúncio vencido.
- Renovação reabilita a mesma URL canônica. Criativos/anúncios não devem indexar páginas técnicas de compra ou painéis administrativos.

---

## 13. Plano de refatoração e remoção de gargalos/legado

**Regra:** antes de remover qualquer recurso, realizar busca de referências, verificação de dependência SQL (views, functions, triggers, políticas, jobs, grants), consumidores React, APIs, testes e uso histórico. O fato de o arquivo “parecer antigo” não o torna descartável.

### 13.1 Reutilizar diretamente

- `_wallet_credit_cash`, `_wallet_debit_cash`, `_ledger_record` e padrões de lock/idempotência.
- Edge Functions InfinitePay e fluxo `payment_check`/webhook/conciliação/reversões; atualizar entrada para cotação sem duplicar confirmação.
- `cashPurchaseService`, `useCashPurchases`, `cashPurchaseFlow` (adaptar para tipos legados e novos), status e paginação da tela de compras.
- `AdminCashPurchases` e padrões de Dialog/FormControl/Flash do Primer.
- `promotionsService` e `create_promotion` durante coexistência e migração segura para preços por dia.
- `sponsoredAdsService`, componentes de anúncios, moderação e métricas. Corrigir autorizações, teto/inventário e validações.
- `professionalListingsService`, drafts/publicações, legal, imagens e diretório público.
- `partner_products` e validações de imagem/URL como base da vitrine, sem quebra do conteúdo oficial.
- `advertiser_accounts`, `advertiser_members`, `advertiser_campaigns`, trilha de auditoria e relatórios, após avaliação de compatibilidade.

### 13.2 Substituir/depreciar, com marcos verificáveis

| Código/estrutura | Ação segura | Quando remover |
|---|---|---|
| `CashPackageCards` e UI de `cashPackages` | Substituir por formulário de quantidade, cotação e confirmação. | Após novo fluxo + compatibilidade dos históricos. |
| `getCashPurchaseSettings` | Alterar para leitura de preço/limites, deixando adaptador legado onde usado. | Após encontrar zero consumidores antigos. |
| `requestCashPurchase({packageId})` | Adicionar fluxo novo por `quoteId`; não trocar assinatura abruptamente. | Após desativação dos clientes antigos. |
| `reserve_infinitepay_cash_purchase` | Criar v2 com modo quantidade e migrar Edge Function. | Somente após reconciliação de todos os pedidos pendentes legados. |
| `economy_config.cashPackages` | Marcar como **legacy read-only**, não apagar configuração que explica pedidos antigos. | Nunca sem prova de irrelevância e estratégia auditável. |
| `promotionPackages` | Migrar para tabela comercial versionada. | Após compatibilidade de promoções e preços antigos. |
| Fluxo administrativo de anúncios | Tornar ferramenta de moderação/gestão excepcional, sem criar segundo catálogo de preço. | Não remover capacidade de intervenção. |
| `partner_products` CRUD exclusivamente admin | Introduzir proprietário, agrupamento e regras comerciais; atualizar admin para moderar. | Só após paridade da operação. |
| Teto de anúncios expirados | Introduzir controle por intervalo e migrar trigger com testes concorrentes. | Quando novo controle provar equivalência/superioridade. |
| Componentes e CSS duplicados | Consolidar componentes realmente iguais, eliminar import/estilos obsoletos. | Após referência zero e comparação visual de rotas. |

**Não remover:** migrações históricas, campos de identificação Mercado Pago/InfinitePay, reversões financeiras, filas de e-mail, autorização de exclusão de contas, testes históricos de segurança, funções de recuperação com finalidade documentada e dados financeiros por “economia de espaço”. Priorizar índices, consultas, limites de retenção não financeiros e assets órfãos comprovados para otimização de banco.

---

## 14. Sequência de implementação sem regressão

| Fase | Entrega | Requisito de saída |
|---|---|---|
| **0 — Inventário e baseline** | Verificar ZIP vs main e schema/migrations reais; mapear funções, grants, políticas, rotas, dados, `pg_cron`, feature flags e status dos pagamentos pendentes. | Inventário assinado e plano de migração/rollback por ambiente. |
| **1 — Núcleo de preço EvoCash** | Versões imutáveis, admin na rota existente, auditoria, cotação, cálculo inteiro e testes de concorrência. | Não altera carteira/saldo/históricos. |
| **2 — Checkout por quantidade** | UI do comprador, reserva v2, InfinitePay, callbacks, reconciliação; coexistência com compras antigas. | Um pedido = um crédito; falhas do provedor não geram duplicação. |
| **3 — Motor comercial comum** | Preços de serviços, pedidos, direitos temporários, idempotência, débito atômico e consultas de elegibilidade. | Pagamento e ativação indivisíveis; expiração no banco. |
| **4 — Vitrine de produtos** | Proprietário, CRUD próprio, moderação, assinatura por dias e renovação; migração de produtos antigos. | Produto não publicado não vaza por URL, RLS ou cache. |
| **5 — Profissionais e locais** | Conectar `professional/space` ao direito pago, preservar publicação legal e Storage; renovação/expiração. | Todos os RPCs de leitura e avatares expiram de forma coerente. |
| **6 — Publicidade autônoma** | Posicionamentos por dias, aprovação, capacidade, campanhas, impulsionamentos migrados e métricas. | Não permite inventário excedido, escrita livre nem débito sem vaga. |
| **7 — Limpeza e consolidação** | Remover caminhos obsoletos comprovados, CSS duplicado e leituras desnecessárias; índice/performance. | Mesmo comportamento financeiro e histórico, sem regressão. |
| **8 — Fichas premium oficiais (futuro)** | Catálogo oficial, preço único, compra atômica, entitlement, acesso e estorno. | Nenhum fluxo de venda por terceiros. |

**Deploy em etapas:** migrations aditivas -> backend compatível -> feature flags -> UI -> observação/reconciliação -> desativação do legado -> limpeza posterior. Nunca fazer “drop + deploy” atômico sem compatibilidade entre versões.

### 14.1 Gates de migração

- Rodar em cópia descartável/snapshot sanitizado antes de produção; verificar `supabase migration list`/estrutura efetiva e ferramentas de migração usadas no CI.
- `NOT VALID` + validação posterior para constraints em tabelas grandes, quando aplicável; operações de índice concorrentes conforme restrições de migrations/locks; timeout finito.
- Backfill idempotente e paginado, com contagem origem/destino, relatórios de linhas sem proprietário e divergências antes de ativar RLS nova.
- Compatibilidade de clients antigos/caches enquanto a flag muda; manter versão anterior do backend até consumidores pendentes acabarem.
- Para rollback de UI e funções, conservar schema aditivo. **Transações financeiras não são revertidas por rollback de deploy:** utilizar compensações registradas, nunca exclusão de lançamentos.
- Antes de qualquer mudança destrutiva, definir backup/restauração testável e seu responsável. A decisão anterior de adiar backup não transforma migração financeira destrutiva em segura.

---

## 15. Estratégia de testes e evidência

Rodar **testes novos ou afetados** e gates obrigatórios do repositório; reaproveitar evidência de testes antigos inalterados. Não reexecutar ciclos redundantes sem motivo, mas também não dispensar regressão financeira quando funções centrais mudarem.

### 15.1 Matriz de invariantes (pgTAP/RPC)

- [ ] RLS nega leitura de preço administrativo/dados financeiros a anônimos e outras contas; API pública revela só dados necessários para cotar.
- [ ] Só superadmin ativo, revalidado, consegue publicar nova versão de preço; tentativa de `UPDATE`/`DELETE` na versão histórica falha.
- [ ] Publicação concorrente de preço não cria duas tarifas vigentes; cotação usa versão inequívoca.
- [ ] Quantidade zero, negativa, fracionária, excessiva, overflow ou preço inválido são rejeitados.
- [ ] Alterar preço após criar pedido não altera total, saldo, crédito ou checkout daquele pedido.
- [ ] Mesmo checkout/webhook repetido **não** credita duas vezes; divergência de valor ou `order_nsu` falha fechada.
- [ ] Pagamento tardio, cancelamento, conta bloqueada, devolução parcial/total e chargeback mantêm reconciliação.
- [ ] Usuário sem saldo não cria pedido/direito; corrida de duas contratações não gera saldo negativo.
- [ ] Reenvio com chave idempotente dá exatamente o mesmo pedido/débito; chave usada com payload diferente é rejeitada.
- [ ] Falha entre débito, ledger, pedido e direito não produz estado parcial.
- [ ] Falha/concorrência de inventário publicitário não causa overbooking nem cobra sem capacidade.
- [ ] Perfil, estabelecimento e vitrine vencidos não são acessíveis em busca, URL direta, RPC, Storage, sitemap ou API pública.
- [ ] Renovação durante/depois da validade preserva identidade e prolonga **só** o tempo devido.
- [ ] Suspenso, não aprovado, conta restrita ou conteúdo removido não aparece mesmo com prazo válido.
- [ ] Empresa A não pode editar/cobrar anúncios da empresa B; papel `viewer` não debita carteira.
- [ ] Métricas e publicidade não alteram saldo sem transação comercial aprovada.
- [ ] Ficha premium oficial (fase futura) só é entregue após compra atômica e para destinatário autorizado.

### 15.2 Testes JS/integração

- [ ] Componentes de preço/simulador usam valores devolvidos pelo servidor e formatam BRL corretamente; nunca fonte de verdade no cliente.
- [ ] Fluxo completo `quote -> checkout -> callback -> conciliação -> carteira` com mocks determinísticos da InfinitePay.
- [ ] Timeout ambíguo ao criar checkout congela retry inseguro e encaminha para conciliação.
- [ ] Navegação de volta de checkout e recarga dupla não criam dois pedidos.
- [ ] Rascunho, publicação, edição, moderação, compra, expiração e renovação de cada tipo de vitrine.
- [ ] Datas próximas da meia-noite/fusos e DST não expiram antes/depois indevidamente; relógio de cliente incorreto não muda direito.
- [ ] Relatórios continuam vinculados à conta correta mesmo após exclusão/suspensão de anúncio.
- [ ] Layout mobile pequeno, acessibilidade de formulários, estados de erro, teclado, contraste e dark mode.

### 15.3 Segurança e performance

- [ ] Verificações de `SECURITY DEFINER`/`search_path`, `GRANT/REVOKE`, RLS por tabela e endpoint; proibida escrita de saldo/validade por cliente.
- [ ] Teste de corrida com múltiplas transações simultâneas em carteira, preço e reserva de slot.
- [ ] Carga de 100/1.000/10.000 itens simulados conforme escala alvo; registrar p50/p95 de feeds, listagens e checkout.
- [ ] `EXPLAIN` sem scans caros não intencionais e sem consultas N+1; verificar tamanho do bundle e requisições da Home.
- [ ] Links/imagens de mídia não persistem publicamente após vencer contrato por causa de cache/URL assinada longa.
- [ ] O CI realmente bloqueia merge em falhas; PR protegido e schema sem divergências.

---

## 16. Observabilidade e operação

**Indicadores operacionais:**

- Compras InfinitePay iniciadas / confirmadas / incertas / em reconciliação; valor pago em centavos e EvoCash creditado.
- Soma dos saldos e lançamentos por tipo; alertas para divergência, saldo negativo, preço não vigente, compra sem ledger, serviço sem pedido.
- Contratações criadas / debitadas / ativadas / expiradas / renovadas / reprovadas; elegibilidade e capacidade por posição.
- Fila de moderação, tempo de publicação, percentual de falhas de RPC, latência p95 de diretórios e Home.
- Uso de direitos expirados por acesso público: **esperado zero**; incluir teste sintético periódico.

**Alertas bloqueantes:** diferenças entre valor do provedor e pedido, tentativa de crédito duplo, falha de função privilegiada, preço ativo ausente/duplicado, vazamento público de publicação expirada, lançamento financeiro sem referência, overbooking e falha de reconciliação acima do limite.

**Ferramentas administrativas:** conciliação manual documentada, suspensão de venda sem interromper direitos existentes, suspensão por segurança de conteúdo, auditoria de alteração de preço/conta, painel de direitos e trilha de compensações. Cuidado para não criar botão de “editar saldo” como atalho operacional.

---

## 17. Regras comerciais ainda não quantificadas

Implementação poderá prosseguir **estruturalmente** com valores configuráveis, mas **não** anunciar preços fictícios ou ativar cobranças até confirmar:

1. Valor inicial de **1 EvoCash em BRL**, mínimo/máximo de recarga e controles antifraude.
2. Tarifas de cada serviço em EvoCash/dia e limites de 1 a N dias por contrato; sem fixar exemplos como tarifas reais.
3. Número máximo de anúncios/slots simultâneos na Home, por comunidade e global; política de rotação justa e prioridade.
4. Quantos produtos cabem em uma vitrine e se uma empresa poderá criar múltiplas vitrines/perfis/locais.
5. Política explícita para usuários que já tenham anúncios/perfis/produtos publicados antes da cobrança: migrar, período de cortesia ou ocultar após aviso — **nunca decidir silenciosamente**.
6. Regras jurídicas de publicidade, cancelamento, direito de arrependimento, reembolso, expiração, suspensão e eventual crédito de compensação; compatibilidade do uso de créditos pré-pagos com a InfinitePay e assessoria especializada.
7. Permissões de contas comerciais com múltiplos membros e se a carteira empresarial própria será requisito para o primeiro lançamento ou fase posterior.
8. Instrumentação legal/contratual para auditoria financeira, LGPD, retenção e atendimento ao consumidor.

**Política recomendada enquanto não decidido:** todas as novas cobranças ficam atrás de feature flags **desabilitadas**; rascunhos e mudanças de schema podem ser entregues sem vender incorretamente.

---

## 18. Critérios de aceite final do projeto

A reestruturação só pode ser considerada concluída quando:

- [ ] Comprar uma quantidade inteira arbitrária permitida de EvoCash funciona, com cálculo do servidor, checkout válido, conciliação e crédito único.
- [ ] Superadmin aumenta/reduz preço pela rota existente, com autenticação, histórico, auditoria, versionamento e preservação dos pedidos antigos.
- [ ] Anúncios podem ser contratados por dias e posição, com autonomia **e** moderação, controle de capacidade, débito atômico e expiração efetiva.
- [ ] Vitrine de produtos pertence a um empreendedor, pode ser editada em privado e só aparece enquanto estiver aprovada e paga.
- [ ] Perfis profissionais e estabelecimentos compartilham o mesmo contrato financeiro por dias, sem duplicar fluxos de publicação existentes.
- [ ] Após vencimento, nenhuma rota, RPC, imagem ou cache entrega o conteúdo como ativo; renovação segura restaura a mesma vitrine/perfil.
- [ ] Compra da publicação-base e destaque adicional são independentes.
- [ ] EvoCoins, outbox/sync, reputação, conta/exclusão financeira, ledger, reversões e relatórios continuam íntegros.
- [ ] Não existe função, tela ou endpoint que permita vendedor terceiro comercializar ficha.
- [ ] Código legado comprovadamente sem consumidores foi removido; código histórico/auditável permaneceu; consultas e índices foram otimizados com evidência.
- [ ] Testes financeiros, RLS, concorrência, integrações e smoke da UI passaram nos gates do PR; rollback e conciliação possuem runbook.
- [ ] Entrega mantém Primer React, dark mode, boa acessibilidade, performance mobile e SEO de conteúdo vigente.

---

## 19. Orientação de execução para o Codex / equipe

1. **Não começar implementando UI.** Levantar impacto e estado real do schema, comparar com esse plano e publicar inventário de dependências e sequência exata de migrations.
2. Executar **uma fase por PR**, com migrations aditivas pequenas e notas de migração/compatibilidade. Preservar GitHub CI e os testes aplicáveis.
3. Para cada nova abstração, demonstrar qual código existente será reutilizado; só criar utilitário/RPC/tabela se houver responsabilidade distinta e ganho mensurável.
4. Evitar mudanças cosméticas amplas simultâneas a migrações financeiras. Refatorar apenas depois de fechar invariantes e testes do novo backend.
5. Não “corrigir” problemas alterando o ledger diretamente, desativando RLS, abrindo `GRANT` ou ignorando falhas de webhook. Tratar erro com rollback/compensação auditada.
6. Não assumir configuração ativa ou usuários inexistentes: validar fatos no ambiente. A evolução deve funcionar mesmo com compras históricas.
7. Antes de liberar publicamente, entregar um relatório objetivo com: arquivos mudados, migrations, compatibilidade, testes **novos/afetados**, evidência de segurança, performance, riscos remanescentes e passos de deploy/rollback.
8. **Nenhum deploy ou alteração em produção está autorizado por este documento.** Implementação e liberação seguem decisão específica posterior.

---

## 20. Referências técnicas

### Evidências locais do ZIP

- `supabase/migrations/20260927000001_economy_wallet_ledger_activity.sql`
- `supabase/migrations/20260928000001_economy_cash_purchases_promotions.sql`
- `supabase/migrations/20261015000001_infinitepay_cash_purchases.sql`
- `supabase/migrations/20260929000005_professional_listings.sql`
- `supabase/migrations/20260929000006_sponsored_ads.sql`
- `supabase/migrations/20261018000001_sponsored_ad_metrics.sql`
- `supabase/migrations/20261108000001_public_commercial.sql`
- `supabase/migrations/20261110000001_public_professional_directory.sql`
- `supabase/migrations/20261116000001_advertiser_metrics_v2.sql`
- `supabase/functions/infinitepay-create-checkout/core.js`
- `supabase/functions/infinitepay-create-checkout/index.ts`
- `src/pages/EvoCash.jsx`, `src/pages/AdminCashPurchases.jsx`
- `src/services/cashPurchaseService.js`, `src/services/promotionsService.js`, `src/services/sponsoredAdsService.js`, `src/services/professionalListingsService.js`
- `src/components/CommercialAdmin.jsx`, `src/pages/MyAds.jsx`

### Referências públicas de integração / enquadramento (consultadas em 27/10/2026)

- InfinitePay, **Checkout Integrado**: <https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay> — `POST /links`, `order_nsu`, centavos, webhook, `payment_check`, `single_payment`, validade e chave secreta.
- InfinitePay, **documentação de checkout**: <https://www.infinitepay.io/checkout-documentacao> — fluxos de link, retorno e confirmação (conferir versão de API/conta antes da implementação).
- Banco Central, **FAQ de ativos virtuais e instrumentos de acesso a produtos/serviços**: <https://www.bcb.gov.br/meubc/faqs/s/moedas-virtuais> — contexto regulatório inicial; **não** substitui análise jurídica individual da operação EvoCash.

**Conclusão:** construir **um único núcleo comercial de preço, pedido, débito e validade**, reaproveitando a economia financeira existente, e integrar progressivamente **publicidade**, **vitrine de produtos**, **profissionais/estabelecimentos** e, mais tarde, **fichas oficiais**. O preço do EvoCash será versionado e administrado na rota de compras; todo gasto será auditável e toda expiração será garantida no servidor.
