# Fase 4 — vitrines de produtos com EvoCash

Implementação local na branch `finance-storefront-phase4`, worktree `/tmp/evolutus-finance-phase4`, baseada em `finance-commercial-phase3`, commit `cd0fb0e`. A Fase 3 aprovada foi registrada em commit **local** antes de criar esta branch. O workspace original foi preservado. O planejamento mestre foi relido integralmente, junto dos inventários e entregas 0–3.

A fase entrega criação gratuita, gerenciamento de produtos, mídia privada, moderação e publicação por período usando exclusivamente o motor comercial existente. Contratação e renovação debitam a vitrine inteira, sem cobrança por produto. Não houve push, merge, deploy, alteração de produção, pagamento real ou início da Fase 5.

## Preview para revisão

- [Catálogo público](https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev/vitrine).
- [Área do empreendedor](https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev/vitrine/gerenciar).
- [Administração e moderação](https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev/admin/parcerias?tab=commercial).
- [Preços, direitos e auditoria financeira](https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev/admin/parcerias?tab=engine).

A porta 5173 serve a branch desta fase com Auth, PostgREST, Storage, Edge e PostgreSQL locais. O servidor interrompido foi restaurado durante o trabalho; as rotas voltaram a responder e o preview foi depois trocado para a Fase 4. A interface identifica o ambiente sintético. A conta de empreendedor e a conta superadmin de teste estão no arquivo local ignorado `.finance-local/phase4-access.json`; senhas/tokens não integram esta entrega versionável. O superadmin anterior continua sendo `admin.financeiro@example.invalid`.

O preço de 3 EvoCash/dia e os limites exibidos são **fixtures sintéticas**, criadas somente pelo launcher local, com justificativa explícita. Não são preços ou políticas comerciais aprovadas. A migration não publica preço, não habilita vendas e deixa os limites de cadastro sem configuração. As demais ofertas comerciais permanecem nas condições anteriores.

O laboratório da Fase 3 continua exclusivo de desenvolvimento. A área do empreendedor desta fase é uma funcionalidade normal, protegida pelo Auth e pelo PostgreSQL, sem credenciais administrativas no navegador.

## Arquitetura e migration

Única migration nova: `supabase/migrations/20261201000001_product_storefronts.sql`.

| Estrutura | Papel |
| --- | --- |
| `product_storefronts` | Entidade concreta da vitrine, nome, descrição, contato público e logotipo. Seu ID é o ID da âncora comercial. |
| `private.commercial_resources` | Continua sendo a autoridade de proprietário, estado e revisão editorial. FK composta conecta identidade, proprietário e oferta fixa `product_storefront`. |
| `partner_products` | Tabela existente reaproveitada: vínculo opcional à vitrine, mídia, preço comercial do produto em centavos, ordenação e arquivamento. |
| `storefront_media` | Alocação de caminhos e validação de mídia; estados allocated/ready/deleting, sem dados financeiros. |
| `storefront_settings` | Limites configuráveis de produtos ativos por vitrine e vitrines por proprietário; revisão/CAS e auditoria. Sem valores comerciais iniciais. |
| Motor da Fase 3 | Mesmos preços, pedidos, eventos, direitos, carteira e ledger, sem outro controle de contratação ou prazo. |

Não há saldo, data de vencimento ou contrato duplicado na entidade editorial. A situação “arquivada por expiração” é calculada a partir do entitlement, sem destruir aprovação, produtos ou imagens.

A migration adiciona integridade entre vitrine e âncora, impede aprovação de âncora sem vitrine concreta, instala as projeções públicas e só então marca o adapter como `integration_ready`. `sales_enabled` continua desabilitado, e nenhum preço é criado. Não há adapter de publicidade, perfil profissional ou estabelecimento nesta fase.

As RPCs financeiras de cotação, confirmação e reversão da Fase 3 não foram reimplementadas nem alteradas. `_wallet_debit_cash`, `_ledger_record`, `_wallet_credit_cash`, locks, sessão, dívida/reversões e carteira existentes são reutilizados integralmente.

## Criação, edição e moderação

O usuário autenticado e elegível pode criar vitrines, preparar produtos incompletos, enviar imagens, editar e abrir uma prévia privada sem possuir EvoCash. O banco aplica limites configurados; identificadores fornecidos pelo cliente nunca substituem a autorização por proprietário.

Todas as edições de conteúdo, incluindo substituição de imagem, são tratadas como materiais: a vitrine sai do público e exige nova aprovação. Essa política evita versões públicas silenciosamente substituídas e mantém a implementação simples. Nenhuma edição reinicia, amplia ou recalcula o período contratado. A interface informa que o prazo continua correndo durante a revisão.

