-- P0 fix (auditoria 2026-11-10): delete_workout_sheet() fazia DELETE físico de workout_sheets.
-- workouts.sheet_id sobrevivia via "on delete set null" (20261123000001), mas
-- workout_sheet_completions ia embora por ON DELETE CASCADE (20261125000001), e
-- get_my_progress_sheet_summary (20261211000001) resolve s.name via join direto em
-- workout_sheets -- uma ficha excluída não tinha mais linha para o join casar, então
-- trainedOccurrences/completedOccurrences/distinctSheets do Progresso encolhiam
-- retroativamente mesmo sem nenhum workout real ter sido tocado.
--
-- Correção: "excluir" deixa de ser um DELETE físico e passa a ser um tombstone permanente na
-- própria linha (deleted_at). A linha de workout_sheets nunca mais desaparece, então:
--   * workouts.sheet_id e workout_sheet_completions continuam apontando para uma linha real
--     para sempre -- nenhuma ação de FK jamais precisa disparar, nenhuma cascata apaga nada;
--   * get_my_progress_sheet_summary resolve s.name de uma ficha excluída exatamente como
--     resolve hoje uma arquivada, sem qualquer alteração nessa função;
--   * toda superfície "ativa" (listagem, detalhe, edição, arquivar/restaurar, duplicar como
--     origem, Home, validação de registro offline) passa a filtrar deleted_at is null, então
--     uma ficha excluída fica tão inacessível/intreinável/inedítável quanto antes -- só que sem
--     destruir o fato histórico que a sustentava.
-- economy_transactions/workout_sheet_exercises/RLS: ver justificativa por função abaixo.
set local lock_timeout = '5s';

alter table public.workout_sheets add column deleted_at timestamptz;

-- Mantém a ficha deletada fora de toda consulta "ativa" por padrão; get_my_progress_sheet_summary
-- (não alterada por esta migration) é a única leitora que precisa enxergar linhas com deleted_at
-- preenchido, e ela nunca passa por esta política (lê via função SECURITY DEFINER).
drop policy if exists sheets_read on public.workout_sheets;
create policy sheets_read on public.workout_sheets for select to authenticated
 using(user_id=(select auth.uid()) and deleted_at is null and (select public.has_app_access()));

