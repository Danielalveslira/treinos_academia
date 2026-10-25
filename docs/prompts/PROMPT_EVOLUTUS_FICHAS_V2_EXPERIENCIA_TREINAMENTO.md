# EVOLUTUS — Fichas V2: navegação, planejamento e execução mobile-first

## Sua missão

Atue como engenheiro sênior de produto, frontend React, GitHub Primer, Supabase/PostgreSQL, acessibilidade, segurança e performance PWA. **Implemente a reformulação completa da experiência de fichas e de treinamento**, tomando como fonte da verdade o código atual da branch principal e as entregas já integradas, em especial os PRs **#73 (Catálogo V2)** e **#74 (Fichas de treino)**.

**Não produza apenas uma proposta ou um protótipo:** realize as alterações, escreva testes, valide em navegador e abra um PR para revisão. **Não faça merge nem deploy em produção sem autorização explícita.** Não modifique os contratos financeiros, o modelo de histórico ou a sincronização apenas para simplificar a interface.

### Resultado de produto obrigatório

1. O item **“Exercícios” do menu principal passa a se chamar “Fichas”**, mantendo o caminho técnico `/exercicios` funcional para preservar links, histórico, PWA e integrações.
2. **Fichas** é a área de **planejamento e gestão**: criar, visualizar, editar, duplicar, ordenar, arquivar e restaurar fichas. Biblioteca e Catálogo Evolutus continuam acessíveis, mas secundários.
3. **Treinar** é a área de **ação**: o usuário escolhe uma ficha e inicia rapidamente, com **Treino livre** como alternativa discreta. Não abrir por padrão a seleção solta de grupos e exercícios.
4. Ao iniciar uma ficha, o fluxo vai direto para o **primeiro exercício disponível da ficha**, na sequência planejada, podendo mudar de exercício sem perder registros.
5. **Eliminar texto repetitivo, cards excessivamente altos, barras de etapas redundantes e CTAs duplicados**, sem esconder informações importantes de segurança, gravação ou disponibilidade.
6. Entregar uma interface realmente **mobile-first, simples, acessível, rápida em aparelhos fracos e consistente em modo claro/escuro**.

## 1. Levantamento curto antes de alterar

Inspecione os contratos e consumidores reais, sem pressupor que os exemplos abaixo sejam exaustivos:

- `src/components/Layout.jsx`: `NAV_ITEMS`, rótulos, ícones, links mobile/desktop e regra `replace` versus navegação de ação.
- `src/pages/ExercisesArea.jsx`, `src/pages/Exercises.jsx`: fichas/biblioteca/catálogo, query `?aba=`, `location.state?.openCatalog`, links anteriores e estado ao voltar.
- `src/features/workoutSheets/WorkoutSheetsPage.jsx`, `WorkoutSheetDetailPage.jsx`, `WorkoutSheetEditorPage.jsx`, `WorkoutSheetItemEditor.jsx`, `useWorkoutSheets.js`, `workoutSheetValidation.js`, `workoutSheetsService.js` e `workoutSheets.css`.
- `src/pages/NewWorkout.jsx`, `src/components/WorkoutForm.jsx`, `src/components/SetCard.jsx`, `src/styles/workoutExecution.css`, `src/utils/setSession.js`, `src/utils/rowSaver.js`, `src/utils/doneExercisesStorage.js`.
- `src/App.jsx`, `src/routeLoaders.js`, `vercel.json`, `src/utils/navigation.js`, `src/utils/plannedWorkout.js`: rotas diretas, pré-carregamento, retorno à origem, lembretes e PWA.
- `src/services/workoutsService.js`, `src/services/offline/*`, `src/services/economyService.js`, `src/utils/finishWorkout.js`: persistência, outbox, dados offline e finalização/recompensas.
- Migração já entregue `supabase/migrations/20261122000001_workout_sheets.sql`: propriedade da ficha, elegibilidade e validação no servidor.

Faça uma checagem de chamadas cruzadas e testes existentes. **Não crie outra implementação de fichas nem altere o schema sem necessidade comprovada.**

