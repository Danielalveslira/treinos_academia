# CODEX — Refinamento da demo pública interativa do Evolutus (UX, conversão e fidelidade real)

## Missão

**Aprimore a implementação que você JÁ COMEÇOU na sua branch atual.** Não reinicie o trabalho, não substitua componentes úteis e não faça um redesign genérico. O objetivo é transformar a demo pública em uma experiência curta, visualmente convincente, funcional e fiel ao registro real de treinos do Evolutus: a pessoa entende **o que fará, como registrará uma série, por que o histórico ajuda e o que terá depois de concluir** — sem conta e sem risco de alterar dados reais.

A demo deve despertar a percepção de **"entendi, é simples e funciona"**, não apenas parecer uma captura interativa. Otimize para visitantes em celular, especialmente a partir de **320 px**, redes lentas e aparelhos modestos. Use **Primer e os tokens existentes**, respeitando tema claro/escuro, performance, acessibilidade e identidade do site.

**Importante sobre o material de referência:** o ZIP analisado corresponde ao snapshot do repositório de 30/10/2026 (`f9473dcc162eb41a2b5449d75c8a212cec25a709`). O seu trabalho posterior **não está necessariamente nesse ZIP**. Portanto, comece verificando o estado ATUAL da sua branch, o diff e o que já funciona; trate os caminhos abaixo como referência comprovada do snapshot, não como prova de que arquivos novos ainda não existam.

## 1. Diagnóstico direcionado, antes de editar

Faça uma inspeção objetiva da demo já implementada, comparando-a com a experiência real. Monte mentalmente, ou em poucas notas, uma matriz **existente / correto / falha / ação mínima**. Evite um relatório longo e não reexecute verificações que já estejam válidas e comprovadas para o mesmo código.

Arquivos do projeto real que devem orientar a solução:

- `src/pages/NewWorkout.jsx`: execução de uma ficha, autorização, conclusão real, restrições de sincronização e integração com `WorkoutForm`.
- `src/components/WorkoutForm.jsx`: sequência de exercícios, navegação, retomada, sugestão de histórico, séries concluídas e apresentação da ficha.
- `src/components/SetCard.jsx` e `src/styles/workoutExecution.css`: interface **real** do registro de **uma série por vez**, numeração, campos, botão **Concluir série**, avanço, adicionar/remover séries, rótulos e estados.
- `src/utils/setSession.js`, `src/utils/setSuggestions.js`, `src/utils/workoutSets.js`, `src/utils/calculations.js`: regras reutilizáveis para sugestões, validação, conclusão, edição, limites e volume.
- `src/features/workoutSheets/workoutSheetValidation.js`: metas de séries/repetições e `rest_seconds` nas fichas.
- `src/components/WorkoutExerciseGuide.jsx`: guia visual; **não** importar o fluxo de busca remota na demo por engano.
- `scripts/public-pages-template.mjs`, `scripts/build-public-pages.mjs`, `scripts/public-preview-plugin.js`: páginas públicas são HTML gerado, com cabeçalho, SEO e elementos React carregados sob demanda.
- `src/publicTurbo.js`, `scripts/public-navigation.mjs`, `src/PublicHeaderMenu.jsx`: navegação pública, tema e menu.
- `vite.config.js`, `vercel.json`: geração dos bundles, roteamento, preview, cache e CSP.
- `tests/public-pages.test.mjs`, `scripts/public-turbo-smoke.mjs`, `src/components/workoutSession.interactions.test.js`: padrões já disponíveis para testar integração e interações.

**Fato crucial:** no snapshot analisado, o usuário registra **uma série por vez**, e `SetCard` avança para a próxima. A sugestão vem do histórico (`source: 'history'`) e **não significa série já realizada**. A conclusão real usa persistência/servidor e pode resultar em estados `saving`, `saved`, `local` ou `error`. **O registro real NÃO contém um cronômetro automático de descanso visível nesse fluxo.** Não apresente uma nova lista de todas as séries com visual/comportamento incompatíveis, nem anuncie timer como funcionalidade nativa sem validar implementação posterior.

## 2. Prioridades e proteção do trabalho já feito

