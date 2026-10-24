# Evolutus — Implementação completa da V2 de Métricas de Anúncios

## Papel e objetivo

Atue como engenheiro de software sênior responsável pela arquitetura, segurança, banco de dados, frontend, testes e integração da funcionalidade de anúncios do Evolutus.

**Implemente a V2 completa da tela de métricas de anúncios**, transformando o painel administrativo atual em uma solução profissional de acompanhamento de campanhas para o superadmin e para anunciantes autorizados. O foco é **confiabilidade dos números, compartilhamento seguro entre usuários, clareza dos resultados, visual minimalista e performance**.

Não entregue somente um plano ou um redesign superficial: analise o repositório atualizado e implemente as alterações necessárias, com migrations, integrações, telas e testes. Faça escolhas simples e coerentes com a arquitetura existente. Não introduza dependências, abstrações ou tabelas desnecessárias.

## 1. Primeiro: auditar a implementação existente

Antes de modificar código, percorra os fluxos reais de criação, exibição, coleta, agregação, administração, autenticação e roteamento dos anúncios. Em especial, examine:

- `src/pages/AdminSponsoredAds.jsx` e seus testes.
- `src/features/adMetrics/` — API, hooks, componentes e utilitários.
- `src/hooks/useAdMetrics.js` e `src/services/adMetrics/`.
- As migrations `20260929000006_sponsored_ads.sql`, `20261018000001_sponsored_ad_metrics.sql`, `20261018000002_sponsored_ad_metrics_dashboard.sql` e `20261019000001_sponsored_ad_metrics_privacy_controls.sql`.
- As suítes `supabase/tests/sponsored_ad_metrics*_test.sql` e os testes do frontend correspondentes.
- Roteamento, guards, estrutura de usuários e padrões de componentes Primer já adotados no `/app`.

Considere as regras reais do sistema, sem presumir que a coleta esteja ativa em produção. Verifique os contratos das RPCs antes de reutilizá-las e preserve o comportamento administrativo existente.

### Fatos que precisam ser respeitados

- O painel atual lê métricas agregadas pela RPC administrativa `get_sponsored_ad_metrics_dashboard`, restrita a superadmin.
- A coleta usa `record_ad_events`, agregados em `sponsored_ad_daily_stats` e marcadores temporários em `sponsored_ad_event_marks`.
- A coleta é controlada no cliente por `VITE_AD_METRICS_ENABLED` e no servidor por `sponsored_ad_metrics_settings.collection_enabled`; não habilite nenhuma dessas flags automaticamente.
- Há proteção de privacidade que exclui contas inelegíveis e pessoas que se opuseram à coleta; não afrouxe ou contorne essas regras.
- `partner_name` é texto descritivo, **não uma identidade confiável do proprietário**; `created_by` é o autor administrativo, não o anunciante.
- As estatísticas diárias são preservadas mesmo após a exclusão de um anúncio; portanto, autorização e histórico não podem depender exclusivamente de uma linha ainda existente em `sponsored_ads`.
- O campo `unique_viewers` representa deduplicação segundo a granularidade diária e de contexto existente; a soma entre dias, campanhas ou posicionamentos **não é alcance único de pessoas no período**.

## 2. Arquitetura de acesso: contas de anunciantes

Adote o modelo **conta de anunciante → campanhas → usuários autorizados**, inspirado nas práticas de plataformas profissionais. Não implemente um grant separado para cada anúncio como mecanismo principal.

### Modelagem mínima sugerida

Crie migrations incrementais e seguras para:

1. `advertiser_accounts`: identificador, nome público/comercial, status de ativação, criador e timestamps.
2. `advertiser_members`: relacionamento entre conta de anunciante e usuário autenticado, permissão inicial exclusivamente `viewer`, identificador de quem concedeu acesso, data de concessão, revogação/status e restrição de unicidade adequada.
3. `advertiser_campaigns`: **vínculo durável entre `ad_id` e conta de anunciante**; deve continuar válido mesmo que `sponsored_ads` seja excluído, possibilitando consultas ao histórico agregado. Guardar metadados mínimos de identificação histórica da campanha quando necessário.

