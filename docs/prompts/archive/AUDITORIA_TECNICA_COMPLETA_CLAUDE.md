# AUDITORIA TÉCNICA COMPLETA — EVOLUTUS

## Objetivo

Quero fazer uma **auditoria técnica completa do projeto Evolutus**.

Nesta primeira etapa, **NÃO ALTERE NENHUM CÓDIGO**.

Quero que você analise o repositório inteiro com visão de:

- bugs reais
- bugs potenciais
- estados stale
- problemas de performance
- renders desnecessários
- queries Firestore desnecessárias
- listeners duplicados
- custos Firebase evitáveis
- cache incorreto
- concorrência/race conditions
- código morto
- arquivos mortos
- componentes não utilizados
- hooks não utilizados
- services não utilizados
- exports/imports mortos
- código duplicado
- lógica duplicada
- abstrações desnecessárias
- funções muito grandes
- componentes muito grandes
- problemas de arquitetura
- problemas de segurança
- problemas de Rules
- problemas de autorização
- inconsistência frontend/backend
- tratamento de erros
- loading states
- UX quebrada por estados assíncronos
- acessibilidade
- responsividade
- PWA
- service worker
- bundle size
- lazy loading
- dependências desnecessárias
- testes ausentes ou frágeis
- flakes
- código legado
- TODO/FIXME/HACK

---

# REGRAS IMPORTANTES

Não quero uma “limpeza cosmética”.

Não mude código apenas porque existe uma forma mais moderna ou porque você prefere outro estilo.

Só proponha alterações quando houver ganho concreto em:

- correção
- segurança
- performance
- custo
- manutenção
- simplicidade
- confiabilidade
- UX

Preserve comportamentos que já funcionam.

Não trate hipótese como bug confirmado.

---

# 1. PRIMEIRO ENTENDA A ARQUITETURA

Antes de apontar problemas, mapeie:

- `src/`
- `functions/`
- `firestore.rules`
- `firebase.json`
- hooks
- contexts
- services
- pages
- components
- utils
- testes
- PWA/service worker

Identifique os principais fluxos do sistema:

- autenticação
- perfil
- comunidades
- posts/status
- votos
- moderação
- treinos
- histórico
- progresso
- wallet
- EvoCoins
- EvoCash
- compras PIX
- promoções
- anúncios
- administração
- exclusão de conta
- documentos legais

---

# 2. CÓDIGO MORTO

Faça busca real no projeto por:

- arquivos nunca importados
- componentes sem consumidores
- hooks sem consumidores
- services sem consumidores
- funções não chamadas
- exports não utilizados
- rotas antigas
- páginas antigas
- CSS órfão
- feature flags antigas
- compatibilidade temporária que não é mais necessária
- código comentado antigo
- `TODO`
- `FIXME`
- `HACK`

Não marque automaticamente um arquivo como morto apenas porque não encontrou import direto.

Considere antes:

- imports dinâmicos
- Cloud Functions exports
- scripts
- testes
- Firebase
- service worker
- Vite

Para cada item, classifique como:

- confirmado como morto
- provavelmente morto
- precisa investigação

---

# 3. PERFORMANCE FRONTEND

Audite:

- rerenders
- `useEffect`
- dependências incorretas
- `useMemo`/`useCallback` desnecessários ou ausentes onde realmente importam
- estados duplicados
- derived state armazenado
- contexts grandes
- listeners Firestore
- queries repetidas
- waterfalls
- fetch duplicado
- cache
- paginação
- imagens
- lazy imports
- chunks
- bundle
- listas grandes
- filtros feitos repetidamente

Procure principalmente casos onde:

> a mesma informação é carregada mais de uma vez

ou:

> uma mudança pequena faz partes grandes do app renderizarem novamente

Não recomende memoização sem evidência de que ela traz benefício.

---

# 4. FIREBASE / FIRESTORE

Faça uma auditoria específica de custo e arquitetura.

Procure:

- leituras repetidas
- listeners desnecessários
- listeners sem cleanup
- queries N+1
- reads dentro de loops
- writes redundantes
- documentos grandes demais
- arrays crescendo indefinidamente
- transações desnecessárias
- batches possíveis
- cache inconsistente
- índices
- regiões
- Functions chamando Firestore várias vezes quando poderia agrupar

Não reduza reads sacrificando consistência ou segurança.

Sempre diferencie:

- otimização comprovada
- otimização provável
- micro-otimização sem impacto relevante

---

# 5. SEGURANÇA

Revise:

- Firestore Rules
- Storage Rules
- Cloud Functions
- Admin SDK
- autorização frontend vs backend
- superadmin
- owner
- membership
- dados financeiros
- EvoCash
- EvoCoins
- promoções
- PIX
- exclusão de conta
- moderação

Procure especialmente:

- confiança em dados enviados pelo client
- campos server-managed alteráveis pelo client
- privilege escalation
- IDOR
- ausência de ownership validation
- campos opcionais quebrando Rules
- dados financeiros modificáveis pelo frontend
- endpoints/callables que confiam em dados derivados no cliente
- leitura indevida de dados administrativos/privados

Não faça alterações de segurança sem demonstrar o fluxo afetado.

---

# 6. ASSINCRONISMO E ESTADO STALE

Esse projeto já teve bugs dessa categoria.

Procure sistematicamente por:

```text
mutation no backend
↓
UI continua mostrando estado antigo
```

Revise:

- caches
- contexts
- hooks
- estados locais
- `onSnapshot`
- refetch
- invalidation
- optimistic update
- navegação

Identifique também:

- race conditions
- resposta antiga sobrescrevendo resposta nova
- estado de outro usuário sobrevivendo após troca de conta
- listener duplicado
- listener que não é desmontado
- cache atualizado por apenas um de vários escritores
- múltiplas fontes de verdade para o mesmo dado

Não transforme o app inteiro em realtime.

Escolha a estratégia adequada por domínio:

- atualização local após sucesso
- listener realtime compartilhado
- refetch/invalidation pontual
- nenhuma mudança, se já estiver correto

---

# 7. REACT

Procure:

- efeitos disparando mais vezes que deveriam
- efeito dependendo de objeto inteiro quando deveria depender apenas de ID
- stale closures
- `setState` após unmount
- requests concorrentes
- resultado antigo sobrescrevendo resultado novo
- context provider recriando valores excessivamente
- cópias diferentes do mesmo estado
- derived state desnecessário
- lógica de negócio excessiva dentro de componente
- componentes gigantes com múltiplas responsabilidades
- hooks que escondem comportamento inesperado

Não proponha refactor apenas por tamanho. Demonstre o impacto.

---

# 8. TRATAMENTO DE ERROS

Revise:

- erros engolidos
- `catch` vazio
- `console.error` sem feedback ao usuário
- mensagens genéricas
- erro aparecendo longe da ação
- loading infinito
- botão que não reabilita após erro
- retry incorreto
- estado parcial após falha
- erro de permissão sem mensagem compreensível
- erro de rede tratado como erro funcional

Dê preferência a erros inline quando a ação pertence a um componente específico.

---

# 9. TESTES

Analise a suíte existente.

Identifique:

- partes críticas sem testes
- testes duplicados
- testes frágeis
- flakes
- mocks excessivos
- testes que passam mas não protegem o comportamento real
- testes acoplados a detalhes de implementação
- fluxos financeiros/permissões sem cobertura adequada

Não aumente cobertura apenas por porcentagem.

Priorize fluxos de risco.

---

# 10. DEPENDÊNCIAS

Analise:

- `package.json`
- `functions/package.json`
- demais manifests relevantes

Identifique:

- dependências não usadas
- bibliotecas duplicando funcionalidades
- pacotes muito pesados
- dependências exclusivamente dev colocadas em production
- scripts antigos
- tooling que não é mais utilizado

Não atualize versões nesta etapa.

---

# 11. PWA / SERVICE WORKER

Revise:

- estratégia de cache
- assets obsoletos
- cache versioning
- atualização de versão
- dados sensíveis armazenados indevidamente
- comportamento offline
- possibilidade de servir bundle antigo após deploy
- caches que interferem em dados dinâmicos
- service worker legado
- arquivos PWA não utilizados

Não remova PWA apenas para simplificar.

---

# 12. RESPONSIVIDADE E ACESSIBILIDADE

Audite problemas concretos de:

- overflow
- conteúdo cortado
- botões inacessíveis
- modais/drawers em telas pequenas
- teclado
- foco
- labels
- contraste
- navegação por teclado
- elementos interativos sem semântica
- layout quebrado em mobile

Diferencie bug funcional de melhoria visual.

---

# 13. DUPLICAÇÕES

Compare especialmente:

- services
- hooks
- componentes administrativos
- validações
- formatação
- cache
- permissões
- Firestore access
- tratamento de erros
- modais
- loading states
- helpers
- chamadas de Functions

Quero saber se existem duas implementações diferentes fazendo essencialmente a mesma coisa.

