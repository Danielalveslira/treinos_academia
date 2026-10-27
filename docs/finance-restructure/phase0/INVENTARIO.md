# Reestruturação comercial e financeira — Fase 0

Data: 27/10/2026. Responsável pelo levantamento técnico: Codex.
Plano normativo: `docs/promps/PLANEJAMENTO_REESTRUTURACAO_COMERCIAL_FINANCEIRA_EVOLUTUS.md`, lido integralmente (601 linhas), versão 1.0. O hash está em `baseline.json`.

**Estado: inventário técnico preparado para revisão; aceite de saída pendente.** Nenhuma migration, alteração de configuração, conciliação, criação de checkout ou mutação financeira foi executada em produção. A Fase 1 não foi implementada nesta entrega. O aceite deste inventário não autoriza deploy.

## Base e evidências

O workspace original estava na branch `home-inteligente-v4`, commit `30385ccfdc974978a7a1cacafc9e010d9096fdda`, com alterações locais anteriores à tarefa. Foi preservado. A entrega está isolada na branch `finance-restructure-phase0`, worktree `/tmp/evolutus-finance-phase0`, baseada na `main` `5b50b2605192c7684bdefa065ad3c21ab64f03ab`. A API do GitHub confirmou essa revisão como a ponta da main; a Vercel informou o mesmo SHA no destino de produção, estado `READY`.

Não havia ZIP disponível para reproduzir a comparação literal com o arquivo citado no plano. Os achados do plano foram conferidos contra código da main e catálogo vivo; não se declara equivalência com o ZIP.

| Evidência | Conteúdo e limite |
|---|---|
| `baseline.json` | Agregados operacionais, contagens, configuração booleana, checks de segurança e limites da coleta |
| `security-inventory.json` | Colunas, constraints, índices, políticas, grants, triggers, dependências de catálogo e assinaturas/hashes de funções dos domínios afetados |
| `schema-comparison.json` | Comparação executada pelo comparador existente de funções, segurança, relações, triggers, schemas, views, enums e jobs |
| `source-manifest.json` | SHA-256 do plano, das 176 migrations e dos arquivos de controle selecionados |

As consultas existentes `finance-production-readonly.sql`, `finance-catalog-readonly.sql` e `finance-dependencies-readonly.sql` foram reutilizadas. A única consulta nova, `scripts/release/commercial-baseline-readonly.sql`, complementa os agregados comerciais, Storage e dependências. Todas usam transação read-only, `statement_timeout=10s`, `lock_timeout=2s` e rollback. A conexão também foi forçada a read-only. Resultados brutos, credenciais temporárias e logs ficaram fora do Git, em `.finance-local/commercial-phase0` no workspace original. Não foram consultadas linhas de clientes para compor a documentação pública.

As quatro consultas são snapshots independentes: não representam um único instante transacional. `pg_depend` cobre dependências registradas; chamadas dinâmicas/PLpgSQL também exigem busca textual e testes antes de qualquer remoção (§13 do plano).

## Estado financeiro observado

176 versões de migrations locais e remotas coincidem, até `20261127000001`. A data futura dos nomes não foi usada para inferir instalação: as versões foram lidas do banco real.

- 6 carteiras, 175 lançamentos, 26 compras: 9 creditadas, 16 canceladas e 1 pendente.
- Nenhuma divergência de carteira/ledger, saldo inválido, unidade financeira fracionária ou crédito duplicado nos diagnósticos executados.
- Nenhuma compra creditada sem ledger correspondente ou sem identidade InfinitePay. A compra pendente ainda não tem identidade completa de pagamento, não está incerta e não tem mais de sete dias; isso não foi tratado como pagamento confirmado nem como autorização de cancelamento.
- Reversões estão configuradas como desligadas (`reversalsEnabled=false`): preservar o estado operacional, sem ativação silenciosa.
- Cliente autenticado não pode atualizar carteira, inserir ledger, executar confirmação InfinitePay nem executar o helper de crédito. Service role também não possui UPDATE direto de carteira.
- Existem cinco constraints `NOT VALID` herdadas (listadas na evidência). Diagnósticos retornaram zero violações; isso **não** equivale a executar `VALIDATE CONSTRAINT`. A Fase 0 não as alterou.

