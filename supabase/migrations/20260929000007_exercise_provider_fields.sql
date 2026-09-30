-- Corrige o bug de UUID em createCatalogExercise (exercisesService.js): a função
-- construía um ID determinístico tipo 'catalog--3_4_Sit-Up' (sobra do padrão de
-- document ID livre do Firestore) e tentava gravá-lo em exercises.id, que é uuid --
-- reproduzido contra Postgres real, dá erro fatal (invalid input syntax for type uuid).
-- Auditoria em produção (Management API, 2026-09-29): 1 linha em exercises no total, 0
-- com source='catalog' -- ninguém nunca adicionou um exercício do catálogo com sucesso,
-- então não há nenhum dado de fato migrar/backfillar aqui.
--
-- Rumo à ExerciseAPI (ver docs/... handoff): catalog_exercise_id vira provider_exercise_id
-- (uuid interno nunca é derivado de um ID externo -- nenhum provedor, por definição, pode
-- ditar o formato da nossa chave primária) e ganha um campo 'provider' companheiro, pra
-- suportar múltiplos provedores no futuro sem reescrever o schema de novo. 'catalog'
-- continua sendo o valor de 'source' que indica "veio de um provedor externo" -- é
-- ortogonal a QUAL provedor (hoje só 'exerciseapi' existe).
--
-- equipment entra como snapshot mínimo (nome apresentado + grupo muscular já eram
-- copiados; equipamento é o terceiro campo explicitamente pedido pra manter um treino
-- antigo compreensível mesmo que a ExerciseAPI mude ou remova o exercício depois) --
-- deliberadamente SEM instructions/images/videos/tips/mistakes/safetyInfo: conteúdo rico
-- do fornecedor fica só em cache local por dispositivo até os termos da ExerciseAPI
-- autorizarem persistência server-side.

alter table public.exercises rename column catalog_exercise_id to provider_exercise_id;
alter table public.exercises drop constraint exercises_catalog_exercise_id_check;
alter table public.exercises add constraint exercises_provider_exercise_id_check
  check (char_length(provider_exercise_id) between 1 and 100);

alter table public.exercises drop constraint exercises_catalog_source_shape;
alter table public.exercises
  add column if not exists provider text check (provider in ('exerciseapi')),
  add column if not exists equipment text check (equipment is null or char_length(equipment) between 1 and 60);
alter table public.exercises add constraint exercises_catalog_source_shape check (
  (source = 'catalog' and provider is not null and provider_exercise_id is not null)
  or (source = 'custom' and provider is null and provider_exercise_id is null)
);

-- Substitui a checagem de duplicidade que dependia do ID determinístico
-- (getCatalogPersonalDocumentId) -- agora é uma constraint de banco de verdade: a mesma
-- conta não pode adicionar o mesmo exercício do mesmo provedor duas vezes.
create unique index exercises_user_provider_exercise_idx
  on public.exercises(user_id, provider, provider_exercise_id)
  where source = 'catalog';

-- ============================================================================
-- Rate limit por usuário do proxy da ExerciseAPI (Edge Function
-- exercise-catalog-proxy) -- mesmo padrão de support_limits/promotion_event_limits:
-- dado operacional nosso, não um espelho do catálogo do fornecedor. Uma linha por
-- usuário (não uma por request) -- contadores de janela fixa (minuto + dia), resetados
-- na leitura quando a janela expira.
-- ============================================================================