Esses nomes são referências, não uma ordem para duplicar conceitos já existentes. Verifique o schema e mantenha **uma única fonte de verdade para titularidade**. A associação de uma campanha deve ser explícita e feita apenas por superadmin; nunca atribua propriedade automaticamente por coincidência de `partner_name`.

Regras obrigatórias:

- Uma conta pode ter várias campanhas e vários usuários leitores.
- Um usuário pode pertencer a mais de uma conta, sem misturar os resultados entre elas.
- A exclusão de uma campanha não deve destruir seu histórico nem quebrar relatórios anteriores.
- Transferências de titularidade não podem expor retroativamente métricas de outra empresa: defina e teste a política de transferência (preferencialmente bloquear transferência direta e exigir operação administrativa explícita e auditável).
- Não apagar ou sobrescrever agregados históricos existentes.
- Criar índices e constraints proporcionais às consultas reais; evitar índices redundantes.
- Dados antigos sem vínculo comprovado permanecem **não atribuídos**, visíveis apenas ao superadmin até vinculação manual.
- Permitir revogar acesso imediatamente e desativar a conta sem destruir o histórico.

## 3. Segurança: autorização obrigatória no banco

Implemente mecanismos de acesso de leitura para os anunciantes, separados da RPC administrativa.

- A identidade de quem consulta vem de `auth.uid()`, nunca de um `user_id` arbitrário enviado pelo navegador.
- Toda RPC de anunciante valida a associação ativa do usuário à conta solicitada e o status ativo da conta.
- Toda consulta por campanha aplica o escopo de titularidade **no SQL, antes de agregar**; um `ad_id` forjado ou pertencente a outra conta não pode produzir dados.
- Mantenha a RPC `get_sponsored_ad_metrics_dashboard` restrita ao superadmin.
- Preserve RLS e o bloqueio de leitura direta das tabelas sensíveis para usuários comuns.
- Se usar funções `SECURITY DEFINER`, configurar `search_path` restrito, objetos qualificados, privilégios mínimos, `REVOKE/GRANT` explícitos, parâmetros validados e ausência de SQL dinâmico desnecessário.
- Não expor eventos brutos, marcadores, identificadores dos espectadores, dados de nascimento, opt-outs ou dados de outras empresas.
- Impedir enumeração de campanhas, contas e usuários por diferenças indevidas entre erros.
- Garantir isolamento entre sessões; ao sair, trocar usuário ou trocar conta, invalidar cache e requisições pendentes.
- Não armazenar dados sensíveis de métricas em `localStorage`, `sessionStorage` ou IndexedDB.
- Incluir auditoria mínima de concessão, revogação e vinculação de campanhas, preferencialmente com metadados no banco e operações administrativas rastreáveis.

**Não criar nesta V2 links anônimos com acesso contínuo aos dados.** O botão de compartilhar deve gerar URL profunda para o relatório ou campanha, exigindo login e autorização no servidor. Links externos com token temporário ficam para uma evolução posterior.

## 4. Administração de anunciantes

Integrar ao fluxo administrativo já existente em `AdminSponsoredAds.jsx`, sem construir um segundo painel administrativo paralelo.

Permitir ao superadmin:

1. Criar, visualizar, editar e desativar contas de anunciantes.
2. Vincular campanhas existentes ou recém-criadas a uma conta.
3. Consultar campanhas não vinculadas e atribuí-las manualmente.
4. Conceder acesso `viewer` a usuários existentes do Evolutus, com busca/seleção segura.
5. Listar quem possui acesso e revogá-lo.
6. Abrir a visão do anunciante para conferir o que será exibido, sem burlar validações do backend.
7. Consultar o histórico de campanhas encerradas ou removidas, quando existirem agregados associados.