-- Excluir agora é definitivo para o uso ativo (planejamento zerado, nunca mais listável/editável/
-- treinável), mas nunca mais um DELETE físico: a linha-mãe precisa sobreviver para que
-- workouts/workout_sheet_completions continuem íntegros e get_my_progress_sheet_summary continue
-- contando os mesmos fatos de antes da exclusão.
create or replace function public.delete_workout_sheet(p_sheet_id uuid, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.sheet_actor();
  s public.workout_sheets;
begin
  perform 1 from public.users where id = u for update;
  select * into s from public.workout_sheets where id = p_sheet_id and user_id = u and deleted_at is null for update;
  if s.id is null then raise exception 'SHEET_NOT_FOUND'; end if;
  if p_expected_revision is distinct from s.revision then raise exception 'SHEET_VERSION_CONFLICT'; end if;
  -- Planejamento atual (não é fato histórico) some de verdade: sem itens, nenhuma tela de
  -- execução pode considerar a ficha pronta, e a biblioteca pessoal nunca é tocada.
  delete from public.workout_sheet_exercises where sheet_id = s.id;
  update public.workout_sheets
    set deleted_at = now(), archived_at = coalesce(archived_at, now()), revision = revision + 1, updated_at = now()
    where id = s.id;
  return jsonb_build_object('id', s.id, 'deleted', true);
end $$;

-- Mesma assinatura/corpo de 20261122000001, só com "and deleted_at is null" na posse: uma ficha
-- excluída fica tão "SHEET_NOT_FOUND" para edição quanto uma inexistente -- nunca reaparece
-- editável por essa via.
create or replace function public.save_workout_sheet(p_sheet_id uuid,p_expected_revision bigint,p_metadata jsonb,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 u uuid:=private.sheet_actor(); s public.workout_sheets; r record; e public.exercises;
 c public.exercise_catalog; item public.workout_sheet_exercises; normalized jsonb:='[]';
 days smallint[]; nm text; gd text; gl text; lim jsonb:=private.workout_sheet_limits();
begin
 select * into s from public.workout_sheets where id=p_sheet_id and user_id=u and deleted_at is null for update;
 if s.id is null then raise exception 'SHEET_NOT_FOUND'; end if;
 if p_expected_revision is distinct from s.revision then raise exception 'SHEET_VERSION_CONFLICT'; end if;
 if jsonb_typeof(p_metadata) is distinct from 'object' or jsonb_typeof(p_items) is distinct from 'array'
 or jsonb_array_length(p_items)>(lim->>'items')::int then raise exception 'SHEET_INVALID_PAYLOAD'; end if;
 nm:=private.sheet_trim(p_metadata->>'name'); gl:=nullif(p_metadata->>'goal',''); gd:=private.sheet_trim(coalesce(p_metadata->>'goal_description',''));
 if nm is null or char_length(nm) not between 1 and 80 or char_length(gd)>500
 or (gl is not null and gl not in ('hipertrofia','forca','resistencia','condicionamento','mobilidade','other'))
 or jsonb_typeof(p_metadata->'weekdays') is distinct from 'array' then raise exception 'SHEET_INVALID_PAYLOAD'; end if;
 select coalesce(array_agg(value::smallint order by value::smallint),'{}') into days from jsonb_array_elements_text(p_metadata->'weekdays');
 if not private.valid_sheet_weekdays(days) then raise exception 'SHEET_INVALID_PAYLOAD'; end if;
 if (select count(distinct value->>'exercise_id') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'SHEET_DUPLICATE_EXERCISE'; end if;
 for r in select value,ordinality from jsonb_array_elements(p_items) with ordinality loop
  if jsonb_typeof(r.value) is distinct from 'object' then raise exception 'SHEET_INVALID_PAYLOAD'; end if;
  select * into e from public.exercises where id=(r.value->>'exercise_id')::uuid and user_id=u for share;
  if e.id is null then raise exception 'SHEET_EXERCISE_UNAVAILABLE'; end if;
  select * into c from public.exercise_catalog where provider=e.provider and provider_exercise_id=e.provider_exercise_id for share;
  if not private.sheet_exercise_available(e.id,u) and not exists(
   select 1 from public.workout_sheet_exercises where sheet_id=s.id and exercise_id=e.id
  ) then raise exception 'SHEET_EXERCISE_UNAVAILABLE'; end if;
  item:=null;
  item.exercise_id:=e.id; item.target_sets:=(r.value->>'target_sets')::smallint;
  item.reps_min:=(r.value->>'reps_min')::int; item.reps_max:=(r.value->>'reps_max')::int;
  item.rest_seconds:=(r.value->>'rest_seconds')::int;
  item.target_duration_minutes:=(r.value->>'target_duration_minutes')::int;
  item.target_distance_km:=(r.value->>'target_distance_km')::numeric;
  item.note:=private.sheet_trim(coalesce(r.value->>'note',''));
  if (item.target_sets is not null and item.target_sets not between 1 and (lim->>'sets')::int)
  or (item.reps_min is not null and item.reps_min not between 1 and 1000)
  or (item.reps_max is not null and item.reps_max not between 1 and 1000)
  or item.reps_min>item.reps_max or char_length(item.note)>300
  or (item.rest_seconds is not null and item.rest_seconds not between 0 and 900)
  or (item.target_duration_minutes is not null and item.target_duration_minutes not between 1 and (lim->>'duration')::int)
  or (item.target_distance_km is not null and not(item.target_distance_km>0 and item.target_distance_km<=(lim->>'distance')::numeric))
  or (c.category is distinct from 'cardio' and (item.target_duration_minutes is not null or item.target_distance_km is not null))
  or (c.category='cardio' and (item.target_sets is not null or item.reps_min is not null or item.reps_max is not null))
  then raise exception 'SHEET_INVALID_TARGET'; end if;
  normalized:=normalized||jsonb_build_array(jsonb_build_object('exercise_id',e.id,'sort_order',r.ordinality-1,
   'target_sets',item.target_sets,'reps_min',item.reps_min,'reps_max',item.reps_max,'rest_seconds',item.rest_seconds,
   'target_duration_minutes',item.target_duration_minutes,'target_distance_km',item.target_distance_km,'note',item.note));
 end loop;
 if jsonb_build_object('name',s.name,'goal',s.goal,'goal_description',s.goal_description,'weekdays',to_jsonb(s.weekdays))=jsonb_build_object('name',nm,'goal',gl,'goal_description',gd,'weekdays',to_jsonb(days))
 and normalized=coalesce((select jsonb_agg(to_jsonb(x)-array['id','sheet_id','user_id','created_at','updated_at'] order by sort_order,id) from public.workout_sheet_exercises x where sheet_id=s.id),'[]')
 then return jsonb_build_object('id',s.id,'revision',s.revision); end if;
 delete from public.workout_sheet_exercises where sheet_id=s.id and exercise_id not in(select (value->>'exercise_id')::uuid from jsonb_array_elements(normalized));
 insert into public.workout_sheet_exercises(sheet_id,user_id,exercise_id,sort_order,target_sets,reps_min,reps_max,rest_seconds,target_duration_minutes,target_distance_km,note)
 select s.id,u,x.exercise_id,x.sort_order,x.target_sets,x.reps_min,x.reps_max,x.rest_seconds,x.target_duration_minutes,x.target_distance_km,x.note
 from jsonb_populate_recordset(null::public.workout_sheet_exercises,normalized) x
 on conflict(sheet_id,exercise_id) do update set sort_order=excluded.sort_order,target_sets=excluded.target_sets,
 reps_min=excluded.reps_min,reps_max=excluded.reps_max,rest_seconds=excluded.rest_seconds,
 target_duration_minutes=excluded.target_duration_minutes,target_distance_km=excluded.target_distance_km,note=excluded.note,updated_at=now()
 where (public.workout_sheet_exercises.sort_order,public.workout_sheet_exercises.target_sets,public.workout_sheet_exercises.reps_min,public.workout_sheet_exercises.reps_max,public.workout_sheet_exercises.rest_seconds,public.workout_sheet_exercises.target_duration_minutes,public.workout_sheet_exercises.target_distance_km,public.workout_sheet_exercises.note) is distinct from (excluded.sort_order,excluded.target_sets,excluded.reps_min,excluded.reps_max,excluded.rest_seconds,excluded.target_duration_minutes,excluded.target_distance_km,excluded.note);
 update public.workout_sheets set name=nm,goal=gl,goal_description=gd,weekdays=days,revision=revision+1,updated_at=now() where id=s.id;
 return jsonb_build_object('id',s.id,'revision',s.revision+1);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then raise exception 'SHEET_INVALID_PAYLOAD';
end $$;

-- Mesmo corpo de 20261122000001: só a posse da ficha-origem passa a exigir deleted_at is null
-- (uma ficha excluída não pode servir de origem de duplicação).
create or replace function public.duplicate_workout_sheet(p_source_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); s public.workout_sheets; dest public.workout_sheets;
begin
 if p_request_id is null then raise exception 'SHEET_INVALID_PAYLOAD'; end if;
 perform 1 from public.users where id=u for update;
 select * into s from public.workout_sheets where id=p_source_id and user_id=u and deleted_at is null for update;
 if s.id is null then raise exception 'SHEET_NOT_FOUND'; end if;
 select * into dest from public.workout_sheets where user_id=u and create_request_id=p_request_id;
 if dest.id is not null then return jsonb_build_object('id',dest.id,'revision',dest.revision); end if;
 if (select count(*) from public.workout_sheets where user_id=u and archived_at is null)>=(private.workout_sheet_limits()->>'active')::int then raise exception 'SHEET_LIMIT_REACHED'; end if;
 perform 1 from public.exercises e join public.workout_sheet_exercises i on i.exercise_id=e.id
 where i.sheet_id=s.id order by e.id for share of e;
 perform 1 from public.exercise_catalog c join public.exercises e on e.provider=c.provider and e.provider_exercise_id=c.provider_exercise_id
 join public.workout_sheet_exercises i on i.exercise_id=e.id where i.sheet_id=s.id order by c.id for share of c;
 if exists(select 1 from public.workout_sheet_exercises i where i.sheet_id=s.id and not private.sheet_exercise_available(i.exercise_id,u)) then raise exception 'SHEET_EXERCISE_UNAVAILABLE'; end if;
 insert into public.workout_sheets(user_id,name,goal,goal_description,weekdays,sort_order,create_request_id)
 values(u,left(s.name,72)||' (cópia)',s.goal,s.goal_description,s.weekdays,coalesce((select max(sort_order)+1 from public.workout_sheets where user_id=u),0),p_request_id) returning * into dest;
 insert into public.workout_sheet_exercises(sheet_id,user_id,exercise_id,sort_order,target_sets,reps_min,reps_max,rest_seconds,target_duration_minutes,target_distance_km,note)
 select dest.id,u,exercise_id,sort_order,target_sets,reps_min,reps_max,rest_seconds,target_duration_minutes,target_distance_km,note from public.workout_sheet_exercises where sheet_id=s.id;
 return jsonb_build_object('id',dest.id,'revision',dest.revision);
end $$;

-- Mesmo corpo de 20261122000001: deleted_at is null na posse -- não dá para (re)arquivar/restaurar
-- uma ficha já excluída.
create or replace function public.set_workout_sheet_archived(p_sheet_id uuid,p_archived boolean,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); s public.workout_sheets;
begin
 perform 1 from public.users where id=u for update;
 select * into s from public.workout_sheets where id=p_sheet_id and user_id=u and deleted_at is null for update;
 if s.id is null then raise exception 'SHEET_NOT_FOUND'; end if;
 if p_archived is null then raise exception 'SHEET_INVALID_PAYLOAD'; end if;
 if (s.archived_at is not null)=p_archived then return jsonb_build_object('id',s.id,'revision',s.revision); end if;
 if p_expected_revision is distinct from s.revision then raise exception 'SHEET_VERSION_CONFLICT'; end if;
 if not p_archived and (select count(*) from public.workout_sheets where user_id=u and archived_at is null)>=(private.workout_sheet_limits()->>'active')::int then raise exception 'SHEET_LIMIT_REACHED'; end if;
 update public.workout_sheets set archived_at=case when p_archived then now() end,
 sort_order=case when not p_archived then coalesce((select max(x.sort_order)+1 from public.workout_sheets x where x.user_id=u and x.archived_at is null and x.id<>s.id),0) else sort_order end,
 revision=revision+1,updated_at=now() where id=s.id;
 return jsonb_build_object('id',s.id,'revision',s.revision+1);
end $$;

-- Mesmo corpo de 20261122000001: deleted_at is null na listagem -- uma ficha excluída nunca
-- aparece nem na lista ativa nem na "Mostrar arquivadas" (ela também tem archived_at preenchido).
create or replace function public.list_my_workout_sheets(p_archived boolean default false,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); result jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(q) order by sort_order,id),'[]') into result from (
 select s.id,s.name,s.goal,s.weekdays,s.archived_at,s.revision,s.sort_order,
 (select count(*) from public.workout_sheet_exercises i where i.sheet_id=s.id) as exercise_count,
 (select array_agg(distinct e.muscle_group) from public.workout_sheet_exercises i join public.exercises e on e.id=i.exercise_id where i.sheet_id=s.id) as muscle_groups
 from public.workout_sheets s where s.user_id=u and s.deleted_at is null and (s.archived_at is not null)=p_archived
 order by s.sort_order,s.id limit 40 offset greatest(0,least(coalesce(p_offset,0),100000))
 ) q; return result;
end $$;

-- Mesmo corpo de 20261122000001: deleted_at is null na posse -- consultar/editar/iniciar uma
-- ficha excluída devolve SHEET_NOT_FOUND, igual a uma ficha inexistente.
create or replace function public.get_my_workout_sheet(p_sheet_id uuid,p_for_execution boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); s public.workout_sheets; items jsonb;
begin
 select * into s from public.workout_sheets where id=p_sheet_id and user_id=u and deleted_at is null;
 if s.id is null then raise exception 'SHEET_NOT_FOUND'; end if;
 select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('available',private.sheet_exercise_available(e.id,u),
 'exercise',jsonb_build_object('id',e.id,'name',e.name,'muscleGroup',e.muscle_group,'type',e.type,'source',e.source,'active',e.active,
 'provider',e.provider,'providerExerciseId',e.provider_exercise_id,'catalogId',e.catalog_id)) order by i.sort_order,i.id),'[]') into items
 from public.workout_sheet_exercises i join public.exercises e on e.id=i.exercise_id and e.user_id=u where i.sheet_id=s.id;
 if p_for_execution and (s.archived_at is not null or jsonb_array_length(items)=0 or exists(select 1 from jsonb_array_elements(items) x where not (x->>'available')::boolean)) then raise exception 'SHEET_NOT_READY'; end if;
 return to_jsonb(s)||jsonb_build_object('items',items);
