-- Feed da comunidade: totais de enquete e de participantes de treino em LOTE.
--
-- Cada card de enquete chamava get_poll_results e cada treino marcado chamava
-- count_workout_participants (1 chamada por card, o padrão N+1: 20 cards = 20 chamadas). O
-- feed agora pagina e agrupa os ids de uma página numa única chamada por tipo.
--
-- Mesma regra de visibilidade das funções unitárias, mas FAIL-CLOSED em lote: o que o chamador
-- não pode ver simplesmente não volta (as unitárias lançam PERMISSION_DENIED), então um id
-- inválido ou de outra comunidade nunca derruba nem revela o lote. O teto de 100 ids evita
-- que um array gigante vire varredura.

create or replace function public.get_poll_results_batch(p_status_ids uuid[])
returns table (status_id uuid, option_id text, votes bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with visible as materialized (
    select s.id
    from public.statuses s
    where s.id = any ((coalesce(p_status_ids, '{}'::uuid[]))[1:100])
      and s.type = 'poll'
      and coalesce(public.is_community_member(s.community_id), false)
  )
  select sv.status_id, sv.option_id, count(*)::bigint
  from visible v
  join public.status_votes sv on sv.status_id = v.id
  group by sv.status_id, sv.option_id
$$;

create or replace function public.count_workout_participants_batch(p_status_ids uuid[])
returns table (status_id uuid, participants integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with visible as materialized (
    select s.id
    from public.statuses s
    where s.id = any ((coalesce(p_status_ids, '{}'::uuid[]))[1:100])
      and s.type = 'workout'
      and coalesce(public._can_view_workout_status(s), false)
  )
  select v.id, (select count(*)::integer from public.status_participants sp where sp.status_id = v.id)
  from visible v
$$;

revoke execute on function public.get_poll_results_batch(uuid[]) from public, anon;
grant execute on function public.get_poll_results_batch(uuid[]) to authenticated;
revoke execute on function public.count_workout_participants_batch(uuid[]) from public, anon;
grant execute on function public.count_workout_participants_batch(uuid[]) to authenticated;
