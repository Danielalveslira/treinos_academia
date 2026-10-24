# EVOLUTUS — Implementação integrada: Administração de exercícios, Catálogo V2 e Offline Inteligente

## Papel e objetivo

Atue como engenheiro sênior responsável por arquitetura, segurança, banco de dados, frontend e qualidade do Evolutus. **Implemente, no projeto atual, as melhorias abaixo de ponta a ponta**, com código limpo, testes e migrações seguras. Não entregue somente análise ou protótipos. Inspecione primeiro as implementações existentes para reutilizá-las e evitar duplicação.

### Resultado esperado

1. Apenas **superadmins** criam, editam, revisam, publicam e retiram exercícios do **Catálogo Evolutus**.
2. Um exercício publicado no painel administrativo passa automaticamente a integrar o catálogo oficial, com instruções, metadados e imagens START/END.
3. O catálogo se torna uma experiência de descoberta de exercícios profissional, gratuita, rápida, acessível e mobile-first.
4. O usuário comum deixa de criar exercícios personalizados, mas continua podendo **escolher exercícios oficiais para sua biblioteca, montar/registrar seus treinos e preservar seu histórico**.
5. O offline utiliza **cache seletivo por uso**, sem baixar o catálogo inteiro nem todas as imagens: somente conteúdos escolhidos/consultados, com preparação explícita em um clique, sincronização incremental e identificação de atualizações.
6. Um superadmin consegue retirar rapidamente um exercício inseguro, com bloqueio no servidor, registro de auditoria e propagação segura ao cache local.

## 1. Auditoria inicial obrigatória

Analise o código real antes de implementar. O ZIP de referência contém, entre outros:

- `src/pages/AdminExerciseVisuals.jsx`, `src/hooks/useAdminExerciseVisuals.js` e a rota `/admin/exercicios-imagens` (já protegida por `SuperAdminRoute`).
- `src/components/ExerciseCatalog.jsx`, `src/pages/Exercises.jsx`, `src/pages/ExerciseDetail.jsx`, hooks de catálogo e contexto de exercícios.
- `src/services/exerciseCatalogService.js`, `src/services/exercisesService.js` e `src/utils/exerciseCatalog.js`.
- `src/services/offline/catalogSnapshot.js`, `exerciseCache.js`, `exerciseImagePrep.js`, `userExercisesCache.js`, `readThrough.js`, `syncLock.js` e `src/hooks/useExerciseImagePrep.js`.
- `scripts/service-worker.js` e `src/components/CatalogOfflineStatus.jsx`.
- `supabase/migrations/20260930000001_exercise_catalog.sql`, `20261026000006_exercise_catalog_offline_converge.sql`, migrações de imagens e suas funções/RLS.
- `supabase/tests/`, testes unitários e workflows de CI.

**Pontos concretos a investigar/corrigir:**

- `catalogSnapshot.js` implementa varredura completa e nova transferência de todos os exercícios quando a revisão muda. **Eliminar essa necessidade para o fluxo normal**; não é aceitável substituir o download total por outro download total oculto.
- `exerciseImagePrep.js` já baixa somente URLs recebidas, com concorrência e cancelamento. **Reutilizar e aprimorar**, sem criar uma segunda infraestrutura redundante.
- `useExerciseImagePrep.js` depende de exercícios que já estejam cacheados; se o metadado não existir localmente, pode ignorar um exercício escolhido. Corrigir a resolução seletiva antes de calcular/baixar imagens.
- `scripts/service-worker.js` usa `MAX_EXERCISE_IMAGE_ENTRIES = 100` e redução com pouco armazenamento. Um limite global por quantidade não garante a preservação dos exercícios prioritários. Implantar política coerente com limite em bytes/quota e prioridades, sem promessa absoluta contra eviction do navegador.
- `providerExerciseToPersonal()` fixa o provider `evolutus_dataset`. Preservar a proveniência real ao publicar conteúdo original, com constraints, mapeamentos e testes coerentes.
- `public.exercises` tem política `exercises_all` que permite criação pessoal do tipo `custom` por chamada direta ao Supabase. **Não confundir esconder botão com garantir permissão no banco**.
- `exercise_catalog.is_active` existe, mas a retirada precisa alcançar usuários que já adicionaram o exercício, caches e tentativas de novos registros.
- Avaliar a compatibilidade de `allocate_exercise_visual_set` com rascunhos não publicados e com a publicação atômica de metadados + referências de mídia.
- Verificar quais migrations estão efetivamente aplicadas no ambiente remoto antes de depender delas. O arquivo existir no repositório não prova aplicação em produção.

