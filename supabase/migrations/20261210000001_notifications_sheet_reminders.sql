-- Notificações: lembretes ligados às fichas, controle único de Push e reembolso sem autonotificação.
-- Forward-only e aditiva: não altera jobs, notificações nem entregas já existentes.
-- Rollback: reaplicar as definições anteriores de private.dispatch_due_workout_reminders
-- (20261126000001) e private.notify_refund_event (20261207000001); remover o trigger
-- push_preferences_single_switch e a função private.planned_sheets_for_day.
set local lock_timeout = '5s';

-- 1) Ficha do dia: somente associação EXPLÍCITA (workout_sheets.weekdays, 0 = domingo, mesmo padrão
-- do frontend), da própria conta, não arquivada, com exercícios e todos disponíveis (mesma regra de
-- complete_workout_sheet). Nenhuma inferência por histórico ou recomendação.
create or replace function private.planned_sheets_for_day(p_user_id uuid, p_day date)
returns table (sheet_id uuid, sheet_name text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name
  from public.workout_sheets s
  where s.user_id = p_user_id
    and s.archived_at is null
    and extract(dow from p_day)::smallint = any (s.weekdays)
    and exists (select 1 from public.workout_sheet_exercises x where x.sheet_id = s.id)
    and not exists (select 1 from public.workout_sheet_exercises x
      where x.sheet_id = s.id and not private.sheet_exercise_available(x.exercise_id, p_user_id))
  order by s.sort_order, s.id
  limit 8
$$;
revoke all on function private.planned_sheets_for_day(uuid, date) from public, anon, authenticated;

-- 2) O lembrete "1 hora antes" não pode chegar no horário do treino ainda dizendo "daqui a 1 hora".
update private.notification_catalog set ttl_seconds = 1800 where type = 'workout_reminder_before';

