# EVOLUTUS — Fase 3: Remoção segura da criação de exercícios personalizados

Atue como engenheiro sênior responsável por frontend, Supabase/PostgreSQL, segurança, offline e qualidade do Evolutus. **Implemente integralmente a Fase 3**, tomando como base o código mais recente da branch atual e as Fases 1+2 **já implantadas em produção**. Não refaça o painel `/admin/exercicios`, não introduza novo ciclo de vida paralelo e não avance para o redesign público do catálogo (Fase 4) nem para o cache seletivo (Fase 5).

## Objetivo inegociável

**Usuários comuns não poderão mais cadastrar exercícios próprios.** Todos os *novos* exercícios selecionáveis devem vir do **Catálogo Evolutus oficial**, criado/publicado exclusivamente pelo superadmin conforme as Fases 1+2. Entretanto, **criar, organizar, executar, editar e registrar TREINOS continua permitido**. Exercício (conteúdo do catálogo), biblioteca pessoal (seleção de exercícios) e treino/sessão (atividade do usuário) são entidades distintas: não as confunda nem elimine funcionalidades de treino.

## 1. Auditoria curta e implementação imediata

Antes de editar, rastreie no repositório ATUAL todos os fluxos de criação/edição de exercícios pessoais e seus consumidores, sem pressupor que o ZIP anterior reflita o deploy. Pontos de partida do código legado:

- `src/pages/Exercises.jsx` (escolha entre "Catálogo Evolutus" e "Criar personalizado"; estados `addChoiceOpen`/`formOpen`/`editingExercise`; textos de estado vazio e menu de ações).
- `src/components/ExerciseForm.jsx`, `src/contexts/ExercisesContext*`, hooks relacionados e `src/services/exercisesService.js` (`createExercise`, `createCatalogExercise`, `updateExercise`, `deleteExercise`).
- `src/pages/NewWorkout.jsx`, `src/components/WorkoutForm.jsx`, `src/pages/ExerciseDetail.jsx`, histórico, biblioteca, relatórios e ordenação.
- `src/services/offline/` (fila de mutações, cache de exercícios pessoais e sincronização), testes e telas que acionem esses serviços.
- RLS/GRANT/policies, triggers e RPCs ligados a `public.exercises`, `public.workouts` e `sync_workout_mutations`; conferir compatibilidade com `20261117000001_exercise_catalog_lifecycle.sql` e com migrações posteriores.

Faça o inventário das referências reais; remova código obsoleto **somente depois** de atualizar consumidores e confirmar ausência de dependências. Prossiga com a implementação sem parar em outra rodada de planejamento.

## 2. Experiência do usuário — biblioteca e treinos

1. Em `/exercicios` (ou rota equivalente atual), **elimine** a opção "Criar personalizado", o seletor de origem, o formulário de cadastro pessoal e qualquer CTA/menu/atalho que reabra esses fluxos. O comando **"Adicionar exercício" deve abrir diretamente o Catálogo Evolutus**.
2. Ajuste estados vazios e microtextos, especialmente em `/novo-treino`: oriente o usuário a **escolher exercícios no Catálogo Evolutus**, não a "cadastrar" exercícios próprios. Respeite o estado logado, navegação de volta e contexto do usuário.
3. Preserve: busca da biblioteca, inclusão de exercícios oficiais, ativação/desativação local, observações pessoais, ordenação, remoção da biblioteca (conforme integridade referencial), detalhes, históricos, criação e edição de treinos, séries, cargas, repetições, exercícios concluídos e navegação.
4. Atributos oficiais (nome, grupos musculares, tipo, provider, ID e mídias do catálogo) **não devem ser editáveis pelo usuário comum**. Permita apenas preferências verdadeiramente pessoais já suportadas (por exemplo, observação, ordem e ativo), sem alterar a identidade do exercício. Simplifique qualquer formulário de edição que hoje permita modificar metadados oficiais.
5. Registros antigos com `source='custom'` devem continuar legíveis em biblioteca e histórico, com indicação discreta de **"Exercício antigo"** quando necessário; não ofereça criação, clonagem ou conversão automática enganosa. Para **novas sessões**, priorize apenas exercícios oficiais ativos/publicados; trate exercícios legados por uma regra explícita e compatível, orientando sua substituição sem perder dados anteriores. Não elimine registros silenciosamente.
6. Interface mobile-first, acessível e consistente com GitHub Primer/tokens existentes. Não adicionar CSS hardcoded, duplicação de botões ou telas paralelas.

## 3. Segurança real no Supabase — obrigatória