1. **P0 — Fidelidade:** reproduzir o comportamento visual do produto real, com `SetCard` e as convenções de `WorkoutForm` sempre que possível.
2. **P0 — Isolamento:** nunca autenticar, consultar ou gravar treino real, nem acionar Supabase, RPC, outbox, cache pessoal, economia, EvoCoins, upload, `localStorage` ou sessão para executar a demo. Recursos comuns do cabeçalho público podem manter seu comportamento existente; **a implementação da demo** não deve introduzir requisições aos serviços de treino.
3. **P0 — Jornada funcional:** o visitante consegue começar, concluir uma série, perceber o progresso, seguir para o próximo exercício e terminar em um resumo coerente, sem etapas vazias ou botões decorativos.
4. **P1 — Clareza/conversão:** explicar o benefício pelo uso, em microtextos contextuais e momentos de conquista real dentro da simulação.
5. **P1 — Mobile/UX:** reduzir toques, ruído, altura desnecessária, sobreposição de barras e erros de interação.
6. **P1 — Integração pública:** rota pública direta, links corretos, SEO e navegação previsível.
7. **P2 — Polimento:** transições discretas, estados de feedback, apresentação desktop e métricas, apenas se não comprometer P0/P1.

Se já existem trechos bons, **preserve-os**. Refatore apenas o acoplamento necessário. Sem criar novo sistema de design, sem dependências pesadas, sem migrations, sem alterações no treino de produção por conveniência da demo. **Não crie commits automaticamente**, a menos que isso já tenha sido explicitamente solicitado no contexto atual.

## 3. Rota e arquitetura: não criar uma segunda aplicação

A abordagem preferencial, se compatível com o que já foi implementado, é **página pública HTML/SEO + ilha React isolada e carregada sob demanda**, seguindo a arquitetura atual do site. Se a branch já tiver uma rota pública correta e mais simples, mantenha-a e corrija somente os pontos necessários.

- Rota canônica sugerida: `/demo`; abrir diretamente, por atualização e por link compartilhado, **sem login**, sem redirecionamento para `/app` e sem tela de loading de autenticação.
- Se gerada como HTML público, ajustar `publicPages`/gerador, o preview local, a regra de Vercel, metadados, canonical, sitemap e os testes relevantes. **Não presumir que adicionar uma rota em `src/App.jsx` seja suficiente**: as rotas públicas e o SPA têm pipelines distintos.
- Verificar o encaixe com Turbo. Se o ciclo de montagem/desmontagem da ilha puder duplicar listeners ou manter estado obsoleto, optar por navegação convencional **somente para `/demo`** em vez de introduzir complexidade. Links para `/cadastro` devem continuar usando navegação apropriada.
- Reutilizar header/hambúrguer, rodapé e alternância de tema do site, sem copiar uma segunda versão deles. O componente da demo deve responder ao tema ativo; não impor dark mode quebrado a quem selecionou claro.
- HTML inicial com título, proposta de valor, CTA e explicação útil **antes de carregar JS**. Conteúdo importante para indexação deve estar no HTML, não apenas em um spinner. Conferir se SEO/indexação é adequada ao conteúdo final (não forçar `index` para página vazia).
- Adicionar entrada da demo na Home (`/`) **sem substituir o CTA principal de cadastro** e, quando fizer sentido, em `/como-funciona`, sem reconstruir páginas inteiras fora do escopo.
- Code splitting real: a rota não deve inchar o bundle inicial da Home ou o boot compartilhado. Não usar `iframe`: além de desnecessário para uma moldura visual, o projeto utiliza `frame-ancestors 'none'` na CSP.
- Preservar funcionamento de links e navegação Voltar/Avançar; não interferir no redirecionamento atual da Home para quem já tem sessão.

## 4. Experiência desejada — mostrar o valor *fazendo*

### 4.1 Primeira dobra: entender e começar imediatamente

Evitar uma landing dentro da landing. Um bloco curto deve responder em segundos:

**Título sugerido:** `Experimente registrar um treino`  
**Apoio:** `Marque uma série, acompanhe suas cargas e veja como fica seu histórico. Sem cadastro.`  
**CTA principal:** `Começar demonstração` ou `Registrar primeira série`, conforme a demo já estiver aberta.