Estados editoriais: rascunho, em análise, aprovada, reprovada, suspensa e arquivada pelo proprietário. Suspensão não é removida por edição, submissão, pagamento ou renovação. Somente o superadmin reautenticado pode devolvê-la a rascunho para nova submissão e aprovação. As decisões também incrementam a revisão editorial: um formulário administrativo antigo não pode sobrescrever uma decisão mais recente.

Produtos sem imagem ou com campos incompletos permanecem privados como rascunho. Submissão e aprovação verificam descrição da vitrine e completude de todos os produtos não arquivados, inclusive mídia validada pertencente à mesma vitrine. Arquivar produto preserva dados/imagem e retira o item das projeções públicas; libera sua vaga no limite de produtos ativos.

Administração fica na seção existente Propostas e produtos. Leads e produtos legados continuam acessíveis ao superadmin. A moderação identifica proprietário, revisão, motivo, situação editorial, direito, vencimento e histórico de contratações. Preços, suspensão/revogação financeira, reversões e auditoria monetária permanecem na aba Motor comercial, evitando ferramentas financeiras duplicadas.

## Contratação e renovação

1. O proprietário submete a revisão completa; superadmin aprova com motivo, senha pelo Auth e autenticação recente validada no banco.
2. O gerenciamento consulta tarifa vigente, limites de dias e estado de vendas do motor. Oferta sem preço ou pausada não permite nova contratação.
3. O proprietário informa dias; `quote_commercial_order` calcula e congela duração, tarifa e total no servidor. A interface mostra esse resultado e um vencimento estimado baseado no instante do banco e no direito existente.
4. Após confirmação explícita, `confirm_commercial_order` revalida proprietário, sessão, aprovação/revisão, bloqueios, oferta e cotação. Na mesma transação: débito da carteira existente, ledger, pedido, direito e evento.
5. Publicação passa a depender da âncora aprovada e do direito vigente, pelo predicado privado da Fase 3. Falha na concessão desfaz débito, ledger, pedido e direito.
6. Renovação usa outro pedido autorizado e o preço da nova cotação. O motor adiciona dias ao prazo restante ou começa novo período após expiração, preservando vitrine, produtos, imagens e histórico.

O botão para adquirir EvoCash leva ao fluxo existente. A volta de uma recarga não contrata nem debita automaticamente. Preços de produtos, em centavos de BRL, são informativos e direcionam à loja externa; não são preços do serviço, saldo ou checkout de mercadorias no Evolutus.

Reversão utiliza exclusivamente a operação administrativa auditada da Fase 3. Não se criou política automática de compensação. Suspensão registra motivo, revisão, instante, direito e vencimento para permitir apurar período não entregue. Concessão de compensação depende de política comercial aprovada e decisão administrativa.

## Expiração, mídia, cache e privacidade

`public_product_catalog` atende catálogo, filtros, categorias, detalhe e produto individual. Todas as projeções usam a vigência do PostgreSQL, combinada à revisão aprovada, titular elegível e estado administrativo do direito. Não existe ramo público especial que ignore o contrato por o visitante ser superadmin.

Produtos legados sem vínculo não entram nesse catálogo. A leitura direta de `partner_products` não é concedida ao anônimo; as policies administrativas só abrangem registros legados. As tabelas novas não oferecem leitura/escrita direta ao cliente. As projeções públicas não retornam proprietário, e-mail de conta, senha, preço contratado, saldo ou auditoria. O campo de contato é explicitamente apresentado ao proprietário como **público**.

A vitrine pública preserva a ilha React, filtros, cards e modal Primer, agora agrupados por vitrine. Há paginação no catálogo, no gerenciamento e nos produtos/contratos. Antes de abrir detalhes de produto, uma nova consulta revalida a disponibilidade. Em falha de rede, a ilha remove conteúdo anterior; em expiração, invalida os elementos e o modal usando o prazo devolvido pelo banco. Essa invalidação visual não é a autoridade de acesso: chamadas diretas continuam protegidas no servidor.

- Novas imagens são comprimidas/reexportadas pelo utilitário existente antes do envio. O Edge limita o corpo, verifica MIME, RIFF/WebP completo, dimensões, tamanho e ausência de metadados EXIF/XMP pelos helpers existentes.
- O banco aloca o caminho; o cliente não escolhe nem sobrescreve arquivos. O bucket `storefront-media` é privado e não possui policies de acesso direto pelo cliente.
- `storefront-media` entrega bytes somente após autorização SQL, revalidada depois da leitura do Storage. Não emite URL assinada duradoura. Respostas têm `no-store`, controles de CDN e `nosniff`.
- Proprietário acessa imagens privadamente com a sessão; após expiração, imagens e produtos continuam preservados. O visitante recebe 404 para imagem vencida, suspensa ou privada.
- Substituição remove a mídia antiga somente se não houver referências. O descarte primeiro marca `deleting`; novas associações deixam de ser permitidas. A linha é removida após sucesso no Storage. Falhas deixam um registro rastreável para retry, sem exposição pública.
- Tentativas de upload que falham são limpas quando possível; interrupções de rede/processo podem deixar allocations ou mídias não associadas. Permanecem privadas e rastreáveis. A operação pode repetir DELETE autorizado para mídias não referenciadas; uma rotina de coleta operacional periódica não foi adicionada nesta fase.
- Nenhum sistema consegue revogar bytes já recebidos, capturas ou cópias externas. URLs externas dos produtos legados, anteriormente distribuídas, não podem ser revogadas pelo Evolutus. Esses dados são preservados apenas na administração, sem serem apresentados como mídia protegida pela nova arquitetura.