Há 5 anúncios (1 vencido), 8 promoções, 2 produtos, 1 perfil publicado, 1 conta de anunciante, 1 membro e 3 campanhas. Esses registros impedem assumir uma instalação vazia ou migrar conteúdo sem política de legado aprovada.

## Comparação do schema e diferenças

Uma base PostgreSQL descartável, sem portas publicadas, recebeu as 176 migrations. Foi usado o scaffold local existente de Storage/Auth, complementado por `auth.sessions` e `auth.jwt()` sintéticos, necessários ao Postgres standalone. Isso comprova reconstrução do schema público/privado nesse scaffold; não é homologação de GoTrue, Storage ou checkout real.

O comparador existente encontrou oito entradas de diferença, agrupadas em cinco funções:

| Função | Diferença encontrada | Tratamento |
|---|---|---|
| `private.apply_published_visual_set(uuid,uuid,text)` | Corpo e configuração | Investigar em trabalho do catálogo; não substituir pelo arquivo local |
| `public.allocate_exercise_visual_set(uuid,text,text,jsonb,uuid,uuid,text,text,text)` | Corpo e configuração | Preservar contrato publicado até investigação |
| `public.admin_list_catalog_exercises(text,text,text,integer,integer)` | Sobrecarga adicional em produção e sua segurança | Mapear consumidores antes de remover ou recriar |
| `public._bump_exercise_catalog_revision()` | Grants | Registrar diferença; não abrir nem revogar permissões nesta fase |
| `public._sync_exercise_catalog_is_active()` | Grants | Mesmo tratamento |

Nenhuma diferença de relação, trigger, view, enum ou job foi reportada pelo comparador, e nenhuma das diferenças de função listadas pertence ao núcleo financeiro. Normalização do comparador: apenas proprietários DBA equivalentes e ACLs duplicadas desses proprietários; não normaliza grants de clientes nem corpos. Foram comparadas 356 funções locais contra 357 remotas, 104 tabelas, 77 triggers, 5 views, 2 enums e 15 jobs. Igualdade de versões não provou ausência de drift.

## Dependências e reaproveitamento

| Domínio | Contratos atuais | Evolução e condição de compatibilidade |
|---|---|---|
| Compra EvoCash | `EvoCash.jsx`, `CashPackageCards.jsx`, `cashPurchaseService.js`, `useCashPurchases.js`, `cashPurchaseFlow.js`; `cashPackages` | Quantidade/cotação somente nas fases 1–2. Preservar mapper, históricos, retorno e Realtime; incluir `EconomyGuide.jsx` na retirada da comunicação de pacotes |
| Checkout | Edge `infinitepay-create-checkout`, reserva, finish/fail/release/uncertain | Reserva v2 por cotação; reaproveitar validação de URL, lease e tratamento de timeout ambíguo. Não trocar assinatura legada com clientes/pedidos ativos |
| Crédito/estorno | Webhook, check-payment, admin-reconcile, `confirm_infinitepay_cash_purchase`, helpers de carteira e ledger | Um único motor de confirmação. Preservar identidade/valor, locks, casos financeiros, pagamento tardio, reversões e exclusão de conta |
| Administração | `/admin/compras-evocash`, `AdminCashPurchases.jsx` | Adicionar abas na rota atual depois do backend; manter conciliação, filtros, lembretes e revisão |
| Impulsionamentos | `promotionsService`, `PromoteDialog`, `create_promotion`, `promotionPackages` | Coexistência; migrar por equivalência de oferta comprovada. Não apagar campanhas/pacotes históricos |
| Publicidade | `sponsoredAdsService`, `AdminSponsoredAds`, `useSponsoredAds`, banners da Home/comunidade | Manter escrita administrativa e regras de audiência. Não liberar self-service antes de revisão, inventário e débito atômico |
| Anunciantes | `advertiser_accounts/members/campaigns/audit`, relatórios V2 | Reutilizar a identidade existente; `permission='viewer'` é constraint efetiva. Adicionar papéis mediante autorização por ação, preservando campanhas históricas sem FK ao anúncio vivo |
| Vitrine de produtos | `partner_products`, `CommercialAdmin`, `PartnerProductList` | Já há janela editorial `starts_at/ends_at`, mas faltam proprietário, vitrine e pedido pago. `sponsored` não autoriza cobrança |
| Profissionais/locais | `professionalListingsService`, drafts, prepare/finalize/abort, termos e diretório público | Preservar `unique(owner_id)` e fluxo editorial; ligar vigência a um motor comum, incluindo Storage |
| Offline/contas | Sync/outbox, carteira, exclusão/restrições, legal e casos financeiros | Compras e débitos comerciais exigem confirmação online. Não enfileirar mutações monetárias no mecanismo offline de treino |

