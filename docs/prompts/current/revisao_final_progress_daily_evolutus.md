# Revisão final — progressDaily, Rules, Functions e backfill

## Objetivo

Revisar os pontos críticos restantes da nova área de **Progresso** antes de qualquer deploy.

Foco principal:

- segurança das Firestore Rules;
- consistência do `progressDaily`;
- concorrência e ordem de eventos;
- suíte completa das Functions;
- backfill seguro e idempotente;
- ordem correta de publicação.

**Não fazer commit, push, deploy ou backfill `--apply` sem autorização.**

## 1. Firestore Rules

Auditar a coleção:

```text
users/{uid}/progressDaily/{date}
```

Confirmar e testar:

```text
dono → pode ler
outro usuário → não pode ler
cliente → não pode criar
cliente → não pode editar
cliente → não pode excluir
Admin SDK → consegue manter os documentos
```

Se os testes de Rules não estiverem rodando por falta de Java/emulator:

1. instalar/configurar apenas o necessário;
2. executar a suíte real;
3. não considerar Rules validadas apenas por inspeção visual.

Não afrouxar Rules para fazer testes passarem.

## 2. Concorrência e consistência do progressDaily

Auditar profundamente:

```text
functions/progress-daily-service.js
```

e os triggers relacionados a workouts.

Verificar comportamento em:

```text
create
update
delete
```

Testar especialmente:

### Dois creates rápidos no mesmo dia

```text
workout A criado
workout B criado quase ao mesmo tempo
```

O resumo final deve conter os dois.

### Update concorrente

Editar um workout enquanto outro evento do mesmo dia ainda está sendo processado.

O resumo final deve representar o estado atual real dos workouts.

### Delete

Excluir um workout e confirmar que:

```text
volume
séries
repetições
cardio
active
```

são recalculados corretamente.

### Eventos fora de ordem

Simular eventos chegando em ordem diferente da original.

O sistema deve convergir para o estado atual do Firestore.

### Retry

Executar novamente o mesmo evento/operação.

Não pode:

```text
duplicar volume
duplicar séries
duplicar reps
duplicar cardio
```

## 3. Estratégia de agregação

Confirmar se o serviço faz:

```text
recalcular o dia a partir dos workouts atuais
```

ou se incrementa/decrementa valores de forma incremental.

Se for incremental, avaliar risco real de:

```text
retry
evento duplicado
evento fora de ordem
falha parcial
```

Preferir abordagem convergente/idempotente quando necessária.

Não redesenhar sem evidência.

## 4. Suíte completa das Functions

Existe uma falha preexistente em:

```text
calculateAge
26 !== 25
```

Corrigir o teste para não depender da data atual.

Preferir:

```text
data de referência fixa
```

ou injeção de relógio/data controlada.

Objetivo:

```text
Functions tests → 100% verdes
```

Não mascarar a falha nem remover o teste.

## 5. Backfill progressDaily

Auditar:

```text
scripts/backfill-progress-daily.mjs
```

Confirmar:

- `--dry-run` não grava;
- `--apply` é obrigatório para escrita;
- usuário precisa ser explicitamente informado;
- não processa usuário errado;
- não duplica resultados;
- não soma sobre resumo existente incorretamente;
- pode ser executado novamente sem alterar resultado final;
- erros parciais são reportados;
- possui resumo final claro.

Testar:

```text
1ª execução dry-run
2ª execução dry-run
apply em ambiente seguro/emulator
nova execução
```

Resultado final deve ser idêntico.

## 6. Validação do backfill

Para usuários/amostras controladas, comparar:

```text
workouts reais do dia
vs
progressDaily gerado
```

Validar pelo menos:

```text
strengthVolumeKg
strengthSets
strengthReps
cardioMinutes
cardioDistanceKm
active
```

Escolher dias com:

```text
1 workout
vários workouts
força
cardio
força + cardio
workout editado
workout excluído
```

## 7. Exclusão de conta

Confirmar que o fluxo de exclusão remove:

```text
users/{uid}/progressDaily/**
```

sem quebrar outras subcollections.

Adicionar/validar teste correspondente.

## 8. Janela de medidas corporais

A implementação usa janela anual limitada a:

```text
500 documentos
```

Confirmar que:

- o limite é suficiente para uso real;
- não existe interpretação errada de “ano completo” se o limite for atingido;
- comportamento é seguro caso um usuário ultrapasse 500 medições.

Não aumentar o limite sem necessidade.

## 9. Testes obrigatórios

Executar:

```bash
npm test
npm run lint
npm run build
git diff --check
```

Além disso:

```text
Functions tests completos
Firestore Rules tests
progressDaily tests
backfill tests
delete-account tests
```

Nenhuma suíte deve ficar com falha conhecida antes do deploy.

## 10. Revisão da ordem de publicação

Validar se a ordem correta é:

```text
1. testes 100% verdes
2. deploy Firestore Rules
3. deploy Functions
4. backfill --dry-run
5. revisar resultado
6. backfill --apply
7. validar progressDaily no Firestore
8. deploy frontend
9. smoke test em produção
```

Identificar qualquer dependência que exija ordem diferente.

## 11. Não publicar frontend antes do backfill

Confirmar que usuários antigos não verão gráficos incompletos.

Se o frontend depender de `progressDaily` para histórico passado, o backfill precisa estar concluído antes da publicação.

Se existir fallback seguro para dados antigos, documentar exatamente como funciona.

## 12. Relatório final

Entregar:

```text
REVISÃO FINAL — PROGRESSO

1. FIRESTORE RULES
status:
testes:
riscos:

2. PROGRESS DAILY
estratégia:
idempotência:
concorrência:
eventos fora de ordem:
retries:

3. FUNCTIONS
suíte completa:
calculateAge:
falhas restantes:

4. BACKFILL
dry-run:
idempotência:
segurança:
resultado:

5. EXCLUSÃO DE CONTA
status:

6. MEDIDAS CORPORAIS
limite anual:
risco:

7. TESTES
npm test:
lint:
build:
diff check:
Rules:
Functions:

8. ORDEM DE DEPLOY RECOMENDADA
- ...

9. BLOQUEADORES
- ...

10. CONCLUSÃO
```

Finalizar com apenas uma destas:

```text
PRONTO PARA DEPLOY
```

```text
PRONTO PARA BACKFILL, MAS NÃO PARA DEPLOY
```

```text
AINDA NÃO ESTÁ PRONTO PARA PRODUÇÃO
```

## Restrições

Não fazer commit.
Não fazer push.
Não fazer deploy.
Não executar backfill `--apply`.
Não alterar produção.
Não afrouxar Rules.
Não ignorar falhas de teste.