## 2. Navegação: Fichas como planejamento; Treinar como execução

### Menu principal

- Trocar o **texto** `Exercícios` por **`Fichas`** em `NAV_ITEMS` e nos rótulos de acessibilidade relevantes do menu, desktop e mobile; escolher um ícone compatível com planejamento. Conservar a identidade visual e a área clicável.
- **Manter `/exercicios` como caminho válido**. Não mudar nomes físicos de arquivos/rotas apenas por estética, nem quebrar `/exercicios/:id`, `?aba=biblioteca`, `?aba=catalogo`, `state.openCatalog`, deep links, favoritos ou retorno a `/novo-treino`.
- A entrada **Fichas** deve mostrar por padrão a gestão de fichas. **Biblioteca** e **Catálogo Evolutus** devem continuar acessíveis por navegação secundária clara e compacta, sem três abas igualmente dominantes se isso prejudicar mobile.
- Atualizar microtextos visíveis quando se referirem à área principal, mas **não substituir “exercício” por “ficha” onde o conceito é realmente um exercício** (p. ex., catálogo, metas, histórico, instruções e contagens).

### Nova entrada Treinar

- **Não apagar `/novo-treino`**: essa rota já executa sessões e suporta `?ficha=<id>`, `?exercicio=<id>` e parâmetros de lembrete. Preserve seus contratos e links.
- Adotar **uma entrada dedicada ao Treinar**, preferencialmente `/treinar`, com a lista **compacta e acionável** de fichas. Atualizar somente o item de navegação principal `Treinar` para essa entrada; manter links antigos para `/novo-treino` funcionais, incluindo Treino livre e acessos diretos.
- Não criar uma segunda área completa de edição de fichas na tela Treinar. **Reutilizar o mesmo serviço/hook de leitura**; ali, exibir apenas nome, quantidade de exercícios, informação secundária útil e CTA `Iniciar treino`. A gestão completa permanece em Fichas.
- Exibir **Treino livre** como opção secundária, abrindo o fluxo original de exercícios avulsos. Não eliminar o fluxo nem modificar como uma sessão livre é registrada.
- Preservar `originState`, `returnToOrigin` e a semântica de navegação de ação (`replace`/`push`) para não criar loops no botão Voltar.
- Em ficha arquivada, vazia ou com exercício indisponível, bloquear o início pelo motivo correto e fornecer caminho direto para corrigir a ficha, sem bypass da verificação do servidor.

## 3. Redesign da lista de Fichas e do estado vazio

### Tela Fichas

- Cabeçalho compacto: título `Minhas fichas`, uma linha de orientação **somente quando necessária**, e **um único CTA “Nova ficha”**.
- **Remover duplicação de “Criar ficha”** entre cabeçalho e estado vazio; no vazio, manter um CTA principal com texto curto, a menos que o cabeçalho já o resolva satisfatoriamente.
- Listagem de fichas em cartões compactos ou linhas com hierarquia clara: **nome**, `N exercícios`, até um ou dois metadados úteis (objetivo, dias sugeridos). Não repetir descrição/objetivo desnecessariamente.
- Ação **Iniciar** evidente nas fichas aptas; toque no conteúdo abre detalhes; ações secundárias (`Editar`, `Duplicar`, `Arquivar/Restaurar`, `Reordenar`) em menu contextual acessível, usando o padrão existente do Primer.
- `Mostrar arquivadas` deve ser um controle secundário, não disputar destaque com criação/início. Estados vazio/erro/carregamento concisos.
- Texto dos limites e rascunhos apenas nos estados em que se aplicam. Manter suporte aos limites reais do backend (40 fichas, 40 itens, etc.).
- Nada de lista inteira de exercícios/imagens no carregamento inicial de Fichas; buscar os detalhes ao abrir a ficha.

### Tela Treinar (seletor rápido)

- Cabeçalho `Treinar` + orientação curta, somente se útil.
- Fichas ativas em lista de cards compactos, com **ação principal “Iniciar”** e acesso secundário a detalhes. Não repetir todo o conteúdo da seção Fichas.
- Quando não houver fichas, oferecer `Criar ficha` e `Treino livre`, sem impor que o usuário tenha uma ficha para treinar.
- Não inventar seleção de “ficha do dia” ou sugestão personalizada se não existir regra confiável. Dias sugeridos são organização, não agendamento automático.

