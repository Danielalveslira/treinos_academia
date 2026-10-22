# EVOLUTUS — Auditoria técnica e visual da página inicial pública

## Objetivo

Audite **a implementação atual da rota `/`** do Evolutus, acessível no ambiente de desenvolvimento:

https://jubilant-space-fishstick-v4jvgj759pphp6q9-5173.app.github.dev/

A página foi reconstruída com Primer e teve seu header, hamburger, controle de tema e footer ajustados. Sua tarefa é **verificar o código e o comportamento real**, eliminar defeitos e resíduos confirmados e deixar a implementação enxuta, estável e consistente. **Não redesenhe a página, não adicione funcionalidades nem produza um diagnóstico genérico.**

## Limites de escopo — obrigatórios

- **Alvo principal:** rota `/`, seus componentes, CSS/JS e recursos diretamente utilizados.
- **Header/footer públicos:** revisar porque são renderizados na home; corrigir apenas defeitos demonstrados, preservando seu funcionamento nas outras páginas públicas.
- **`/app` é intocável:** não modificar arquivos, componentes, navegação, tema ou estilos do aplicativo principal. Use-o apenas como referência visual do Primer.
- Não modificar `/vitrine`, `/profissionais`, `/como-funciona` ou `/para-empresas` nem suas regras de negócio. Não reintroduzir `/funcionalidades` e `/guia-registro-treino`.
- Não remover conteúdo SEO, rotas, analytics, recursos compartilhados ou classes usadas dinamicamente sem provar que estão obsoletos.
- Não executar `git reset`, não reverter mudanças legítimas e não alterar baselines, limites ou testes apenas para fazê-los passar.

## Execução (siga a ordem, sem desperdiçar tokens)

### 1. Mapear somente o necessário

1. Identifique o HTML/template da home e os arquivos de estilo, scripts, chunks e componentes realmente carregados nela, **incluindo dependências indiretas**.
2. Registre `git status --short` antes de começar. Identifique mudanças preexistentes para preservá-las.
3. Verifique a ordem de carregamento de CSS/JS, a inicialização do Primer, o tema e os componentes públicos compartilhados. **Não varra arquivos sem relação com a rota.**

### 2. Auditoria de CSS e Primer — prioridade máxima

Investigue no **código e nos estilos computados do navegador**:

- CSS não utilizado, seletores órfãos, estilos de páginas removidas, declarações duplicadas e regras conflitantes.
- Sobrescritas de especificidade, `!important` injustificado, cores/medidas fixas desnecessárias, media queries repetidas e CSS legado que concorre com o Primer.
- Classes de estado ou tema usadas dinamicamente: **não as classifique como inúteis apenas porque não aparecem no HTML estático**.
- Estilos do header, hamburger, tema, botões e footer que mudam depois do carregamento; compare estado inicial, após hidratação/JS e após navegação.
- Tokens de cores, espaçamentos, tipografia, bordas e foco do Primer realmente aplicados nos temas claro e escuro.
- CSS importado, emitido ou deduplicado pelo Vite de forma que um componente público fique sem tokens no runtime (problema já observado no modal da Vitrine).
- CSS injetado dinamicamente, duplicação de tags `<style>`, escopo de seletores e compatibilidade com a CSP existente.

**Ação:** remova somente CSS comprovadamente morto/duplicado e corrija conflitos na origem. Prefira componentes e tokens oficiais Primer. Não substitua um conflito por mais CSS corretivo em cascata.

### 3. Auditoria visual e funcional — navegador real

Teste a **rota `/`** em Chromium/Playwright, **320, 390, 768, 1024 e 1440 px**, em **claro e escuro**. Inspecione a página completa, não apenas o topo. Confira:

