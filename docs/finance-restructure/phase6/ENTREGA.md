# Fase 6 — publicidade autônoma com EvoCash

28/10/2026. Implementação isolada na branch `finance-advertising-phase6`, worktree `.finance-local/phase6`. Base confirmada: `finance-profiles-phase5-1`, `8cc0f26f859996e3ff129e3d561cd0cb84f153a5`; conectividade Git verificada. O workspace principal e suas alterações anteriores foram preservados.

## 1. Resumo executivo

A central `/meus-anuncios` prepara campanhas gratuitamente, submete revisões, consulta preço e capacidade e contrata dias mediante autorização da carteira pessoal do proprietário. Home, banner/feed de comunidade e pacote explícito reutilizam `sponsored_ads`; impulsionamentos reutilizam `promotions`. Não foram criados carteira, ledger, checkout ou motor comercial paralelos.

A implementação inclui capacidade transacional por intervalo, snapshots de posicionamentos, moderação independente de pagamento, mídia privada, suspensão, renovação manual, relatórios existentes e invalidação via Supabase Realtime oficial. Todos os valores, campanhas, usuários e eventos da homologação são sintéticos. Resultados de teste não são audiência real nem evidência de desempenho comercial.

Não houve push, merge, deploy, acesso ou alteração de produção, pagamento real, tarifa oficial, CPC/CPM, leilão, saque, comissão ou fase posterior. Aprovação de lançamento continua dependendo do checklist consolidado.

## 2. Auditoria e reaproveitamento

O planejamento mestre, inventários/entregas 0–5.1, correções finais 5.1 e checklist foram confrontados com o código. O inventário desta fase está em [INVENTARIO.md](INVENTARIO.md).

| Módulo real | Tratamento |
| --- | --- |
| `sponsored_ads`, banner, cards, Home existente | Projeção aprovada e superfícies reutilizadas; nenhuma substituição de recomendação ou navegação de treino. |
| `advertiser_accounts/members/campaigns` | Conta comercial, equipe e atribuição histórica mantidas; não inferir titularidade de `created_by` antigo. |
| Métricas V2 e `sponsored_ad_daily_stats` | Mesmo painel, ingestão e agregados; nova elegibilidade de contratos e exclusão de membros da própria campanha. |
| `promotions` e consumidores orgânicos | Mesmos alvos, autoria e engajamento; novas contratações passam pelo motor comum. |
| `commercial_offerings/price_versions/orders/order_events` | Catálogo, preços imutáveis, cotações, idempotência, débito e reversão existentes. |
| `visibility_entitlements`, `private.commercial_resources` | Direito temporal e âncora de propriedade existentes. |
| Gateway/bucket WebP e manutenção de mídia | Reutilizados alocação, compressão, validação, leases, proteção por recurso e limpeza. |
| Interface Primer, autenticação recente, CAS | Reutilizados; sem bibliotecas de publicidade ou rastreamento externo. |

## 3. Arquivos

O manifesto completo de arquivos e hashes está em [ARQUIVOS.json](ARQUIVOS.json). Principais alterações: central e administração lazy, adaptação do diálogo de impulsionamento, serviços de publicidade/comunidades, seleção e invalidação, selo pago explícito, migrations, testes SQL/JS/concorrência e harnesses locais. O CI recebe a nova concorrência; não foi executado remotamente.

## 4. Migrations

Executar, futuramente em ambiente autorizado, a sequência aditiva `20261205000001` a `20261205000018`:

1. Inventário, snapshots, reservas e integração transacional aos pedidos.
2. Contas, rascunhos, aprovação e projeção de `sponsored_ads`.
3. Autorização financeira por conta/contexto e integração à ingestão de métricas.
4. Epoch de invalidação, seleção e contabilização do inventário legado.
5. Adaptação de impulsionamentos e permissões da comunidade.
6. Interrupção, histórico de pedidos e operações administrativas.
7. Imagens protegidas pelo gateway existente.
8. Locks compatíveis com FKs para evitar deadlock entre cotações.
9. Histórico editorial imutável, arquivamento e reanálise de impulsionamentos.
10. Seleção por candidatos reservados e invalidação de proprietário/contexto.
11. Índice de expiração do legado validado por medição.
12. Resumo comercial e dias restantes calculados no servidor.
13. Preservação do gate de conta/sessão na policy de anúncios legados e novos.
14. Projeção verificada de promoção de comunidades, com `security_invoker` e RLS da origem.
15. Invalidação e evidência operacional de alteração/remoção do conteúdo original.
16. Preservação dos vínculos privados após exclusão autorizada do proprietário, compatível com o worker existente.
17. Autorização em lote, leitura RLS equivalente com gate por consulta, rotação justa de posts e prazo monotônico dos destaques.
18. Evidência operacional de alterações/remoções da comunidade e seu impacto nos impulsionamentos, sem compensações automáticas.

Nenhuma migration histórica foi modificada. As novas migrations foram instaladas cumulativamente sobre a baseline descartável anterior, com rollback e comparação de hashes de carteiras, ledger, pedidos, direitos, preços e anúncios legados. `evidence/migrations-reinstall.log` registra a prova. Posicionamentos nascem com capacidade zero e vendas/veiculação desabilitadas; pacote global vazio; nenhum preço é semeado.

## 5. Modelo de preços

Preço = tarifa vigente da oferta × dias inteiros. Um dia = 24 horas exatas. São ofertas independentes: Home, feed de comunidade, banner de comunidade, pacote global, post e comunidade em destaque. Não há multiplicador oculto por audiência.

A administração permanece em `/admin/parcerias?tab=engine`: preço inteiro, limites de dias, vigência, justificativa, histórico imutável, CAS, confirmação e autenticação recente. O navegador não determina total, pagante ou validade. Cotações congelam preço; renovação usa a versão vigente e cria outro pedido.

As fixtures locais usam valores identificados como sintéticos, sem promover os exemplos do planejamento a política oficial. Novas vendas continuam bloqueadas sem configuração administrativa.

## 6. Capacidade e contratação

`advertising_placements` descreve a superfície técnica e referencia a oferta comercial. `private.advertising_resource_inventory` congela o escopo do recurso; `advertising_order_inventory` congela o escopo por pedido; `advertising_reservations` preserva o intervalo efetivamente contratado.

A disponibilidade usa o pico simultâneo de intervalos sobrepostos, com limites semiabertos `[início,fim)`, por posicionamento/contexto. Não soma reservas não simultâneas como se competissem. Reservas cumpridas e compromissos legados elegíveis participam do cálculo.

A cotação verifica o período completo, mas não segura vaga nem debita. A confirmação revalida dentro da transação do motor existente, trava posicionamentos em ordem estável com `FOR NO KEY UPDATE`, registra todas as reservas e concede o direito. Qualquer falha desfaz também débito e ledger. O pacote global é indivisível.

Capacidade menor que compromissos existentes é rejeitada. Pausar novas vendas preserva contratos. Suspensão conserva a reserva; apenas reversão administrativa explícita libera compromisso financeiro revertido, sem apagar seu histórico. Não há calendário de reservas temporárias nem crédito automático.

## 7. Contas e carteira

A conta autônoma tem proprietário explícito. `owner` administra o conteúdo; `manager` prepara revisões autorizadas; `viewer`/analista mantém o relatório autorizado. Superadmin modera e configura.

Somente o proprietário pagante contrata nesta entrega. O pedido registra seu usuário e o recurso, cujo vínculo à conta beneficiária permanece na atribuição existente. Um gestor não pode cotar ou gastar a carteira do proprietário. Carteira compartilhada, troca de titularidade e autorização delegada para gastar saldo de terceiros não são oferecidas. A concessão de papéis de equipe permanece sob administração autorizada; não há convite financeiro implícito.

## 8. Moderação, revisão e mídia

Rascunho → enviado → aprovado/reprovado. Cobrança só após aprovação. Edição pendente não altera a projeção aprovada, o destino, a imagem pública ou o contrato. Aprovação de revisão não estende nem reinicia o período. Suspensão/arquivamento não são removidos por aprovação de conteúdo ou pagamento.

Revisões enviadas possuem evidência imutável privada. A central consulta histórico do material e contratações; administração consulta fila, suspensão, retomada e histórico operacional. Conteúdo arquivado e seu histórico financeiro permanecem armazenados.

