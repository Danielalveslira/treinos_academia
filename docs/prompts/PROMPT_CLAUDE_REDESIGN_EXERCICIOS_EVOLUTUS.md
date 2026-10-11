# Evolutus — Redesign e auditoria da página Exercícios

Atue como desenvolvedor sênior de React, UI/UX e Supabase. Analise **o estado atual do repositório** antes de alterar qualquer arquivo e **implemente** as melhorias na página **Exercícios**, incluindo o catálogo e o fluxo de adição à biblioteca pessoal.

## Regra visual obrigatória

**NÃO utilizar emojis Unicode/nativos** (ex.: figuras renderizadas pelo teclado/sistema operacional). Quando eu disser “emojis”, quero dizer **ícones vetoriais no estilo visual que o Evolutus já usa hoje**.

- Reutilize prioritariamente `lucide-react` e os ícones existentes do projeto (`src/constants/muscleGroupIcons.js`, `@primer/octicons-react`, componentes Primer e estilos já definidos).
- Amplie a biblioteca de **ícones por grupo muscular e por músculo do catálogo**, com visual uniforme, dimensões, espessura de traço, contraste e estados consistentes com o tema atual.
- Crie um mapeamento centralizado e reutilizável, com fallback discreto para grupos personalizados/desconhecidos. Preserve sempre o **nome textual** do músculo/grupo; o ícone é apoio visual, não a única identificação.
- Escolha ícones semanticamente coerentes. Evite repetir um ícone genérico para quase todos os músculos. Se a biblioteca existente não tiver ícone anatômico preciso, use a melhor alternativa visual e mantenha o rótulo claro — **não substitua por emoji nativo**.
- Se a branch contiver `muscleGroupEmojis.js` ou outras mudanças experimentais com caracteres emoji, **substitua essa solução por componentes de ícones do padrão atual**; não perpetue esse arquivo/abordagem.
- Não introduza uma nova biblioteca de ícones, imagens remotas ou dependências sem necessidade.

## 1. Auditar a classificação muscular de ponta a ponta

Verifique `imports/exercicios_ptbr.json`, `src/utils/exerciseCatalog.js`, `src/constants/muscleGroups.js`, `src/contexts/ExercisesContext.jsx`, `src/services/exercisesService.js`, `src/components/ExerciseCatalog.jsx`, os hooks/services do catálogo e as RPCs/migrations Supabase correspondentes.

- Valide todos os exercícios elegíveis do dataset local (**873 entradas; historicamente 868 válidas**, confirme os números no repositório atual) e confira se cada `primaryMuscle` está mapeado corretamente.
- Corrija inconsistências conhecidas da versão auditada: **Antebraços não devem ir para Bíceps; Pescoço não deve ir para Costas; músculo desconhecido não deve cair silenciosamente em Pernas**. Defina tratamento explícito para **Cardio** conforme a categoria.
- Confira a diferença entre o filtro muscular do catálogo (pode encontrar músculo **principal ou secundário**) e o grupo em que o exercício é salvo na biblioteca (geralmente definido pelo **principal**). Deixe isso claro na interface, sem classificação enganosa.
- Verifique todas as etapas: busca/filtro → detalhes → adicionar → persistência → exibição no grupo → treino → edição/reordenação, incluindo eventual divergência entre estado local e banco.
- Preserve os exercícios personalizados e as escolhas manuais dos usuários. **Não reclassifique registros históricos em massa** sem estratégia segura, relatório de impacto e aprovação.
- Mantenha a origem dos exercícios vinculada ao **Supabase/PostgreSQL** e os mecanismos offline/IndexedDB já existentes. Não usar Firebase.

## 2. Redesenhar a página Exercícios

Implemente uma interface **premium, limpa, intuitiva, rápida e responsiva**, aproveitando o design system atual do Evolutus:

- Hierarquia clara: título, ações principais, resumo útil da biblioteca, busca/filtros e grupos musculares.
- Grupos musculares apresentados com **ícones vetoriais do próprio padrão Evolutus**, nome e quantidade de exercícios; organização consistente no desktop e mobile.
- Cards/listas mais legíveis: nome do exercício destacado; informações secundárias discretas; ações de editar, inativar, excluir e reordenar acessíveis sem poluição visual.
- Acesso evidente ao catálogo e ao cadastro manual; feedback claro ao adicionar exercício, inclusive **qual grupo o recebeu** e quando já estava adicionado.
- Busca e filtros intuitivos, com limpar filtros, estados vazios, loading, erro e visualização de inativos bem resolvidos.
- Catálogo com filtros de músculo/equipamento/categoria/dificuldade fáceis de usar; informação correta sobre o que a busca textual realmente pesquisa (não prometer filtro por músculo via texto se a RPC pesquisa apenas nomes).
- Melhore a apresentação de imagens **apenas quando os recursos reais já existirem**; mantenha fallbacks elegantes, sem simular ilustrações inexistentes.
- Evite excesso de cards, badges, sombras, números ou ações repetidas. Preserve acessibilidade, navegação por teclado, áreas de toque e contraste em tema escuro.

## 3. Biblioteca ampliada de ícones musculares

Centralize a associação de ícones tanto para os grupos da biblioteca quanto, quando fizer sentido, para músculos específicos do catálogo, abrangendo: Peito, Costas, Pernas, Ombros, Bíceps, Tríceps, Abdômen, Glúteos, Panturrilha, Antebraços, Pescoço, Cardio e Outros; também os músculos específicos do dataset (por exemplo, adutores, abdutores, quadríceps, posteriores, dorsais, trapézio e lombar).

Mantenha compatibilidade com **grupos personalizados**, normalização de acentos/maiúsculas e fallback neutro. Prefira reaproveitar `getMuscleGroupIcon`/`MUSCLE_GROUP_ICONS` a criar sistemas visuais duplicados. Se incluir mais de uma opção de ícone por grupo, só exponha um seletor ao usuário se isso fizer sentido para a experiência e não exigir persistência nova desnecessária.

## 4. Integridade, performance e testes

- Confirme que a adição ao catálogo não duplica exercícios e que a **ordem** dos itens é efetivamente persistida quando aplicável.
- Preserve paginação, debounce, cache e comportamento offline; evite carregar o catálogo completo ou introduzir leituras extras a cada renderização.
- Crie/atualize testes de mapeamento para **todos os músculos encontrados**, categoria Cardio, desconhecidos, músculos secundários, grupos personalizados, prevenção de duplicidade e ordenação.
- Rode os testes relevantes, lint e build. Quando possível, valide a página no navegador em desktop e mobile, inclusive tema escuro, com exercícios e com biblioteca vazia.
- Não apresente testes que não executou como aprovados. Se houver bloqueio de ambiente, documente-o objetivamente.

## 5. Entrega e limites

**Execute as mudanças no código local**, não apenas proponha ideias. Ao final, entregue:

1. Diagnóstico conciso com problemas encontrados e causa raiz.
2. Resumo do novo layout e do padrão de ícones adotado.
3. Arquivos modificados e lógica de classificação antes/depois.
4. Resultado dos testes e pendências de homologação, especialmente dados já existentes e offline.

**Não executar migrations em produção, nem commit, push ou deploy sem minha autorização.** Não alterar políticas RLS, dados de usuários ou fluxos de treino sem necessidade comprovada. Caso alguma mudança de schema seja realmente indispensável, apenas prepare e explique a migration antes de aplicá-la. Se futuramente autorizado a publicar, confirme primeiro o repositório GitHub `Danielalveslira/treinos_academia`, o remote, a identidade autenticada, o projeto Vercel e o Supabase de destino.

**Prioridade:** classificação muscular correta, UX clara e visual consistente com os **ícones que o Evolutus já utiliza**, nunca emojis nativos.