create table public.exercise_catalog_proxy_limits (
  user_id uuid primary key references public.users(id) on delete cascade,
  minute_window_start timestamptz not null default now(),
  minute_count integer not null default 0,
  day_window_start date not null default current_date,
  day_count integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.exercise_catalog_proxy_limits enable row level security;
-- server-only: só a Edge Function (service_role) lê/escreve, via a RPC abaixo.

-- Contraparte GLOBAL do limite por usuário: protege a cota real da chave ExerciseAPI
-- (compartilhada por TODOS os usuários) contra o caso "muitos usuários diferentes, cada
-- um dentro do próprio limite, somados estouram o plano". Singleton (id boolean, mesmo
-- padrão de economy_config/showcase_legal_policy) -- só existe uma cota global.
create table public.exercise_catalog_global_limits (
  id boolean primary key default true check (id),
  minute_window_start timestamptz not null default now(),
  minute_count integer not null default 0,
  day_window_start date not null default current_date,
  day_count integer not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.exercise_catalog_global_limits (id) values (true);
alter table public.exercise_catalog_global_limits enable row level security;
-- server-only, mesmo motivo da tabela por usuário acima.

-- Atômica via lock de linha (for update) em AMBAS as tabelas na mesma transação/chamada
-- -- a Edge Function nunca precisa de uma segunda consulta pra checar o orçamento
-- global. Se qualquer um dos dois (usuário ou global) já estiver no teto, nenhum dos
-- dois contadores é incrementado -- uma chamada rejeitada nunca "gasta" cota de
-- ninguém, nem a do usuário nem a global.
create or replace function public.check_exercise_catalog_rate_limit(
  p_user_id uuid, p_minute_cap integer, p_day_cap integer,
  p_global_minute_cap integer, p_global_day_cap integer
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_row public.exercise_catalog_proxy_limits;
  v_global public.exercise_catalog_global_limits;
  v_user_allowed boolean;
  v_global_allowed boolean;
begin
  insert into public.exercise_catalog_proxy_limits (user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  select * into v_row from public.exercise_catalog_proxy_limits where user_id = p_user_id for update;

  if now() - v_row.minute_window_start >= interval '1 minute' then
    v_row.minute_window_start := now();
    v_row.minute_count := 0;
  end if;
  if v_row.day_window_start <> current_date then
    v_row.day_window_start := current_date;
    v_row.day_count := 0;
  end if;
  v_user_allowed := v_row.minute_count < p_minute_cap and v_row.day_count < p_day_cap;

  select * into v_global from public.exercise_catalog_global_limits where id for update;
  if now() - v_global.minute_window_start >= interval '1 minute' then
    v_global.minute_window_start := now();
    v_global.minute_count := 0;
  end if;
  if v_global.day_window_start <> current_date then
    v_global.day_window_start := current_date;
    v_global.day_count := 0;
  end if;
  v_global_allowed := v_global.minute_count < p_global_minute_cap and v_global.day_count < p_global_day_cap;

  if v_user_allowed and v_global_allowed then
    v_row.minute_count := v_row.minute_count + 1;
    v_row.day_count := v_row.day_count + 1;
    v_global.minute_count := v_global.minute_count + 1;
    v_global.day_count := v_global.day_count + 1;
  end if;

  update public.exercise_catalog_proxy_limits set
    minute_window_start = v_row.minute_window_start, minute_count = v_row.minute_count,
    day_window_start = v_row.day_window_start, day_count = v_row.day_count, updated_at = now()
    where user_id = p_user_id;
  update public.exercise_catalog_global_limits set
    minute_window_start = v_global.minute_window_start, minute_count = v_global.minute_count,
    day_window_start = v_global.day_window_start, day_count = v_global.day_count, updated_at = now()
    where id;

  return jsonb_build_object(
    'allowed', v_user_allowed and v_global_allowed,
    'userAllowed', v_user_allowed, 'globalAllowed', v_global_allowed,
    'minuteCount', v_row.minute_count, 'minuteCap', p_minute_cap,
    'dayCount', v_row.day_count, 'dayCap', p_day_cap,
    'globalMinuteCount', v_global.minute_count, 'globalMinuteCap', p_global_minute_cap,
    'globalDayCount', v_global.day_count, 'globalDayCap', p_global_day_cap
  );
end;
$$;
revoke execute on function public.check_exercise_catalog_rate_limit(uuid, integer, integer, integer, integer) from public, anon, authenticated;
