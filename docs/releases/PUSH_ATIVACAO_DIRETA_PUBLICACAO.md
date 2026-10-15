# Publicação — ativação direta de Push

Publicação autorizada e concluída em 14/10/2026.

- Produção: https://treinosacademia-ten.vercel.app
- Commit: `8e8bcc55bc111c33d907418db024a9285607030a`, branch `main`, GitHub confirmado como `Danielalveslira/treinos_academia`.
- Vercel: `dpl_u5fLCoyx1ww6fv6QJ589xoRZDQjR`, `READY`, alias principal confirmado no mesmo commit.
- Supabase: projeto Evolutus confirmado; worker `process-push-outbox` versão **9**, `ACTIVE`, `verify_jwt=true`. Código baixado após deploy comparado integralmente com os quatro módulos locais.
- Migrations `20261102000001` e `20261102000002` aplicadas pela CLI, na ordem e em transações próprias. Nenhum seed. Dry-run posterior sem pendências.
- Dez verificações de metadados aprovadas: enum, histórico, RPC autenticada sem acesso anônimo, helper privado, claim reservado ao serviço, search_path restrito, catálogo/TTL, RLS e cron a cada minuto. Execuções recentes do cron bem-sucedidas.
- Smoke HTTP: Home, assets atuais do Dashboard/CSS, SW, login e perfil com HTTP 200; headers de segurança preservados. Chromium anônimo em 390/1366 px sem erros JavaScript, overflow ou prompt de permissão inesperado.

Antes da publicação foram salvos o schema `public,private` e os fontes do worker versão 8 em `/tmp/push-production`. O hash do schema e os resultados estão em `PUSH_ATIVACAO_DIRETA_PUBLICACAO_EVIDENCIAS.json`. O dump é de schema, não um backup completo dos dados. Rollback operacional: restaurar frontend `2a2d274`, aplicar `supabase/rollbacks/20261102000002_disable_push_explicit_activation.sql` e, se necessário, restaurar worker anterior; preservar schema aditivo e holds de consentimento.

Validações locais anteriores: 1.939 testes JavaScript, 156 testes de funções com integração SQL e 29 cenários Chromium aprovados; 58/58 asserções da nova suíte SQL. Build, lint sem erros e budget aprovados. As 477 asserções SQL de regressão incluíram uma falha preexistente em funções de votos/promoções, reproduzida sem as migrations novas e confirmada no schema remoto anterior. Essa pendência não foi alterada nesta publicação e permanece descrita em `PUSH_HOME_ATIVACAO.md`.

**Limite da homologação:** o smoke de produção não fez login, ativação ou disparo de teste. Entrega física, ACK e clique reais aguardam conta/aparelho de teste expressamente autorizados. Não se alega entrega Web Push homologada em aparelho. Nenhuma preferência de usuário foi alterada por teste.

Alterações locais preexistentes nos documentos de exercícios e prompts de outros trabalhos foram preservadas e não incluídas no commit de Push.
