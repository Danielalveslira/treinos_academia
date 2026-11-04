# Prompt: Demo interativa pública da tela de registro de treino (Evolutus)

## 1. Papel e objetivo

Você é um(a) engenheiro(a) front-end sênior com forte senso de design de produto. Sua tarefa é criar, na **rota pública** do Evolutus (sem login, sem cadastro), uma **demonstração interativa fiel à tela real de registro de treino**, para que o visitante experimente o app em segundos e entenda o valor antes de criar conta.

A demo deve parecer o app de verdade, ser **bonita**, **rápida** e **leve**, e funcionar muito bem em **celulares pequenos** (largura de 320 px em diante).

## 2. Antes de escrever código (obrigatório)

1. Explore o projeto existente e identifique a stack, o sistema de design (cores, tipografia, espaçamentos, ícones, tokens) e **o componente real da tela de registro de treino**.
2. **Reaproveite os componentes reais** da tela de marcar exercícios, alimentados por dados fictícios. Não recrie do zero algo diferente: a fidelidade visual e comportamental é o requisito número um.
3. Se o componente real estiver acoplado a API, autenticação ou banco de dados, extraia a parte visual e injete dados e handlers falsos por props, sem alterar o comportamento da tela real.
4. Siga as convenções do projeto (estrutura de pastas, nomes, estilo de código, tema escuro com a cor de tema já usada no site).
5. Se algo essencial for ambíguo, escolha a opção mais simples e registre a decisão no final.

## 3. Rota e escopo

- Criar uma rota pública, sugerida: `/demo` (ajuste ao padrão de rotas do projeto).
- **Sem autenticação**, sem chamadas ao servidor, sem gravação de dados.
- Todo o estado vive **apenas em memória** (e, no máximo, no estado local do componente). Ao recarregar a página, a demo reinicia.
- Adicionar links para a demo na landing page (botão secundário no topo, como "Experimente agora", e na seção "Como funciona").
- Incluir metadados de SEO próprios da rota (título, descrição, imagem de compartilhamento) e `robots` como indexável.

## 4. Conteúdo da demonstração

Usar uma ficha de exemplo realista, com dados fictícios em português do Brasil:

- Nome da ficha: **Treino A - Peito e Tríceps**.
- 4 exercícios, por exemplo: Supino reto com barra, Supino inclinado com halteres, Crucifixo na máquina, Tríceps na polia.
- Cada exercício com 3 ou 4 séries, já com meta de repetições (por exemplo 8 a 12).
- Para cada série, exibir a **carga da última sessão** (por exemplo "Última vez: 60 kg x 10") como referência, pois isso guia a progressão de carga e é um dos grandes diferenciais do app.
- Usar a imagem ou ilustração do exercício somente se for leve (formato webp, carregamento sob demanda). Caso contrário, usar um ícone simples.

## 5. Comportamento e interações (fiéis à tela real)

1. **Cabeçalho da sessão**: nome da ficha, data de hoje, tempo de treino decorrido (cronômetro simples) e barra de progresso com séries concluídas sobre o total.
2. **Lista de exercícios**: cada exercício é um cartão que pode ser expandido ou recolhido. O primeiro começa expandido.
3. **Linha de série**: número da série, campo de **carga (kg)**, campo de **repetições**, referência da última sessão e botão de **marcar como feita**.
4. **Ajuste rápido**: botões de mais e menos para carga (passos de 1 kg ou 2,5 kg) e repetições, além de permitir digitar diretamente. Usar teclado numérico no celular (`inputmode`).
5. **Marcar série como feita**: alterna o estado, com feedback visual claro (cor, ícone de check, leve animação) e vibração curta se o dispositivo suportar.
6. **Cronômetro de descanso automático**: ao marcar uma série como feita, abre uma barra ou painel fixo na parte inferior com contagem regressiva (padrão 90 segundos), com botões de +15 s, -15 s e pular. Ao terminar, sinalizar de forma discreta (visual e vibração).
7. **Adicionar série** e **remover série** em cada exercício.
8. **Finalizar treino**: abre um **resumo da sessão simulada** com duração, séries concluídas, volume total (soma de carga x repetições) e comparação com a última sessão (por exemplo "+5% de volume"). Mostrar um destaque para recordes simulados.
9. **Chamada para ação final**: abaixo do resumo, mensagem clara como "Gostou? Crie sua conta para salvar seus treinos de verdade", com botão para `/cadastro` e botão secundário "Refazer demonstração".
10. **Selo discreto de modo demonstração** fixo no topo, com texto curto como "Modo demonstração: nada é salvo".

