-- Alinhamento de histórico: a migração de projeto Supabase EUA -> Brasil (06/11/2026, PR #127,
-- ver docs/juridico/DOSSIE_DECISAO_LEGAL_2_0.md) trocou o projeto hospedado, mas as migrations
-- originais destes dois cron jobs (20260930000002_deletion_worker.sql,
-- 20261012000001_web_push_notifications.sql / 20261012000003_push_worker_cron_secret.sql) ficaram
-- com a URL antiga (projeto já desativado, DNS não resolve mais). Confirmado por consulta somente
-- leitura ao projeto real vinculado: alguém já corrigiu isso fora de uma migration (direto no
-- banco) -- esta migration só capta no histórico o que já está ao vivo, sem mudar nada em produção.
-- Não editar as migrations antigas (regra do repositório); re-agendar com o mesmo nome substitui o
-- job existente, então aplicar isto não interrompe nem duplica os jobs já corretos.
select cron.schedule(
  'process-deletion-jobs', '* * * * *',
  $$select net.http_post(
    url := 'https://aofjhkkfrtrluuulacjv.supabase.co/functions/v1/process-deletion-jobs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvZmpoa2tmcnRybHV1dWxhY2p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4Njc0NTIsImV4cCI6MjEwOTQ0MzQ1Mn0.53EnUxR4_LP5JxS9WWo4iTvM4UDE7MGsYU10n00l1-U',
      'Content-Type', 'application/json'
    )
  )$$
);

select cron.schedule(
  'process-push-outbox', '* * * * *',
  $$select net.http_post(
    url := 'https://aofjhkkfrtrluuulacjv.supabase.co/functions/v1/process-push-outbox',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvZmpoa2tmcnRybHV1dWxhY2p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4Njc0NTIsImV4cCI6MjEwOTQ0MzQ1Mn0.53EnUxR4_LP5JxS9WWo4iTvM4UDE7MGsYU10n00l1-U',
      'Content-Type', 'application/json',
      'X-Push-Worker-Secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'push_worker_secret'), '')
    )
  )$$
);

-- 'send-cash-purchase-reminder-emails' também tem a URL antiga no histórico, mas está INATIVO
-- (active=false) no projeto real -- não sabemos se foi uma pausa deliberada. cron.schedule()
-- reativaria o job ao recriá-lo; não re-agendamos aqui para não mudar esse estado sem instrução
-- explícita. Mesma observação para 'expire-stale-infinitepay-purchases' (inativo, sem URL stale).