end $$;

-- Mesmo corpo de 20261123000001: deleted_at is null na posse do trigger de membership -- um
-- registro offline só chegando agora para uma ficha já excluída é rejeitado como SHEET_NOT_FOUND
-- (nunca inserido com um vínculo para uma ficha que o usuário não vê mais em lugar nenhum).
create or replace function private.validate_workout_sheet_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.workout_sheets; e public.exercises; u uuid;
begin
 if new.sheet_id is null then return new; end if;
 u:=private.sheet_actor();
 if new.user_id is distinct from u then raise exception 'SHEET_NOT_FOUND'; end if;
 select * into s from public.workout_sheets where id=new.sheet_id and user_id=u and deleted_at is null for share;
 if s.id is null then raise exception 'SHEET_NOT_FOUND'; end if;
 if s.archived_at is not null then raise exception 'SHEET_NOT_READY'; end if;
 select * into e from public.exercises where id=new.exercise_id and user_id=u for share;
 if e.id is null then raise exception 'SHEET_EXERCISE_UNAVAILABLE'; end if;
 perform 1 from public.exercise_catalog c where c.provider=e.provider
   and c.provider_exercise_id=e.provider_exercise_id for share;
 if not private.sheet_exercise_available(e.id,u) then raise exception 'SHEET_EXERCISE_UNAVAILABLE'; end if;
 if not exists(select 1 from public.workout_sheet_exercises
   where sheet_id=s.id and user_id=u and exercise_id=e.id) then
  raise exception 'SHEET_EXERCISE_MISMATCH';
 end if;
 return new;
