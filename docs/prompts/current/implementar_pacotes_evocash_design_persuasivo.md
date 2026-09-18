# Prompt — Implementar pacotes de EvoCash com design persuasivo ético

Quero implementar a apresentação dos pacotes oficiais de EvoCash no Evolutus, com foco em **aumentar desejo e conversão**, usando princípios de psicologia comportamental de forma ética, transparente e sem dark patterns.

## Pacotes aprovados

```text
Essencial — 50 EvoCash — R$ 5,90
Inicial   — 100 EvoCash — R$ 9,90
Popular   — 300 EvoCash — R$ 24,90
Max       — 700 EvoCash — R$ 49,90
```

Config esperada:

```js
cashPackages: {
  pack_50:  { cashAmount: 50,  amountCentavos: 590,  label: "50 EvoCash",  active: true },
  pack_100: { cashAmount: 100, amountCentavos: 990,  label: "100 EvoCash", active: true },
  pack_300: { cashAmount: 300, amountCentavos: 2490, label: "300 EvoCash", active: true },
  pack_700: { cashAmount: 700, amountCentavos: 4990, label: "700 EvoCash", active: true }
}
```

Antes de escrever em produção, confirme o schema real de `economyConfig/current` e não sobrescreva outros blocos existentes.

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

### 1. Ancoragem

Use o pacote `Max` como referência de maior valor e destaque a economia relativa dos pacotes maiores.

Exemplos permitidos:

```text
Popular
Economize R$ 4,80 comparado a 3 compras de 100 EvoCash
≈ 16% melhor valor

Max
Economize R$ 19,40 comparado a 7 compras de 100 EvoCash
≈ 28% melhor valor
```

Faça os cálculos no código a partir dos preços/config sempre que possível. Não deixe percentuais comerciais hardcoded se puderem ficar inconsistentes com a config.

### 2. Efeito de compromisso / opção recomendada

Destaque visualmente o `Popular` como escolha recomendada.

Pode usar:

```text
Recomendado
Melhor equilíbrio
```

NÃO use “Mais escolhido” enquanto não houver dados reais de compras comprovando isso.

O card Popular pode ter maior destaque visual, borda/elevação e CTA mais evidente, mas não deve estar pré-selecionado de forma enganosa.

### 3. Framing de valor

Não mostre apenas:

```text
300 EvoCash
R$ 24,90
```

Mostre também o valor unitário de maneira discreta:

```text
R$ 8,30 por 100 EvoCash
```

Para o Max:

```text
R$ 7,13 por 100 EvoCash
Melhor valor por EvoCash
```

Para o Essencial, comunique o benefício de entrada:

```text
Comece com pouco
```

Não destaque que ele tem pior valor unitário.

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
Comprar por R$ 9,90
Comprar por R$ 24,90
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
valor por 100
benefício curto
badge quando aplicável
CTA
```

Sugestão de copy:

```text
ESSENCIAL
50 EvoCash
R$ 5,90
Comece com pouco

INICIAL
100 EvoCash
R$ 9,90
Uma boa forma de começar

POPULAR
300 EvoCash
R$ 24,90
Recomendado
Melhor equilíbrio entre preço e saldo

MAX
700 EvoCash
R$ 49,90
Melhor valor
Até ~28% mais econômico que comprar 100 por vez
```

A copy final pode ser ajustada para combinar com o design atual do Evolutus.

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
   - cálculo de valor por 100;
   - cálculo de economia do Popular/Max;
   - pacote inativo não aparece;
   - CTA envia o `packageId` correto;
   - não existe claim “Mais escolhido” sem dado real;
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
