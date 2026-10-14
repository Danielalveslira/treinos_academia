-- Confirm destination before execution. Only new synthetic rows; everything rolls
-- back. Real database roles/RLS, no rewards, no existing users/votes modified.
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
create temp table aud03_smoke_result(result jsonb);
do $$
declare
  owner_id uuid:=gen_random_uuid(); voter_id uuid:=gen_random_uuid(); stranger_id uuid:=gen_random_uuid();
  community_id uuid:=gen_random_uuid(); poll_id uuid:=gen_random_uuid(); expired_id uuid:=gen_random_uuid();
  checks integer:=0; n integer; original_votes text; financial_count bigint;
begin
  select md5(coalesce(string_agg(row_to_json(v)::text,E'\n' order by status_id,user_id),'')) into original_votes from public.status_votes v;
  select count(*) into financial_count from public.economy_transactions;
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    select id,'authenticated','authenticated','aud03-smoke-'||id||'@example.invalid',now(),'{}','{}',now(),now()
    from unnest(array[owner_id,voter_id,stranger_id]) id;
  update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now()
    from public.legal_policy p where p.id and p.published and u.id=any(array[owner_id,voter_id,stranger_id]);
  insert into public.communities(id,name,created_by,owner_id) values(community_id,'AUD03 transactional smoke',owner_id,owner_id);
  insert into public.community_members(community_id,user_id) values(community_id,voter_id);
  insert into public.statuses(id,community_id,author_id,type,expires_at,poll_question,poll_options)
    values(poll_id,community_id,owner_id,'poll',now()+interval '1 day','AUD03 smoke?','[{"id":"a","label":"A"},{"id":"b","label":"B"}]'),
      (expired_id,community_id,owner_id,'poll',now()-interval '1 day','AUD03 expired?','[{"id":"a","label":"A"},{"id":"b","label":"B"}]');
  perform set_config('request.jwt.claim.sub',stranger_id::text,true);
  execute 'set local role authenticated';
  begin
    insert into public.status_votes(status_id,user_id,option_id) values(poll_id,stranger_id,'a');
    raise exception 'SMOKE_NONMEMBER_ACCEPTED';
  exception when insufficient_privilege then checks:=checks+1; end;
  begin
    insert into public.status_votes(status_id,user_id,option_id) values(poll_id,stranger_id,'invented');
    raise exception 'SMOKE_PRIVATE_OPTION_REVEALED';
  exception when insufficient_privilege then checks:=checks+1; end;
  if exists(select 1 from public.get_poll_results_batch(array[poll_id])) then raise exception 'SMOKE_PRIVATE_RESULTS_LEAKED'; end if;
  checks:=checks+1;
  perform set_config('request.jwt.claim.sub',voter_id::text,true);
  begin
    insert into public.status_votes(status_id,user_id,option_id) values(poll_id,voter_id,'invented');
    raise exception 'SMOKE_INVALID_OPTION_ACCEPTED';
  exception when check_violation then checks:=checks+1; end;
  begin
    insert into public.status_votes(status_id,user_id,option_id) values(expired_id,voter_id,'a');
    raise exception 'SMOKE_EXPIRED_VOTE_ACCEPTED';
  exception when insufficient_privilege then checks:=checks+1; end;
  begin
    insert into public.status_votes(status_id,user_id,option_id) values(poll_id,owner_id,'a');
    raise exception 'SMOKE_THIRD_PARTY_ACCEPTED';
  exception when insufficient_privilege then checks:=checks+1; end;
  insert into public.status_votes(status_id,user_id,option_id) values(poll_id,voter_id,'a');
  if not exists(select 1 from public.status_votes where status_id=poll_id and user_id=voter_id and option_id='a') then raise exception 'SMOKE_LEGITIMATE_VOTE_FAILED'; end if;
  checks:=checks+1;
  begin
    insert into public.status_votes(status_id,user_id,option_id) values(poll_id,voter_id,'a');
    raise exception 'SMOKE_DUPLICATE_ACCEPTED';
  exception when unique_violation then checks:=checks+1; end;
  insert into public.status_votes(status_id,user_id,option_id) values(poll_id,voter_id,'b')
    on conflict(status_id,user_id) do update set status_id=excluded.status_id,user_id=excluded.user_id,option_id=excluded.option_id;
  if (select sum(votes) from public.get_poll_results(poll_id))<>1 then raise exception 'SMOKE_SWAP_TOTAL'; end if;
  checks:=checks+1;
  begin
    update public.status_votes set option_id='invented' where status_id=poll_id;
    raise exception 'SMOKE_INVALID_UPDATE_ACCEPTED';
  exception when check_violation then checks:=checks+1; end;
  begin
    update public.status_votes set user_id=owner_id where status_id=poll_id;
    raise exception 'SMOKE_IDENTITY_UPDATE_ACCEPTED';
  exception when check_violation then checks:=checks+1; end;
  delete from public.status_votes where status_id=poll_id;
  if exists(select 1 from public.get_poll_results(poll_id)) then raise exception 'SMOKE_CANCEL_TOTAL'; end if;
  checks:=checks+1;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub','',true);
  execute 'set local role anon';
  begin
    perform * from public.status_votes;
    raise exception 'SMOKE_ANON_READ_ACCEPTED';
  exception when insufficient_privilege then checks:=checks+1; end;
  begin
    perform * from public.get_poll_results(poll_id);
    raise exception 'SMOKE_ANON_RPC_ACCEPTED';
  exception when insufficient_privilege then checks:=checks+1; end;
  execute 'reset role';
  if (select count(*) from public.economy_transactions)<>financial_count then raise exception 'SMOKE_FINANCIAL_REWARD'; end if;
  checks:=checks+1;
  if (select md5(coalesce(string_agg(row_to_json(v)::text,E'\n' order by status_id,user_id),'')) from public.status_votes v)<>original_votes then raise exception 'SMOKE_EXISTING_VOTES_CHANGED'; end if;
  checks:=checks+1;
  insert into aud03_smoke_result values(jsonb_build_object('checks',checks,'legitimate_vote',true,'existing_votes_unchanged',true,'financial_rewards',0,'fixtures','transactional rollback'));
end $$;
select result from aud03_smoke_result;
rollback;
