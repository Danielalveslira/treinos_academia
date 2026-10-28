\ir _helpers/auth_session.sql
begin;
select no_plan();

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '41000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
  'showcase-recovery-test@example.invalid', 'not-used', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);
update public.users set usage_profile = 'professional'
  where id = '41000000-0000-0000-0000-000000000001';
select pg_temp.set_test_user( '41000000-0000-0000-0000-000000000001', true);

insert into public.professional_listings (id, owner_id, kind)
values (
  '42000000-0000-0000-0000-000000000001',
  '41000000-0000-0000-0000-000000000001',
  'professional'
);
insert into public.professional_listing_drafts (
  listing_id, owner_id, kind, display_name, category_key, modality_keys,
  specialties, bio, city, city_key, uf, service_mode, contacts, version
) values (
  '42000000-0000-0000-0000-000000000001',
  '41000000-0000-0000-0000-000000000001',
  'professional', 'Vitrine Teste', 'personal_trainer', array['musculacao'],
  '{}', 'Bio de teste', 'São Paulo', 'sao paulo', 'SP', 'online', '{}'::jsonb, 1
);

select public.save_professional_listing_draft(
  '42000000-0000-0000-0000-000000000001',
  jsonb_build_object(
    'kind', 'professional',
    'displayName', 'Vitrine Teste',
    'categoryKey', 'personal_trainer',
    'modalityKeys', jsonb_build_array('musculacao'),
    'specialties', '[]'::jsonb,
    'bio', 'Bio de teste',
    'city', 'São Paulo',
    'uf', 'SP',
    'serviceMode', 'online',
    'contacts', jsonb_build_object(
      'whatsapp', 'https://wa.me/5511999999999',
      'instagram', 'https://instagram.com/vitrine.teste',
      'website', 'https://vitrine.example.com'
    ),
    'linkedCommunityId', '',
    'useProfileAvatar', false
  ),1
);
select is(
  (select contacts from public.professional_listing_drafts
    where listing_id = '42000000-0000-0000-0000-000000000001'),
  jsonb_build_object(
    'whatsapp', 'https://wa.me/5511999999999',
    'instagram', 'https://instagram.com/vitrine.teste',
    'website', 'https://vitrine.example.com'
  ),
  'save persists every contact in the draft'
);

-- Direct legacy publication is retired; a lost HTTP response is recovered by reading
-- the committed revision, never by creating a second publication operation.
select is((select version from public.professional_listing_drafts where listing_id='42000000-0000-0000-0000-000000000001'),2,'save advances revision once');
select throws_ok($$select public.save_professional_listing_draft('42000000-0000-0000-0000-000000000001','{}',1)$$,'EDITORIAL_REVISION_CONFLICT','retry of stale save cannot overwrite committed draft');
select is((public.get_my_professional_listing('42000000-0000-0000-0000-000000000001')->'draft'->>'version')::int,2,'owner reload recovers authoritative saved version');
select throws_ok($$select public.prepare_professional_listing_publish('42000000-0000-0000-0000-000000000001','old-operation')$$,'EDITORIAL_REVIEW_REQUIRED','legacy prepare cannot self-publish');
select throws_ok($$select public.finalize_professional_listing_publish('42000000-0000-0000-0000-000000000001','old-operation',null,null)$$,'EDITORIAL_REVIEW_REQUIRED','legacy finalize fails closed even for trusted invocation');
select public.set_professional_listing_editorial('42000000-0000-0000-0000-000000000001',2,'submitted');
select throws_ok($$select public.set_professional_listing_editorial('42000000-0000-0000-0000-000000000001',2,'submitted')$$,'EDITORIAL_REVISION_CONFLICT','lost submit response cannot submit a stale revision');
select is((public.get_my_professional_listing('42000000-0000-0000-0000-000000000001')->'draft'->>'version')::int,3,'owner reload recovers authoritative submitted version');
select is((select review_state from public.professional_listing_drafts where listing_id='42000000-0000-0000-0000-000000000001'),'submitted','retry leaves content submitted for moderation');
select is((select count(*)::int from public.published_professional_listings where listing_id='42000000-0000-0000-0000-000000000001'),0,'no public snapshot is created by owner submission');
select is(public.public_get_professional('42000000-0000-0000-0000-000000000001'),null::jsonb,'pending submission remains unavailable publicly');
select is((select count(*)::int from public.commercial_orders where resource_id='42000000-0000-0000-0000-000000000001'),0,'save and retry never create a financial order');
select * from finish();
rollback;
