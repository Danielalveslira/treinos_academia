-- O worker de Web Push passa a exigir o header X-Push-Worker-Secret. O valor mora no Supabase
-- Vault (secret `push_worker_secret`, criado fora do Git) e é lido pelo próprio job a cada
-- execução; a anon key do gateway é pública e não autoriza mais o processamento. Sem o segredo
-- no Vault o header vai vazio, o worker responde 401 e a fila simplesmente não anda.
-- cron.schedule com o mesmo nome substitui o job anterior (continua existindo um único).
select cron.schedule(
  'process-push-outbox', '* * * * *',
  $$select net.http_post(
    url := 'https://ywrjojrjgozdfpddkkuy.supabase.co/functions/v1/process-push-outbox',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3cmpvanJqZ296ZGZwZGRra3V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MzA3MjYsImV4cCI6MjEwNjAwNjcyNn0.CKODsrNrIpijKaiJGk9tQbTvuw24EuctjFouaLWMPRg',
      'Content-Type', 'application/json',
      'X-Push-Worker-Secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'push_worker_secret'), '')
    )
  )$$
);