## 4. Detalhe da ficha: objetivos e exercícios sem poluição

- Cabeçalho com voltar, **nome da ficha**, metadados opcionais em **uma linha compacta e responsiva**, e acesso a edição sem disputar com o CTA principal.
- Exibir objetivos, descrição e dias somente se houver valores e se trouxerem informação nova; evitar linhas vazias.
- Substituir os enormes cards de cada exercício por **linhas compactas ordenadas**: índice discreto, nome, metas existentes (ex.: `3 × 8–12 · 90s`) e affordance para abrir instruções/demonstrações.
- Não renderizar a frase **“Sem metas definidas”** repetida em cada item; ausência de metas é válida e não é erro.
- **Não renderizar um botão “Ver execução de [nome inteiro]” por exercício**; tocar na linha ou num controle curto abre o `WorkoutExerciseGuide` com imagens START/END e instruções oficiais.
- Exibir indisponibilidade/retirada com um aviso **localizado no exercício afetado**, sem permitir seu uso em novas sessões; manter histórico.
- Manter **Iniciar treino** como CTA principal visível e confortável no mobile. Considerar barra inferior contextual somente se não competir com navegação mobile, instalador PWA e teclado.
- Arquivar, restaurar e editar continuam operacionais; não duplicar gravação nem mudar as regras de publicação do catálogo.

## 5. Execução: foco em exercício e série atual

O fluxo de treino com ficha deve ser **direto e contextual**:

1. Ao entrar com `/novo-treino?ficha=<id>`, validar a ficha como já é feito, preservar checks de propriedade/publicação e **selecionar automaticamente o primeiro exercício elegível na ordem da ficha**. Se não houver elegível, mostrar impedimento e ação de correção, sem abrir uma tela vazia.
2. Em vez dos blocos grandes `2 Exercício` e `3 Séries`, usar indicadores textuais concisos: **`Exercício 1 de N`** e, no card, **`Série 1 de M`**. Barra de progresso visual opcional, mas somente com contagem real, nunca com cálculo artificial.
3. Mostrar **um exercício e a série em edição/conclusão** como foco; nome, imagem pequena se disponível, link `Ver execução` e a **meta da ficha** em uma única linha, somente quando existir.
4. Não repetir a cada etapa o aviso longo `Metas da ficha (referência)...` nem “concluído hoje é por exercício/dia”. Manter explicação acessível uma vez, sob ajuda contextual, quando necessária.
5. Entradas de **peso** e **repetições** adequadas a teclado numérico mobile, com rótulos visíveis, validação segura e foco/teclado sem layout quebrado. `Concluir série` deve ficar claro e confortável. Informar `Salvo`, `Salvando`, `Pendente de sincronização` ou `Erro` de forma breve e precisa.
6. Após a última série, oferecer **Próximo exercício** claramente, respeitando a ordem da ficha, sem avançar antes da persistência segura nem reiniciar rascunhos ao navegar. Permitir voltar/trocar exercício preservando dados preenchidos, séries já concluídas e ações pendentes.
7. Controles avançados (`Ajustar séries`, `Data/observações`, `Sessões anteriores`) ficam recolhidos por padrão quando aplicável; preservar total funcionalidade e acessibilidade.
8. O modo **Treino livre** mantém seleção por grupo/exercício quando apropriado, mas compartilha os mesmos componentes de registro de séries — sem duas implementações diferentes de persistência.
9. Exercícios cardio devem continuar com suas métricas e validações próprias. Não forçar controles de peso/repetições em exercícios cardio.

### Limite funcional que não pode ser ignorado

