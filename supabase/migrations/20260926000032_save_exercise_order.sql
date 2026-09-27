-- Grava a nova ordem de um grupo muscular inteiro num único statement (equivalente ao
-- writeBatch original — tudo ou nada, nunca uma reordenação parcial).
create or replace function public.save_exercise_order(p_exercise_ids uuid[]) returns void
  language sql security definer set search_path = public as $$
  update public.exercises e
    set "order" = ids.idx - 1
    from unnest(p_exercise_ids) with ordinality as ids(id, idx)
    where e.id = ids.id and e.user_id = auth.uid()
$$;