Upload usa o gateway `storefront-media`, WebP validado no servidor, limite de tamanho/dimensões e FK composta imagem/recurso. A URL pública não contém caminho de Storage. O gateway revalida autorização antes e depois de ler bytes, com `no-store`; não emite URL assinada duradoura. Imagem pendente nunca substitui a aprovada. Referências atuais e históricas impedem coleta indevida.

## 9. Home e comunidades

O banner existente da Home continua no espaço já destinado a patrocínio. Recomendações de ficha, histórico, informações de treino e navegação não foram substituídos. Seleção publicitária não consulta carteira ou realiza escrita financeira, não bloqueia a renderização principal e retorna poucos anúncios elegíveis.

Comunidades usam os componentes reais de banner/card e o feed original. Publicidade é identificada como Patrocinado; impulsionamento como Destaque patrocinado. Não há cópia de post ou criação de curtidas/comentários. A comunidade precisa autorizar a modalidade; o autor/proprietário e a origem permanecem elegíveis.

A projeção de comunidades valida o impulso no servidor, em vez de confiar em flags antigas. A elegibilidade paga é agrupada uma vez por consulta; o gate RLS mantém a regra existente e avalia a sessão uma vez no snapshot da consulta. Os selos de todos os posts carregados são autorizados em lote, independentemente dos seis selecionados para a seção de destaques. Essa seção usa rotação aleatória equivalente e relógio PostgreSQL. Ao perder o canal de invalidação, a interface oculta destaque pago e conserva conteúdo orgânico. Alteração/remoção da origem bloqueia a elegibilidade e registra evidência. Reanálise explícita atualiza o fingerprint sob lock.

Posts que vencem antes do fim solicitado não são vendáveis para esse período. Isso inclui o caso normal de post efêmero com menos de 24 horas restantes: não se amplia sua validade orgânica para viabilizar uma venda.

## 10. Pacote global e rotação

O pacote é uma lista administrativa explícita de posições suportadas. Cada campanha e pedido preserva seu snapshot; novas superfícies não entram em contratos antigos. Login, checkout, carteira, administração e execução sensível de treino não integram o inventário.

A política atual é amostragem aleatória com direitos equivalentes, limitada por superfície. Não favorece preço, duração ou data de criação; não é leilão e não promete número de impressões. Posicionamentos adicionais exigem implementação e habilitação explícita.

## 11. Expiração e invalidação

O PostgreSQL decide início, expiração, estado editorial, conta e direito. Cron não autoriza exibição. A contratação é imediata; renovação ativa começa após o saldo de tempo existente, e renovação vencida começa no instante da confirmação. Início futuro arbitrário não é oferecido; as reservas possuem intervalos reais para expansão futura.

A seleção não reutiliza cache de autorização. Realtime publica apenas um epoch sem criativo, conta ou dados financeiros. Mudanças de contrato, campanha, posicionamento, proprietário, restrição, permissão ou origem invalidam a seleção. Respostas antigas e respostas após desmontagem não reautorizam conteúdo.

O relógio monotônico limita o tempo exibido a partir do timestamp PostgreSQL e do início da requisição; atraso de rede encurta a autorização. Um timer remove apenas itens vencidos, sem polling. Os destaques de post/comunidade também recebem prazo monotônico calculado com o relógio PostgreSQL; no vencimento, revalidam em lote sem conservar selos expirados. Falha do canal deixa a publicidade indisponível até reconexão/revalidação.

## 12. Métricas

O painel V2 continua sendo o único relatório. Impressões do coletor existente exigem pelo menos 50% de visibilidade por um segundo contínuo; carga de API não é impressão. Cliques são eventos distintos, inclusive rápidos sem impressão anterior, com a qualificação explicitada no relatório.

A ingestão recebe lotes de até 20, valida estrutura/contexto/contrato, deduplica UUID por usuário e aplica tetos por anúncio/posição/dia e usuário/hora/dia. Membros da própria conta e superadmin não contam como audiência da campanha. Clientes não escrevem agregados oficiais. Não há conversão ou receita atribuída inventada.

