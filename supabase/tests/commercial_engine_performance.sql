-- Local synthetic performance diagnostic, not a pgTAP suite. Always rolled back.
begin;
set local statement_timeout='30s';
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('73600000-0000-0000-0000-000000000001','authenticated','authenticated','commercial-performance@example.invalid','x',now(),'{}','{}',now(),now());
insert into public.commercial_offerings(code,name,description,integration_ready)values('synthetic_performance','Synthetic performance','Local diagnostic fixture',true);
insert into public.commercial_price_versions(id,offering_code,revision,unit_price_cash,min_days,max_days,active_from,created_by,reason)
values('73600000-0000-0000-0000-000000000002','synthetic_performance',1,1,1,30,now(),'73600000-0000-0000-0000-000000000001','Synthetic diagnostic only');
insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,approved_revision,moderation_state)
select md5('commercial-load:'||i)::uuid,'synthetic_performance','73600000-0000-0000-0000-000000000001',1,1,'approved' from generate_series(1,10000)i;
insert into public.commercial_orders(id,payer_user_id,request_id,resource_id,offering_code,price_version_id,content_revision,duration_days,unit_price_cash,total_cash,created_at,quote_expires_at,status,fulfilled_at,period_start,period_end)
select md5('commercial-order:'||i)::uuid,'73600000-0000-0000-0000-000000000001',md5('commercial-request:'||i)::uuid,md5('commercial-load:'||i)::uuid,'synthetic_performance','73600000-0000-0000-0000-000000000002',1,7,1,7,now(),now()+interval '5 minutes','fulfilled',now(),now(),now()+interval '168 hours' from generate_series(1,10000)i;
insert into public.visibility_entitlements(resource_id,origin_order_id,starts_at,expires_at)
select resource_id,id,period_start,period_end from public.commercial_orders where offering_code='synthetic_performance';
insert into public.commercial_order_events(offering_code,order_id,actor_user_id,action,reason)
select offering_code,id,payer_user_id,'quoted','Synthetic diagnostic only' from public.commercial_orders where offering_code='synthetic_performance';
analyze private.commercial_resources;
analyze public.visibility_entitlements;
analyze public.commercial_order_events;
analyze public.commercial_orders;
-- Same server-side eligibility join as the private predicate, explained explicitly.
explain(analyze,buffers) select exists(select 1 from private.commercial_resources r
join public.commercial_offerings f on f.code=r.offering_code join public.users u on u.id=r.owner_user_id
join public.visibility_entitlements e on e.resource_id=r.id
where r.id=md5('commercial-load:5000')::uuid and f.integration_ready and u.account_status='active'
and not exists(select 1 from public.account_restrictions ar where ar.user_id=u.id and not (ar.action='temporary_suspension' and ar.until<=statement_timestamp()))
and r.moderation_state='approved' and r.approved_revision=r.content_revision and e.administrative_state='enabled'
and e.starts_at<=statement_timestamp() and e.expires_at>statement_timestamp());
explain(analyze,buffers) select a.id,o.id,e.id from public.commercial_order_events a
join public.commercial_orders o on o.id=a.order_id left join public.visibility_entitlements e on e.origin_order_id=o.id
where a.action='quoted' order by a.id desc limit 20;
rollback;
