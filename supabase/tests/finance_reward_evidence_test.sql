\ir _helpers/auth_session.sql
begin;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('f5000000-0000-0000-0000-000000000001','authenticated','authenticated','evidence-one@example.invalid','x',now(),'{}','{}',now(),now());
select pg_temp.set_test_user('f5000000-0000-0000-0000-000000000001',true);
insert into public.community_creation_activity_days(user_id,activity_date,qualified_seconds,qualified,checkpoints_count,last_checkpoint_at)
values('f5000000-0000-0000-0000-000000000001',private.sp_today(),1800,false,5,now()-interval '3 minutes');
select is(public.register_qualified_activity()->>'granted','false','elapsed heartbeat alone cannot grant');
select is((select qualified from public.community_creation_activity_days where user_id=auth.uid()),false,'elapsed time alone cannot unlock community day');
select is((select count(*)::integer from public.economy_transactions where user_id=auth.uid()),0,'heartbeat does not create credit');
select is(private.post_is_rewardable(jsonb_populate_record(null::public.statuses,'{"type":"photo","photo_path":"missing.webp"}')),false,'missing storage media not rewardable');
select is(private.post_is_rewardable(jsonb_populate_record(null::public.statuses,'{"type":"workout","author_id":"f5000000-0000-0000-0000-000000000001","workout_date":"2026-10-23T12:00:00Z"}')),false,'nonexistent workout not rewardable');
insert into public.communities(id,name,created_by,owner_id) values('f5000000-0000-0000-0000-000000000010','Evidence community',auth.uid(),auth.uid());
insert into public.community_members(community_id,user_id) values('f5000000-0000-0000-0000-000000000010',auth.uid());
insert into public.statuses(id,community_id,author_id,type,text) values
('f5000000-0000-0000-0000-000000000020','f5000000-0000-0000-0000-000000000010',auth.uid(),'text','Hoje fiz um treino consistente de pernas e corrida'),
('f5000000-0000-0000-0000-000000000021','f5000000-0000-0000-0000-000000000010',auth.uid(),'text','Hoje fiz um treino consistente de pernas e corrida');
update public.economy_pending_awards set due_at=now()-interval '1 second' where user_id=auth.uid();
select private.settle_pending_awards();
select is((select count(*)::integer from public.economy_transactions where user_id=auth.uid() and reason='post_published'),1,'repeated content rewarded once across resource IDs');
select is(public.register_qualified_activity()->>'granted','true','verified business event plus time allows legitimate activity');
select is((select sum(amount)::integer from public.economy_transactions where user_id=auth.uid()),4,'one real post plus activity, cap preserved');
update public.users set account_status='disabled' where id=auth.uid();
select is(private.award_evocoins(auth.uid(),'support_received','blocked-direct','test','blocked')->>'reason','account_unavailable','central engine revalidates account access');
update public.users set role='superadmin' where id=auth.uid();
select is(private.award_evocoins(auth.uid(),'support_received','allowed-admin','test','allowed')->>'awardedCoins','1','existing superadmin standing exception preserved');
select * from finish();
rollback;
