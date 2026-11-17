\ir _helpers/auth_session.sql
begin;
select plan(12);
select is(private.catalog_personal_muscle_group('forca','isquiotibiais'),'Pernas','isquiotibiais seguem Pernas');
select is(private.catalog_personal_muscle_group('forca','quadriceps'),'Pernas','quadriceps seguem Pernas');
select is(private.catalog_personal_muscle_group('forca','dorsais'),'Costas','dorsais seguem Costas');
select is(private.catalog_personal_muscle_group('cardio','quadriceps'),'Cardio','cardio prevalece sobre músculo principal');
select is(private.catalog_personal_muscle_group('forca','panturrilhas'),'Panturrilha','panturrilhas mantêm o grupo');
select is(private.catalog_personal_muscle_group('forca','biceps'),'Bíceps','biceps mantêm o grupo');
select is(private.catalog_personal_muscle_group('forca','triceps'),'Tríceps','triceps mantêm o grupo');
select is(private.catalog_personal_muscle_group('forca','gluteos'),'Glúteos','gluteos mantêm o grupo');
select is(private.catalog_personal_muscle_group('forca','abdominais'),'Abdômen','abdominais mantêm o grupo');
select is(private.catalog_personal_muscle_group('forca','novo-musculo'),'Outros','músculo não mapeado tem fallback explícito');
select is(private.catalog_personal_muscle_group('forca','chest'),'Peito','origem legada inglesa usa a mesma taxonomia');
select is(private.catalog_personal_muscle_group('forca',null),'Outros','músculo ausente não inventa grupo');
select * from finish();
rollback;