Mostrar sempre um identificador breve **`Demonstração · dados fictícios · nada é salvo`**, visível mas discreto. O visitante não pode interpretar o estado fictício como dados da própria conta. Se a primeira série estiver pronta na tela, a ação de começar pode ser o próprio botão `Concluir série`; evite exigir um clique adicional só para destravar a experiência.

O **primeiro exercício** deve aparecer pronto para uso, com sugestão fictícia de carga e repetição, claramente identificada como **`Sugerido do último treino (exemplo)`**. Quem preferir alterar pode digitar; quem só quiser entender pode concluir imediatamente. **Sugestão não é conclusão automática.**

### 4.2 Jornada prioritária, com progresso legítimo

Implementar/aperfeiçoar este caminho:

1. **Ver a ficha de exemplo** — `Treino A — Peito e Tríceps`, objetivo e sequência clara dos exercícios, sem mostrar 12 inputs simultaneamente.
2. **Entender um dado útil** — destaque pontual para a referência da última sessão: `Você não precisa lembrar a carga anterior.`
3. **Concluir a primeira série** — usar o botão e a lógica compatíveis com a tela real; atualizar indicação de série concluída e avançar corretamente. Retornar feedback curto: `Série concluída nesta demonstração` ou um check com a etiqueta geral de demo visível. Não usar `Salvo`, `Sincronizado` ou `Salvo no aparelho` como se houvesse persistência real.
4. **Continuar** — exibir `Série 2 de 3`, sem perder as escolhas; permitir rever/editar uma série anterior e voltar à série pendente.
5. **Concluir exercício** — respeitar o estado real `ExerciseComplete`/ações `Próximo exercício` e `Revisar séries` (ou o equivalente já implementado), com microtexto opcional `Assim você acompanha o que fez sem papel ou planilha.`
6. **Concluir a demonstração** — mostrar resumo dos registros **efetivamente concluídos na simulação** e uma ação clara de cadastro. Não exigir completar uma sessão longa para o visitante perceber valor: após o primeiro exercício, a experiência já deve ter um marco útil e uma saída acessível para o resumo/CTA, sem declarar como concluídas séries pendentes.

Manter uma lista curta e realista de **4 exercícios de peito/tríceps** como exemplo de ficha, mas **uma série por vez** como no produto real. Se houver caminho de experimentação curta, explicar que é uma amostra da ficha; não falsificar o progresso de uma ficha com exercícios não feitos. Permitir seguir o fluxo completo para quem desejar.

### 4.3 Interações efetivamente funcionais

- Campos de **peso (kg)** e **repetições** devem aceitar vírgula decimal, zero de carga quando aplicável, validação e limites já presentes nas funções reais.
- Avançar, escolher exercício, revisar, editar série concluída, adicionar/remover série e reiniciar devem operar sobre o mesmo estado coerente em memória.
- Usar `MAX_WORKOUT_SETS` e as funções de sessão existentes; não duplicar regras com números arbitrários.
- Evitar conclusão duplicada por duplo toque; preservar a proteção de interação rápida existente em `WorkoutForm` ou reproduzir o mesmo invariante na adaptação.
- Se existir meta `reps_min`/`reps_max` ou `rest_seconds` nos dados de exemplo, mostrar como **meta da ficha**, não como resultado realizado.
- **Descanso:** não instalar timer obrigatório apenas porque o prompt antigo pediu. No snapshot, `rest_seconds` existe no modelo da ficha, mas não foi encontrado cronômetro automático no registro. Se a branch atual já tiver uma implementação real, reutilizá-la. Se não existir, mostrar somente `Descanso previsto: 90 s` quando adequado; qualquer timer extra deve ser tratado como **recurso experimental da demo**, não como recurso do app anunciado ao público, e só incluído se houver benefício real e não aumentar fricção.
- **Guia/imagem de exercício:** usar arquivos públicos reais locais se forem adequados, sem puxar `useExerciseCatalogDetail` nem requisições ao catálogo durante a simulação; fallback elegante caso não haja material local correto. Nunca usar uma foto de um exercício para ilustrar outro.
- Data e horário: se exibidos, usar formatação `pt-BR`; não confundir o dia local do navegador com a regra de `America/Sao_Paulo` do produto real. Evite relógio em tempo real se não agrega ao aprendizado.

