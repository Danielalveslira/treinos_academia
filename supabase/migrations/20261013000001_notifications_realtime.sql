-- Central de Notificações em tempo real. O app assina SOMENTE INSERT e UPDATE de
-- public.notifications com filtro `recipient_id=eq.<uid>`; o Realtime ainda aplica a RLS
-- (`notifications_select_own`) com o JWT do assinante, então ninguém recebe linhas de outra conta.
-- DELETE (descurtir remove a notificação) não é assinado: o Realtime não filtra DELETE por
-- coluna; o cliente se reconcilia pelo contador (debounce) e pela próxima abertura da lista.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