`cash_purchases.package_id` e `package_label` continuam NOT NULL. A futura migration de modalidade precisa preservar todos os legados, permitir NULL apenas para quantidade e impor CHECK por modalidade; não inserir package ID fictício.

`enforce_sponsored_ad_caps()` efetivo conta anúncios vencidos e usa COUNT sem serialização. A seleção da aplicação filtra validade, mas a policy de leitura da tabela não impõe expiração. Não considerar o filtro React/SDK uma fronteira de segurança. A substituição fica na fase 6 com reserva de intervalos, locks e teste concorrente antes de cobrança.

## Superfícies públicas, mídia e cache

Profissionais: revisar conjuntamente `public_list_professionals`, `public_get_professional`, `list_published_professional_listings`, policy de `published_professional_listings`, `public_professional_avatar_visible`, URLs diretas, busca, metadados e sitemap. As funções públicas atuais verificam publicação/estado da conta, sem direito comercial pago. `profile-avatars` é privado, com policy de leitura pública condicionada ao helper. Não apagar o avatar quando vencer.

Produtos: a policy pública atual verifica aprovação e janela editorial; `image_url` aceita recurso externo. Para garantir expiração de mídia será necessário adotar armazenamento/entrega controlados ou definir precisamente o limite de acesso à imagem externa; esconder um card não revoga bytes já publicados externamente.

Anúncios: `useSponsoredAds` usa cache e tick de vencimento, e o serviço aplica `expires_at > now` no banco. O futuro predicado comercial deve entrar no servidor, inclusive consulta direta, sem depender desses chamadores. TTL de cache/URL assinada não pode exceder o direito.

Storage foi inventariado sem listar objetos: `profile-avatars`, `community-covers`, `status-photos`, drafts/referências de exercícios e evidências são privados; `exercise-visuals` é público e pertence ao catálogo oficial, não à mídia comercial paga.

## Configuração e jobs

Métricas: `sponsored_ad_metrics_settings.collection_enabled=true` em produção; flag configurada Vercel `VITE_AD_METRICS_ENABLED=true`. Também foram lidas como true as flags `VITE_GREETING_V2_ENABLED`, `VITE_OFFLINE_COLD_START_ENABLED` e `VITE_OFFLINE_WRITE_ENABLED`. Valores do projeto não são prova dos valores embutidos no deployment existente. Nenhuma flag das novas cobranças foi encontrada no código auditado: as fases seguintes devem criar gates de backend **desligados por padrão**, além da apresentação frontend.

15 jobs ativos foram capturados por nome, agenda e hash do comando, sem publicar comandos potencialmente sensíveis. Preservar especialmente expiração/reconciliação de compras, lembretes, exclusão de contas, liquidação de recompensas e push/outbox. Cron não será a garantia de expiração comercial.

## Sequência de migrations e rollout por ambiente

Nenhum arquivo de migration foi criado nesta fase. A sequência abaixo define responsabilidades dos lotes futuros; nomes/timestamps devem ser atribuídos sobre a main atualizada no respectivo PR, evitando falsa promessa de SQL já pronto.

