-- EvoCoins por participação — 5/7: recompensas pendentes (publicação e comentário).
--
-- Nada é pago na hora. Criar uma publicação/comentário válido só ENFILEIRA uma recompensa; depois
-- de ~15 min (economy_reward_settings.pending_delay) o cron reavalia tudo no estado ATUAL:
--   * o conteúdo ainda existe (excluir antes = nada);
--   * o usuário ainda tem acesso ao app e a comunidade está disponível para ele;
--   * não é auto-interação (comentário em publicação própria / resposta a si mesmo);
--   * o conteúdo atual ainda cumpre o mínimo (editar para "esvaziar" = nada; editar não paga);
--   * ainda não foi premiado (natural_key única no ledger) e há folga na ação e no teto global.
-- Chaves: publicação 'post:<status_id>'; comentário 'comment:<status_id>' (UMA vez por usuário por
-- publicação, para excluir/recriar o comentário na mesma publicação nunca pagar de novo).

create table public.economy_pending_awards (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  action text not null references public.economy_reward_rules(action),
  natural_key text not null,
  ref_type text not null,
  ref_id uuid not null,
  due_at timestamptz not null,
  attempts smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, natural_key)
);
create index economy_pending_awards_due_idx on public.economy_pending_awards (due_at, id);
alter table public.economy_pending_awards enable row level security;
revoke all on public.economy_pending_awards from anon, authenticated;

