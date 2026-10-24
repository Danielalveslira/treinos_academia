begin;
select no_plan();
create function pg_temp.refs() returns jsonb language sql as $$
  select '{"version":1,"images":[
    {"role":"start","path":"96000000-0000-0000-0000-000000000001/v1/start.webp"},
    {"role":"end","path":"96000000-0000-0000-0000-000000000001/v1/end.webp"}
  ]}'::jsonb;
$$;
select ok(public.catalog_has_complete_images('96000000-0000-0000-0000-000000000001', pg_temp.refs()), 'START e END publicados são completos sem thumbnail');
select ok(not public.catalog_has_complete_images('96000000-0000-0000-0000-000000000001', null), 'null é incompleto');
select ok(not public.catalog_has_complete_images('96000000-0000-0000-0000-000000000001', '{"version":1,"images":[]}'), 'version sozinha não basta');
select ok(not public.catalog_has_complete_images('96000000-0000-0000-0000-000000000001', pg_temp.refs() #- '{images,1}'), 'START sem END é incompleto');
select ok(not public.catalog_has_complete_images('96000000-0000-0000-0000-000000000001', pg_temp.refs() #- '{images,0}'), 'END sem START é incompleto');
select ok(not public.catalog_has_complete_images('96000000-0000-0000-0000-000000000001', jsonb_set(pg_temp.refs(), '{version}', 'null')), 'version null é incompleta');
select ok(not public.catalog_has_complete_images('96000000-0000-0000-0000-000000000001', jsonb_set(pg_temp.refs(), '{version}', '0')), 'version zero é inválida');
select ok(not public.catalog_has_complete_images('96000000-0000-0000-0000-000000000001', jsonb_set(pg_temp.refs(), '{images}', '{}')), 'images malformado não causa erro');
select ok(not public.catalog_has_complete_images('96000000-0000-0000-0000-000000000001', jsonb_set(pg_temp.refs(), '{images,1,path}', '""')), 'caminho vazio é incompleto');
select ok(not public.catalog_has_complete_images('96000000-0000-0000-0000-000000000002', pg_temp.refs()), 'caminhos de outro exercício são inválidos');
select ok(not public.catalog_has_complete_images('96000000-0000-0000-0000-000000000001', jsonb_set(pg_temp.refs(), '{version}', '2')), 'caminhos de outra versão são inválidos');
select finish();
rollback;