Produza um diagnóstico técnico curto com problemas, pontos de reuso e riscos, mas **continue com a implementação**.

## 2. Administração oficial — exclusiva do superadmin

Evolua a seção administrativa existente de imagens para um **painel completo de exercícios**, mantendo e reutilizando o fluxo maduro de upload/validação/publicação de START/END.

### Interface

- Seções claras: **Exercícios**, **Novo exercício**, **Em revisão** e **Retirados**; reutilizar navegação e componentes Primer existentes.
- Busca, filtros por grupo muscular/status, paginação, contagem de registros e ações contextuais.
- Formulário único: nome, músculos primário/secundários, categoria, equipamento, dificuldade, instruções em etapas, orientações de segurança, imagem START, imagem END e thumbnail quando aplicável.
- Estados explícitos: `draft`, `in_review`, `published`, `withdrawn` (ajustar nomes ao esquema existente; evitar dois campos de status contraditórios).
- Salvar rascunho incompleto; **publicar somente com dados obrigatórios e imagens START/END válidas e efetivamente armazenadas**.
- Preview fiel de como o exercício aparecerá para o usuário, edição segura, confirmação de ações sensíveis, feedback real de carregamento/erro/sucesso.
- Evitar duplicar telas ou criar CSS hardcoded. Usar somente Primer/tokens já adotados pelo app, layout responsivo e acessível.

### Persistência e publicação

- `public.exercise_catalog` continua sendo a fonte oficial dos metadados do exercício. Mantenha a identidade estável do item e controle versões de conteúdo e mídia.
- Distinguir exercícios importados de exercícios criados pela equipe (ex.: provider `evolutus_original`); ajustar constraints e consumidores necessários **com migrations aditivas e testes**, sem modificar migrations históricas.
- Publicação validada **no backend**; nunca depender de campos enviados pelo cliente como `is_superadmin`, `published` ou identificadores de outro autor.
- Reutilizar o pipeline de mídias já existente; uploads temporários devem ter validação antes de se tornarem públicos. Evitar exposição de mídia de rascunho por URLs previsíveis/públicas.
- Considerar falhas entre upload, transação SQL e publicação: estado recuperável, sem publicar referências incompletas nem deixar arquivos órfãos indefinidamente.
- Publicar um exercício deve atualizar o catálogo automaticamente; não deve exigir uma segunda etapa manual em outro módulo.
- Reedição deve atualizar somente as versões afetadas. Evitar trocar URLs/cache-busting de imagens que não mudaram.

## 3. Reformulação do Catálogo Evolutus

Transforme o catálogo em um ponto forte do produto: **biblioteca oficial gratuita, visualmente cuidada e fácil de usar**.

- Página de descoberta que mostre conteúdo útil mesmo sem digitar uma busca; utilizar consulta paginada e quantidade controlada, sem carregar a base inteira.
- Busca rápida, filtros compactos por músculos/equipamento/categoria/nível e estados vazios informativos.
- Cards consistentes com thumbnail real, nome e metadados essenciais. Lazy loading de imagens e atenção à estabilidade de layout.
- Detalhe do exercício com duas imagens START/END, instruções passo a passo, observações de segurança e CTA para adicionar à biblioteca pessoal.
- Mostrar claramente o valor do catálogo oficial e gratuito sem banners excessivos ou poluição visual.
- Preservar buscas, filtros, paginação, retorno à posição anterior e experiência em mobile.
- Acessibilidade: semântica, labels, navegação por teclado, foco, contraste e estados de loading/erro.
- Tratar imagens ausentes, falhas de rede e dados antigos sem travar a tela.
- Usar `@primer/react` e os tokens de tema; não recriar componentes já disponíveis.