## 5. Psicologia cognitiva aplicada com ética e propósito

**Não aplicar truques para forçar cadastro.** Aplicar princípios de cognição para reduzir esforço, permitir entendimento progressivo e dar satisfação proporcional às ações reais do visitante. Cada mecanismo precisa ter uma **expressão concreta na tela**:

| Princípio/efeito | Aplicação exigida | O que evitar |
|---|---|---|
| **Fluência cognitiva e familiaridade** | UI igual à execução real, nomes conhecidos (`Série`, `Peso`, `Repetições`, `Concluir série`), primeiro estado pronto para interação. | Interface promocional diferente do app que o usuário verá depois. |
| **Reconhecimento > memorização** | Mostrar a sugestão do último treino e a meta perto dos campos; informar sempre exercício e série atuais. | Fazer o usuário recordar valores ou procurar informações fora de contexto. |
| **Divulgação progressiva / redução de carga cognitiva** | Uma série principal, opções secundárias em posições previsíveis e conteúdo histórico recolhível. | Formulários extensos, 4 cards abertos, guias longos e excesso de dicas. |
| **Lei de Hick (decisão simples)** | Uma ação primária predominante por etapa; secundárias claras, sem CTAs concorrendo. | `Criar conta`, `Finalizar`, `Próximo`, `Ver tudo` com mesmo destaque no mesmo local. |
| **Efeito de progresso / gradiente de meta** | Progresso derivado de séries realmente marcadas, com denominador coerente; após o primeiro acerto, mostrar avanço perceptível. | Progresso inventado, séries pré-concluídas para criar sensação falsa de conquista. |
| **Feedback imediato e controle percebido** | Resposta visual após clique, próximo passo evidente, revisão/edição reversível. | Animações longas, vibração obrigatória, mensagens falsas de sincronização. |
| **Efeito Von Restorff (contraste seletivo)** | Dar destaque visual a **uma** ação relevante — concluir série ou cadastro no resumo — com tokens do tema. | Pintar todos os botões de verde, saturar a tela de badges ou chamar atenção para tudo. |
| **Efeito pico-fim (peak-end)** | O melhor momento é descobrir o valor da referência histórica e concluir o primeiro exercício; encerrar com resumo **calculado** e CTA não intrusivo. | Recordes inventados, comparações arbitrárias, confete exagerado ou urgência artificial. |
| **Autonomia e prevenção de erro** | `Pular explicação`, `Recomeçar`, voltar, corrigir, sair e continuar sem criar conta. | Modais bloqueantes, armadilhas de saída e confirmação desnecessária. |

O guia contextual deve ser **curto e opcional**, com no máximo uma ajuda ativa por momento: por exemplo, um destaque sutil na sugestão histórica antes da primeira série e uma pequena explicação do progresso depois do primeiro clique. Não usar carrossel de onboarding com 4+ telas, tour obrigatório, pop-ups repetidos nem animação infinita. Respeitar `prefers-reduced-motion`.

**Integridade de comunicação:** não inventar avaliações, número de usuários, treinos salvos, porcentagem de resultados de pessoas reais, escassez, descontos, EvoCoins ou badges como se fossem obtidos. A capacidade da demo será avaliada pela **clareza e fidelidade**, não por manipulação psicológica.

## 6. Resumo final que convence porque é verdadeiro

Após a conclusão voluntária da amostra/sessão, apresentar um resumo **calculado a partir do estado fictício realmente manipulado pelo visitante**:

- Nome da ficha e indicação de `Demonstração`.
- Número de exercícios e séries efetivamente concluídos **versus planejados**, sem contar pendências como concluídas.
- Volume de treino = `Σ (peso × repetições)` das séries concluídas válidas. Usar as funções de cálculo do repositório ou um seletor puro testável com a mesma fórmula, com formatação brasileira.
- Comparação histórica **apenas** se houver base fictícia comparável claramente identificada; usar denominador correto, proteger divisão por zero e evitar `%`/recordes inventados. Se não for comparável, omitir a métrica.
- Uma frase objetiva explicando o benefício: `No Evolutus, seus próximos treinos usam seu histórico para facilitar o registro.` Não afirmar que esta simulação foi salva.
- CTA principal: **`Criar conta e registrar meus treinos`** → rota real `/cadastro`.
- CTA secundário: **`Repetir demonstração`** → reset completo do estado da simulação.
- Link discreto `Voltar ao início` e caminho claro para sair sem cadastro.

