\ir _helpers/auth_session.sql
begin;
select no_plan();
-- Isolate from committed synthetic preview fixtures. Every change rolls back.
delete from public.sponsored_ads where is_global;

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('76900000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','ads-rotation-'||i||'@example.invalid','x',now(),'{}','{}',now(),now() from generate_series(1,2)i;
update public.users set role='superadmin' where id='76900000-0000-0000-0000-000000000002';
create function pg_temp.rot_admin() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('76900000-0000-0000-0000-000000000002',true);
end$$;
create function pg_temp.rot_viewer() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('76900000-0000-0000-0000-000000000001',true);
end$$;

select pg_temp.rot_admin();
set local role authenticated;
-- 5 campanhas legadas (globais, sem contrato comercial) igualmente elegíveis -- nenhum ID,
-- ordem de criação ou nome deveria pesar na amostra.
insert into public.sponsored_ads(id,partner_name,title,is_global,display_mode,created_by)
select ('76910000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'Marca '||i,'Campanha '||i,true,array['banner'],'76900000-0000-0000-0000-000000000002'
from generate_series(1,5)i;
-- Uma campanha já vencida: nunca deve aparecer na amostra, mesmo sendo global.
insert into public.sponsored_ads(id,partner_name,title,is_global,display_mode,expires_at,created_by)
values('76920000-0000-0000-0000-000000000001','Marca vencida','Campanha vencida',true,array['banner'],statement_timestamp()-interval '1 hour','76900000-0000-0000-0000-000000000002');
reset role;

select pg_temp.rot_viewer();
set local role authenticated;

select is(
  (select display_limit from public.advertising_placements where code='home_banner'),
  4,
  'home_banner passa a amostrar mais de 1 candidato por chamada (rotação real no client)'
);
select is(
  (select display_limit from public.advertising_placements where code='community_feed'),
  1,
  'community_feed não é alterado por esta migration (cada linha retornada é um card próprio no feed)'
);

select is(jsonb_array_length(public.select_advertising('home_banner',null)),4,'amostra respeita display_limit mesmo com mais candidatos elegíveis');
select is(
  (select (x->>'eligible_total')::integer from jsonb_array_elements(public.select_advertising('home_banner',null)) x limit 1),
  5,
  'eligible_total conta os 5 elegíveis reais, não os 4 retornados nesta amostra'
);
select ok(
  not exists(select 1 from jsonb_array_elements(public.select_advertising('home_banner',null)) x where x->>'id'='76920000-0000-0000-0000-000000000001'),
  'campanha vencida nunca aparece na amostra'
);

-- Distribuição: cada uma das 5 campanhas igualmente elegíveis deve, ao longo de muitas
-- chamadas, às vezes entrar e às vezes ficar de fora da amostra de 4 -- não exigimos
-- proporção exata (amostra aleatória pequena), só ausência de favorecimento sistemático
-- (nenhuma sempre dentro, nenhuma sempre fora) e uma dispersão compatível com seleção
-- uniforme (ORDER BY random()), não com viés de ID/ordem/posição.
create temp table rot_tally(ad_id uuid primary key,hits integer not null default 0);
insert into rot_tally(ad_id) select ('76910000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,5)i;
do $$
declare trial_count integer:=300; i integer; row_id uuid; begin
 for i in 1..trial_count loop
  for row_id in select (x->>'id')::uuid from jsonb_array_elements(public.select_advertising('home_banner',null)) x loop
   update rot_tally set hits=hits+1 where ad_id=row_id;
  end loop;
 end loop;
end $$;
-- p=4/5 por chamada, 300 chamadas: média esperada 240, desvio-padrão binomial ~6.9.
-- Banda de ±60 (~8.7 desvios) só falha com favorecimento grosseiro (ex.: uma campanha
-- sempre excluída ou sempre incluída), nunca por ruído estatístico normal.
select ok((select min(hits) from rot_tally)>180,'nenhuma campanha é sistematicamente excluída da amostra (mínimo de aparições acima do esperado por acaso)');
select ok((select max(hits) from rot_tally)<300,'nenhuma campanha aparece em 100% das chamadas (sempre há chance real de ficar de fora, provando que a amostra não está fixa em 4 favoritos)');
select ok((select max(hits)-min(hits) from rot_tally)<120,'dispersão entre as campanhas é compatível com seleção uniforme, não com favoritismo por id/ordem/posição');
drop table rot_tally;

select * from finish();
rollback;