Não construir, por enquanto, cadastro autônomo de organizações, convite para e-mail não cadastrado, edição de campanha pelo anunciante, aprovação comercial ou hierarquia extensa de papéis.

## 5. Portal exclusivo do anunciante

Criar uma experiência autenticada, integrada ao menu e ao layout real do `/app`, com rota coerente com o roteamento existente (exemplo: `/meus-anuncios`; valide possíveis conflitos).

Requisitos:

- Exibir apenas contas e campanhas às quais o usuário tenha acesso.
- Quando houver várias contas autorizadas, oferecer seletor claro com escopo isolado.
- Disponibilizar visão geral da conta e detalhamento de cada campanha.
- Cada campanha deve mostrar identidade reconhecível: nome, imagem/miniatura quando disponível, posicionamento, situação atual e período. Para campanhas removidas, usar metadados históricos realmente preservados e indicar indisponibilidade do material original.
- O anunciante **não pode editar** anúncio, orçamento, status, permissões nem números.
- Compartilhar deve copiar a URL autenticada; um destinatário não autorizado recebe tela de acesso negado, nunca dados privados.
- Aplicar carregamento sob demanda e reuso dos componentes e utilitários de métricas, evitando código duplicado entre admin e anunciante.

## 6. Dashboard V2: qualidade visual e utilidade

Redesenhar o painel de métricas para um padrão profissional, simples e consistente com o Evolutus:

- Usar **GitHub Primer** (`@primer/react` e tokens oficiais); sem CSS hardcoded desnecessário, `!important`, componentes legados ou bibliotecas visuais paralelas.
- Design minimalista, responsivo, mobile-first, acessível (teclado, leitores de tela, foco, estados de loading/erro/vazio), com dark mode consistente.
- Evitar poluição visual, cartões redundantes, gráficos decorativos e informações que não ajudem a tomar decisões.
- Cabeçalho com conta/campanha, período analisado, estado da campanha, atualização do relatório e ações **Compartilhar** e **Exportar**.
- Resumo com impressões visíveis, cliques, CTR qualificado e alcance agregado **com rótulos corretos**; dados secundários acessíveis sem ocupar o destaque principal.
- Gráfico de evolução diária, com opção de comparar impressões e cliques, períodos predefinidos e intervalo personalizado.
- Comparação com período anterior equivalente, com cálculo determinístico no servidor ou em função testada; não indicar melhora/piora quando os dados não permitem comparação confiável.
- Distribuição por posicionamento, campanhas e comunidade, aproveitando os agregados que já existem.
- Tabela/lista ordenável de campanhas com busca, filtros e acesso ao detalhe.
- Paginação ou carregamento incremental para resultados extensos, sem esconder silenciosamente linhas além do limite atual de 50.
- Exibir o período e fuso usado no banco, distinguindo data de medição de horário local de exibição.
- Garantir que filtros sejam aplicados de maneira consistente a cards, gráficos e exportações.

Não inventar gráficos, scores, crescimento, estimativas, ROI, receita, vendas, conversões ou orçamento quando não houver fonte real verificável.

## 7. Fidelidade e transparência estatística

Este requisito é mais importante que o visual.