Não crie uma abstração genérica apenas para eliminar poucas linhas duplicadas.

---

# 14. NÃO FAÇA REFACTOR MASSIVO

Evite:

- trocar arquitetura inteira
- renomear centenas de arquivos
- converter tudo para outro padrão
- criar abstrações genéricas sem necessidade
- mover arquivos apenas por estética
- reescrever algo estável sem ganho mensurável

Prefira correções pequenas, isoladas e verificáveis.

---

# 15. CLASSIFICAÇÃO OBRIGATÓRIA

Para cada achado, classifique a prioridade:

### P0
Segurança, perda/corrupção de dados, financeiro ou função crítica quebrada.

### P1
Bug real, performance relevante ou UX claramente incorreta.

### P2
Dívida técnica que vale corrigir.

### P3
Melhoria opcional/cosmética.

Também marque o nível de confiança:

- `CONFIRMADO`
- `PROVÁVEL`
- `HIPÓTESE`

Não apresente hipótese como bug confirmado.

---

# 16. EVIDÊNCIA OBRIGATÓRIA

Cada problema deve trazer, sempre que possível:

- arquivo
- função/componente
- linhas ou trecho relevante
- comportamento atual
- por que é problema
- cenário de reprodução
- impacto
- correção recomendada
- risco da correção
- esforço estimado

Se não conseguir demonstrar o problema pelo código, reduza o nível de confiança.

---

# 17. PROCURE TAMBÉM POR ESTES PADRÕES

Faça buscas específicas por:

```text
window.location.reload
location.reload
localStorage
sessionStorage
setInterval
setTimeout
onSnapshot
useEffect
eslint-disable
TODO
FIXME
HACK
console.error
console.warn
catch (
Promise.all
getDoc
getDocs
addDoc
updateDoc
setDoc
writeBatch
runTransaction
```

Não assuma que um match é problema. Use os resultados apenas como ponto de investigação.

---

# 18. RESULTADO FINAL

Nesta primeira etapa, não altere código.

Entregue o relatório com esta estrutura:

## A. Resumo executivo

Inclua:

- saúde geral do projeto
- principais riscos
- principais oportunidades
- quantidade de P0/P1/P2/P3 encontrados
- limitações da auditoria

## B. Top 10 achados

Ordenados por impacto real.

## C. Relatório completo

Use tabela com:

| ID | Prioridade | Confiança | Área | Arquivo | Problema | Evidência | Impacto | Recomendação | Esforço |
|---|---|---|---|---|---|---|---|---|---|

## D. Código morto

Separar em:

### Confirmado como morto
### Provavelmente morto
### Precisa investigação

## E. Performance

Liste as maiores oportunidades e classifique o ganho potencial:

- alto
- médio
- baixo

Inclua quando possível:

- renderizações evitadas
- reads evitáveis
- writes evitáveis
- bundle/chunk afetado
- latência percebida

## F. Firebase

Liste separadamente oportunidades de:

- reduzir reads
- reduzir writes
- reduzir latency de Functions
- melhorar cache
- evitar listeners desnecessários
- melhorar cleanup
- corrigir região/arquitetura quando aplicável

## G. Testes

Liste:

- gaps críticos
- flakes
- testes redundantes
- testes de pouco valor
- testes recomendados

## H. Plano de correção

Monte lotes pequenos:

### Lote 1 — P0
### Lote 2 — P1 críticos
### Lote 3 — performance
### Lote 4 — código morto/duplicação
### Lote 5 — limpeza P2

Mostre:

- quais mudanças podem ser feitas juntas
- quais devem ficar isoladas
- ordem sugerida
- risco de cada lote
- testes necessários antes/depois

---

# RESTRIÇÃO FINAL

Nesta primeira etapa:

```text
NÃO editar
NÃO excluir
NÃO criar refactor
NÃO commit
NÃO push
NÃO deploy
NÃO alterar Firebase
NÃO alterar produção
```

Apenas investigar e gerar o relatório.

Pode executar:

- busca estática
- testes
- lint
- build
- scripts de análise

somente quando forem úteis para confirmar um achado.

Não corrija automaticamente algo apenas porque um comando encontrou warning.

---

# PRINCÍPIO DA AUDITORIA

O objetivo não é deixar o código “mais bonito”.

O objetivo é tornar o Evolutus:

- mais correto
- mais confiável
- mais rápido
- mais barato de operar
- mais seguro
- mais simples de manter

sem quebrar funcionalidades que já estão funcionando.
