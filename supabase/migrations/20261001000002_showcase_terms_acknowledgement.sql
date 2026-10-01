-- Decisão de produto: uma nova versão dos Termos da Vitrine nunca mais bloqueia,
-- suspende ou despublica nada. O titular só recebe um aviso persistente (resolvido em
-- MyProfessionalListing.jsx) e pode registrar ciência -- isso nunca é condição para
-- publicar, editar ou manter uma vitrine no ar. showcase_legal_acceptances (a tabela
-- antiga, "aceite = pré-condição de publicar") é preservada intacta como histórico --
-- nunca mais escrita, mas nenhuma linha é apagada. "Acceptance" não é reaproveitada pro
-- novo comportamento porque não é mais isso: é só ciência de uma atualização.
create table public.showcase_legal_acknowledgements (
  user_id uuid not null references public.users(id) on delete cascade,
  document_id text not null,
  version text not null,
  digest text not null,
  acknowledged_at timestamptz not null default now(),
  primary key (user_id, version)
);
alter table public.showcase_legal_acknowledgements enable row level security;
create policy showcase_legal_acknowledgements_select on public.showcase_legal_acknowledgements for select
  using (user_id = auth.uid() or public.is_superadmin());

-- Só registra ciência da versão atualmente publicada -- nunca cria, nem precisa, a
-- versão que o cliente alega conhecer (evita um cliente desatualizado ou adulterado
-- gravando ciência de uma versão errada). Idempotente: chamar de novo pra mesma versão
-- não duplica (PK) nem erra (on conflict do nothing). Não mexe em vitrine, rascunho,
-- permissão ou qualquer outra coisa -- só essa tabela.
create or replace function public.acknowledge_showcase_terms() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_policy public.showcase_legal_policy;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into v_policy from public.showcase_legal_policy where id;
  if coalesce(v_policy.published, false) is not true or v_policy.version is null then
    raise exception 'NO_ACTIVE_SHOWCASE_TERMS';
  end if;

  insert into public.showcase_legal_acknowledgements (user_id, document_id, version, digest)
    values (v_uid, v_policy.document_id, v_policy.version, v_policy.digest)
    on conflict (user_id, version) do nothing;

  return jsonb_build_object('version', v_policy.version, 'acknowledged', true);
end;
$$;
revoke all on function public.acknowledge_showcase_terms() from public;
grant execute on function public.acknowledge_showcase_terms() to authenticated;

-- Publicação deixa de validar qualquer coisa jurídica -- só titularidade, elegibilidade,
-- estado da vitrine e completude do rascunho (regras reais da própria Vitrine). O
-- assinatura muda (p_terms_accepted/p_terms_version saem) porque mantê-los como
-- parâmetros ignorados sugeriria, erradamente, que ainda importam aqui -- nenhuma outra
-- mudança de comportamento além da remoção do bloco de termos. IMPORTANTE (sem relação
-- com esta mudança): a Fase 2 do publish (Edge Function que chama
-- finalize_professional_listing_publish) continua não existindo -- isso aqui não torna a
-- Vitrine publicável de ponta a ponta sozinho.
drop function if exists public.prepare_professional_listing_publish(uuid, boolean, text, text);

create or replace function public.prepare_professional_listing_publish(
  p_listing_id uuid, p_operation_id text
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.professional_listings;
  v_draft public.professional_listing_drafts;
  v_avatar_media_id uuid;
  v_avatar_path text;
  v_avatar_wanted boolean;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_operation_id is null or length(p_operation_id) = 0 then raise exception 'INVALID_ARGUMENT'; end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select * into v_listing from public.professional_listings where id = p_listing_id for update;
  if v_listing is null or v_listing.owner_id <> v_uid then raise exception 'LISTING_NOT_FOUND'; end if;

  select * into v_draft from public.professional_listing_drafts where listing_id = p_listing_id for update;

  if v_listing.lifecycle_state = 'published' and v_draft.publish_operation_id = p_operation_id then
    return jsonb_build_object('repeated', true, 'version', v_listing.published_version);
  end if;
  if v_listing.lifecycle_state in ('suspended', 'deleting') then raise exception 'LISTING_NOT_EDITABLE'; end if;
  if v_draft.review_state = 'publishing' and v_draft.publishing_started_at > now() - interval '2 minutes' then
    raise exception 'PUBLISH_IN_PROGRESS';
  end if;
  if v_draft.listing_id is null or coalesce(v_draft.version, 0) = 0 then raise exception 'DRAFT_INCOMPLETE'; end if;

  v_avatar_wanted := v_draft.kind = 'professional' and v_draft.use_profile_avatar is true;
  if v_avatar_wanted then
    select avatar_media_id, avatar_path into v_avatar_media_id, v_avatar_path from public.users where id = v_uid;
    v_avatar_wanted := v_avatar_media_id is not null and v_avatar_path is not null;
  end if;

  update public.professional_listing_drafts set
    review_state = 'publishing', publishing_operation_id = p_operation_id, publishing_started_at = now(), updated_at = now()
    where listing_id = p_listing_id;

  return jsonb_build_object(
    'repeated', false, 'version', v_draft.version,
    'avatarMediaId', case when v_avatar_wanted then v_avatar_media_id else null end,
    'avatarPath', case when v_avatar_wanted then v_avatar_path else null end
  );
end;
$$;
-- Sem revoke: chamada diretamente pelo dono autenticado (mesmo padrão de
-- request_cash_purchase) -- é a Edge Function futura de finalize/abort que precisa ser
-- service_role-only, não esta (mesma nota da migration original).