Não exibir alertas de salvamento remoto, recompensa financeira ou supostas conquistas pessoais. Nunca colocar um resumo vazio com valores falsos para tornar a tela mais atraente.

## 7. Identidade visual e mobile-first

- Componentes **Primer** e tokens existentes (`fgColor`, `bgColor`, `borderColor`, botão primário etc.). Base visual alinhada a `src/styles/workoutExecution.css`, `workoutSheets.css` e páginas públicas; nada de um tema paralelo feito com dezenas de hexadecimais ou CSS global.
- **Mobile (320, 360, 375, 390 e 430 px):** a demo é a experiência principal, sem moldura fake de celular; sem scroll horizontal, sem fontes minúsculas, sem conteúdo cortado, sem barras fixas competindo com teclado.
- Áreas de toque preferencialmente **44×44 CSS px**; contraste WCAG 2.2 AA, foco visível, rótulos claros, `inputMode="decimal"`/`numeric`, fontes de inputs ≥16px, `dvh` e safe area quando necessário.
- Não prender simultaneamente **timer + CTA + barra de conclusão** no rodapé. Priorize uma única ação fixa, apenas quando melhora a usabilidade; sempre dar padding para não cobrir o último campo e não ocultar foco ao abrir teclado.
- **Desktop:** permitir leitura da proposta de valor ao lado de uma *moldura CSS* de aparelho, com a própria demo React **única** dentro dela. Sem `iframe`, sem instância duplicada nem rolagem interna desconfortável.
- Use hierarquia clara: ficha → exercício → série → valores → ação. Comportamento consistente no modo claro e escuro, tipografia e espaçamentos do produto.
- Micromovimentos de 150–250 ms no máximo quando agregarem compreensão; não usar animação automática que desvie atenção.
- Estados vazios, botões desabilitados e mensagens de validação devem dizer **o que fazer em seguida**, não apenas `Inválido`.

## 8. Implementação segura e enxuta

- Preferir **reutilizar `SetCard` e helpers puros** (`setSession`, `setSuggestions`, `workoutSets`) com um **controlador/adapter de demonstração próprio**. Separar: `demoFixtures` (dados), `demoSession` (estado/regras), `Demo` (render/UX). Os nomes e arquivos concretos podem seguir o padrão atual da branch.
- **Não montar `NewWorkout`/`WorkoutForm` inteiro se isso importar hooks de sessão, `rowSaver`, histórico remoto, locks ou storage**; extrair só a apresentação necessária ou reutilizar componentes visuais realmente puros. Não duplicar toda a implementação de treino.
- Dados fictícios versionáveis, determinísticos e explícitos. Exemplo: ficha com 4 exercícios, três séries por exercício, sugestões históricas coerentes, sem IDs que coincidam com entidades reais. Não buscar dados de usuários nem da API pública para simular o treino.
- Estado em memória, isolado da conta atual; ao recarregar ou escolher `Repetir`, reiniciar de verdade. Sem `localStorage`, IndexedDB, `sessionStorage`, outbox, service worker custom de persistência da demo ou cookies para guardar os registros. Não mexer no service worker geral fora do necessário para roteamento.
- Proibir import acidental de `supabase`, `economyService`, `useWorkouts`, `useAuth`, `rowSaver`, serviços de treino, funções administrativas ou finanças no **bundle/caminho de execução da demo**. Se houver import transitivo, avaliar sua segurança e carga e isolar a camada visual.
- Nenhuma operação de escrita, mutação ou conversão comercial real; a CTA de cadastro é navegação normal, não criação de usuário automática.
- Evitar timers periódicos desnecessários e event listeners sem limpeza. Botões rápidos não devem gerar ações duplicadas nem estados inconsistentes; mudanças de exercício preservam o que foi feito.
- Corrigir incompatibilidades entre o prompt antigo e o código **sem alterar comportamento real em produção**. Se um pequeno ajuste compartilhado for inevitável, garantir equivalência e proteger com teste focado.
- Se já existir analytics compatível, instrumentar apenas eventos **anônimos** de interação com demo (abertura, primeira série, conclusão, CTA), sem nomes, cargas, repetições, ID de usuário ou conteúdo de formulário; não adicionar serviço novo.

