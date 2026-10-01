-- Fase 2 da publicação da Vitrine. finalize_professional_listing_publish (já existe,
-- desde 20260929000005) grava published_professional_listings.avatar_path com o MESMO
-- caminho privado de profile_avatar_media.storage_path -- ela recusa qualquer
-- p_avatar_path diferente do que está gravado pra aquele media_id (AVATAR_AUTHORIZATION_
-- CHANGED), então nunca existiu a ideia de copiar o arquivo pra outro lugar: o design já
-- pronto é reusar o MESMO objeto privado, e deixar a leitura pública condicionada a ele
-- estar referenciado por uma vitrine publicada agora -- não a um prefixo de caminho fixo.
--
-- A vitrine é pública pra qualquer visitante, inclusive sem conta (Termos da Vitrine,
-- seção 2) -- a policy de leitura existente (profile_avatars_read) exige auth.uid() não
-- nulo, então não serve pra isso. Esta policy nova libera select sem sessão, mas só pro
-- exato caminho que uma vitrine publicada está usando agora -- se a vitrine for
-- despublicada (unpublish_professional_listing já DELETA a linha de
-- published_professional_listings) ou trocar de avatar, a referência some e o arquivo
-- volta a ser privado sozinho, sem precisar de nenhuma rotina de limpeza pra isso
-- especificamente (múltiplas policies de select no Postgres se somam com OR, nunca
-- substituem a policy antiga).
create policy profile_avatars_published_read on storage.objects for select
  using (
    bucket_id = 'profile-avatars'
    and exists (
      select 1 from public.published_professional_listings ppl
      where ppl.avatar_path = storage.objects.name
    )
  );
