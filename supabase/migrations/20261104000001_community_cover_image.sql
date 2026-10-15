-- Capa visual do cartão de "Explorar comunidades" (ver Communities.jsx / CommunityExploreCard.jsx).
-- Sem tabela de mídia nova (diferente de profile_avatar_media): a capa não precisa de
-- allocation/confirm nem de validação de dimensão no servidor -- é só uma coluna em
-- communities, mesma lógica de dono/superadmin que communities_update já aplica, com
-- caminho determinístico {communityId}.webp (um arquivo por comunidade, sempre
-- sobrescrito via upsert). Arquivo antigo ao trocar a capa fica órfão no Storage, mesma
-- lacuna já documentada em profile_avatar_media (limpeza é um job futuro, não risco de
-- segurança -- o caminho velho nunca mais é referenciado por nenhum cover_path).
alter table public.communities add column if not exists cover_path text;

-- Privado (como todo bucket do app), mas de leitura ampla: a capa aparece em "Explorar
-- comunidades" ANTES de entrar, igual nome/descrição/ícone (communities_select já não
-- restringe por membership) -- só exige sessão válida, mesmo padrão de profile-avatars.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-covers', 'community-covers', false, 4194304, array['image/webp'])
on conflict (id) do nothing;

create policy community_covers_read on storage.objects for select
  using (bucket_id = 'community-covers' and auth.uid() is not null);

-- Insert/update: só quem já poderia dar update() na própria comunidade (dono ou
-- superadmin, communities_update) -- e só no caminho que já é o dela, nunca no de outra.
create policy community_covers_insert on storage.objects for insert
  with check (
    bucket_id = 'community-covers'
    and exists (
      select 1 from public.communities c
      where c.id::text || '.webp' = storage.objects.name
        and (public.is_superadmin() or public.is_community_owner(c.id))
    )
  );
create policy community_covers_update on storage.objects for update
  using (
    bucket_id = 'community-covers'
    and exists (
      select 1 from public.communities c
      where c.id::text || '.webp' = storage.objects.name
        and (public.is_superadmin() or public.is_community_owner(c.id))
    )
  );
