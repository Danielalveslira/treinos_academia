# RELATÓRIO DE EVOLUÇÃO — ENQUETES, CONQUISTAS E TREINOS MARCADOS

## Objetivo

Quero uma análise profunda de três tipos de publicação do Evolutus:

- Enquete
- Compartilhamento de conquista
- Treino marcado

Hoje sinto que essas três funcionalidades ainda estão imaturas, pouco úteis e sem motivo forte para o usuário voltar a utilizá-las.

Nesta etapa, **NÃO ALTERE CÓDIGO**.

Quero primeiro um relatório de produto, UX e arquitetura mostrando como podemos transformar essas funcionalidades em partes realmente interessantes da comunidade.

---

# 1. Audite como funcionam hoje

Leia a implementação completa de:

- criação da publicação
- formulário
- `StatusCard`
- feed
- banco de dados
- services
- Functions
- Rules
- cache
- contadores
- notificações, se houver
- histórico relacionado

Para cada um dos três tipos, explique:

- como funciona atualmente
- quais campos são armazenados
- quais ações o usuário pode fazer
- o que acontece depois da publicação
- quais interações existem
- onde termina o fluxo
- por que hoje parece pouco útil

---

# 2. ENQUETES

Hoje a enquete basicamente permite:

```text
pergunta
opções
votar
ver percentual
```

Quero saber como podemos torná-la uma ferramenta real de comunidade.

Avalie ideias como:

- prazo para encerramento
- encerramento automático
- resultado final destacado
- múltipla escolha
- permitir alterar voto ou não
- número de participantes
- quem já participou
- enquete anônima
- enquete rápida
- enquete fixada
- enquete do dia
- enquete criada por admin
- enquete ligada a desafio/treino
- discussão/comentários sobre o resultado

Não implemente tudo só porque está nessa lista.

Quero que você diga o que realmente faz sentido para o Evolutus.

Exemplos de uso:

```text
"Qual treino vamos fazer sábado?"
"Qual exercício entra no desafio da semana?"
"Treino hoje às 18h ou 19h?"
"Quem vai participar do treino de pernas amanhã?"
```

A enquete deve gerar **interação e decisão coletiva**, não ser apenas um formulário.

---

# 3. CONQUISTAS

Audite como o compartilhamento de conquista funciona hoje e proponha evolução.

Quero explorar coisas como:

- conquista gerada automaticamente pelo sistema
- recorde pessoal
- sequência de treinos
- frequência semanal/mensal
- aumento de carga
- volume recorde
- quantidade de treinos
- meta concluída
- desafio concluído
- evolução pessoal

Em vez de o usuário simplesmente escrever uma conquista, o Evolutus poderia gerar cards automaticamente.

Exemplo:

```text
🏆 NOVO RECORDE

Supino reto
80 kg × 8

Recorde anterior:
75 kg × 8

+6,7%
```

Outro exemplo:

```text
🔥 10 TREINOS CONCLUÍDOS

Daniel atingiu uma nova marca.
```

Quero sugestões para tornar isso:

- compartilhável
- visual
- motivador
- social
- competitivo

Avalie também:

- reação/parabéns
- ranking relacionado
- badges
- raridade da conquista
- evolução comparativa contra o próprio usuário
- compartilhamento automático opcional

Evite competição corporal prejudicial.

Prefira competição relacionada a:

- consistência
- atividade
- evolução pessoal
- participação
- desafios

---

# 4. TREINO MARCADO

Hoje parece apenas uma publicação dizendo que haverá um treino.

Quero investigar a possibilidade de transformar isso em um **evento da comunidade**.

Analise ideias como:

- data
- horário
- local
- treino/exercícios
- limite de participantes
- organizador

Interações possíveis:

```text
[Vou participar]
[Talvez]
[Não vou]
```

Depois mostrar:

```text
8 confirmados
3 talvez
```

Avalie também:

- lista de participantes
- contagem regressiva
- lembrete
- status "Hoje"
- status "Começa em 2h"
- treino concluído
- resultado do evento
- publicação pós-treino
- desafio coletivo
- treino da comunidade
- competição amigável
- meta compartilhada
- ranking do desafio

Exemplo:

```text
🏋️ TREINO MARCADO

Treino de pernas
Sábado · 17:30
Academia X

12 participantes

[✓ Vou participar]
```

Depois do evento:

```text
✅ TREINO CONCLUÍDO

9 participantes completaram
```

Quero descobrir o que faria essa funcionalidade gerar retorno para o app.

---

# 5. COMPETIÇÃO E DIVERSÃO

Pense no Evolutus como uma comunidade fitness.

Quero propostas de gamificação com utilidade real:

- desafios semanais
- desafios da comunidade
- streak de participação
- metas coletivas
- ranking semanal
- badges
- recordes
- temporadas
- conquistas raras
- participação em treinos

Evite:

- spam
- grind artificial
- ranking baseado em quem passa mais tempo no app
- recompensa financeira excessiva
- pay-to-win
- competição corporal prejudicial

Prefira premiar:

- consistência
- participação
- evolução
- contribuição à comunidade
- conclusão de desafios

---

# 6. EvoCoins

Avalie se algum desses sistemas deveria conversar com EvoCoins.

Porém:

**NÃO altere a economia agora.**

Quero apenas propostas.

Exemplos:

- completar desafio
- participar de evento
- atingir marco

Analise riscos de:

- farm de Coins
- criação falsa de eventos
- votação combinada
- spam de conquistas
- auto-recompensa

Se recomendar integração econômica, explique como evitar abuso.

---

# 7. CONEXÃO ENTRE AS TRÊS FUNCIONALIDADES

Quero principalmente descobrir se elas podem funcionar juntas.

Exemplo:

```text
ENQUETE
"Qual desafio faremos?"
↓
resultado
↓
TREINO/DESAFIO MARCADO
↓
pessoas participam
↓
evento termina
↓
CONQUISTAS são geradas
↓
comunidade compartilha resultados
```

Quero saber se esse ciclo faria mais sentido do que manter os três tipos de publicação isolados.

---

# 8. PRIORIDADES V1 / V2 / V3

Classifique as propostas como:

## V1
Melhoria simples, grande benefício.

## V2
Evolução intermediária.

## V3
Ideia futura mais ambiciosa.

Para cada proposta, informe:

- impacto para o usuário
- complexidade
- necessidade de backend
- necessidade de novos documentos/coleções
- risco de abuso
- impacto em reads/writes Firestore

---

# 9. PROPOSTA DE UX

Para cada tipo, mostre como o card deveria ficar conceitualmente.

Use wireframes em texto.

Exemplo:

```text
┌──────────────────────────────┐
│ 🏋️ TREINO MARCADO           │
│                              │
│ Treino de pernas             │
│ Sábado · 17:30               │
│ Academia X                   │
│                              │
│ 👥 8 confirmados · 3 talvez │
│                              │
│ [ Vou participar ]           │
└──────────────────────────────┘
```

Faça isso para:

- enquete
- conquista
- treino marcado

---

# 10. RELATÓRIO FINAL

Quero receber:

## Diagnóstico atual
Por que cada uma das três funcionalidades é pouco útil hoje.

## Proposta ideal
Como cada uma deveria funcionar no Evolutus.

## Fluxos integrados
Como enquete → treino/desafio → conquista poderia funcionar.

## V1 recomendada
Escolha um conjunto pequeno de mudanças que entregue **grande melhoria sem transformar o projeto em algo gigante**.

## V2
Próximas evoluções.

## V3
Recursos futuros mais ambiciosos.

## Impacto técnico
Liste os principais arquivos, estruturas Firestore, Functions e componentes que provavelmente precisariam mudar.

## Riscos
Analise:

- spam
- abuso
- custo Firebase
- fraude de recompensa
- complexidade excessiva
- duplicação de funcionalidades
- problemas de moderação

---

# RESTRIÇÃO FINAL

Nesta etapa:

```text
NÃO alterar código
NÃO criar documentos Firestore
NÃO alterar Rules
NÃO alterar Functions
NÃO alterar economia
NÃO commit
NÃO push
NÃO deploy
```

Quero apenas análise e proposta.

O objetivo principal é responder:

> Como fazer enquete, conquista e treino marcado deixarem de ser apenas "tipos de post" e virarem funcionalidades que façam a comunidade do Evolutus ser mais divertida, participativa e competitiva?
