-- Índices parciais para as duas leituras que rodam a CADA abertura de uma comunidade e hoje varrem mais
-- do que precisam:
--
--  * "Próximos treinos" (listUpcomingWorkouts): where community_id = ? and type = 'workout' and
--    workout_date > now() order by workout_date. Só existe statuses_type_expires_idx (type, expires_at):
--    o plano lê TODOS os treinos da plataforma e filtra a comunidade depois.
--  * "Destaques" (listFeaturedStatusesForCommunity): where community_id = ? and promoted and
--    promoted_until > now() order by promoted_until. Sem índice utilizável: varredura sequencial.
--
-- Medido (EXPLAIN ANALYZE, papel authenticated, comunidade com 50 mil publicações):
--    próximos treinos  61,0 ms ->  9,4 ms
--    destaques         11,0 ms ->  1,7 ms   (1.017 -> 41 buffers)
-- Parciais: só indexam as poucas linhas de treino/promovidas, então o custo de escrita e de espaço é mínimo.
-- Se statuses já for grande em produção, aplique cada comando com CREATE INDEX CONCURRENTLY fora de
-- transação (o editor de migrations do Supabase roda em transação, por isso aqui vai o comando simples).

create index if not exists statuses_community_workout_date_idx
  on public.statuses (community_id, workout_date)
  where type = 'workout';

create index if not exists statuses_community_promoted_idx
  on public.statuses (community_id, promoted_until)
  where promoted;