- Preserve as regras de contabilização existentes e seus mecanismos antifraude e de deduplicação. Não reescreva a coleta sem justificativa técnica comprovada.
- Diferencie claramente **impressão visível**, **clique**, **clique qualificado**, **CTR bruto**, **CTR qualificado** e **alcance agregado**.
- Explique em linguagem concisa que alcance agregado **não significa espectadores únicos durante todo o período**, pois um usuário pode ser contabilizado novamente em outro dia, posicionamento ou campanha.
- CTR qualificado = cliques com impressão previamente registrada conforme regra atual / impressões visíveis. Não chamar isso de conversão ou venda.
- Nunca substituir valor inexistente por zero nem atribuir zero a uma data sem prova de que houve medição válida. Preservar a distinção entre `0`, `null`, ausência de registro e indisponibilidade da coleta.
- Distinguir coleta **desativada**, dados **históricos**, período **sem registros** e falha de carregamento. Não afirmar que a medição está completa se o estado histórico das flags não está disponível.
- Explicar os limites reais da coleta: depende de cliente habilitado, autenticação, elegibilidade, oposição à coleta e entrega bem-sucedida dos eventos.
- Mostrar atualização real do snapshot e, quando possível, último dia com eventos **daquela conta/campanha**, nunca metadados globais capazes de revelar outras empresas.
- Evitar conclusões automáticas especulativas. Só mostrar análises simples quando diretamente sustentadas por números válidos.
- Considerar os efeitos de campanha excluída, períodos sem registros, cliques sem impressão registrada, CTR acima de 100% e filtros sem resultados.
- Não modificar políticas de privacidade, retenção ou consentimento para elevar artificialmente a contagem.

## 8. Relatórios e exportação

Entregar relatório compartilhável e exportação reutilizando a mesma fonte autorizada do dashboard:

- **Compartilhar**: copiar link profundo para a conta/campanha e, se aplicável, período/filtros, exigindo autenticação e autorização.
- **CSV**: exportar linhas reais e campos corretamente nomeados, sem truncamentos ocultos; proteger contra *CSV formula injection*; indicar período, data, fuso, filtros e definições das métricas.
- **PDF**: relatório legível e profissional com identidade Evolutus, nome do anunciante, campanha(s), período, KPIs e séries disponíveis, data da emissão e ressalvas estatísticas. Preferir solução enxuta que não comprometa o bundle; não simular um PDF com um arquivo incorreto.
- Garantir correspondência entre números apresentados e números exportados; não recalcular com fórmula divergente.
- Exportações devem respeitar exatamente o mesmo escopo autorizado do usuário.
- Não inserir dados pessoais dos espectadores ou informações de outros anunciantes nos arquivos.

## 9. Arquitetura e performance

- Reaproveitar as agregações SQL, RPCs administrativas e o padrão de cache em memória já existentes quando apropriado.
- Criar uma interface/API compartilhada para leitura do dashboard, com separação clara entre acesso administrativo e acesso do anunciante.
- Preferir **uma consulta agregada por combinação de conta/campanha/filtros**, evitando N+1 e múltiplos requests para cada cartão.
- Os índices devem refletir predicados reais de autorização, `ad_id`, conta, data e filtros; avaliar `EXPLAIN` se houver ambiente apropriado.
- Ter limites explícitos para intervalos, paginação e payload. Manter a validação de intervalo no servidor.
- Gráficos com lazy loading, layout estável e sem renderizações excessivas.
- Cache somente em memória e escopado por usuário, conta, filtros e privilégios. Revogação não pode continuar expondo snapshots antigos depois de uma falha de autorização ou mudança de identidade.
- Não introduzir polling constante ou Realtime sem necessidade.
- Seguir padrões de nomenclatura, testes e arquitetura já existentes no repositório.

## 10. Testes obrigatórios e cenários de segurança

Ampliar as suítes automatizadas de frontend e pgTAP/Supabase, cobrindo no mínimo:

**Isolamento e autorização**
- Anunciante A não acessa métricas do anunciante B, inclusive quando manipula IDs, parâmetros ou URLs.
- Usuário sem vínculo não acessa contas/campanhas.
- Vínculo revogado ou conta desativada perde acesso imediatamente nas novas leituras.
- Uma pessoa vinculada a duas empresas vê cada uma separadamente, sem mistura de totais.
- Usuário deslogado não acessa métricas.
- Usuário comum não executa operações administrativas nem acessa tabelas de estatísticas diretamente.
- O superadmin continua usando o painel atual.