end $$;

-- Mesmo corpo de 20261125000001: deleted_at is null nas duas referências a workout_sheets -- o
-- Home nunca mostra, nem por recência nem por atividade do mês, uma ficha excluída (ela é
-- "arquivada" para fins de filtro, mas não deve competir pelas vagas de destaque do painel).
create or replace function public.get_my_sheet_insights() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); today date:=private.sp_today(); result jsonb;
begin
  with activity as materialized (
    select s.id sheet_id,a.date last_date,a.created_at last_registered_at,m.month_days
    from public.workout_sheets s
    left join lateral (
      select w.date,w.created_at from public.workouts w
      where w.user_id=u and w.sheet_id=s.id and w.date<=today
      order by w.date desc,w.created_at desc limit 1
    ) a on true
    left join lateral (
      select count(distinct w.date)::int month_days from public.workouts w
      where w.user_id=u and w.sheet_id=s.id
      and w.date>=date_trunc('month',today)::date and w.date<=today
    ) m on true where s.user_id=u and s.deleted_at is null
  ), summaries as materialized (
    select s.id,s.name,s.goal,s.weekdays,s.sort_order,s.archived_at,
      coalesce(i.exercise_count,0) exercise_count,coalesce(i.available,false) available,
      a.last_date,a.last_registered_at,coalesce(a.month_days,0) month_days,
      exists(select 1 from public.workout_sheet_completions c
        where c.user_id=u and c.sheet_id=s.id and c.business_day=today) completed_today
    from public.workout_sheets s left join activity a on a.sheet_id=s.id
    left join lateral (
      select count(*) exercise_count,bool_and(private.sheet_exercise_available(x.exercise_id,u)) available
      from public.workout_sheet_exercises x where x.sheet_id=s.id
    ) i on true where s.user_id=u and s.deleted_at is null
  ), selected as (
    (select * from summaries where archived_at is null order by sort_order,id limit 40)
    union
    (select * from summaries where last_date is not null order by last_date desc,last_registered_at desc,sort_order,id limit 1)
    union
    (select * from summaries where month_days>0 order by month_days desc,last_date desc,last_registered_at desc,sort_order,id limit 1)
  ) select jsonb_build_object('today',today,'sheets',coalesce(jsonb_agg(to_jsonb(selected) order by sort_order,id),'[]'))
    into result from selected;
  return result;
end $$;