RPC pública, HTML direto e mídia têm controles anti-cache. A URL consistente `/vitrine/<id>` responde 200 somente para conteúdo elegível, 404 neutro quando indisponível e 503 neutro em falha do backend. O handler escapa texto e entrega título, descrição e canonical sem dados privados. O noindex conservador já existente da Vitrine foi preservado; vitrines não são adicionadas ao sitemap nem são anunciadas como indexadas. Não se promete remoção instantânea de buscadores externos.

O service worker não usa o shell offline como resposta para URLs diretas de vitrines. APIs e mídia privada não entram no cache de imagens oficiais dos exercícios. O HTML estático do catálogo contém apenas sua estrutura e o estado de carregamento.

## Legado e limpeza comprovada

A política para produtos existentes sem vitrine é mantê-los privados na administração até decisão explícita de migração. Não houve atribuição automática de dono, gratuidade perpétua, importação de imagens externas, exclusão de produtos ou remoção de histórico.

Foram preservados `PartnerProductForm`, `PartnerProductList` e o CRUD administrativo legado, com suas validações de imagem. Seus textos agora explicam que a aprovação histórica não publica. A função antiga `productStatus`, que derivava “Publicado” somente de aprovação/datas manuais, foi removida por ter ficado incorreta e não ter outros consumidores. O parâmetro `now` e o cálculo `Date.now()` exclusivo dessa lista foram retirados. A consulta administrativa antiga passa a selecionar somente produtos sem vínculo.

A antiga projeção pública sem contrato foi substituída e sua policy pública removida. Não houve remoção de consumers de promoções, carteira, relatórios, perfis profissionais ou compras. Nenhuma dependência foi adicionada. `/minha-vitrine` continua sendo a área profissional e não foi convertida nesta fase.

## Evidências verificáveis

Evidências JSON/texto em `evidence/`; imagens de QA permanecem locais, ignoradas pelo Git, conforme `docs/CAPTURES_POLICY.md`. O inventário detalhado está em `ARQUIVOS.md`.

| Área | Resultado |
| --- | --- |
| Migration | Aplicação integral sobre a base descartável da Fase 3, com rollback. Fixture de produto legado e todos os registros anteriores preservados, sem alterar saldos/ledger. Verificados zero preços/vendas/limites comerciais semeados. `migration-final-install.log`. |
| SQL Fase 4 | **74 asserções novas**, cobrindo testes de propriedade, RLS, mídia, vínculo concreto, aprovação, limites, CAS, contratação, expiração, renovação, suspensão, reversão, limpeza rastreável e remoção de titular. **282 asserções nas oito suítes**. Quantidades por suíte em `sql-summary.json`. |
| Atomicidade | Falha sintética na concessão após débito deixa saldo, ledger, pedido e direito inalterados. Não há publicação isolada nem pedido fulfilled parcial. |
| Regressão | As suítes das Fases 1–3, integridade financeira e reversões passaram. O legado de produtos e leads também foi revalidado. Logs por suíte, com total em `quality.json`. |
| Concorrência real | Duas vitrines concretas disputaram o mesmo saldo: um pedido de 90 debitado, outro recusado. Seis replays de confirmação e seis de renovação geraram um débito por pedido. Duas renovações independentes simultâneas preservaram um direito com 2.937.600 segundos exatos. Suspensão concorrente impediu a confirmação pendente sem novo débito. `concurrency.json`. |
| Browser real | Criação → edição → produto → upload/substituição → prévia privada → submissão → aprovação → cotação → confirmação → ledger/carteira/direito → expiração → renovação → suspensão → nova aprovação administrativa. Mesmo ID e imagem preservados após renovação. Duplo clique gerou uma confirmação; débito total foi 27 EvoCash (21 + 6), sem cobrança por cadastro/produto. `browser.json`. |
| Sessão | Visitante anônimo e usuário autenticado acessaram o catálogo; o usuário autenticado manteve o cabeçalho de sessão, sem pedido indevido de login. Outra conta não listou vitrines privadas do proprietário. |
| Cache e URLs | Navegador aberto removeu a vitrine no vencimento. URL direta e imagem retornaram 404 depois de vencer. Falha de rede removeu conteúdo anterior. Suspensão bloqueou a imagem imediatamente. |
| HTTP adversarial | Sete cenários com Auth, Edge, Storage, REST e PostgreSQL reais: headers no-store inclusive RPC GET, bloqueio de tabela direta, upload alheio/anônimo/inválido/excessivo, adulteração de validade, mídia/âncora de terceiros e sessão revogada. `http.json`. |
| Mobile e temas | Área privada e catálogo em 320/390/1440 px, claro/escuro, sem overflow ou pageerror. Capturas locais inspecionadas. |
| JavaScript | Sete arquivos novos/afetados passaram, incluindo serviços, estados/erros, administração legada, rotas, navegação administrativa, service worker e handler HTTP. `js.log`. |
| Release | 98 testes locais passaram, incluindo os três testes do handler público. `release.log`. |
| Gates | Lint com zero erros e 16 warnings existentes; build, budget e scanners de segredos de fonte/build passaram. Aviso de chunk Primer grande permanece. |
| Performance | 1.000 vitrines/10.000 produtos sintéticos, rollback ao final. Amostra EXPLAIN ANALYZE: consulta pontual 2,360 ms; grupos 96,029 ms; busca/página 158,211 ms; categorias 89,417 ms. `performance.log`. Não são p95, SLA nem medição de produção. |