**Integridade histórica e estatística**
- Exclusão de campanha não apaga estatísticas nem desvincula indevidamente seu histórico.
- Campanha antiga sem titularidade não é atribuída por `partner_name`.
- Tentativa de reassociação/transferência não provoca vazamento retroativo.
- Contagens por período, campanha, conta e posicionamento batem com agregados autorizados.
- Somatório do alcance diário não é rotulado como pessoas únicas no período.
- Valores ausentes, coleta desligada, CTR nulo, CTR acima de 100% e cliques sem impressão funcionam corretamente.
- Comparação de períodos usa janelas equivalentes.
- Paginação não altera totais globais.
- CSV e PDF não expõem dados de terceiros nem apresentam números diferentes do dashboard.

**UX e regressão**
- Mobile, desktop, modo claro/escuro, filtros, troca de conta, loading, erro, vazio, compartilhamento, exportação e acessibilidade.
- Mudança de sessão ou revogação invalida cache e respostas em voo.
- Fluxo de criação, edição, publicação/exibição e coleta de anúncios continua funcionando.
- Nenhuma migração quebra dados, políticas RLS, dependências ou RPCs existentes.

Execute e corrija os problemas encontrados em `lint`, testes de frontend, build, validação de migrations e testes SQL correspondentes. Utilize os comandos efetivos do projeto; não mascare erros, não altere testes para fazê-los passar artificialmente e não declare como executado algo que não foi validado.

## 11. Limites de escopo e cuidados de release

Não implementar nesta entrega:

- Links anônimos ou públicos com métricas atualizadas.
- Convites para e-mails sem conta no Evolutus.
- Hierarquia corporativa complexa ou edição de campanhas por anunciantes.
- Conversões, vendas, ROI, investimento ou faturamento não rastreados.
- Rastreamento adicional de usuários para compensar lacunas de coleta.
- Ativação automática da coleta de métricas.
- Refatorações amplas de módulos fora do domínio de anúncios.

Criar migrations **aditivas, reversíveis quando tecnicamente possível e seguras para dados existentes**. Nunca apagar métricas para adaptar o esquema. Não executar migrations em produção nem fazer deploy automaticamente: deixar as alterações prontas e documentar os passos para publicar com segurança.

## 12. Critérios de aceite

A entrega estará concluída quando:

1. Superadmin conseguir cadastrar um anunciante, atribuir campanhas, autorizar/revogar leitores e visualizar históricos.
2. Usuário autorizado abrir o portal e consultar somente campanhas da sua conta, inclusive campanhas encerradas com histórico preservado.
3. Usuário de outra empresa não conseguir obter dados por nenhuma rota, RPC ou parâmetro manipulado.
4. Dashboard V2 funcionar em mobile e desktop, com Primer e ambos os temas, apresentando números precisos e definições claras.
5. Compartilhamento autenticado, CSV e PDF funcionarem sem violar autorização nem divergir dos valores do painel.
6. Coleta, privacidade, rotas existentes e administração anterior permanecerem operacionais.
7. Testes automatizados relevantes passarem e limitações remanescentes serem explicitadas.

## 13. Retorno final obrigatório

Ao finalizar, entregue um resumo técnico e objetivo com:

- O que foi implementado e onde.
- Migrations criadas e alterações de autorização/RLS/RPCs.
- Fluxo para o superadmin disponibilizar métricas a um usuário.
- O que o anunciante consegue acessar e compartilhar.
- Testes e comandos realmente executados, com seus resultados.
- Pendências ou limitações reais, especialmente sobre cobertura da coleta e dados históricos sem titularidade.
- Passos exatos necessários para publicar em produção, **sem publicar por conta própria**.

**Prioridade de execução:** 1) segurança e vínculo durável de titularidade; 2) integridade das métricas; 3) backend do portal; 4) UX V2; 5) compartilhamento e exportação; 6) testes e documentação.

**Padrão esperado:** código limpo, modular, de baixo acoplamento, performático, acessível, seguro e consistente com o Evolutus. Sem funcionalidades fictícias, sem métricas inventadas e sem atalhos de segurança.