- O projeto atualmente registra um exercício realizado **por exercício/dia**, e `doneExercisesStorage.js` usa marcação visual diária compartilhada entre fichas. **Isso não é progresso independente por ficha.**
- Nesta entrega, não criar percentual de conclusão por ficha nem reiniciar marcações quando o usuário trocar de ficha. Se houver indicador de sequência, baseá-lo somente na posição de navegação; se houver indicador de realizado, rotulá-lo com a semântica real `feito hoje` e refletir o estado confirmado.
- Não criar `session_id`, novas tabelas ou alterar `public.workouts` apenas para sustentar um contador visual. Se a UX exigir sessão independente por ficha, documentar essa dependência para uma etapa futura; não simular uma capacidade inexistente.
- **Não alterar** o tratamento offline da outbox, `rowSaver`, idempotência, `sync_workout_mutations`, `complete_workout_session`, premiação EvoCoins ou políticas de RLS. Metas planejadas **nunca** são séries realizadas nem dão recompensa.

## 6. CSS, GitHub Primer, acessibilidade e dark mode

- Priorizar componentes reais do **`@primer/react`**, tokens e padrões já utilizados no Evolutus. Não introduzir bibliotecas visuais concorrentes, CSS global indiscriminado, cores hardcoded, `!important` como atalho, nem portais que percam o tema.
- Reorganizar `workoutSheets.css` e `workoutExecution.css` com classes restritas ao recurso; eliminar regras obsoletas e duplicações **depois** de atualizar os consumidores. Preservar o sistema de light/dark existente.
- Layout **mobile-first desde 320 px**; testar 320×568, 360×740, 390×844, 768×900 e 1280×900. Nunca gerar overflow horizontal, sobreposição de ações ou scroll interno que aprisione a navegação.
- Alvos de toque de pelo menos **44×44 px**, texto legível, contraste suficiente, foco visível, sem depender só de cor/ícone, labels/ARIA corretos e retorno de foco depois de menu/modal.
- Rodapé de ação do treino deve coexistir com teclado virtual, safe areas, navegação inferior e PWA install prompt. Não esconder botão crítico sob a barra de navegação.
- Tratar modo `prefers-reduced-motion`, loading, erros, sucesso, vazios e indisponibilidade. Sem animações pesadas, imagens decorativas remotas ou sombras excessivas.

## 7. Performance real para celulares fracos

- **Reutilize** `useWorkoutSheets` e consultas resumidas existentes; não carregar todos os detalhes nem todas as imagens das fichas na entrada de Treinar/Fichas.
- Não disparar consultas por card (sem N+1). Reutilizar cache existente e deduplicar chamadas; não aumentar polling nem criar nova conexão realtime sem justificativa.
- Route-level lazy loading para lista, detalhe, editor e execução; pré-carregamento apenas nas condições já previstas em `routeLoaders.js` (respeitar `saveData` e conexões lentas).
- Na execução, renderizar somente o conteúdo necessário do exercício atual; imagens START/END e histórico detalhado **sob demanda**; componentes de linhas memoizados quando útil, sem memoização cosmética.
- Evitar remontar `WorkoutForm` e perder `savers`, estados de séries e rascunhos por transições de layout; usar chaves e navegação com intenção explícita.
- Manter paginação de fichas e catalogo, não carregar o catálogo inteiro nem implementar download offline completo (reservado para fase posterior).
- Avaliar **bundle gzip por rota**, número de chamadas, renders e comportamento com CPU 4× desacelerada/rede lenta. Comparar ao baseline anterior e corrigir regressões mensuráveis. Não mascarar excesso de bundle alterando o limite do CI.

## 8. Segurança, compatibilidade e dados históricos

- Validações de ficha, proprietário, sessões revogadas, exercícios oficiais publicados, duplicação, limite e revisão continuam **no backend**. A UI só reflete o resultado; jamais aceitar uma ficha indisponível forçando parâmetros URL ou estado client-side.
- Não alterar indiscriminadamente migrations existentes, triggers, RLS, grants ou RPCs. Qualquer correção comprovadamente necessária será migration **aditiva**, com pgTAP de segurança.
- Não perder dados de `public.workouts`, snapshots, bibliotecas pessoais, fichas existentes ou outbox pendente. Nenhuma operação visual pode limpar dados do usuário para “resolver” bugs.
- Preservar acessos diretos a `/exercicios`, `/exercicios/:id`, `/fichas/:id`, `/fichas/:id/editar`, `/fichas/nova`, `/novo-treino`, `/novo-treino?ficha=...`, `/novo-treino?exercicio=...`, lembretes `?planejado=...`, histórico e progresso.
- Fazer verificação de ownership, conta trocada, sessão revogada, ficha arquivada/vazia, retirada do catálogo e reabertura de tela com atualização remota concorrente.
- Ficha não deve passar a criar exercícios personalizados: continuar usando o **Catálogo Evolutus oficial**.