## 4. Remover a criação personalizada — sem quebrar treinos

- Remover das telas de usuário comum a ação de **cadastrar um exercício próprio** e seus formulários/fluxos obsoletos.
- **Não remover** criação, montagem, edição ou registro de **treinos**. Treino/sessão é diferente de exercício do catálogo.
- Usuários poderão pesquisar, selecionar e adicionar exercícios oficiais, organizá-los na biblioteca, registrar sessões e consultar o histórico.
- Bloquear no banco/API/RPC o `INSERT` de exercício `source='custom'` por usuários comuns, inclusive por requisições diretas. Validar também alterações que possam transformar registro do catálogo em item customizado ou trocar `catalog_id`/provider de maneira indevida.
- Para itens `source='catalog'`, validar no servidor existência, publicação, atividade do exercício, propriedade do usuário e unicidade apropriada. Não confiar em nomes, providers e estados fornecidos pelo frontend.
- Migrar com cuidado registros personalizados **preexistentes**, caso haja, mantendo histórico e integridade referencial; não apagar automaticamente dados históricos.
- Auditar tabelas, views, funções e políticas realmente obsoletas; remover apenas o que estiver comprovadamente sem referências. Nada de `DROP CASCADE` indiscriminado.
- Revisar todas as superfícies dependentes (biblioteca, detalhes, histórico, telas de treino, ordenação, importações, relatórios, offline).

## 5. Offline inteligente e seletivo — requisito central

**NÃO baixar todos os exercícios. NÃO baixar todas as imagens. NÃO sincronizar o catálogo integralmente em cada revisão.**

### Regras de comportamento

| Evento | Ação esperada |
|---|---|
| Usuário abre o catálogo | Buscar página necessária e miniaturas visíveis, sem download massivo. |
| Usuário abre detalhe | Consultar o item e imagens START/END sob demanda; cache oportunista reutilizável. |
| Usuário adiciona à biblioteca | Salvar referência/metadata mínima, marcar o item como prioritário; sem download pesado silencioso. |
| Usuário clica **Preparar meus exercícios offline** | Em uma única operação, resolver **somente** os exercícios pessoais selecionados e baixar metadados, instruções e imagens faltantes. |
| Usuário abre o app novamente | Reutilizar armazenamento local e verificar atualizações de modo econômico. |
| Exercício não mudou | Nenhum download desnecessário de seu conteúdo ou imagens. |
| Dados mudaram, imagens não | Atualizar apenas dados. |
| Uma imagem mudou | Atualizar só o arquivo alterado, mantendo o restante. |
| Exercício retirado | Torná-lo indisponível conforme regras de segurança da seção 6; limpar entradas locais elegíveis. |
| Exercício removido da biblioteca | Remover sua prioridade offline; manter ou eliminar cache temporário conforme política de quota e uso compartilhado. |

### Arquitetura proposta

**Fonte:** Supabase como fonte autoritativa; o cache local é uma cópia parcial, nunca uma fonte global de verdade.

**Dados:** IndexedDB, com entradas por `catalog_id`, revisões e metadados de disponibilidade; preservar namespaces por usuário onde houver conteúdo pessoal.

**Imagens:** Cache Storage + Service Worker já existentes, preferindo arquivos publicados imutáveis com identidade/versão estável. Distinguir imagens temporárias das priorizadas para offline.

**Seleção:** Lista de `catalog_id`s dos exercícios pertencentes à biblioteca do usuário; resolver entradas não encontradas no cache por consulta seletiva no servidor, em lotes pequenos. Não deixar um item de fora apenas porque falta o detalhe local.

