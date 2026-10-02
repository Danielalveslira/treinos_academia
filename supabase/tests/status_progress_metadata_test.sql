begin;
select no_plan();

-- ..01 autor  ..02 membro  ..03 não membro
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('91000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-progress@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03']) as n;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest,
  legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id::text like '91000000-%';
insert into public.public_profiles (user_id, username) select id, 'prog' || right(id::text, 2) from public.users where id::text like '91000000-%';
insert into public.communities (id, name, created_by, owner_id) values ('92000000-0000-0000-0000-000000000001', 'Progresso', '91000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000003');
insert into public.community_members (community_id, user_id) values
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001'),
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002');
select public._wallet_credit_coins('91000000-0000-0000-0000-000000000002', 100);
update private.comment_rate_limits set min_interval = interval '0 seconds', burst_limit = 0 where singleton;

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-0000000000' || p, true)$$;
-- Insere uma foto do jeito do app (createPhotoStatus): como o próprio usuário, passando pela RLS (invoker).
create or replace function pg_temp.photo(p_id text, p_kind text default null, p_start date default null, p_end date default null) returns void language sql as
  $f$insert into public.statuses (id, community_id, author_id, type, expires_at, photo_path, photo_caption, progress_kind, progress_period_start, progress_period_end)
     values (('93000000-0000-0000-0000-0000000000' || p_id)::uuid, '92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'photo',
             now() + interval '1 day', 'statusPhotos/92000000-0000-0000-0000-000000000001/93000000-0000-0000-0000-0000000000' || p_id || '.webp',
             'Semana concluída 💪', p_kind, p_start, p_end)$f$;

set local role authenticated;
select pg_temp.as_user('01');

-- === os 5 tipos de progresso entram como foto normal ===
select lives_ok($$select pg_temp.photo('10', 'daily', '2026-10-02', '2026-10-02')$$, 'daily');
select lives_ok($$select pg_temp.photo('11', 'perfect_week', '2026-09-28', '2026-10-04')$$, 'perfect_week');
select lives_ok($$select pg_temp.photo('12', 'week', '2026-09-28', '2026-10-04')$$, 'week');
select lives_ok($$select pg_temp.photo('13', 'month', '2026-10-01', '2026-10-31')$$, 'month');
select lives_ok($$select pg_temp.photo('14', 'quarter', '2026-10-01', '2026-12-31')$$, 'quarter (92 dias)');
select lives_ok($$select pg_temp.photo('15')$$, 'foto comum continua sem metadado');
select is((select count(*)::int from public.statuses where progress_kind is not null), 5, 'cinco publicações de progresso');
select ok((select progress_kind is null and progress_period_start is null and progress_period_end is null from public.statuses where id = '93000000-0000-0000-0000-000000000015'), 'foto comum: todos os campos de progresso nulos');
select is((select type from public.statuses where id = '93000000-0000-0000-0000-000000000012'), 'photo', 'progresso é uma publicação do tipo photo (mesmo pipeline/bucket)');

-- === constraint: formas inválidas são recusadas no banco ===
select throws_ok($$select pg_temp.photo('20', 'year', '2026-01-01', '2026-12-31')$$, '23514', null, 'kind desconhecido recusado');
select throws_ok($$select pg_temp.photo('21', 'week', null::date, null::date)$$, '23514', null, 'kind sem período recusado');
select throws_ok($$select pg_temp.photo('22', null, '2026-10-01'::date, '2026-10-31'::date)$$, '23514', null, 'período sem kind recusado');
select throws_ok($$select pg_temp.photo('23', 'week', '2026-10-04', '2026-09-28')$$, '23514', null, 'fim antes do início recusado');
select throws_ok($$select pg_temp.photo('24', 'quarter', '2026-01-01', '2026-06-30')$$, '23514', null, 'período maior que um trimestre recusado');
select throws_ok($$insert into public.statuses (community_id, author_id, type, expires_at, text, progress_kind, progress_period_start, progress_period_end)
  values ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'text', now() + interval '1 day', 'oi', 'week', '2026-09-28', '2026-10-04')$$,
  '23514', null, 'progresso só existe em publicações de foto (texto recusado)');

-- === RLS: só quem pode publicar na comunidade ===
select pg_temp.as_user('03');
select throws_ok($$select pg_temp.photo('30', 'week', '2026-09-28', '2026-10-04')$$, '42501', null, 'não membro não publica progresso');

-- === feed: curtir e comentar funcionam como em qualquer publicação ===
select pg_temp.as_user('02');
select is((select count(*)::int from public.statuses where progress_kind = 'week'), 1, 'membro enxerga o card de progresso no feed (RLS de leitura)');
select is((select progress_kind from public.statuses where id = '93000000-0000-0000-0000-000000000012'), 'week', 'metadado legível junto da publicação');
reset role;
select pg_temp.as_user('02');
select is((public.cast_vote('93000000-0000-0000-0000-000000000012', 1::smallint) ->> 'action'), 'create', 'curtir um card de progresso funciona');
select is((select positive_vote_count from public.statuses where id = '93000000-0000-0000-0000-000000000012'), 1, 'contador de curtidas do card');
select is((public.cast_vote('93000000-0000-0000-0000-000000000012', null::smallint) ->> 'action'), 'remove', 'descurtir funciona');
select is((select positive_vote_count from public.statuses where id = '93000000-0000-0000-0000-000000000012'), 0, 'contador volta a zero');
select is((public.comment_create('93000000-0000-0000-0000-000000000012', null, 'Parabéns!', '94000000-0000-0000-0000-000000000001')).body, 'Parabéns!', 'comentar um card de progresso funciona');
select is((select comment_count from public.statuses where id = '93000000-0000-0000-0000-000000000012'), 1, 'contador de comentários do card');

-- === exclusão: só o autor (ou moderação); o card some do feed ===
set local role authenticated;
select pg_temp.as_user('02');
delete from public.statuses where id = '93000000-0000-0000-0000-000000000012';
select is((select count(*)::int from public.statuses where id = '93000000-0000-0000-0000-000000000012'), 1, 'outro membro não exclui o card');
select pg_temp.as_user('01');
delete from public.statuses where id = '93000000-0000-0000-0000-000000000012';
select is((select count(*)::int from public.statuses where id = '93000000-0000-0000-0000-000000000012'), 0, 'o autor exclui o próprio card');
reset role;
select is((select count(*)::int from public.post_comments where status_id = '93000000-0000-0000-0000-000000000012'), 0, 'comentários do card excluído saem junto (cascade)');

-- === exclusão de conta: a imagem do card entra na limpeza do Storage como qualquer foto ===
update public.users set role = 'superadmin' where id = '91000000-0000-0000-0000-000000000003';
select pg_temp.as_user('03');
select public.queue_deletion('account', '91000000-0000-0000-0000-000000000001');
create temp table _del as select public.run_deletion_job(id) r from public.deletion_jobs where target_id = '91000000-0000-0000-0000-000000000001';
select ok((select r -> 'photoPaths' @> '["statusPhotos/92000000-0000-0000-0000-000000000001/93000000-0000-0000-0000-000000000011.webp"]'::jsonb from _del), 'worker devolve o caminho do card para limpar do Storage');
select is((select count(*)::int from public.statuses where progress_kind is not null), 0, 'cards de progresso do usuário excluído removidos');

select * from finish();
rollback;
