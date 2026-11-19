-- Achado do teste de isolamento do P1 (scripts/homolog/verify-auth-session-isolation.mjs):
-- auth.uid() não é nulo numa sessão de cadastro/recuperação (auth_signup/auth_recovery), só
-- numa sessão sem nenhum JWT. As duas leituras abaixo ainda usavam esse teste como se fosse
-- "qualquer pessoa com conta", deixando uma sessão restrita ler avatares e capas de comunidade
-- antes de qualquer prova de senha ou conclusão de onboarding.
drop policy if exists profile_avatars_read on storage.objects;
create policy profile_avatars_read on storage.objects for select
  using (bucket_id = 'profile-avatars' and public.has_app_access());

drop policy if exists community_covers_read on storage.objects;
create policy community_covers_read on storage.objects for select
  using (bucket_id = 'community-covers' and public.has_app_access());
