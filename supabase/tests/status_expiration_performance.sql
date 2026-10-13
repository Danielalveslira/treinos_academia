begin;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('94000000-0000-0000-0000-000000000001','authenticated','authenticated','expiry-perf@example.invalid','unused',now(),'{}','{}',now(),now());
insert into public.communities(id,name,created_by) values('95000000-0000-0000-0000-000000000001','Expiry performance','94000000-0000-0000-0000-000000000001');
insert into public.statuses(community_id,author_id,type,text,expires_at)
select '95000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-000000000001','text','synthetic performance',case when n%1000=0 then now()-interval '1 day' else now()+interval '1 day' end from generate_series(1,20000)n;
analyze public.status_expiration_queue;
analyze public.statuses;
explain(analyze,buffers) select st.* from public.status_expiration_queue q join public.statuses st on st.id=q.status_id
where q.next_attempt_at<=now() order by q.next_attempt_at,q.status_id limit 50 for update of st skip locked;
explain(analyze,buffers) select id,publication_expires_at from public.status_publications where community_id='95000000-0000-0000-0000-000000000001' and (publication_expires_at is null or publication_expires_at>now()) order by created_at desc,id desc limit 11;
update public.status_expiration_control set enabled=true;
select public.process_expired_statuses(50);
select deleted,errors,extract(epoch from finished_at-started_at)*1000 duration_ms from public.status_expiration_runs order by id desc limit 1;
rollback;
