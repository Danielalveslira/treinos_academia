# Fase 5 — homologação e rollout offline

Estado em 2026-10-06: **NO-GO para ativação global**. O projeto oficial é `ywrjojrjgozdfpddkkuy` (produção), sem homologação separada. As três migrations offline foram aplicadas após conferência do ledger e dry run. O código pode ser publicado com as flags remotas em 0%; testes reais em produção e aparelhos Android/iOS físicos são necessários antes de ampliar o rollout.

## Evidência local

| Gate | Resultado |
| --- | --- |
| pgTAP | 32 arquivos SQL, 1.456 asserts aprovados, 0 falhas, 0 skips, no PostgreSQL local `pgphase5` |
| Migrations | 108 arquivos anteriores e 3 migrations novas; suíte de 32 pgTAP aprovada no banco local. As 3 novas foram aplicadas no Supabase oficial após ledger e dry run. |
| SQL concorrente | EvoCoins: 7 checks; atividade: 40 chamadas simultâneas, uma linha, zero erros |
| Edge Functions | 9 arquivos, 86 casos internos; 86 aprovados incluindo concorrência real com `PG_TEST_CONTAINER=pgtest` |
| Backfill/scripts | 3 arquivos, 19 casos internos, 19 aprovados |
| Frontend | `npm test`: 1.154 casos aprovados, 0 falhas, 0 skips |
| Lint | 0 erros; 8 avisos já existentes |
| Build/budget | `npm run build` e `npm run budget` passam, sem afrouxar limites; boot JS gzip 307.624 bytes, CSS 71.228 bytes |
| Chromium real | `npm run test:offline-browser` passou: cold start offline, perfil/histórico local, treino novo na outbox, duas pendências preservadas após reconexão sem sessão e atualização do SW; dados sintéticos, sem sync remoto |

O comando `node --test supabase/functions/*/*.test.js` conta **arquivos como testes de nível superior** e oculta os casos internos no sumário; idem `scripts/*.test.mjs`. Para auditar os casos, rode cada arquivo diretamente com `node caminho/do/arquivo.test.js`. `concurrency.test.js` pula por padrão; com o banco local disponível, use `PG_TEST_CONTAINER=pgtest node supabase/functions/process-push-outbox/concurrency.test.js`.

O container novo usou a imagem local `public.ecr.aws/supabase/postgres:17.6.1.166` com `--network none`. Ela não contém todas as tabelas do Supabase Storage gerenciado nem as colunas recentes de `auth.users`; antes das migrations, foram criadas **somente no banco de teste** fixtures equivalentes mínimas para Storage/Auth, e a extensão pgTAP foi instalada antes da suíte. A CLI `supabase db start` falhou durante a inicialização do Realtime por timeout de conexão; não foi usada para declarar a cadeia aprovada. O teste do container novo valida a sequência das migrations da aplicação, com essa limitação explícita de baseline.

## Rollout

As flags mestras continuam independentes. Em produção, escrita e cold start exigem **flag mestra `true` e configuração remota válida**:

| Recurso | Flag | Percentual independente | Padrão de produção |
| --- | --- | --- | --- |
| Leitura | `VITE_OFFLINE_READ_ENABLED` | não se aplica | ligado (pode desligar com `false`) |
| Escrita | `VITE_OFFLINE_WRITE_ENABLED` | `offline_write` em `public.offline_feature_flags` | desligado e 0% na migration |
| Cold start | `VITE_OFFLINE_COLD_START_ENABLED` | `offline_cold_start` em `public.offline_feature_flags` | desligado e 0% na migration |

O percentual aceita 0 a 100, inclusive decimais. O mesmo `user_id` cai sempre no mesmo balde (hash local, 10.000 baldes), sem lista de contas incorporada no bundle. Identidade ausente não entra em coorte. As flags não concedem acesso ao servidor; RLS, sessão e `has_app_access()` prevalecem. A RPC autenticada atualiza a configuração sem build; clientes online consultam a cada 15 segundos e antes de nova escrita. Offline usa somente a última resposta válida da conta. **Rollback de escrita/cold start não apaga a outbox existente**: o sync continua processando pendências da mesma conta após revalidação.

