# Prompt — Implementar pacotes de EvoCash com design persuasivo ético

Quero implementar a apresentação dos pacotes oficiais de EvoCash no Evolutus, com foco em **aumentar desejo e conversão**, usando princípios de psicologia comportamental de forma ética, transparente e sem dark patterns.

> **Atualização (2026-09-20) — reposicionamento como moeda premium/rara.** Os valores
> originais abaixo foram substituídos pelos pacotes aprovados nesta seção. Os antigos
> (50/R$5,90, 100/R$9,90, 300/R$24,90, 700/R$49,90) não devem mais aparecer em nenhum
> lugar do código, config ou copy. As seções "Ancoragem" e "Framing de valor" mais
> abaixo descrevem a versão ANTERIOR do design (economia calculada, "R$X por 100
> EvoCash") e foram **descontinuadas**: a versão atual comunica raridade pela própria
> quantidade de EvoCash e pelo design, sem matemática comparativa entre pacotes.

## Pacotes aprovados

```text
Essencial — 25 EvoCash  — R$ 5,90  — "Para uma ação pontual"
Inicial   — 50 EvoCash  — R$ 10,90 — "Uma boa forma de começar"
Popular   — 120 EvoCash — R$ 23,90 — badge "Recomendado" — "Melhor equilíbrio entre preço e saldo"
Max       — 300 EvoCash — R$ 49,90 — badge "Melhor valor" — "Maior pacote disponível"
```

O Max é 300 EvoCash (não 250, valor considerado antes): o custo real de
`promotionPackages.community_boost_30d` é 300 EvoCash, e com um teto de 250 nenhuma
compra única cobriria esse destaque — o usuário teria que combinar pacotes. Alinhar o
Max a 300 resolve essa incompatibilidade sem alterar o preço da promoção.

Config esperada em `economyConfig/current.cashPackages`:

```js
cashPackages: {
  pack_25:      { cashAmount: 25,  amountCentavos: 590,  label: "25 EvoCash",  active: true },
  pack_50_v2:   { cashAmount: 50,  amountCentavos: 1090, label: "50 EvoCash",  active: true },
  pack_120:     { cashAmount: 120, amountCentavos: 2390, label: "120 EvoCash", active: true },
  pack_300_v2:  { cashAmount: 300, amountCentavos: 4990, label: "300 EvoCash", active: true }
}
```

`packageId` é tratado como um SKU imutável — nunca reaproveitado para um preço/
quantidade diferente. Os novos pacotes de 50 e 300 EvoCash usam `pack_50_v2`/
`pack_300_v2`, não `pack_50`/`pack_300`: esses IDs antigos já significaram preços
diferentes (R$5,90 e R$24,90 respectivamente), e reaproveitá-los arriscaria uma aba com
cache antigo mostrar o preço velho na tela enquanto o backend (que resolve preço fresco
por `packageId` a cada request) cobra o preço novo pelo mesmo ID. `pack_50`, `pack_100`,
`pack_300` e `pack_700` foram todos removidos e não devem sobrar residuais no documento
de config — uma escrita com `{merge: true}` sozinha NÃO remove chaves de mapa aninhado
não mencionadas (Firestore faz merge recursivo em campos de mapa); a remoção exige
`FieldValue.delete()` explícito para cada chave antiga dentro do mesmo write. `pack_250`
nunca chegou a existir em produção e não deve ser criado.

Antes de escrever em produção, confirme o schema real de `economyConfig/current` e não sobrescreva outros blocos existentes (ex.: `promotionPackages`).

---

## Objetivo de UX

A tela `/evocash` deve fazer o usuário entender rapidamente:

```text
quanto recebe
quanto paga
qual pacote oferece melhor valor
o que poderá fazer com o EvoCash
```

Não quero uma tela com aparência de tabela técnica. Quero cards de compra visualmente desejáveis.

## Princípios de persuasão a aplicar

### 1. Ancoragem (descontinuado)

> Esta seção descrevia a versão anterior do design e não é mais aplicada. A partir do
> reposicionamento de 2026-09-20, nenhum card mostra "economize R$X" ou "~X% melhor
> valor" — a raridade e o posicionamento premium vêm da própria quantidade de EvoCash
> oferecida e do design dos cards, sem matemática comparativa entre pacotes.

### 2. Efeito de compromisso / opção recomendada

Destaque visualmente o `Popular` como escolha recomendada.

Pode usar:

```text
Recomendado
Melhor equilíbrio
```

NÃO use “Mais escolhido” enquanto não houver dados reais de compras comprovando isso.

O card Popular pode ter maior destaque visual, borda/elevação e CTA mais evidente, mas não deve estar pré-selecionado de forma enganosa.

### 3. Framing de valor (descontinuado)

> Esta seção pedia um valor unitário discreto ("R$X por 100 EvoCash") em cada card.
> A partir do reposicionamento de 2026-09-20 esse framing foi removido: os cards
> mostram apenas quantidade de EvoCash, preço e a tagline curta da tabela de pacotes
> aprovados, sem cálculo de preço unitário.

### 4. Efeito de progressão

Faça os cards transmitirem claramente uma escada:

```text
Essencial → experimentar
Inicial   → começar
Popular   → aproveitar mais
Max       → melhor custo-benefício
```

Isso deve ser feito por copy curta, não por textos longos.

### 5. Concretude / benefício

Leia o `economyConfig.current.privileges.createCommunity.cashCost` real e, se fizer sentido, mostre exemplos concretos do que o saldo permite.

Exemplo, SOMENTE se o custo real suportar:

```text
100 EvoCash
Pode cobrir até 2 criações de comunidade
```

Não invente utilidades ainda não implementadas.

A Fase 6 ainda não existe, então não prometa anúncios, impulsionamentos ou recursos futuros como se já estivessem disponíveis.

### 6. Redução de fricção

Cada card deve ter CTA simples:

```text
Comprar por R$ 5,90
Comprar por R$ 10,90
Comprar por R$ 23,90
Comprar por R$ 49,90
```

Ao clicar, mantenha o fluxo atual seguro de `requestCashPurchase`.

Não altere a lógica financeira/idempotência já implementada.

### 7. Segurança e confiança

Perto da área de compra, comunique de forma curta:

```text
Pagamento via PIX
Crédito confirmado após validação do pagamento
EvoCash é um crédito interno do Evolutus
```

Não use linguagem que sugira investimento, rendimento, saque ou conversão para dinheiro.

---

## Restrições éticas obrigatórias

NÃO implementar:

- contagem regressiva falsa;
- “últimas unidades” falsas;
- urgência artificial;
- desconto fictício;
- preço riscado sem preço anterior real;
- “mais comprado” sem dados;
- depoimentos inventados;
- pré-seleção escondida;
- botão de cancelar difícil de encontrar;
- cobrança automática;
- falsa escassez;
- qualquer mensagem que tente envergonhar o usuário por escolher o pacote barato.

A persuasão deve vir de **clareza de valor, comparação real e boa apresentação**, não de engano.

---

## Layout desejado

Desktop:

```text
[ Essencial ] [ Inicial ] [ POPULAR ] [ Max ]
                           ↑ destaque
```

Mobile:

```text
cards empilhados ou carrossel simples
Popular aparece em posição de destaque
```

Cada card deve mostrar:

```text
nome
quantidade de EvoCash
preço
tagline curta
badge quando aplicável
CTA
```

Copy aprovada (2026-09-20):

```text
ESSENCIAL
25 EvoCash
R$ 5,90
Para uma ação pontual

INICIAL
50 EvoCash
R$ 10,90
Uma boa forma de começar

POPULAR
120 EvoCash
R$ 23,90
Recomendado
Melhor equilíbrio entre preço e saldo

MAX
300 EvoCash
R$ 49,90
Melhor valor
Maior pacote disponível
```

Nenhum card mostra preço unitário, "economize R$X" ou percentual de economia — ver nota
de descontinuação nas seções "Ancoragem" e "Framing de valor" acima.

---

## Implementação

1. Audite a tela `/evocash` atual.
2. Reaproveite os componentes e tokens visuais existentes.
3. Não crie um design system paralelo.
4. Leia os pacotes do `economyConfig/current`; a UI não deve depender de uma lista comercial duplicada hardcoded.
5. O backend continua sendo a fonte autoritativa de preço e quantidade.
6. Se precisar de metadados puramente visuais como `recommended`, `tagline` ou ordem, prefira uma camada de apresentação local mapeada por `packageId`, sem duplicar preço/quantidade.
7. Preserve acessibilidade, teclado, contraste e responsividade.
8. Adicione testes para:
   - ordem dos pacotes;
   - preço/quantidade de cada pacote batem com os valores aprovados (25/50/120/300);
   - valores antigos (50/590, 100/990, 300/2490, 700/4990) nunca aparecem;
   - pacote inativo não aparece;
   - CTA envia o `packageId` correto;
   - não existe claim "Mais escolhido"/"Mais comprado" sem dado real;
   - nenhum texto de preço unitário, economia ou percentual comparativo aparece;
   - retry mantém a idempotência existente.

## Produção

Primeiro implemente e teste localmente.

**Não altere `economyConfig/current` de produção, não faça deploy, commit ou push sem minha autorização.**

Ao terminar, me mostre:

```text
arquivos alterados
mock/resumo visual da tela
cálculos exibidos
testes adicionados
resultado de frontend tests/lint/build
```

Pare para revisão.