Mantidos oposição à medição, exclusão de menores/configuração de idade, marcadores temporários de 48 horas e retenção agregada existente de 24 meses. Isso é desenho técnico; não constitui aprovação jurídica de finalidade, base legal, consentimento ou retenção. A coleta fica desligada por padrão e foi desligada novamente após os testes sintéticos.

A validação de ingestão utiliza eventos de teste identificados como sintéticos. Não representa alcance real ou garantia de audiência; a observabilidade do browser e os limites antifraude não constituem prova criptográfica de atenção humana.

## 13. Interrupções e reversão

Registros distinguem interrupção voluntária, suspensão editorial, arquivamento, indisponibilidade do posicionamento, revisão/remoção da origem e reversão comercial. Contratos e reservas preservam datas; eventos operacionais registram ator, motivo e instante, e origem alterada preserva o fingerprint aprovado.

A reversão existente exige superadmin, autenticação recente, razão, confirmação e idempotência. Não foram introduzidos reembolso, crédito, extensão gratuita ou renovação automática. Decisões sobre compensação permanecem bloqueadas no checklist.

## 14. Segurança e concorrência

RLS, grants mínimos, `search_path` vazio, propriedade, sessão ativa, autenticação recente e CAS são verificados no PostgreSQL. Links novos aceitam HTTPS, não renderizam HTML e usam `noopener noreferrer sponsored`; não há fetch de destino externo no backend nem redirecionador aberto.

A matriz real em PostgreSQL cobre última vaga, seis reenvios, renovação simultânea, saldo compartilhado, pacote global disputando múltiplas posições, redução de capacidade, suspensão durante pagamento, mudança de preço e revisão editorial após cotação. Confirmação tem no máximo um débito e não deixa reserva/direito parcial.

Falhas encontradas e corrigidas: deadlock por promoção de lock de FK; gate de conta perdido na policy do legado; configuração global incompatível com `safeupdate`; constraint de unidades antiga incompatível com rascunho sem cobrança; associação de mídia entre campanhas; invalidação de impulso da origem; teste de privacidade confundindo parte do timestamp com o ano de nascimento. Não se removeram proteções para fazer testes passarem.

## 15. Performance

`EXPLAIN (ANALYZE, BUFFERS)` e vinte amostras da RPC real por massa, com rollback. O seletor começa pelas reservas vigentes, limita resultados e utiliza índices de posicionamento/contexto/intervalo e paginação privada.

| Histórico sintético expirado | p50 antes/depois (ms) | p95 antes/depois (ms) |
| ---: | ---: | ---: |
| 100 | 10,250 / 9,753 | 21,879 / 11,428 |
| 1.000 | 12,428 / 11,193 | 25,005 / 22,049 |
| 10.000 | 11,403 / 5,289 | 35,710 / 9,446 |

Os resultados são locais, sujeitos a carga/variação e não são SLA. Planos e massas estão em `evidence/performance-*`. O índice do legado foi incorporado após a comparação. Não há consulta de ledger/pagamento na seleção nem carregamento integral das campanhas no navegador.

A consulta real de 200 entre 2.000 comunidades sintéticas executou a elegibilidade publicitária uma única vez. A comparação reproduzível do gate de sessão herdado por linha com a mesma regra avaliada por consulta registrou **2.863,488 ms → 78,273 ms**, sob carga local. Planos completos e transações revertidas estão em `evidence/community-performance.json`; o harness comprova `Actual Loops = 1`, sem impor um SLA artificial.

## 16. Testes e evidências