Sequência proposta, sempre com monitoramento entre etapas: 0% no deploy, smoke em produção, depois 5%, 10%, 25%, 50% e 100%. O percentual é calculado pelo `user_id` e **não seleciona contas internas**; não anunciar o primeiro percentual como restrito à equipe. Abrir escrita primeiro e cold start depois; não elevar os dois percentuais no mesmo release. Reverter ao último percentual saudável ou a 0% se qualquer gate abaixo falhar. Não usar percentual como controle de segurança: todo usuário deve continuar protegido pelo backend.

## Diagnóstico seguro

`evolutusOfflineDiagnostics()` no console da PWA ainda devolve contadores locais. Eventos técnicos permitidos também entram em fila local limitada (100) e são enviados via RPC autenticada para `public.offline_telemetry`, sem payload, token, e-mail ou conteúdo do treino. O servidor limita 120 eventos por usuário por hora e elimina linhas após 30 dias. Falha de telemetria nunca bloqueia treino ou sync; eventos podem ser descartados quando storage/sessão não estão disponíveis.

Consulta agregada de recibos no SQL Editor do projeto oficial (acesso administrativo, sem expor IDs):

```sql
select date_trunc('day', applied_at at time zone 'America/Sao_Paulo')::date as business_day,
       operation, count(*) as mutations_applied
from public.offline_mutation_receipts
where applied_at >= now() - interval '7 days'
group by 1, 2
order by 1 desc, 2;
```

Recibos medem mutações confirmadas, não tentativas de retry nem pendências ainda no aparelho. Para cada etapa do canário, comparar contadores locais antes/depois da reconexão com essa contagem e com a outbox visível no aparelho; divergência não explicada é NO-GO.

## Validação com Supabase real

1. Verificar o projeto oficial `ywrjojrjgozdfpddkkuy` e o ledger; as três migrations foram aplicadas após dry run e um segundo dry run confirmou zero pendências.
2. Publicar o frontend com as duas flags remotas em 0% e fazer smoke online com conta de teste, sem alterar dados de clientes.
3. Antes de elevar o rollout, testar login online A → perfil/legal/histórico → rede desligada → fechar e reabrir PWA → registrar e editar treino → outbox → restaurar rede → verificar sessão, perfil, acesso e legal antes do primeiro lote → confirmar uma só linha por `mutation_id` e histórico atualizado. Repetir com ACK perdido, token expirado, logout, troca para B e conflito `updated_at`.
4. Registrar hora, versão do bundle/SW, sistema/navegador, contadores de diagnóstico, quantidade de pendências antes/depois, resultado do servidor e evidências sem dados pessoais.

## Aparelhos físicos

Executar os cenários acima em Android Chrome PWA instalada e iPhone Safari “Adicionar à Tela de Início”. Em cada aparelho, testar: primeiro login online; cold start sem rede após encerramento completo; dados locais e escrita; reconexão; sessão expirada; logout e outra conta; atualização de SW preservando IndexedDB/outbox; storage pressionado; virada 23:59:59→00:00:00 em São Paulo com o aparelho em outro fuso; Finalizar treino online. Registrar modelo, versão do SO, navegador, armazenamento livre e capturas da outbox antes/depois. O simulador/Chromium desktop não substitui esses gates.

## GO / NO-GO

**GO para rollout acima de 0%** somente com migrations confirmadas no projeto oficial, 100% de pgTAP e testes de segurança locais, fluxo real com Supabase sem duplicação, Android e iPhone físicos aprovados, zero perda de outbox, reconexão sempre revalidando sessão/acesso/legal antes do sync, budget aprovado e canal operacional para recolher diagnósticos e interromper o rollout.

**NO-GO imediato** se houver perda de mutação, duplicação não idempotente, cruzamento de contas, sync sob acesso negado, aceite legal inventado, recompensa decidida pelo cliente, falso “salvo” com falha de storage, ou falha de cold start/upgrade em qualquer plataforma física. Preservar a outbox e desligar as duas flags remotas. Investigar e repetir toda a matriz afetada antes de elevar o percentual.
