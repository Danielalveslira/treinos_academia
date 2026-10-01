-- Três validações que só existiam no cliente (findings da varredura de Firebase legado,
-- PR #58) ganham um equivalente server-side. "Não confie no frontend" para as três.

-- 1) Janela de tempo de "pode entrar no treino" (isScheduledWorkoutJoinable em
-- utils/scheduledWorkout.js: workout.date > agora). A policy FOR ALL original só tinha
-- `user_id = auth.uid()` no with_check -- Postgres avalia SÓ with_check num INSERT,
-- nunca using(), então a checagem de membership de community em using() nunca rodava
-- pra join: dava pra inserir um status_participants pra workout de QUALQUER comunidade,
-- não só da que o usuário participa, além de não validar a data nenhuma. Separado em 3
-- policies pra poder travar isto só no insert (join), sem mudar o "cancelar mesmo depois
-- do início do treino" que já é comportamento esperado no delete.
drop policy if exists status_participants_all on public.status_participants;

create policy status_participants_select on public.status_participants for select
  using (user_id = auth.uid() and public.is_community_member(
    (select community_id from public.statuses where id = status_participants.status_id)
  ));

create policy status_participants_insert on public.status_participants for insert
  with check (
    user_id = auth.uid()
    and public.is_community_member(
      (select community_id from public.statuses where id = status_participants.status_id)
    )
    and exists (
      select 1 from public.statuses s
      where s.id = status_participants.status_id
        and s.type = 'workout'
        and s.workout_date > now()
    )
  );

create policy status_participants_delete on public.status_participants for delete
  using (user_id = auth.uid() and public.is_community_member(
    (select community_id from public.statuses where id = status_participants.status_id)
  ));

-- 2) Peso -- mesmo teto já aplicado em validateBodyMeasurement (0 < kg <= 400). Altura
-- (users.height_cm) já tinha check constraint desde users_new_fields.sql e validação
-- redundante em update_user_profile/save_body_check_in; peso nunca teve nenhuma das
-- duas, nem na tabela nem na RPC -- um valor absurdo (negativo, zero, milhões) passava
-- direto por save_body_check_in.
alter table public.body_measurements
  add constraint body_measurements_weight_kg_check
  check (weight_kg is null or (weight_kg > 0 and weight_kg <= 400));

-- 3) Ícone de comunidade -- mesma lista fechada de COMMUNITY_ICON_NAMES (src/constants/
-- communityIcons.js). Nem o insert direto do painel admin (communities_insert/update,
-- RLS) nem a RPC create_community (fase de economia/privilégio pago) validavam o valor
-- de icon_name no servidor, só o <select> do formulário -- uma chamada direta podia
-- gravar qualquer string.
alter table public.communities
  add constraint communities_icon_name_check
  check (icon_name is null or icon_name in (
    'users', 'dumbbell', 'heart-pulse', 'flame', 'trophy', 'target',
    'zap', 'star', 'rocket', 'mountain', 'bike', 'footprints'
  ));