SQL simula papéis/claims e sessões na base descartável; browser e HTTP utilizam sessões efetivamente emitidas pelo GoTrue local. Edge/Storage/PostgREST/PostgreSQL são reais no ambiente isolado; EvoCash, usuários, produtos, preço e imagens são sintéticos. Não houve requisição financeira externa.

O teste SQL novo segue a descoberta `*_test.sql`. O CI obrigatório recebeu o teste do handler público e a corrida de vitrines concretas. O CI remoto integral não foi executado, pois não houve push. Não se declara reexecução indiscriminada de todos os smokes globais ou homologação real de pagamentos.

## Reprodução, operação e limites

No ambiente isolado existente:

```sh
node scripts/homolog/finance/phase4-preview.mjs
node scripts/homolog/finance/phase4-seed.mjs
npm run dev -- --config .finance-local/preview.config.mjs
# Em outro terminal:
node scripts/homolog/finance/phase4-migration-check.mjs
node scripts/homolog/finance/phase4-validate.mjs product_storefronts_test.sql public_commercial_test.sql partner_products_require_image_test.sql commercial_engine_test.sql evocash_pricing_test.sql infinitepay_cash_purchases_test.sql finance_integrity_test.sql finance_reversals_test.sql
node scripts/homolog/finance/phase4-browser.mjs
node scripts/homolog/finance/phase4-http.mjs
PG_TEST_CONTAINER=evolutus_price_phase1_db node scripts/storefront-concurrency.mjs
```

O launcher usa nomes e portas fixos da stack descartável e aguarda Storage. O seed cria novas contas fictícias a cada execução; não usar essas ferramentas em produção. A validação SQL limpa o gate jurídico somente dentro da transação de teste e reverte ao fim; o browser usa o pacote jurídico aprovado do repositório instalado como fixture e as sessões reais correspondentes. A prova de migration requer o container de baseline descartável, sem tabelas da Fase 4 instaladas, e sempre termina com rollback.

Continuam dependendo de decisão externa: preços/limites oficiais, termos comerciais de publicação e compensação, política de migração do legado, retenção após exclusão de conta, operação periódica de limpeza de uploads interrompidos e validação do CI remoto/deployment futuro. Não há contratação real liberada por esta entrega.

Para futura liberação autorizada, coordenar migration, Edge de mídia, API de detalhe e frontend; manter vendas pausadas até completar as verificações e configurar parâmetros aprovados. Ativar a integração técnica não publica rascunhos nem habilita vendas. Retomar código visual antigo não deve restaurar a antiga policy pública sem contrato.

Rollback operacional: pausar novas vendas pelo motor, preservar schema aditivo e dados, manter consultas privadas e conciliação. Não desfazer débitos por DELETE/UPDATE de saldo. Usar somente a reversão auditada existente quando houver decisão aplicável. Expiração e suspensão continuam efetivas mesmo sem cron ou frontend.

Os critérios funcionais foram atendidos no ambiente isolado: propriedade validada no PostgreSQL, débito único e indivisível com o direito, expiração em consultas e mídia, renovação da mesma vitrine e dados preservados. As Fases 1, 2 e 3 permaneceram funcionais nas regressões executadas; InfinitePay e a implementação da carteira/ledger não foram modificadas.
