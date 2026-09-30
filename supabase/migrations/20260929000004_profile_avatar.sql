-- Porta profileAvatarService.js + functions/profile-avatar-service.js (allocate/confirm/
-- remove) pra Supabase. purgeExpired (job agendado, limpeza de allocations abandonadas)
-- NÃO entra aqui -- fica pro mesmo lote de "rotinas agendadas sem equivalente Postgres"
-- já documentado (purgeExpiredPhotos/purgeOrphanedPhotos também estão nessa lista desde
-- que statuses foi migrado). Pelo mesmo motivo, a exclusão IMEDIATA do arquivo anterior
-- que confirm()/remove() faziam no original (bucket.file(previousPath).delete(...)) não
-- acontece aqui -- o arquivo velho fica no Storage (linha marcada 'superseded'/'deleted'
-- em profile_avatar_media) até o job de limpeza existir. Nunca acumula risco de
-- segurança (o arquivo velho não é mais referenciado por avatar_path de ninguém), só
-- custo de storage.
--
-- Cross-referência com profissionais (submittedAvatarMediaId/useProfileAvatar/
-- professionalListingOwnerLocks) do original também NÃO entra aqui -- essa tabela ainda
-- não existe em Postgres (professionais é a PRÓXIMA feature a migrar). Até lá, avatar se
-- comporta como se nenhum profissional jamais estivesse usando essa mídia.
--
-- Rate-limit de alocações (6/hora no original) não precisa mais de um array de
-- timestamps em users.avatarAllocation -- profile_avatar_media já são linhas reais, então
-- "quantas nos últimos 60min" é só um count(*).

create table public.profile_avatar_media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  storage_path text not null,
  state text not null default 'allocated' check (state in ('allocated', 'active', 'superseded', 'deleted')),
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index profile_avatar_media_owner_created_idx on public.profile_avatar_media(owner_id, created_at desc);
create index profile_avatar_media_purge_idx on public.profile_avatar_media(state, created_at)
  where state in ('allocated', 'superseded', 'deleted');
alter table public.profile_avatar_media enable row level security;
-- Leitura: só o dono (ou superadmin) -- precisa disso mesmo sem nenhuma tela ler esta
-- tabela direto, porque a policy de insert em storage.objects abaixo faz um exists()
-- contra ela que roda com o role authenticated: sem select aqui, esse exists() nunca
-- enxerga a própria linha (RLS se aplica à subquery também, não só à query de fora) --
-- mesmo motivo pelo qual status_photos_insert (storage.sql) só funciona porque
-- statuses_select já libera a linha pro autor. Nada sensível aqui (diferente de
-- deletion_jobs/block_reason), então liberar select pro dono é seguro.
create policy profile_avatar_media_select on public.profile_avatar_media for select
  using (owner_id = auth.uid() or public.is_superadmin());
-- insert/update/delete: sem policy pra authenticated -- só as RPCs abaixo (security
-- definer) escrevem nesta tabela.

alter table public.users
  add column if not exists avatar_media_id uuid references public.profile_avatar_media(id),
  add column if not exists avatar_path text;
alter table public.public_profiles
  add column if not exists avatar_media_id uuid references public.profile_avatar_media(id),
  add column if not exists avatar_path text;

-- useCommunityAuthorAvatars precisa saber quando avatar_path muda em tempo real (um
-- listener por autor visível, mesma estratégia do onSnapshot original).
alter publication supabase_realtime add table public.public_profiles;

-- Bucket privado, mesmo padrão de status-photos. Caminho do objeto: {uid}/{mediaId}.webp.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', false, 1048576, array['image/webp'])
on conflict (id) do nothing;

-- Leitura: qualquer autenticado (avatar aparece em feeds/listas de membros de todo
-- mundo) -- loadAvatarBytes no original também não checava dono, só sessão válida.
create policy profile_avatars_read on storage.objects for select
  using (bucket_id = 'profile-avatars' and auth.uid() is not null);

-- Insert: só no caminho já reservado por uma alocação própria recente e ainda
-- 'allocated' -- mesma trava de "escreve na tabela primeiro, cliente sobe o arquivo
-- depois" do status-photos.
create policy profile_avatars_insert on storage.objects for insert
  with check (
    bucket_id = 'profile-avatars'
    and exists (
      select 1 from public.profile_avatar_media m
      where m.storage_path = storage.objects.name
        and m.owner_id = auth.uid()
        and m.state = 'allocated'
        and m.created_at > now() - interval '1 hour'
    )
  );