## 9. Testes obrigatórios e critérios de aceite

Criar/atualizar testes unitários, integração e smoke tests mobile/desktop com evidências reais de execução. Cobrir no mínimo:

1. O menu apresenta **“Fichas”**, tanto desktop quanto mobile; clicar abre `/exercicios` sem quebrar abas e links antigos.
2. O menu **Treinar** abre um seletor centrado nas fichas; `Iniciar` vai à sessão com `?ficha=id`, sem precisar escolher grupo muscular.
3. Treino livre permanece acessível e conserva o fluxo anterior.
4. Fichas vazias/arquivadas/indisponíveis exibem estado correto e não podem ser iniciadas indevidamente.
5. Lista compacta, detalhes compactos, instruções ao toque, edição/duplicação/arquivamento e links diretos preservados.
6. Metas opcionais aparecem somente quando existentes; **não** criar séries concluídas a partir de metas.
7. Avançar/voltar exercícios não duplica saves e não perde séries, rascunhos, outbox ou conclusão do dia.
8. Fluxos de força e cardio; 0/1/40 exercícios por ficha; nomes longos; uso em várias fichas no mesmo dia; treino livre entre sessões.
9. Leitura online/offline já suportada, queda de rede durante registro, ACK perdido, sincronização posterior e rejeição de exercício retirado.
10. `Finalizar treino` e EvoCoins continuam sob as regras atuais, sem pontuação fabricada.
11. Dark/light, teclado mobile, PWA install, menu, modal, foco, tab/esc, leitores de tela e `prefers-reduced-motion`.
12. Breakpoints mínimos listados acima, sem overflow horizontal e sem `layout shift` relevante. CPU 4× e rede limitada, com comparação da mudança real de bundle/consultas.
13. `npm test`, `npm run lint`, `npm run build` e jobs existentes do CI oficial; pgTAP se houver SQL alterado. Nunca ignorar falha, desabilitar teste ou criar mock que esconda a integração.

### Aceite visual

- Em Fichas, é possível encontrar uma ficha e suas ações sem precisar atravessar textos explicativos.
- Em Treinar, com fichas existentes, **um toque em Iniciar** começa a execução da ficha; **nenhuma tela intermediária de grupos**.
- Em cada ficha, o usuário vê rapidamente **ordem + nomes + metas realmente definidas**, sem um card enorme para cada exercício.
- Durante o treino, o foco é **exercício atual → série atual → concluir**, com próximo exercício explícito e feedback de gravação correto.
- Um celular de 320 px navega e registra normalmente com o teclado aberto, sem botões ocultos ou necessidade de zoom horizontal.

## 10. Entrega e PR

- Implementar em **branch específica** baseada na versão mais recente da `main`, com PR próprio. Não reabrir ou reimplementar os PRs #73/#74.
- Código modular, limpo e consistente com os padrões existentes. Não inserir feature flags desnecessárias, serviços duplicados nem telas paralelas para o mesmo objetivo.
- Documentar o **antes/depois** do fluxo Fichas/Treinar, rotas preservadas, componentes modificados, resultados dos testes, capturas mobile/desktop claro e escuro, tamanho dos bundles e riscos residuais.
- **Não executar merge nem deploy em produção** sem autorização explícita. Este trabalho é a revisão final da UX de fichas antes de avançarmos à fase posterior de downloads inteligentes.

**Execute a implementação integral e finalize com um relatório objetivo. Não solicite outra rodada de planejamento e não declare sucesso sem evidências de testes.**