1. **Não basta remover botões.** Revise `exercises_all` e demais policies, grants, triggers e RPCs. Bloqueie no servidor a criação de `public.exercises.source='custom'` por usuários comuns, inclusive via PostgREST, cliente Supabase direto, chamadas manipuladas e operações offline reenviadas. Evite `DROP CASCADE` e alterações destrutivas.
2. Garanta que não seja possível contornar a restrição com `UPDATE` que troque `source`, `provider`, `provider_exercise_id` ou `catalog_id`, nem forjar `source='catalog'` com um identificador inexistente, retirado ou não publicado. **Reutilize e preserve as triggers da Fase 1+2**; amplie somente onde houver brecha demonstrada.
3. Preserve autenticação, propriedade por `auth.uid()`, sessão ativa (`private.current_session_active()` ou guarda oficial do projeto), RLS e permissões mínimas. `SECURITY DEFINER` exige `search_path` seguro e grants explícitos. Não inserir service-role key no frontend nem criar endpoint público privilegiado.
4. As operações pessoais ainda autorizadas (adicionar item oficial à biblioteca, nota, ordem, ativo e remoção legítima) devem funcionar, mas não permitir que o cliente altere a origem ou os metadados oficiais. Restrinja as colunas graváveis na aplicação **e** aplique garantias no banco; evite que a atualização envie campos imutáveis desnecessariamente.
5. Considere requisições concorrentes, duplicatas e restrições de unicidade (mesmo exercício oficial adicionado duas vezes). Prefira validação atômica no Postgres e operações idempotentes quando aplicável.
6. A Fase 1+2 já bloqueia novos registros com exercícios oficiais não publicados/retirados. **Não enfraqueça essas proteções** para acomodar o novo fluxo.

## 4. Dados antigos e integridade

- **Não excluir** linhas antigas `source='custom'`, registros de treino, vínculos, notas, estatísticas ou caches pessoais sem procedimento de migração e prova de que não há uso.
- Inspecione dependências reais (`workouts.exercise_id`, referências históricas, relatórios, offline etc.) antes de alterar contratos.
- Diferencie **bloquear criação nova** de **preservar leitura/histórico antigo**. Se necessário, crie uma regra de legado específica e restrita para atualização pessoal permitida, sem abrir uma exceção geral para novos exercícios personalizados.
- Não transformar automaticamente exercícios antigos em exercícios oficiais por semelhança de nome: isso poderia alterar a interpretação do histórico. Se oferecer substituição para uso futuro, ela deve ser explícita e preservar o passado.
- Migrations **novas, incrementais e rastreáveis**; não editar migrations já aplicadas em produção. Não remover tabelas/policies/funções apenas por parecerem antigas; documentar dependências e remover somente recursos comprovadamente órfãos.

## 5. Offline e sincronização — compatibilidade nesta fase

- Elimine caminhos locais que permitam **criar novo exercício personalizado offline**.
- Se houver mutações antigas de criação personalizada na outbox, ao sincronizar devem receber **rejeição definitiva e compreensível**, sem loop, sem promover conteúdo proibido e sem perda silenciosa de dados locais recuperáveis.
- Preserve cache pessoal por usuário, visualização offline do histórico, seleção de exercícios oficiais já armazenados e sincronização de treinos.
- Não implemente nesta fase download global do catálogo nem a arquitetura nova de cache seletivo; isso é **Fase 5**. Apenas mantenha os fluxos existentes corretos.

## 6. Testes e critérios de aceite

Adicionar/atualizar testes unitários, integração e pgTAP para comprovar:

1. Usuário comum **não** vê nenhum caminho para criar exercício personalizado em desktop/mobile; "Adicionar" abre diretamente o catálogo.
2. Usuário comum **não consegue inserir `source='custom'`** por SQL/API autenticada, mesmo alterando o payload, e não pode alterar `source`/identificadores oficiais depois de criar um vínculo.
3. Exercício oficial publicado pode ser adicionado à biblioteca; item inexistente, `draft`, `in_review` ou `withdrawn` é rejeitado no backend, inclusive com dados manipulados.
4. Duplicatas e acesso a itens de outro usuário são bloqueados; sessões revogadas não conseguem novas escritas onde aplicável.
5. Observações, ordem e ativo/inativo continuam funcionais; metadados oficiais não podem ser modificados pelo usuário.
6. Exercícios personalizados preexistentes e seus treinos **continuam legíveis**; históricos e relacionamentos permanecem intactos, inclusive após migração.
7. Novos treinos com exercícios oficiais continuam funcionais; exercícios retirados seguem bloqueados para novos registros.
8. Mutação offline antiga rejeitada não entra em tentativas infinitas, não desaparece sem explicação e não compromete outras mutações da fila.
9. Busca, biblioteca vazia, detalhes, navegação, mobile e acessibilidade não sofrem regressão.

Execute os comandos de validação aplicáveis no repositório real: suites pgTAP `supabase/tests/*_test.sql`, testes JS, `npm run lint`, `npm run build`, CI e verificações de segurança. Reporte **resultados efetivamente executados**; não omita erros nem use `|| true` para esconder falhas. Se o Supabase local oficial falhar, declare a limitação e os testes alternativos claramente; não confunda ambiente equivalente com o CI oficial.

## 7. Entrega e limites

- Faça a implementação completa desta **Fase 3** na branch atual, com alterações pequenas, seguras e manutenção simples.
- **Não publicar automaticamente em produção**. Preparar PR/CI no fluxo já protegido; migrations devem ser verificadas antes de aplicação remota. A Fase 1+2 já está em produção e não deve regredir.
- **Não implementar Fase 4** (redesign público do Catálogo Evolutus) nem **Fase 5** (offline inteligente/seletivo) neste trabalho.
- Não criar novas tabelas ou abstrações apenas por preferência; justificar cada alteração estrutural. Não apagar histórico, não desativar controles de segurança, não alterar o painel superadmin sem necessidade.

**Relatório final obrigatório:** listar arquivos/migrations alterados, comportamento antes/depois, como foi bloqueada a criação personalizada no banco, tratamento dos legados e da fila offline, resultados reais de testes/CI, e riscos ou pendências. Não declarar como concluído o que não foi testado.