-- update/delete: sem policy pra authenticated -- limpeza só via service_role (job futuro).

-- Equivalente a allocate(uid). Reaproveita uma alocação pendente ainda dentro da janela
-- (mesmo motivo do original: não queimar cota de rate-limit em cliques repetidos antes
-- do upload acontecer de verdade).
create or replace function public.allocate_profile_avatar() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_pending record;
  v_recent_count integer;
  v_media_id uuid;
  v_path text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select id, storage_path into v_pending from public.profile_avatar_media
    where owner_id = v_uid and state = 'allocated' and created_at > now() - interval '1 hour'
    order by created_at desc limit 1;
  if v_pending.id is not null then
    return jsonb_build_object('mediaId', v_pending.id, 'path', v_pending.storage_path);
  end if;

  select count(*) into v_recent_count from public.profile_avatar_media
    where owner_id = v_uid and created_at > now() - interval '1 hour';
  if v_recent_count >= 6 then
    raise exception 'RATE_LIMITED';
  end if;

  v_media_id := gen_random_uuid();
  v_path := v_uid::text || '/' || v_media_id::text || '.webp';
  insert into public.profile_avatar_media (id, owner_id, storage_path, state)
    values (v_media_id, v_uid, v_path, 'allocated');

  return jsonb_build_object('mediaId', v_media_id, 'path', v_path);
end;
$$;

-- Chamada só pela Edge Function profile-avatar-confirm (service_role), depois de já ter
-- baixado o arquivo do Storage e validado tamanho/tipo/dimensões lá (Postgres não
-- decodifica imagem) -- espelha confirm(uid, mediaId), exceto a parte de
-- professionalListingDrafts (ver nota no topo) e a exclusão imediata do arquivo anterior
-- (ver mesma nota).
create or replace function public.confirm_profile_avatar_internal(
  p_media_id uuid, p_width integer, p_height integer
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_media public.profile_avatar_media;
  v_uid uuid;
  v_previous_media_id uuid;
  v_previous_path text;
  v_username text;
  v_bio text;
begin
  select * into v_media from public.profile_avatar_media where id = p_media_id for update;
  if v_media is null or v_media.state <> 'allocated' then
    raise exception 'UPLOAD_NOT_AUTHORIZED';
  end if;
  v_uid := v_media.owner_id;

  select avatar_media_id, avatar_path, username, bio into v_previous_media_id, v_previous_path, v_username, v_bio
    from public.users where id = v_uid;

  update public.users set
    avatar_media_id = p_media_id, avatar_path = v_media.storage_path
    where id = v_uid;
  insert into public.public_profiles (user_id, username, bio, share_statistics, avatar_media_id, avatar_path)
    values (v_uid, v_username, v_bio, false, p_media_id, v_media.storage_path)
    on conflict (user_id) do update set
      avatar_media_id = excluded.avatar_media_id, avatar_path = excluded.avatar_path;

  update public.profile_avatar_media set
    state = 'active', width = p_width, height = p_height, confirmed_at = now(), updated_at = now()
    where id = p_media_id;

  if v_previous_media_id is not null and v_previous_media_id <> p_media_id then
    update public.profile_avatar_media set state = 'superseded', updated_at = now()
      where id = v_previous_media_id and state = 'active';
  end if;

  return jsonb_build_object('mediaId', p_media_id, 'path', v_media.storage_path);
end;
$$;
revoke execute on function public.confirm_profile_avatar_internal(uuid, integer, integer) from public, anon, authenticated;

-- Equivalente a remove(uid) -- só o lado do banco (ver nota no topo sobre o arquivo em
-- si ficar pra um job de limpeza futuro).
create or replace function public.remove_profile_avatar() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_media_id uuid;
  v_path text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select avatar_media_id, avatar_path into v_media_id, v_path from public.users where id = v_uid;

  update public.users set avatar_media_id = null, avatar_path = null where id = v_uid;
  update public.public_profiles set avatar_media_id = null, avatar_path = null where user_id = v_uid;
  if v_media_id is not null then
    update public.profile_avatar_media set state = 'deleted', updated_at = now() where id = v_media_id;
  end if;

  return jsonb_build_object('removed', true);
end;
$$;