| Fase / ordem | Lotes aditivos previstos | Gate antes de seguir |
|---|---|---|
| 1.1 → 1.2 | Versões de preço/auditoria/configuração pausada → cotação e RPCs administrativas com revalidação | Imutabilidade, RLS/grants, cálculo inteiro/overflow, publicação concorrente e cotação congelada; zero alteração de saldo/pedido existente |
| 2.1 → 2.2 | Modalidade/quote/version em `cash_purchases` → reserva v2 e integração compatível | Legado conciliável; crédito único; timeout incerto; replays e payload divergente; compra pendente existente preservada |
| 3.1 → 3.2 | Ofertas/preços/pedidos/eventos/direitos → contratação atômica e predicado comum | Carteira+ledger+pedido+direito indivisíveis; duração UTC; renovação e idempotência concorrentes |
| 4.1 → 4.2 | Vitrine e vínculo opcional de produto → backfill aprovado e consultas privadas/públicas | Origem/destino contados; proprietário decidido; RLS e mídia sem vazamento |
| 5.1 → 5.2 | Direito ligado ao listing → todos os RPCs/policies/Storage e finalize compensável | Sem janela publicada e não paga; identidade/termos/drafts preservados |
| 6.1 → 6.2 | Papéis e revisões de anúncios → inventário de intervalos e contratação | Corridas de capacidade sem overbooking; nenhum débito sem vaga; métricas históricas intactas |
| 7 | Limpeza comprovada e índices medidos | Busca de referências e dependências, paridade funcional, EXPLAIN e comparação visual |
| 8 | Fichas oficiais, fase futura | Requisito específico posterior; sem venda por terceiros |

Local: banco descartável e dados sintéticos, aplicar lotes em ordem, testar também upgrade com dados legados e manter flags desligadas. Homologação: ambiente próprio, dados sanitizados, segredos separados, checkout simulado e testes das falhas do provedor; levantar URL/projeto/responsável antes de provisionar. Produção: nenhum comando de aplicação autorizado; depois de decisão específica, exigir backup/restauração testados, preflight fresco, CI e observação, publicar schema aditivo → backend compatível → gates → UI → observação antes de descontinuar legado.

Rollback local/homologação: restaurar snapshot descartável ou recriar o ambiente sintético; reverter aplicação para a revisão registrada. Rollback de produção proposto: pausar **novas** cotações/contratações por gate, retornar UI/backend compatíveis e conservar schema aditivo, pedidos, ledger, callbacks e direitos aceitos. Não executar down migration destrutiva, revogar links aceitos, apagar lançamentos ou recalcular preço de pedidos. Efeitos financeiros exigem compensação auditada, nunca rollback de Git. Nenhuma operação destrutiva integra este PR.

## Validação e pendências para aceite

- As quatro consultas remotas terminaram com sucesso em read-only; a consulta comercial nova também executou na base local.
- Reconstrução das 176 migrations e comparação estrutural concluídas, com os limites sintéticos de Auth/Storage descritos acima.
- CI da revisão base: `js`, `sql`, `finance-e2e`, `secrets` e agregador `finance-quality` retornaram success na API GitHub. Isso é evidência do baseline, não execução de testes sobre código novo. Há execuções históricas `verify` de release com failure e execuções posteriores com success; não se declara que todos os workflows passaram.
- GitHub confirmou `protected=true` na main, mas detalhes da proteção retornaram HTTP 403. Verificar checks obrigatórios efetivamente configurados antes de merge.
- Esta fase altera documentação e diagnóstico SQL, sem UI nem comportamento financeiro. Não há teste de carga, browser financeiro, pagamento, RLS adversarial ou corrida nova que possa ser declarado aprovado.

Para encerrar o gate da Fase 0: revisar/aceitar este inventário e a classificação do drift, confirmar responsável e ambiente de homologação, registrar responsável pelo backup/restore antes de qualquer operação destrutiva e validar a proteção efetiva do PR. ZIP pode ser fornecido para comparação literal, ou registrar aceite explícito da main/schema vivo como base substituta. A assinatura do responsável pelo aceite permanece pendente; hashes são rastreabilidade técnica, não aprovação comercial ou assinatura humana.

As decisões do §17 do plano permanecem abertas: preço/limites, tarifas/dias, slots/rotação, limite de produtos/múltiplos locais, tratamento de conteúdo legado, políticas jurídicas/comerciais e papéis empresariais. Elas não impedem preparação estrutural posterior, mas impedem ativar as novas cobranças. Nenhum valor comercial foi inventado.
