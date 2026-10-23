\ir _helpers/auth_session.sql
begin;
select plan(17);

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
  )
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

select is(
  public.prepare_professional_listing_publish(
    '42000000-0000-0000-0000-000000000001', 'operation-1'
  )->>'resumed',
  'false',
  'first prepare starts a new operation'
);
select results_eq(
  $$select review_state, publishing_operation_id
      from public.professional_listing_drafts
      where listing_id = '42000000-0000-0000-0000-000000000001'$$,
  $$values ('publishing'::text, 'operation-1'::text)$$,
  'prepare stores the operation lock'
);
select is(
  public.prepare_professional_listing_publish(
    '42000000-0000-0000-0000-000000000001', 'operation-1'
  )->>'resumed',
  'true',
  'the same interrupted operation resumes immediately'
);

select public.abort_professional_listing_publish(
  '42000000-0000-0000-0000-000000000001', 'operation-1'
);
select results_eq(
  $$select review_state, publishing_operation_id
      from public.professional_listing_drafts
      where listing_id = '42000000-0000-0000-0000-000000000001'$$,
  $$values ('draft'::text, null::text)$$,
  'abort releases its own operation'
);

select public.prepare_professional_listing_publish(
  '42000000-0000-0000-0000-000000000001', 'operation-2'
);
select public.abort_professional_listing_publish(
  '42000000-0000-0000-0000-000000000001', 'operation-1'
);
select is(
  (select publishing_operation_id from public.professional_listing_drafts
    where listing_id = '42000000-0000-0000-0000-000000000001'),
  'operation-2',
  'a late abort cannot clear a newer operation'
);

select is(
  public.finalize_professional_listing_publish(
    '42000000-0000-0000-0000-000000000001', 'operation-2', null, null
  )->>'repeated',
  'false',
  'first finalize writes the publication'
);
select is(
  (select lifecycle_state from public.professional_listings
    where id = '42000000-0000-0000-0000-000000000001'),
  'published',
  'finalize marks the listing published'
);
select is(
  (select count(*)::integer from public.published_professional_listings
    where listing_id = '42000000-0000-0000-0000-000000000001'),
  1,
  'finalize creates exactly one projection'
);
select ok(
  (select public_contacts @> jsonb_build_array(
      jsonb_build_object('type', 'whatsapp', 'url', 'https://wa.me/5511999999999'),
      jsonb_build_object('type', 'instagram', 'url', 'https://instagram.com/vitrine.teste'),
      jsonb_build_object('type', 'website', 'url', 'https://vitrine.example.com')
    )
    from public.published_professional_listings
    where listing_id = '42000000-0000-0000-0000-000000000001'),
  'finalize publishes all saved contacts'
);
select is(
  public.finalize_professional_listing_publish(
    '42000000-0000-0000-0000-000000000001', 'operation-2', null, null
  )->>'repeated',
  'true',
  'finalize retry is idempotent'
);
select is(
  (select count(*)::integer from public.published_professional_listings
    where listing_id = '42000000-0000-0000-0000-000000000001'),
  1,
  'idempotent finalize does not duplicate the projection'
);
select is(
  public.prepare_professional_listing_publish(
    '42000000-0000-0000-0000-000000000001', 'operation-2'
  )->>'repeated',
  'true',
  'prepare recognizes an operation that already finalized'
);

update public.professional_listing_drafts set
  version = 2,
  review_state = 'publishing',
  publishing_operation_id = 'stale-operation',
  publishing_started_at = now() - interval '5 minutes'
where listing_id = '42000000-0000-0000-0000-000000000001';
select is(
  public.prepare_professional_listing_publish(
    '42000000-0000-0000-0000-000000000001', 'replacement-operation'
  )->>'resumed',
  'false',
  'a new operation atomically replaces a stale lock'
);
select is(
  (select publishing_operation_id from public.professional_listing_drafts
    where listing_id = '42000000-0000-0000-0000-000000000001'),
  'replacement-operation',
  'stale recovery stores only the replacement operation'
);
select throws_ok(
  $$select public.prepare_professional_listing_publish(
      '42000000-0000-0000-0000-000000000001', 'competing-operation'
    )$$,
  'PUBLISH_IN_PROGRESS',
  'a different operation cannot steal a fresh lock'
);

select public.abort_professional_listing_publish(
  '42000000-0000-0000-0000-000000000001', 'replacement-operation'
);
select is(
  (select review_state from public.professional_listing_drafts
    where listing_id = '42000000-0000-0000-0000-000000000001'),
  'draft',
  'replacement operation can be safely aborted'
);

select * from finish();
rollback;