**Manifesto/versionamento:** Definir mecanismo de revisões monotônicas por exercício e por mídia, ou equivalente comprovadamente correto. Manter índice mínimo de alterações/retiradas para os itens selecionados. Não depender somente de `MAX(updated_at)` dos ativos nem de comparação de um snapshot global.

**Atualização diferencial:** Consulta por IDs selecionados e versões conhecidas; retornar alterações e retiradas, sem transferir registros inalterados. Considerar versionamento/tombstones de retirados, inclusive quando deixam de ser visíveis nas policies de leitura normais. O endpoint de status de retirada deve retornar somente campos mínimos e autorizados, nunca conteúdo privado de rascunhos.

**Fluxo em um clique:**

1. Obter a lista pessoal efetiva e IDs oficiais.
2. Checar status e revisões desses IDs em lote.
3. Atualizar somente conteúdos alterados ou ausentes no IndexedDB.
4. Reunir apenas URLs de imagens atuais dos exercícios selecionados.
5. Verificar a presença real de cada arquivo e baixar somente os faltantes/alterados, com concorrência pequena e backoff em falhas transitórias.
6. Confirmar disponibilidade pelo armazenamento local, não apenas pelo sucesso HTTP.
7. Mostrar progresso real (itens e imagens), falhas, espaço disponível aproximado e ação de tentar novamente.

**Resiliência:** suportar cancelamento com `AbortController`, retomada dos itens faltantes, rede instável, quota insuficiente, indisponibilidade de IndexedDB/Cache Storage e duas abas abertas. Reutilizar `withSyncLock`/deduplicação já existente e controlar concorrência.

**Desempenho:** não disparar downloads pesados em boot, ao navegar pelo catálogo ou em redes limitadas sem ação explícita. Checagem de revisão/status pode ocorrer ao abrir o app, entrar no catálogo, voltar ao foreground e recuperar a conexão, com amortização para evitar consultas excessivas. Não confiar exclusivamente em `navigator.onLine` como prova de conectividade.

**Eviction/limites:** abandonar a lógica fixa de 100 imagens como garantia universal; estabelecer orçamento em bytes, política de descarte para conteúdo temporário e prioridade relativa do conjunto offline preparado. Verificar uso/quota com APIs suportadas e tratar falhas. **Nunca prometer armazenamento permanente:** o navegador pode eliminar dados; fornecer indicador preciso de disponibilidade e opção de reparo.

**Conta/privacidade:** limpar manifesto de prioridades ao logout ou troca de conta, isolar dados privados por usuário e impedir que um login posterior leia biblioteca pessoal de outro usuário. Imagens públicas compartilháveis podem permanecer em cache, desde que não revelem a biblioteca privada.

**Interface mínima:** ação principal **“Preparar meus exercícios offline”** na biblioteca, estados `não preparado`, `parcial`, `pronto`, `atualizando`, `erro`, progresso verificável e botão `Cancelar` durante preparo. Não duplicar botões separados para catálogo e imagens. O status precisa abranger **dados e imagens**, não somente quantidade de fotos.

### Migração da arquitetura offline atual

- Avaliar `CatalogOfflineStatus`, `catalogSnapshot.js`, `exerciseCache.js` e consumidores do indicador `snapshot.complete`.
- Remover a **dependência funcional** de snapshot completo; adaptar busca offline para explicitar que resultados locais são **parciais**. Nunca mostrar “nenhum exercício existe” só porque ainda não foi baixado.
- Fazer migração de dados locais já existentes sem excluir desnecessariamente o que é válido, nem tratar snapshot legado como garantia de conteúdo atualizado.
- Se permanecer código legado, comprovar que não executa download completo em ações normais; remover caminhos mortos e documentação incorreta.

## 6. Segurança, denúncias e retirada de exercícios perigosos

Criar ação administrativa **“Retirar do catálogo”**, com confirmação e motivo obrigatório. Não executar `DELETE` físico do exercício publicado como mecanismo de retirada.

### Estados e efeitos