## 6. Design e visual

- Tema escuro moderno, usando a cor de tema e os tokens já existentes no site (a cor de fundo do tema é `#0d1117`; reaproveite a paleta e a cor de destaque atuais).
- Visual limpo, minimalista, com bastante respiro, cantos arredondados consistentes e hierarquia tipográfica clara.
- Números (carga, repetições, tempo) em destaque, com fonte de números tabulares para não "pular" ao mudar.
- Contraste mínimo AA, estados de foco visíveis e animações sutis (150 a 250 ms), respeitando `prefers-reduced-motion`.
- Em telas grandes (desktop), exibir a demo dentro de uma **moldura de celular centralizada**, com uma coluna de texto explicativo ao lado (por exemplo, três pontos curtos sobre o que o visitante está vendo). Em telas pequenas, a demo ocupa a tela inteira sem moldura.

## 7. Requisitos para celulares pequenos (prioridade máxima)

- Layout **mobile first**, perfeito a partir de **320 px de largura** e 568 px de altura, sem rolagem horizontal em nenhuma hipótese.
- Alvos de toque com no mínimo **44 x 44 px** e espaço suficiente entre eles para evitar toques errados.
- Painel do cronômetro e botão de finalizar fixos na parte inferior, respeitando a área segura (`env(safe-area-inset-bottom)`) e sem cobrir o conteúdo (adicionar espaço no fim da lista).
- Campos numéricos com tamanho de fonte de pelo menos 16 px para evitar zoom automático no iOS.
- Usar unidades fluidas e `dvh` em vez de `vh` para lidar com barras do navegador móvel.
- Evitar tabelas largas, textos longos e elementos que dependam de hover.
- Uso confortável com uma mão: ações principais ao alcance do polegar.

## 8. Desempenho e acessibilidade

- Carregar a demo de forma **preguiçosa** (code splitting) para não pesar a landing page. Meta: a rota deve ser leve, sem bibliotecas pesadas só para a demo.
- Sem dependências novas, a menos que sejam realmente necessárias e pequenas.
- Boa pontuação no Lighthouse em desempenho, acessibilidade e SEO.
- Semântica correta: botões reais, rótulos nos campos, `aria-live` educado para o cronômetro e para o progresso, ordem de foco lógica, navegação por teclado funcional.
- Textos todos em **português do Brasil**.

## 9. Telemetria

Se o projeto já tiver analytics, registrar apenas eventos simples e sem dados pessoais: início da demo, primeira série concluída, treino finalizado e clique em "Criar conta". Se não houver analytics, não adicionar nenhum.

## 10. Critérios de aceite

- [ ] A rota pública abre sem login e não faz nenhuma chamada de gravação ao servidor.
- [ ] A tela é visualmente fiel à tela real de registro de treino e reaproveita seus componentes.
- [ ] Marcar uma série dispara o cronômetro de descanso automaticamente.
- [ ] A carga da última sessão aparece em cada série.
- [ ] Finalizar mostra o resumo simulado e a chamada para criar conta.
- [ ] Funciona sem rolagem horizontal em 320 px, com alvos de toque de pelo menos 44 px.
- [ ] Recarregar a página reinicia a demo.
- [ ] A landing page tem os links para a demo.
- [ ] Sem erros no console, build passando e sem regressão nas telas existentes.

## 11. Entrega

Ao terminar, informe de forma objetiva:

1. Os arquivos criados e alterados.
2. Quais componentes reais foram reaproveitados e quais ajustes foram necessários.
3. Decisões tomadas onde havia ambiguidade.
4. Como testar a rota localmente, incluindo a verificação em largura de 320 px.