- `sql-summary.json`: 17 suítes, 1.000 asserções SQL, incluindo carteira, ledger, preços, contratos, perfis, múltiplos cadastros, vitrines, mídia, RLS, legado, sessão revogada e reversão.
- `concurrency.json`: disputas PostgreSQL reais, sem mocks de carteira ou inventário.
- `browser.json`: criação → moderação → aprovação → cotação → contratação, com Auth/REST/PostgreSQL locais.
- `lifecycle.json`: comunidade/feed/global, post/comunidade em destaque, WebP real, mídia pendente/suspensa/expirada negada, renovação e deduplicação de eventos sintéticos.
- `realtime.json` e `realtime-viewer.json`: runtime oficial entregando alteração real PostgreSQL, com RLS, para proprietário e audiência. `live-browser.json`: banner e feed pagos renderizados; suspensão e retomada sem reload, preservando orgânico; desconexão real do serviço oculta a publicidade e a reconexão a restaura. Latência observada de suspensão: 923 ms na execução registrada.
- `promotion-expiry.json`: expiração pelo tempo real PostgreSQL com a página aberta, sem reload; selos de post/comunidade desaparecem, enquanto o post orgânico e a campanha não vencida continuam disponíveis. Os intervalos sintéticos de exibição são restaurados ao final; carteira, ledger, pedidos e direitos não são alterados.
- `source-invalidation.json`: edição real da descrição da comunidade invalida o destaque sem reload, grava auditoria operacional e preserva o post orgânico e o anúncio independente.
- `visual.json`: 30 cenários aprovados: 320/390/1440, claro/escuro, Home, comunidade, central, administração e métricas; zero overflow, erros de console/aplicação ou respostas HTTP com erro. Banner pago presente nas 12 combinações de Home/comunidade. Capturas regeneráveis e ignoradas pelo Git.
- JavaScript: **2.258 testes aprovados**; Edge Functions: **203 casos aprovados, zero falhas e três skips explícitos** entre 206 casos. Os três skips são testes opt-in de notificações/push que exigem `PG_TEST_CONTAINER`, fora das alterações publicitárias; a concorrência financeira/publicitária foi executada separadamente contra PostgreSQL real. A execução final de JavaScript e Edge ocorreu fora da restrição de subprocessos do sandbox, garantindo a execução dos casos compilados por esbuild, além do carregamento dos arquivos. O teste de cold start usa a data privada completa, evitando falso positivo com dígitos do timestamp.
- Logs JavaScript, Edge Functions, build/lint/budget e scanners ficam em `evidence`; avisos herdados de lint/chunk permanecem explícitos. Logs versionados têm espaços finais normalizados.

Os testes antigos de pacotes agora provam bloqueio de novas compras pelo caminho legado e conservam fixtures históricas para testar cancelamento/flags/ledger. O teste do motor usa oferta sintética própria, sem depender do preço do preview. Limpeza dos eventos de preview durante a suíte de métricas ocorre apenas na transação revertida do teste.

## 17. Preview e credenciais

Preview local: <https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev>. Alternativa no Codespace: `http://127.0.0.1:5173`. É um servidor de desenvolvimento dependente da sessão/containers, não um deploy persistente.

- `/meus-anuncios`: selecionar a conta e criar/acompanhar/renovar campanhas; mesmo painel de métricas.
- `/admin/parcerias?tab=autonomous`: inventário, pacote, moderação e operações.
- `/admin/parcerias?tab=engine`: preços, pedidos, direitos e reversões existentes.
- `/app`: Home com banner elegível.
- `/comunidades/<community>`: comunidade sintética identificada em `evidence/lifecycle.json`.

As credenciais sintéticas atuais e IDs ficam em `.finance-local/phase6-access.json`, ignorado e bloqueado no HTTP. O superadmin local é `admin.financeiro@example.invalid`; a senha de teste é `Evolutus-Local-Fase1!2026`. A senha do empreendedor/audiência sintéticos é `Evolutus-Local-Fase6!2026`; os e-mails gerados são apresentados junto à entrega e podem ser obtidos no arquivo local. Nenhum token de sessão integra a documentação versionada.

| Papel sintético | E-mail | Senha local |
| --- | --- | --- |
| Superadmin | `admin.financeiro@example.invalid` | `Evolutus-Local-Fase1!2026` |
| Empreendedor | `publicidade-692f580d-dbb4-49ba-a84a-76cc6b2fed26@example.invalid` | `Evolutus-Local-Fase6!2026` |
| Audiência | `audience-5db343a5-cc98-4b0b-82b5-2eb6fad5fc9c@example.invalid` | `Evolutus-Local-Fase6!2026` |

Comunidade de teste: `/comunidades/76875b6a-630f-4e87-9c2f-767fda63e86d`. Conta do empreendedor: `/meus-anuncios?accountId=2acea5b3-c23b-4ae5-99a8-22b2e8000fcf`. Os endereços `.invalid` e as senhas acima são exclusivos da base descartável.

