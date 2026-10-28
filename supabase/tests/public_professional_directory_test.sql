begin;
select no_plan();
update private.commercial_resources set moderation_state='draft' where offering_code in('professional_profile','establishment_profile');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('51000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'public-pro-1@example.invalid', 'unused', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('51000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'public-pro-2@example.invalid', 'unused', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.professional_listings (id, owner_id, kind, lifecycle_state)
values
  ('52000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'professional', 'published'),
  ('52000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000002', 'professional', 'draft');
insert into public.published_professional_listings
  (listing_id, kind, display_name, sort_key, category_key, modality_keys, specialties,
   bio, city, city_key, uf, service_mode, public_contacts, avatar_path, published_version)
values
  ('52000000-0000-0000-0000-000000000001', 'professional', 'Ana Teste', 'ana teste',
   'personal_trainer', array['musculacao'], array['Treino de força'], 'Descrição publicada',
   'São Paulo', 'sao paulo', 'SP', 'online',
   '[{"type":"website","url":"https://example.com"}]'::jsonb, 'published/ana.webp', 1),
  ('52000000-0000-0000-0000-000000000002', 'professional', 'Rascunho', 'rascunho',
   'personal_trainer', array['musculacao'], '{}', 'Nunca divulgar',
   'São Paulo', 'sao paulo', 'SP', 'online', '[]'::jsonb, null, 1);


-- Published rows alone are legacy data, never a paid publication.
select is(public.public_get_professional('52000000-0000-0000-0000-000000000001'),null::jsonb,'legacy publication without a right remains private');
-- Minimal trusted contract fixtures for public-filter tests; actual debit/ledger is exercised
-- by professional_commercial_test.sql and the browser. No financial fixture survives rollback.
insert into public.commercial_price_versions(id,offering_code,revision,unit_price_cash,min_days,max_days,active_from,created_by,reason)
values('52900000-0000-0000-0000-000000000001','professional_profile',1000000,1,1,30,clock_timestamp()-interval '1 second','51000000-0000-0000-0000-000000000001','Synthetic public directory fixture');
insert into public.commercial_orders(id,payer_user_id,request_id,resource_id,offering_code,price_version_id,content_revision,duration_days,unit_price_cash,total_cash,quote_expires_at,status,fulfilled_at,period_start,period_end)
select l.id,l.owner_id,gen_random_uuid(),l.id,'professional_profile','52900000-0000-0000-0000-000000000001',1,1,1,1,clock_timestamp()+interval '5 minutes','fulfilled',clock_timestamp(),statement_timestamp(),statement_timestamp()+interval '24 hours' from public.professional_listings l where l.id in('52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000002');
insert into public.visibility_entitlements(resource_id,origin_order_id,starts_at,expires_at) select id,id,period_start,period_end from public.commercial_orders where id in('52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000002');
update private.commercial_resources set content_revision=1,approved_revision=1,moderation_state='approved' where id in('52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000002');
set local role anon;
select is(jsonb_array_length(public.public_list_professionals('professional')->'items'), 1,
  'anonymous list returns only active published records');
select is(public.public_list_professionals('professional', 'musculacao', 'SP', 'São Paulo', 'online')->'items'->0->>'displayName',
  'Ana Teste', 'server-side filters match published fields');
select is(jsonb_array_length(public.public_list_professionals('professional', 'corrida')->'items'), 0,
  'modality filter excludes nonmatches');
select is(public.public_get_professional('52000000-0000-0000-0000-000000000001')->>'bio',
  'Descrição publicada', 'anonymous detail returns publishable bio');
select is(public.public_get_professional('52000000-0000-0000-0000-000000000002'), null::jsonb,
  'draft state is excluded even if a published row is stale');
select ok(not (public.public_list_professionals('professional')->'items'->0 ? 'ownerId'),
  'projection omits owner ID');
select ok(not (public.public_list_professionals('professional')->'items'->0 ? 'email'),
  'projection omits internal email');
select throws_ok($$ select public.public_list_professionals('professional', null, null, null, null, 0, 21) $$,
  '22023', 'INVALID_ARGUMENT', 'server rejects an oversized page');
select throws_ok($$ select public.public_list_professionals('professional', null, null, null, null, -1, 20) $$,
  '22023', 'INVALID_ARGUMENT', 'server rejects negative offset');
select is(public.public_professional_avatar_visible('published/ana.webp'), false,
  'legacy personal avatar is not exposed as paid commercial media');
reset role;

set local role authenticated;
select is(jsonb_array_length(public.public_list_professionals('professional')->'items'), 1,
  'authenticated caller gets the same public projection');
select is(public.public_get_professional('52000000-0000-0000-0000-000000000002'), null::jsonb,
  'authenticated caller cannot obtain stale draft through public endpoint');
reset role;

update public.professional_listings set lifecycle_state = 'published'
where id = '52000000-0000-0000-0000-000000000002';
set local role anon;
select is(public.public_list_professionals('professional', null, null, null, null, 0, 1)->>'nextOffset',
  '1', 'first limited page provides the next offset');
select is(public.public_list_professionals('professional', null, null, null, null, 1, 1)->'items'->0->>'displayName',
  'Rascunho', 'second page is returned by server-side pagination');
reset role;
update public.professional_listings set lifecycle_state = 'draft'
where id = '52000000-0000-0000-0000-000000000002';

update public.professional_listings set lifecycle_state = 'suspended'
where id = '52000000-0000-0000-0000-000000000001';
set local role anon;
select is(jsonb_array_length(public.public_list_professionals('professional')->'items'), 0,
  'suspension removes listing');
select is(public.public_get_professional('52000000-0000-0000-0000-000000000001'), null::jsonb,
  'suspension removes detail');
select is(public.public_professional_avatar_visible('published/ana.webp'), false,
  'suspension revokes avatar access');
reset role;

update public.professional_listings set lifecycle_state = 'published'
where id = '52000000-0000-0000-0000-000000000001';
insert into public.account_restrictions(user_id, action, until)
values ('51000000-0000-0000-0000-000000000001', 'temporary_suspension', now() + interval '1 day');
set local role anon;
select is(jsonb_array_length(public.public_list_professionals('professional')->'items'), 0,
  'active account restriction hides a listing');
select is(public.public_professional_avatar_visible('published/ana.webp'), false,
  'active account restriction revokes avatar access');
reset role;
delete from public.account_restrictions where user_id = '51000000-0000-0000-0000-000000000001';
update public.users set account_status = 'disabled'
where id = '51000000-0000-0000-0000-000000000001';
set local role anon;
select is(jsonb_array_length(public.public_list_professionals('professional')->'items'), 0,
  'disabled owner is excluded');
select is(public.public_professional_avatar_visible('published/ana.webp'), false,
  'disabled owner avatar is revoked');
reset role;

update public.users set account_status = 'active'
where id = '51000000-0000-0000-0000-000000000001';
delete from public.published_professional_listings
where listing_id = '52000000-0000-0000-0000-000000000001';
set local role anon;
select is(public.public_get_professional('52000000-0000-0000-0000-000000000001'), null::jsonb,
  'unpublished record has no public detail');
select is(public.public_professional_avatar_visible('published/ana.webp'), false,
  'unpublishing revokes avatar access');
reset role;

select * from finish();
rollback;
