-- Confirm destination first. Synthetic transaction only; no rewards or real-user writes.
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
create temp table aud07_smoke_result(result jsonb);
do $$
declare
 uid uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); community uuid:=gen_random_uuid();
 checks integer:=0; before_ledger bigint; before_posts text; before_pending bigint; quota_before integer;
begin
 select count(*) into before_ledger from public.economy_transactions;
 select count(*) into before_pending from public.economy_pending_awards;
 select md5(coalesce(string_agg(row_to_json(s)::text,E'\n' order by id),'')) into before_posts from public.statuses s;
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select id,'authenticated','authenticated','aud07-smoke-'||id||'@example.invalid',now(),'{}','{}',now(),now() from unnest(array[uid,stranger])id;
 update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now() from public.legal_policy p where p.id and u.id in(uid,stranger);
 insert into public.communities(id,name,created_by,owner_id)values(community,'AUD07 transactional smoke',uid,uid);
 insert into public.community_members(community_id,user_id)values(community,uid);
 perform set_config('request.jwt.claim.sub',uid::text,true);
 execute 'set local role authenticated';
 insert into public.statuses(community_id,author_id,type,text) select community,uid,'text','x' from generate_series(1,5);
 checks:=checks+1;
 begin
  insert into public.statuses(community_id,author_id,type,text)values(community,uid,'text','x');
  raise exception 'QUOTA_BYPASS';
 exception when sqlstate 'PT429' then checks:=checks+1; end;
 begin
  perform * from private.status_publication_limits;
  raise exception 'QUOTA_DETAILS_LEAKED';
 exception when insufficient_privilege then checks:=checks+1; end;
 perform set_config('request.jwt.claim.sub',stranger::text,true);
 begin
  insert into public.statuses(community_id,author_id,type,text)values(community,stranger,'text','x');
  raise exception 'MEMBERSHIP_BYPASS';
 exception when insufficient_privilege then checks:=checks+1; end;
 execute 'reset role';
 select minute_count into quota_before from private.status_publication_limits where user_id=uid;
 if quota_before<>5 then raise exception 'INVALID_QUOTA_TOTAL'; end if;
 checks:=checks+1;
 if (select count(*) from public.economy_transactions)<>before_ledger or (select count(*) from public.economy_pending_awards)<>before_pending then raise exception 'SMOKE_REWARD'; end if;
 checks:=checks+1;
 if (select md5(coalesce(string_agg(row_to_json(s)::text,E'\n' order by id),'')) from public.statuses s where s.community_id<>community)<>before_posts then raise exception 'EXISTING_POSTS_CHANGED'; end if;
 checks:=checks+1;
 insert into aud07_smoke_result values(jsonb_build_object('checks',checks,'created',5,'sixth_denied',true,'quota',quota_before,'financial_rewards',0,'existing_posts_unchanged',true,'fixtures','rollback'));
end $$;
select result from aud07_smoke_result;
rollback;