Reprodução (somente containers descartáveis):

```sh
node scripts/homolog/finance/phase6-preview.mjs
npm run dev -- --config .finance-local/preview.config.mjs
node scripts/homolog/finance/phase6-reinstall.mjs
node scripts/homolog/finance/phase6-validate.mjs
PG_TEST_CONTAINER=evolutus_price_phase1_db node scripts/advertising-concurrency.mjs
node scripts/homolog/finance/phase6-seed.mjs
node scripts/homolog/finance/phase6-browser.mjs
node scripts/homolog/finance/phase6-lifecycle.mjs
node scripts/homolog/finance/phase6-realtime-check.mjs
node scripts/homolog/finance/phase6-live-browser.mjs
node scripts/homolog/finance/phase6-promotion-expiry.mjs
node scripts/homolog/finance/phase6-source-invalidation.mjs
node scripts/homolog/finance/phase6-community-performance.mjs
node scripts/homolog/finance/phase6-visual.mjs
```

A stack deve conter as migrations de desenvolvimento instaladas; o teste `reinstall` prova a sequência com rollback e não é um instalador. O preview reutiliza Auth/REST/Storage e usa um gateway Edge próprio da Fase 6, montado neste worktree, além do runtime oficial de Realtime restrito a loopback. O Vite encaminha Auth/REST/Storage diretamente aos serviços Docker locais, retirando o salto Deno que apresentava resets intermitentes. Edge Functions mantêm seu gateway próprio. Nenhum POST financeiro é repetido automaticamente. Sua configuração segue o [compose oficial do Supabase](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml); imagem/digest estão em `evidence/realtime-image.json`. Os harnesses redirecionam transporte para loopback, sem fabricar respostas ou frames publicitários.

## 18. Remoções e compatibilidade

Retirados do diálogo ativo seleção de pacote e débito direto de promoção. `create_promotion` só permite replay histórico compatível; novas compras antigas falham orientando o motor único. `promotionPackages` e estruturas históricas não foram apagados. O CRUD legado conserva manutenção de material existente, mas não expande escopo ou prazo nem cria novo inventário sem o fluxo comercial.

Nenhum consumidor orgânico foi removido sem substituição. Tabelas de anúncios/impulsos continuam distintas; compartilham cobrança, não um componente monolítico. Nenhuma primitiva InfinitePay precisou ser alterada.

## 19. Pendências e riscos de lançamento

Continuam explícitos os itens B/C do [checklist consolidado](../CHECKLIST_LANCAMENTO.md): tarifas/capacidades oficiais, termos editoriais/comerciais, cancelamento/compensação, LGPD/retenção, legado real, backup/restore, drift de destino, CI remoto, ambiente/CDN/Storage/Realtime e autorização de publicação. As fixtures não resolvem essas decisões.

Não se oferece início futuro arbitrário, carteira de empresa, gasto delegado, renovação automática, audiência mínima, conversão atribuída ou novas superfícies comerciais automáticas. Mudanças do pacote afetam apenas novas campanhas; uma campanha já preparada preserva seu conjunto, inclusive antes da contratação.

Realtime local foi homologado com serviço oficial; roteamento e disponibilidade do serviço no destino ainda exigem validação autorizada. A segurança do servidor não depende do canal, e a interface falha fechada quando ele não está disponível. O epoch global é uma solução simples de invalidação; medir sua contenção no volume real antes de aumentar o inventário.

Rollback de aplicação não estorna transações: pausar vendas/veiculação conforme a decisão operacional, manter schema/históricos e usar a reversão administrativa auditada somente quando autorizada. Não executar down migration destrutiva.

## 20. Integridade das fases anteriores

As regressões afetadas e os hashes da instalação preservam Fases 1–5.1: compra EvoCash por quantidade, preços versionados, carteira/ledger, motor comercial, produtos, profissionais, estabelecimentos, múltiplos cadastros, mídia, moderação, expiração e renovação. Isso é evidência local verificável; não afirma homologação financeira real ou estado do banco de produção.
