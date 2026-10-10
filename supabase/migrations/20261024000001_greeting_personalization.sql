-- Mensagens dinâmicas da Home (personalização gramatical + boas-vindas). Toda a escolha de frase é LOCAL no
-- cliente; o banco só guarda dois fatos da própria conta, ambos lidos junto com a linha de public.users que a
-- Home já carrega (nenhuma consulta nova, nenhum canal Realtime novo, nenhum índice: acesso sempre pela PK):
--   greeting_voice             preferência de ESTILO DO TEXTO do cabeçalho (não altera cadastro nem permissões)
--   greeting_welcome_seen_at   instante, definido pelo SERVIDOR, em que as boas-vindas foram vistas (1x/conta)
-- Escrita somente por duas RPCs pequenas, idempotentes e restritas ao próprio auth.uid(); o UPDATE direto do
-- cliente em public.users continua revogado (20261001000001). RLS/grants existentes não são alterados.

alter table public.users
  add column if not exists greeting_voice text not null default 'auto',
  add column if not exists greeting_welcome_seen_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.users'::regclass and conname = 'users_greeting_voice_check'
  ) then
    alter table public.users
      add constraint users_greeting_voice_check
      check (greeting_voice in ('auto', 'masculino', 'feminino', 'neutro'));
  end if;
end $$;

-- Define a preferência. Só os quatro valores exatos; repetir o valor atual não escreve nada.
create or replace function public.set_greeting_voice(p_voice text) returns text
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not coalesce(public.has_app_access(), false) then raise exception 'FORBIDDEN'; end if;
  if p_voice is null or p_voice not in ('auto', 'masculino', 'feminino', 'neutro') then
    raise exception 'INVALID_GREETING_VOICE';
  end if;

  update public.users
     set greeting_voice = p_voice
   where id = v_uid
     and greeting_voice is distinct from p_voice;

  return p_voice;
end;
$$;

-- Confirma as boas-vindas UMA vez por conta. O instante é do servidor (now()); chamadas repetidas ou
-- concorrentes (outro aparelho, reentrada) devolvem o instante original sem gravar de novo: o UPDATE
-- condicional serializa na linha e a segunda chamada reavalia `is null` já com o valor commitado.
create or replace function public.ack_greeting_welcome() returns timestamptz
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_seen timestamptz;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not coalesce(public.has_app_access(), false) then raise exception 'FORBIDDEN'; end if;

  update public.users
     set greeting_welcome_seen_at = now()
   where id = v_uid
     and greeting_welcome_seen_at is null
  returning greeting_welcome_seen_at into v_seen;

  if v_seen is null then
    select greeting_welcome_seen_at into v_seen from public.users where id = v_uid;
  end if;
  return v_seen;
end;
$$;

revoke all on function public.set_greeting_voice(text) from public, anon;
revoke all on function public.ack_greeting_welcome() from public, anon;
grant execute on function public.set_greeting_voice(text) to authenticated;
grant execute on function public.ack_greeting_welcome() to authenticated;