-- 3) Despacho: mesma elegibilidade de 20261126000001 (plano, fuso, dia de treino, sem treino já
-- registrado no dia, atraso máximo de 15 minutos). A ficha é resolvida NO DESPACHO, então
-- arquivar/esvaziar/renomear uma ficha depois do agendamento nunca gera um nome obsoleto.
-- Uma ficha: nome e destino direto para a execução. Várias: só a contagem e o seletor /treinar.
create or replace function private.dispatch_due_workout_reminders(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_job public.workout_reminder_jobs;
  v_plan jsonb;
  v_names text[] := array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  v_id bigint;
  v_count integer := 0;
  v_variant integer;
  v_sheets integer;
  v_sheet_id uuid;
  v_sheet_name text;
  v_metadata jsonb;
  v_url text;
  v_dedupe text;
begin
  for v_job in select * from public.workout_reminder_jobs
    where status = 'pending' and scheduled_at <= now()
    order by scheduled_at, id limit least(greatest(p_limit, 1), 100) for update skip locked
  loop
    select training_preferences into v_plan from public.users
      where id = v_job.user_id and account_status not in ('disabled','deleting');
    if v_plan is null or coalesce((v_plan->>'reminderEnabled')::boolean, false) is not true
      or v_plan->>'timezone' is distinct from v_job.timezone
      or v_job.planned_date < coalesce((v_plan->>'effectiveFrom')::date, v_job.planned_date)
      or not coalesce((v_plan->'plannedTrainingDays') ? v_names[extract(isodow from v_job.planned_date)::int], false)
      or v_job.scheduled_at < now() - interval '15 minutes'
      or exists (select 1 from public.workouts w where w.user_id = v_job.user_id and w.date = v_job.planned_date)
    then
      update public.workout_reminder_jobs set status = 'skipped', processed_at = now() where id = v_job.id;
    else
      v_id := null;
      v_sheet_id := null;
      v_sheet_name := null;
      v_variant := ((v_job.planned_date - date '2000-01-01')::bigint + (abs(hashtext(v_job.user_id::text)) % 997))::int;
      v_metadata := jsonb_build_object('plannedDate', v_job.planned_date, 'reminderKind', v_job.kind,
        'variant', v_variant);
      v_url := '/treinar?planejado=' || v_job.planned_date::text;
      -- Isolado: falha ao resolver a ficha nunca impede o lembrete genérico.
      begin
        select count(*)::int, (array_agg(p.sheet_id))[1], (array_agg(p.sheet_name))[1]
          into v_sheets, v_sheet_id, v_sheet_name
          from private.planned_sheets_for_day(v_job.user_id, v_job.planned_date) p;
        if v_sheets = 1 then
          v_metadata := v_metadata || jsonb_build_object('sheetId', v_sheet_id, 'sheetName', v_sheet_name);
          v_url := '/novo-treino?ficha=' || v_sheet_id::text || '&planejado=' || v_job.planned_date::text;
        elsif v_sheets > 1 then
          v_metadata := v_metadata || jsonb_build_object('sheetCount', least(v_sheets, 7));
        end if;
      exception when others then
        raise warning '[Reminders] sheet lookup skipped (%)', sqlstate;
      end;
      v_dedupe := 'workout-reminder:' || v_job.planned_date::text || ':' || v_job.kind || ':'
        || extract(epoch from v_job.scheduled_at)::bigint::text;
      insert into public.notifications (recipient_id, type, priority, entity_type, action_url, metadata, dedupe_key)
      values (v_job.user_id,
        (case when v_job.kind = 'before' then 'workout_reminder_before' else 'workout_reminder_start' end)::public.notification_type,
        'normal', 'weekly_training_plan', v_url, v_metadata, v_dedupe)
      on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing
      returning id into v_id;
      if v_id is null then
        select id into v_id from public.notifications
          where recipient_id = v_job.user_id and dedupe_key = v_dedupe;
      end if;
      update public.workout_reminder_jobs set status = 'sent', processed_at = now(), notification_id = v_id
        where id = v_job.id;
      if v_id is not null then v_count := v_count + 1; end if;
      -- O lembrete do horário substitui o "1 hora antes" ainda não lido na Central (o aparelho já
      -- faz o mesmo pela tag): um treino, um aviso pendente.
      if v_job.kind = 'start' and v_id is not null then
        update public.notifications n set read_at = now()
          where n.recipient_id = v_job.user_id and n.type = 'workout_reminder_before'
            and n.read_at is null and n.metadata->>'plannedDate' = v_job.planned_date::text;
      end if;
    end if;
    perform private.schedule_next_workout_reminder(v_job.user_id, v_job.kind, greatest(now(), v_job.scheduled_at) + interval '1 second');
  end loop;
  return v_count;
end;
$$;
revoke all on function private.dispatch_due_workout_reminders(integer) from public, anon, authenticated;
grant execute on function private.dispatch_due_workout_reminders(integer) to service_role;

-- 4) Um único controle de Push: categorias não têm interface própria, então nenhuma pode continuar
-- silenciada depois que a pessoa ativa as notificações. Tipos sem Push (catalog.push = false),
-- alertas críticos e a revogação por dispositivo continuam intactos.
create or replace function private.push_preferences_single_switch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.enabled and (tg_op = 'INSERT' or not old.enabled) then
    new.categories := '{"social":true,"communities":true,"economy":true,"workouts":true,"account":true,"administrative":true}'::jsonb;
  end if;
  return new;
end;
$$;
revoke all on function private.push_preferences_single_switch() from public, anon, authenticated;
drop trigger if exists push_preferences_single_switch on public.push_notification_preferences;
create trigger push_preferences_single_switch before insert or update of enabled
  on public.push_notification_preferences for each row
  execute function private.push_preferences_single_switch();

-- Só contas que já ativaram e ficaram com alguma categoria desligada (nenhuma interface atual grava
-- categorias). Contas com Push desligado não mudam: a próxima ativação passa pelo trigger acima.
update public.push_notification_preferences
  set categories = '{"social":true,"communities":true,"economy":true,"workouts":true,"account":true,"administrative":true}'::jsonb,
      updated_at = now()
  where enabled and exists (select 1 from jsonb_each_text(categories) c where c.value = 'false');

-- 5) Reembolso: quem executou a ação (abrir, cancelar) não recebe aviso da própria ação. Metadata
-- continua vazia (sem valor, motivo nem status); Push e Central reconhecem o reembolso pelo destino.
create or replace function private.notify_refund_event() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.refund_requests;
begin
 select * into r from public.refund_requests where id=new.request_id;
 if r.requester_id is distinct from new.actor_id then
  insert into public.notifications(recipient_id,type,entity_type,entity_id,action_url,metadata,dedupe_key)
  values(r.requester_id,'report_resolved','refund_request',r.id,'/evocash?solicitacoes=1&request='||r.id,
   '{}','refund-event:'||new.id);
 end if;
 perform private.notify_superadmins('admin_appeal','normal','refund_request',r.id,'/admin/compras-evocash?tab=refunds',
 '{}','refund-admin:'||new.id,new.actor_id);
 return new;
end $$;
revoke all on function private.notify_refund_event() from public,anon,authenticated,service_role;
