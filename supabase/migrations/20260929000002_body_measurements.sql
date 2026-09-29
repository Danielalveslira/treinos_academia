-- Porta bodyMeasurementsService.js (Firestore direto, sem Cloud Function) pra Supabase.
-- Leitura: tabela própria com RLS (mesmo padrão de workouts/exercises — dono lê/lista
-- direto, sem RPC). Escrita: uma RPC só (save_body_check_in), porque o original grava
-- height_cm (em users) e a nova medida no MESMO commit atômico (writeBatch) — aqui isso
-- vira uma única transação de função, não dois `supabase.from(...)` separados.

create table public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  date timestamptz not null,
  weight_kg numeric,
  body_fat_percent numeric,
  abdomen_cm numeric,
  waist_cm numeric,
  hip_cm numeric,
  chest_cm numeric,
  arm_cm numeric,
  thigh_cm numeric,
  calf_cm numeric,
  lean_mass_kg numeric,
  fat_mass_kg numeric,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index body_measurements_user_date_idx on public.body_measurements(user_id, date desc);

alter table public.body_measurements enable row level security;
create policy body_measurements_select on public.body_measurements for select
  using (user_id = auth.uid() or public.is_superadmin());

-- Equivalente a saveBodyCheckIn. payload traz só as chaves com valor limpo (mesmo
-- cleanNumber do serviço JS original, mantido no client) — presença de chave = valor
-- válido fornecido. 'heightCm' e 'date' são tratados à parte; o resto (incl. 'note') só
-- vira uma nova linha em body_measurements se pelo menos uma dessas chaves existir —
-- nota sozinha, sem nenhuma medida numérica, ainda cria uma linha (mesmo comportamento
-- do original: hasMeasurement é calculado DEPOIS de 'note' entrar no objeto).
create or replace function public.save_body_check_in(payload jsonb) returns boolean
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_height numeric;
  v_measurement jsonb;
  v_note text;
  v_date timestamptz;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  if payload ? 'heightCm' then
    v_height := (payload->>'heightCm')::numeric;
    if v_height not between 50 and 250 then raise exception 'INVALID_HEIGHT'; end if;
  end if;

  v_measurement := payload - 'heightCm' - 'date';
  if v_height is null and v_measurement = '{}'::jsonb then
    return false;
  end if;

  if v_height is not null then
    update public.users set height_cm = v_height where id = v_uid;
  end if;

  if v_measurement <> '{}'::jsonb then
    if coalesce(payload->>'date', '') = '' then raise exception 'INVALID_DATE'; end if;
    -- Meio-dia em America/Sao_Paulo (não UTC nem o fuso do servidor) -- mesma proteção
    -- do original contra o dia virar o anterior/seguinte só por causa de fuso horário.
    v_date := ((payload->>'date')::date + time '12:00') at time zone 'America/Sao_Paulo';
    v_note := nullif(trim(coalesce(v_measurement->>'note', '')), '');
    if v_note is not null and length(v_note) > 500 then raise exception 'NOTE_TOO_LONG'; end if;

    insert into public.body_measurements (
      user_id, date, weight_kg, body_fat_percent, abdomen_cm, waist_cm, hip_cm,
      chest_cm, arm_cm, thigh_cm, calf_cm, lean_mass_kg, fat_mass_kg, note
    ) values (
      v_uid, v_date,
      (v_measurement->>'weightKg')::numeric, (v_measurement->>'bodyFatPercent')::numeric,
      (v_measurement->>'abdomenCm')::numeric, (v_measurement->>'waistCm')::numeric,
      (v_measurement->>'hipCm')::numeric, (v_measurement->>'chestCm')::numeric,
      (v_measurement->>'armCm')::numeric, (v_measurement->>'thighCm')::numeric,
      (v_measurement->>'calfCm')::numeric, (v_measurement->>'leanMassKg')::numeric,
      (v_measurement->>'fatMassKg')::numeric, v_note
    );
  end if;

  return true;
end;
$$;