-- Enfileira só se ainda couber algo hoje (retorno rápido por PK; sem folga = nem grava).
create or replace function private.enqueue_pending_award(
  p_user_id uuid, p_action text, p_natural_key text, p_ref_type text, p_ref_id uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_delay interval;
begin
  if private.evocoins_headroom(p_user_id, p_action) <= 0 then return; end if;
  select pending_delay into v_delay from public.economy_reward_settings where id;
  insert into public.economy_pending_awards (user_id, action, natural_key, ref_type, ref_id, due_at)
  values (p_user_id, p_action, p_natural_key, p_ref_type, p_ref_id, now() + v_delay)
  on conflict (user_id, natural_key) do nothing;
end;
$$;

-- Comunidade utilizável pelo usuário (ativa, sem exclusão em curso, sem restrição para ele).
create or replace function private.community_usable_by(p_community_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.communities c where c.id = p_community_id and c.is_active)
    and not exists (select 1 from public.deletion_jobs j
                     where j.kind = 'community' and j.target_id = p_community_id and j.state <> 'complete')
    and not exists (select 1 from public.community_restrictions cr
                     where cr.community_id = p_community_id and cr.user_id = p_user_id)
    and exists (select 1 from public.community_members m
                 where m.community_id = p_community_id and m.user_id = p_user_id)
$$;

-- Comentário elegível, olhando o estado atual no banco.
create or replace function private.comment_is_rewardable(p_comment public.post_comments) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_post public.statuses;
  v_parent_author uuid;
begin
  if p_comment.author_id is null or p_comment.status <> 'active'
     or not private.is_meaningful_text(p_comment.body, 20) then
    return false;
  end if;
  select * into v_post from public.statuses where id = p_comment.status_id;
  if not found then return false; end if;
  if p_comment.parent_comment_id is null then
    if v_post.author_id = p_comment.author_id then return false; end if;
  else
    select author_id into v_parent_author from public.post_comments where id = p_comment.parent_comment_id;
    if v_parent_author is not distinct from p_comment.author_id then return false; end if;
  end if;
  return private.community_usable_by(v_post.community_id, p_comment.author_id);
end;
$$;

create or replace function private.pending_award_is_valid(p_user_id uuid, p_action text, p_ref_id uuid)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_status public.statuses;
  v_comment public.post_comments;
begin
  if not private.user_app_access(p_user_id) then return false; end if;
  if p_action = 'post_published' then
    select * into v_status from public.statuses where id = p_ref_id;
    if not found or v_status.author_id <> p_user_id then return false; end if;
    return private.post_is_rewardable(v_status)
       and private.community_usable_by(v_status.community_id, p_user_id);
  elsif p_action = 'comment_posted' then
    select * into v_comment from public.post_comments where id = p_ref_id;
    if not found or v_comment.author_id is distinct from p_user_id then return false; end if;
    return private.comment_is_rewardable(v_comment);
  end if;
  return false;
end;
$$;

-- Triggers só reagem a escrita feita pelo PRÓPRIO usuário logado (auth.uid() = autor): seeds,
-- service role e jobs internos nunca geram recompensa. Falha de recompensa nunca derruba a ação.
create or replace function private.statuses_enqueue_award() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is distinct from new.author_id then return new; end if;
  if not private.post_is_rewardable(new) then return new; end if;
  if private.evocoins_headroom(new.author_id, 'post_published') <= 0 then return new; end if;
  begin
    perform private.enqueue_pending_award(new.author_id, 'post_published', 'post:' || new.id::text, 'status', new.id);
  exception when others then
    raise warning 'evocoins: falha ao enfileirar recompensa de publicação: %', sqlerrm;
  end;
  return new;
end;
$$;

create or replace function private.post_comments_enqueue_award() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.author_id is null or (select auth.uid()) is distinct from new.author_id then return new; end if;
  -- Do mais barato ao mais caro: texto, folga do dia (1 leitura por PK) e só então as consultas
  -- de elegibilidade. Quem já está no teto não paga nada por escrever comentários.
  if not private.is_meaningful_text(new.body, 20) then return new; end if;
  if private.evocoins_headroom(new.author_id, 'comment_posted') <= 0 then return new; end if;
  begin
    if private.comment_is_rewardable(new) then
      perform private.enqueue_pending_award(new.author_id, 'comment_posted', 'comment:' || new.status_id::text, 'post_comment', new.id);
    end if;
  exception when others then
    raise warning 'evocoins: falha ao enfileirar recompensa de comentário: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function private.enqueue_pending_award(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function private.community_usable_by(uuid, uuid) from public, anon, authenticated;
revoke all on function private.comment_is_rewardable(public.post_comments) from public, anon, authenticated;
revoke all on function private.pending_award_is_valid(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.statuses_enqueue_award() from public, anon, authenticated;
revoke all on function private.post_comments_enqueue_award() from public, anon, authenticated;

create trigger statuses_enqueue_award after insert on public.statuses
  for each row execute function private.statuses_enqueue_award();
create trigger post_comments_enqueue_award after insert on public.post_comments
  for each row execute function private.post_comments_enqueue_award();

-- Processa as pendências vencidas. Mesmo advisory lock de settle_vote_rewards: as duas rotinas
-- seguram linhas de vários usuários na mesma transação, então nunca rodam ao mesmo tempo (evita
-- deadlock entre elas). Falha numa linha não derruba o lote: tenta de novo (até 3x) e depois descarta.
create or replace function private.settle_pending_awards() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.economy_pending_awards;
  v_award jsonb;
  v_paid integer := 0;
  v_dropped integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('settle_vote_rewards')) then
    return jsonb_build_object('skipped', true, 'reason', 'already_running');
  end if;

  for v_row in
    select * from public.economy_pending_awards
    where due_at <= now()
    order by due_at, id
    limit 300
    for update skip locked
  loop
    begin
      if private.evocoins_headroom(v_row.user_id, v_row.action) > 0
         and private.pending_award_is_valid(v_row.user_id, v_row.action, v_row.ref_id) then
        v_award := private.award_evocoins(v_row.user_id, v_row.action, v_row.natural_key, v_row.ref_type, v_row.ref_id::text);
        if (v_award ->> 'awardedCoins')::integer > 0 then v_paid := v_paid + 1; else v_dropped := v_dropped + 1; end if;
      else
        v_dropped := v_dropped + 1;
      end if;
      delete from public.economy_pending_awards where id = v_row.id;
    exception when others then
      raise warning 'evocoins: pendência % falhou: %', v_row.id, sqlerrm;
      if v_row.attempts >= 2 then
        delete from public.economy_pending_awards where id = v_row.id;
        v_dropped := v_dropped + 1;
      else
        update public.economy_pending_awards
          set attempts = attempts + 1, due_at = now() + interval '5 minutes' where id = v_row.id;
      end if;
    end;
  end loop;

  return jsonb_build_object('paid', v_paid, 'dropped', v_dropped);
end;
$$;
revoke all on function private.settle_pending_awards() from public, anon, authenticated;

-- A cada 5 min, defasado do settle de apoios (*/5) para os dois quase nunca disputarem o lock.
select cron.schedule('settle-pending-awards', '2-59/5 * * * *', $$select private.settle_pending_awards()$$);