## 9. Verificações e testes que interessam

Execute somente os testes pertinentes ao diff e aos pontos de risco; aproveite evidências de checks atuais da branch, sem repetir todo o CI à toa.

**Unidade/integração:**

- Estado inicial com sugestão de histórico **não concluída**; concluir avança exatamente uma série; duplo toque não duplica; revisão/edição mantém invariantes.
- Carga decimal/zero e repetições válidas; adicionar/remover respeita limites; não apagar indevidamente a última série concluída; reset limpa tudo.
- Progresso e resumo corretos para sessões completas **e parciais**; volume calculado sem contar pendentes; percentual histórico só quando matematicamente defensável.
- Nenhuma chamada ao backend, persistência local ou invocação de APIs reais de treino/economia pela simulação.

**Browser/UX (Playwright ou os smokes existentes):**

- Abrir `/demo` diretamente, em reload, com link da Home e botão Voltar; abrir com usuário deslogado sem cair em `/login`/`/app`; em produção/preview, sem 404.
- Ver HTML/SEO inicial, canonical, links, sitemap e diferenciação em relação ao shell React; checar que não há duplicação de header/menu/instância quando se navega com Turbo.
- Completar jornada: primeira série → próxima → concluir exercício → navegar/revisar → resumo → repetir → `/cadastro`.
- Responsividade em **320×568**, 360×800, 390×844 e desktop; teclado virtual/foco, tema claro e escuro; nenhum overflow horizontal, CTA encoberto ou toque acidental.
- Navegação por teclado, anúncio de conclusão/progresso com `aria-live` **sem anunciar o relógio a cada segundo**, foco visível, targets confortáveis, reduced motion.
- Bundle: confirmar que conteúdo da demo é lazy e não aumenta significativamente o JS da Home; imagens só onde há correspondência e necessidade.
- Console limpo; verificar requisições indevidas a endpoints de workouts, Supabase RPC de treino ou economia (excluir da análise apenas comportamentos já existentes do cabeçalho público que não são causados pela demo).

Comandos-base do repositório quando aplicáveis: `npm run lint`, `npm run build`, `node --test tests/public-pages.test.mjs`, testes unitários direcionados para novos arquivos e smoke de navegador pertinente. **Não declarar "100% aprovado" sem rodar a verificação correspondente.**

## 10. Definição objetiva de pronto

O trabalho só está pronto se:

1. O que já foi desenvolvido for aproveitado e a diferença real entre demo e app estiver corrigida ou explicitamente explicada.
2. Um visitante novo conseguir **registrar uma série em poucos segundos**, sem cadastro e sem precisar ler manual.
3. A interface reproduzir a lógica essencial do Evolutus (série única, sugestões históricas, avanço, revisão e conclusão), **sem prometer recursos não existentes**.
4. Todo número do progresso e do resumo corresponder ao que foi realizado na simulação.
5. A demo for pública, indexável quando apropriado, compatível com o mecanismo real de páginas públicas e com a Vercel.
6. A Home continuar rápida e os fluxos autenticados, financeiro, fichas e treino real permanecerem intactos.
7. Mobile, acessibilidade, tema e navegação estiverem corretos nos cenários críticos.

## 11. Entrega do Codex

**Implemente as melhorias agora, diretamente sobre a branch atual.** Não pare após sugerir um plano. No retorno, seja objetivo:

1. **O que foi preservado** da implementação existente e **o que foi corrigido**, principalmente a fidelidade com `SetCard`/treino real.
2. Arquivos alterados e justificativa curta para mudanças arquiteturais.
3. Fluxo da demo final em 4–6 passos; onde aplicou reconhecimento, divulgação progressiva, feedback/progresso e efeito pico-fim **de modo verificável**.
4. Testes efetivamente executados, resultados e pendências concretas.
5. Como abrir `/demo` no preview e quais limitações **simuladas** são intencionalmente diferentes do produto real.

**Regra final:** priorize experiência genuína, direta e memorável. Nada de UI de fachada, números inflados, gamificação artificial ou refatoração ampla do aplicativo para construir uma demo pública.
