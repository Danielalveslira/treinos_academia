# Mensagens dinâmicas da Home (Greeting V2) — entrega e rollout

Especificação: `docs/promps/Evolutus_Arquitetura_Mensagens_Dinamicas_V1.md`.
Estado: implementado e validado localmente; publicação conforme `docs/promps/PROMPT_FINAL_PUBLICACAO_GREETING_V2.md`. Desligado por padrão (sem a variável, a flag é falsa).

## O que existe

| Parte | Onde |
|---|---|
| Catálogo editorial (210 frases), pools, IDs | `src/features/greetings/catalog.js` |
| Contexto, voz, período, nome | `context.js` · `format.js` |
| Prioridade, rotação determinística, saída da UI | `select.js` |
| Relógio (1 `setTimeout`, sem polling) | `clock.js` · `useGreetingClock.js` |
| Boas-vindas: elegibilidade e ACK single-flight | `welcome.js` · `useDashboardGreeting.js` |
| Cabeçalho e seletor de voz no Perfil | `DashboardGreeting.jsx` · `GreetingVoiceSettings.jsx` |
| Escritas (só RPC) | `src/services/greetingPreferencesService.js` |
| Banco | `supabase/migrations/20261024000001_greeting_personalization.sql` |
| Testes SQL | `supabase/tests/greeting_personalization_test.sql` · `greeting_welcome_concurrency.sh` |

`src/utils/greeting.js` (saudação anterior) **não foi alterado**: é o caminho de rollback.

## Configuração de build

| Variável | Efeito |
|---|---|
| `VITE_GREETING_V2_ENABLED=true` | liga as novas mensagens, o seletor no Perfil e as RPCs. Qualquer outro valor = saudação anterior, **nenhuma RPC nova**. |
| `VITE_GREETING_WELCOME_FROM=<ISO-8601 com fuso>` | corte das boas-vindas, ex.: `2026-10-24T00:00:00-03:00`. Só contas criadas a partir dele recebem a primeira recepção. Ausente, sem fuso ou inválido = **ninguém** recebe (falha segura). Deve ser um valor fixo da release, nunca "agora". |

Nenhuma das duas está no `.env` do repositório. O `.vercel`/painel da Vercel é onde o valor de produção é definido (são variáveis `VITE_`: mudar o valor exige novo build/deploy).

## Ordem de rollout

1. Aplicar `20261024000001_greeting_personalization.sql` no ambiente controlado e depois no remoto (aditiva e idempotente: `add column if not exists`, constraint condicional, `create or replace`). 
2. Rodar `supabase/tests/greeting_personalization_test.sql` e `greeting_welcome_concurrency.sh` nesse ambiente.
3. Só então publicar o front com `VITE_GREETING_V2_ENABLED=true` e o `VITE_GREETING_WELCOME_FROM` definido.
4. Rollback: desligar a flag e republicar o front (volta a saudação anterior e some o seletor; nenhuma RPC é chamada). As colunas ficam: não fazer `DROP`.

## Garantias verificadas

- Seleção da frase: **0 consultas** (módulos do núcleo sem `fetch`/Supabase/storage/`Math.random`/`Date.now`, garantido por `purity.test.js`). Escritas só em `set_greeting_voice` (ao trocar a preferência) e `ack_greeting_welcome` (uma vez por conta).
- Boas-vindas: ACK só com o cabeçalho montado **e** aba visível; online; single-flight por conta; sem retry em laço (volta da rede tenta de novo); resultado tardio de outra conta é descartado; a frase não muda quando o servidor confirma.
- RPCs: `SECURITY DEFINER`, `search_path` fixo, `REVOKE` de `public`/`anon`, `GRANT` só a `authenticated`, `auth.uid()` e `has_app_access()` obrigatórios, valor exato (sem normalizar), UPDATE direto do cliente continua negado. Concorrência real (12 conexões, barreira comum): 0 erros, instante único.
- Offline: bootstrap guarda só `greetingVoice` (sem sexo; snapshot antigo continua válido); `auto` sem sexo = frase neutra; offline nunca mostra nem confirma boas-vindas.

## Decisões e desvios da especificação

1. **`first_workout` não foi implementado.** A Home carrega só uma página de treinos e não há contagem total confiável sem consulta extra; a especificação manda não inventar. Catálogo: 210 frases (o mínimo da spec).
2. **Sem histórico confiável** (`progressAvailable=false`) planejado/descanso/retorno caem para a saudação por período (a spec pede não afirmar nada sem evidência). Treino concluído/em andamento continuam valendo quando a própria Home os comprovou.
3. **Boas-vindas nunca aparecem offline**, nem o campo `greetingWelcomeSeenAt` foi levado ao bootstrap: com snapshot antigo não dá para saber se outro aparelho já confirmou, e a spec manda usar a saudação normal na dúvida. `greetingWelcomeSeenAt` precisa ser exatamente `null` (coluna ausente = `undefined` = "não sei").
4. O relógio da Home roda sempre (não só com a flag): corrige o dia "congelado" depois da meia-noite no `buildConsistencySnapshot`/`weekStartKey`/`daysSinceLastActivity`, que agora dependem de `dayKey`. Com a flag desligada a saudação anterior também passa a atualizar nas viradas.
5. `tone` do contrato da mensagem não foi incluído (não é usado em tempo de execução); o catálogo guarda `id`, `category`, `voice`, `eyebrow`, `text`, `maxNameLength`, `enabled`.
6. Eyebrow fixo `SEU RITMO, SUA EVOLUÇÃO`, exceto boas-vindas (`BOAS-VINDAS AO EVOLUTUS`).

## Pendências / riscos

- **Homologação autenticada** (primeira entrada de conta nova, dois aparelhos, troca de voz, offline → online) ainda não feita: o app não foi exercitado contra um Supabase real com a flag ligada.
- **Revisão editorial humana** das 210 frases. O lint automático (termos proibidos, gênero, duplicatas, tamanho) não substitui a leitura.
- **Recência das boas-vindas:** uma conta criada depois do corte que treine antes de ver a recepção só a verá num dia sem treino, mesmo dias depois. Seguiu a spec (não confirma o que não foi exibido); se incomodar, limitar a elegibilidade a N dias desde `createdAt`.
- **Suítes SQL (diagnóstico fechado):** as 15 falhas vistas antes eram só do ambiente local: o `grant select on all tables ... to anon, authenticated` aplicado DEPOIS das migrations anulava os `REVOKE` delas. Recriando o banco com os privilégios padrão do Supabase (`alter default privileges ... grant all ... to anon, authenticated, service_role`) aplicados ANTES das migrations e sem grant em massa, **as 43 suítes pgTAP passam (0 falhas)**. Nenhum grant/RLS foi alterado.
- Privacidade: confirmar com quem cuida do jurídico se a preferência de voz (texto da própria conta, sem dado novo) exige alguma menção na política.