- Retirada ativa deve **imediatamente** impedir no servidor novas adições e novos registros de treino que usem o exercício, conforme regras explícitas e testes do domínio.
- Não basta ocultar o item na interface: cobrir acesso direto ao Supabase, APIs/RPCs e caminhos de sincronização.
- Remover das buscas/listagens públicas e impedir novas seleções. Na biblioteca existente, sinalizar a indisponibilidade e orientar a substituição quando houver conexão.
- Preservar treinos históricos, nomes mínimos e integridade referencial; nunca apagar unilateralmente o histórico pessoal do usuário.
- Registrar autor da ação, data, motivo, estado anterior/novo e histórico de modificações em trilha de auditoria protegida.
- Para restauração, exigir nova revisão pelo superadmin; incrementar versão/revisão e revalidar mídia/instruções.
- Se já houver sistema de denúncias reutilizável, integrá-lo; caso não haja, criar fluxo enxuto de **“Reportar problema no exercício”**, sem publicar denúncia automaticamente nem expor dados pessoais. Limitar abusos e permitir triagem pelo superadmin.

### Segurança offline e consistência

- Ao verificar atualizações, dar prioridade aos **tombstones/status de retirados**; invalidar dados ativos e referências de mídia local elegíveis.
- **Não afirmar bloqueio instantâneo em dispositivo desconectado.** Mostrar que o conteúdo pode estar desatualizado quando não houver verificação recente. Nunca apresentar item desatualizado como “validado agora”.
- Durante reconexão, não reintroduzir item retirado a partir de cache antigo ou de uma fila offline.
- Para registros feitos offline antes de receber uma retirada, implementar tratamento explícito de conflito: informar o usuário, preservar o dado local de maneira recuperável e não contornar a validação do servidor. Evitar perda silenciosa e loops infinitos de retry.
- Considerar que arquivos públicos já acessados podem permanecer em cache, CDN ou dispositivos desconectados. Não alegar revogação global instantânea de bytes já distribuídos.

## 7. Permissões e segurança de ponta a ponta

- **Default deny** em RLS/GRANT e RPCs administrativas: somente `public.is_superadmin()` ou mecanismo confiável equivalente pode criar, alterar status, publicar ou retirar itens do catálogo.
- Validar no servidor cada operação sensível; `SuperAdminRoute` é apenas camada de UX, não autorização suficiente.
- Nenhuma service-role key ou segredo administrativo no frontend.
- Validar e restringir campos aceitos, tamanho de textos, quantidade de instruções, relacionamentos, status e transições autorizadas.
- Imagens: validação real de tipo e conteúdo, limites de tamanho e dimensões, formatos admitidos, proteção contra paths externos/arbitrários, tratamento de arquivos inválidos e uploads incompletos. Não confiar apenas na extensão, no MIME do cliente ou na UI.
- Bloquear referência a assets de outro exercício, rascunhos não aprovados e paths em processo de exclusão; reutilizar fences e constraints atuais.
- Renderizar instruções como texto seguro; evitar HTML não confiável/XSS.
- Idempotência para publicar, retirar e receber retry; concorrência controlada para prevenir publicação dupla e perda de atualização.
- Proteger operações de denúncia contra spam; evitar vazamento de informações administrativas nas respostas públicas.
- Evitar alterações destrutivas e escalonamento de privilégios. Toda migração deve ser reversível sempre que tecnicamente viável, observando dependências e histórico.

## 8. Testes, QA e regressão

Criar/atualizar testes automatizados com **cenários positivos, negativos e de concorrência**:

1. Usuário comum não acessa nem executa RPC/admin write; superadmin acessa.
2. Publicar rascunho válido gera item visível no catálogo; rascunho incompleto não publica.
3. A versão publicada preserva START/END corretos, sem mídia órfã e sem URLs arbitrárias.
4. `provider` do exercício original/importado é corretamente mantido ao adicionar à biblioteca.
5. Usuário comum não consegue criar `source='custom'`, inclusive via SQL/API direta.
6. Histórico, vínculos e registro de treinos continuam íntegros após desabilitar criação personalizada.
7. Abrir o catálogo não inicia uma sincronização integral nem faz download massivo das imagens.
8. Preparar offline baixa **somente os exercícios pessoais**, incluindo detalhe ausente no cache, e não solicita conteúdo já válido.
9. Alterar só instruções não baixa imagens; alterar só START não baixa END; versões idênticas não baixam novamente.
10. Offline com falha parcial, quota esgotada, cancelamento e duas abas não corrompe dados anteriores nem exibe sucesso falso.
11. Busca offline diferencia cache parcial de resultado vazio real.
12. Retirar exercício bloqueia novas adições/registros **no servidor**, preserva histórico e chega ao cache via tombstone.
13. Reconexão de fila offline com exercício retirado produz conflito tratável, sem bypass ou perda silenciosa.
14. Troca de conta/logout não expõe dados da biblioteca anterior.
15. UI mobile, dark/light, teclado, leitores de tela, paginação, filtro e performance sem regressões.

Rodar lint, testes unitários, testes SQL/pgTAP, build e verificações já configuradas no CI. **Não mascarar falhas com `|| true`, `set +e` ou exceções silenciosas.** Não afirmar que o teste passou sem execução real. Quando algum teste exigir Supabase remoto não disponível, declarar claramente a limitação.

## 9. Critérios de aceite obrigatórios

- [ ] Apenas superadmin cria/edita/publica/retira exercícios, **com bloqueio real no backend**.
- [ ] Novo exercício publicado entra automaticamente no Catálogo Evolutus com conteúdo e imagens corretos.
- [ ] Interface do catálogo é profissional, responsiva, acessível e paginada, sem download global.
- [ ] Usuário comum seleciona exercícios oficiais e continua registrando treinos sem criar exercícios personalizados.
- [ ] Nenhum fluxo normal depende de baixar o catálogo inteiro ou as imagens de todos os exercícios.
- [ ] Um clique prepara os **exercícios pessoais** e suas mídias, identificando arquivos faltantes.
- [ ] A atualização transfere só alterações relevantes, com status honesto e retomada de falhas.
- [ ] Retiradas são auditadas, bloqueadas no servidor e propagadas aos clientes conectados.
- [ ] Histórico e integridade referencial continuam preservados.
- [ ] Migrations, RLS, upload e estados offline contam com testes negativos.
- [ ] CI, build e testes aplicáveis aprovados, sem regressões conhecidas.

## 10. Estratégia de entrega e relatório final

Implemente em etapas internas, mas trate como **um único trabalho integrado**:

1. Auditoria e migrations aditivas (estados, permissões, versionamento, tombstones/auditoria).
2. Backend/RLS e painel de criação/publicação/retirada.
3. Remoção segura da criação personalizada e integração com biblioteca/treinos.
4. UX do catálogo.
5. Cache seletivo, sincronização diferencial, service worker e UI offline.
6. Testes, correções de regressão e revisão de segurança/performance.

**Não publicar em produção automaticamente sem gates de CI e validação das migrations.** Preparar o deploy e seguir o fluxo de PR/proteções existente no GitHub; indicar claramente se alguma confirmação externa é necessária.

Ao terminar, responder de maneira objetiva com:

- Resumo do que foi efetivamente implementado, por módulo.
- Arquivos e migrations relevantes.
- Resultados reais de lint, testes, build e verificações SQL.
- Mudanças de RLS/segurança e compatibilidade do banco.
- Comportamento offline antes/depois, com evidência de que não baixa a base inteira.
- Pendências e riscos residuais, separados das entregas concluídas.

**Proibições:** não criar novos sistemas paralelos onde já há infraestrutura reutilizável; não trocar a arquitetura por ZIP de catálogo; não usar timers/prefetch pesado sem necessidade; não remover histórico nem a capacidade de criar/registrar treinos; não usar CSS hardcoded fora do padrão Primer; não declarar segurança/offline/performance resolvidos sem provas.
