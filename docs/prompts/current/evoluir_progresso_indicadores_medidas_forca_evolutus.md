# Evolução da área de Progresso — indicadores, força, medidas e gráficos

## Objetivo

Evoluir a área de **Progresso** do Evolutus para ficar mais clara, útil e visualmente consistente, com foco em:

- melhorar o gráfico principal;
- ampliar indicadores físicos e corporais;
- melhorar indicadores de força;
- melhorar análise de volume;
- organizar melhor a experiência da página;
- manter segurança, performance e consistência com a arquitetura atual.

**Não fazer commit, push ou deploy sem autorização.**

---

## 1. Auditar antes de alterar

Primeiro revisar a implementação atual de:

```text
/progresso
gráficos
BodyCompositionCard
medidas corporais
cálculos de volume
cálculos de força
progressDaily
serviços e validators relacionados
Firestore Rules
```

Entregar primeiro:

```text
ESTADO ATUAL
- como o gráfico funciona;
- como período atual/anterior é calculado;
- quais indicadores já existem;
- quais dados já estão disponíveis;
- limitações atuais.

PLANO
- arquivos a alterar;
- novos campos necessários;
- novos cálculos;
- impacto em Rules e backend.
```

Depois implementar.

---

## 2. Melhorar o gráfico principal

O gráfico atual está visualmente ruim e possui uma barra/linha branca de comparação que confunde a leitura.

### Corrigir

- identificar exatamente por que essa série branca aparece;
- corrigir a visualização;
- melhorar contraste no tema escuro;
- deixar período atual e anterior claramente distinguíveis;
- não desenhar comparação quando não existir base anterior válida;
- melhorar tooltip, legenda, labels e estados vazios;
- manter boa responsividade no mobile.

### Períodos

Suportar:

```text
Hoje
Semana
Mês
Trimestre
Ano
```

Com agregação adequada:

```text
Hoje       → por exercício ou distribuição do dia
Semana     → diário
Mês        → diário
Trimestre  → semanal
Ano        → mensal
```

### Indicadores selecionáveis

```text
Volume
Séries
Repetições
Dias de treino
Cardio
```

Mostrar sempre que possível:

```text
valor do período
variação vs período anterior equivalente
```

---

## 3. Medidas corporais

Ampliar o acompanhamento para:

```text
Peso
Altura
IMC
Circunferência abdominal
Cintura
Quadril
Braço
Coxa
Panturrilha
Tórax
```

### Regras

- IMC deve ser tratado apenas como referência;
- medidas devem usar unidade consistente;
- campos opcionais não podem quebrar registros antigos;
- preservar compatibilidade com dados existentes;
- atualizar validators, serviços, UI, Rules e testes quando necessário.

Organizar a interface para não virar um formulário excessivamente poluído.

---

## 4. Composição corporal

Manter/adicionar:

```text
% de gordura
Massa gorda
Massa magra
```

Quando houver:

```text
peso + % de gordura
```

calcular de forma derivada:

```text
massa gorda
massa magra
```

Evitar duplicação/confusão entre valor informado manualmente e valor estimado.

Se houver valor manual e estimado, deixar a origem clara.

Adicionar texto curto explicando que medidas de composição corporal variam conforme método e protocolo, sem linguagem médica ou diagnóstica.

---

## 5. Indicadores de força

Criar análise de evolução por exercício.

Mostrar:

```text
carga utilizada
repetições
melhor carga
melhor desempenho recente
evolução semanal
```

### Avaliar

Se fizer sentido com os dados atuais, adicionar:

```text
1RM estimado
5RM estimado
10RM estimado
```

ou uma métrica mais simples baseada em:

```text
carga × repetições
```

Não criar métricas sofisticadas apenas por criar.

Qualquer estimativa deve:

- informar que é estimativa;
- mostrar fórmula/documentação no código;
- funcionar apenas quando os dados forem válidos;
- não misturar exercícios diferentes.

---

## 6. Volume de treino

Melhorar a apresentação do volume.

Considerar:

```text
séries
repetições
carga
volume total
volume médio por treino
volume médio por dia ativo
evolução por período
```

Explicar claramente:

```text
volume de carga = soma de peso × repetições das séries
```

Não inventar carga para exercícios com peso zero ou peso corporal.

Para esses casos, complementar com:

```text
séries
repetições
frequência
```

---

## 7. Organização da página

Evitar excesso de cards soltos.

Estruturar a página em blocos claros:

```text
Visão geral
Treino
Força
Volume
Composição corporal
Medidas corporais
```

Priorizar:

```text
valor
tendência
comparação
gráfico
explicação curta
```

A interface deve continuar simples mesmo com mais dados.

---

## 8. Evolução das medidas corporais

Permitir acompanhar tendência ao longo do tempo de:

```text
Peso
Gordura
Massa magra
Massa gorda
Cintura
Abdômen
Quadril
Braço
Coxa
Panturrilha
Tórax
```

Não precisa mostrar tudo ao mesmo tempo.

Usar seletor de indicador e períodos.

Exemplo:

```text
[ Peso ] [ Gordura ] [ Cintura ] [ Braço ] ...

Mês
Trimestre
Ano
```

---

## 9. Compatibilidade e migração

Os novos campos devem ser opcionais.

Garantir funcionamento com registros antigos que não possuem:

```text
abdomen
braço
coxa
panturrilha
tórax
massa gorda
```

Não exigir migração destrutiva.

---

## 10. Firestore e segurança

Se novos campos forem persistidos:

- atualizar allowlists;
- validar tipo e faixa;
- impedir campos arbitrários;
- preservar regra de leitura/escrita por proprietário;
- adicionar testes de Rules.

Não afrouxar Rules.

---

## 11. Performance e custo

Evitar:

```text
novas queries por card
fetch por render
leitura de histórico inteiro
duplicação de dados
```

Reutilizar:

```text
progressDaily
histórico corporal já carregado
helpers de agregação existentes
```

Se algum indicador exigir nova agregação backend, justificar antes.

---

## 12. UX do formulário de medidas

Melhorar o formulário atual.

Sugestão de agrupamento:

```text
Dados gerais
- altura
- peso
- % gordura

Circunferências
- abdômen
- cintura
- quadril
- tórax
- braço
- coxa
- panturrilha

Composição
- massa magra
- massa gorda
```

Manter campos opcionais claramente identificados.

Evitar formulário cansativo no mobile.

---

## 13. Testes

Adicionar testes para:

```text
massa gorda
massa magra
IMC
novas medidas
1RM/força, se implementado
volume
comparações de período
dados ausentes
legacy
gráficos sem período anterior
Rules dos novos campos
```

Rodar:

```bash
npm test
npm run lint
npm run build
git diff --check
```

---

## 14. Entrega final

Informar:

```text
Arquivos alterados
Indicadores adicionados
Campos novos
Cálculos novos
Melhorias do gráfico
Mudanças de UX
Alterações de Rules
Impacto em Firestore
Impacto em custo/performance
Testes executados
Pendências
```

Finalizar com:

```text
IMPLEMENTAÇÃO PRONTA PARA REVISÃO
```

ou:

```text
IMPLEMENTAÇÃO PARCIAL — EXISTEM PENDÊNCIAS
```

---

## Restrições

Não fazer commit.
Não fazer push.
Não fazer deploy.
Não alterar produção.
Não inventar métricas sem base nos dados.
Não transformar indicadores em diagnóstico médico.
Não quebrar registros antigos.