- **Header:** dimensões, alinhamentos, logo, CTA, botão de tema e hamburger visível e clicável; navegação sem rotas removidas ou privadas.
- **Hamburger:** mesma linguagem visual do `/app`, abre/fecha corretamente, links certos, navegação por teclado, foco, `Escape` e clique fora quando aplicável.
- **Tema:** ícone correto, troca efetiva, contraste, persistência entre navegações/reload e ausência de mudança inesperada nas cores dos botões após alguns segundos.
- **Home:** hierarquia de títulos, proporção de textos e imagens, largura de conteúdo, margens, respiros, grids, CTAs e legibilidade. Evite hero excessivamente alto ou conteúdo cortado.
- **Footer:** altura reduzida, links úteis, logo legível, distribuição compacta e adaptação correta no mobile.
- Ausência de overflow horizontal, scrollbars internas indevidas, sobreposição, clipping, conteúdo invisível, elementos fora da viewport, layout shift visível e controles sem ação.
- Estados hover, focus, active, disabled e links externos; simule navegação real, não apenas existência de seletores.

**Prova obrigatória:** screenshots **antes/depois nos pontos alterados** (ou evidência visual da ausência de defeito), ao menos em 390 e 1440 px, claro/escuro. Use as capturas para verificar o resultado; não declare “está correto” com base apenas em testes que passaram.

### 4. Performance, SEO, acessibilidade e segurança

Verifique sem reestruturar desnecessariamente:

- **Performance:** CSS/JS de boot, dependências Primer carregadas sem necessidade, scripts duplicados, listeners não removidos, imagens pesadas, tamanhos/layout reservados, lazy loading adequado e chamadas desnecessárias.
- **Budget:** execute `npm run budget` se disponível, registre valor medido e limite. Se a falha for preexistente, discrimine-a. **Não atualize o baseline artificialmente.**
- **SEO:** título, meta description, canonical correto para produção, `robots`, headings semânticos, links rastreáveis, texto relevante no HTML inicial, imagens com `alt`, sitemap/structured data quando já existirem. Não indexar a URL temporária do Codespaces como canonical.
- **Acessibilidade:** nomes acessíveis de ícones, contraste, ordem de foco, labels, semântica, alvos de toque e `prefers-reduced-motion`.
- **Segurança:** HTML/URLs gerados com escape adequado, links externos com `rel` apropriado, respeito à CSP; não introduzir HTML inseguro.

Não invente métricas de Core Web Vitals: informe apenas as efetivamente medidas e em qual ambiente.

### 5. Correções, regressões e conclusão

- Corrija **somente problemas reais, reproduzidos** e diretamente associados ao escopo; mantenha o design aprovado e minimize o diff.
- Rode, conforme disponíveis: `npm run build`, `npm run lint`, testes específicos das páginas públicas, smoke E2E da home/navegação/tema, `git diff --check` e `npm run budget`.
- Compare o comportamento **antes e depois**: menu, tema, botões, conteúdo, footer, mobile e links.
- Confira `git diff` e `git status` ao final. Liste todos os arquivos tocados e prove que **nenhum arquivo do `/app` foi alterado**. Diferencie mudanças suas das preexistentes.
- Se algum teste depender de ambiente inacessível, relate o impedimento; não declare que foi executado.

## Critérios de aceite

1. Nenhum CSS órfão/duplicado **comprovado** permanece nos arquivos alterados; sem regressões de tema ou estilos após carregamento.
2. Home estável e utilizável em mobile-first, nas larguras e temas verificados, sem overflow ou controles quebrados.
3. Header, hamburger, alternância de tema e footer funcionam e têm aparência consistente com Primer.
4. SEO técnico e conteúdo indexável preservados; sem dependências ou CSS carregados sem necessidade comprovada.
5. Nenhuma alteração indevida no `/app` ou em outras rotas; testes relevantes executados de fato.

## Formato de entrega — curto e verificável

Responda **somente** com:

1. **Problemas encontrados e corrigidos:** arquivo + causa + solução, uma linha por problema.
2. **Validações:** resoluções/temas, interações exercitadas, testes e resultados; links/caminhos das capturas.
3. **Performance:** antes/depois quando mensurável; status do budget, sem maquiar números.
4. **Arquivos alterados:** lista exata.
5. **Pendências reais:** apenas as não resolvidas e seu impacto.

**Regra final:** auditoria não é aprovação automática. Um teste verde não anula um defeito visível. Se não houver defeito, não modifique código apenas para gerar mudanças. Encerre após a home: as outras rotas serão tratadas em tarefas futuras.
