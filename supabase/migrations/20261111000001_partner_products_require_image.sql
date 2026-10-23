-- Imagem passa a ser obrigatória para produtos da Vitrine, com o servidor como
-- autoridade final (não só o client em PartnerProductForm/validatePartnerProduct):
-- um INSERT sem imagem (cadastro novo) ou um UPDATE que marque approved=true sem
-- imagem (publicação, inclusive de produto legado incompleto) agora é rejeitado.
-- Produtos legados sem imagem continuam legíveis e editáveis normalmente -- só não
-- podem virar approved=true enquanto a imagem não for preenchida.
create or replace function public.enforce_partner_product_image()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and (new.image_url is null or btrim(new.image_url) = '') then
    raise exception 'image_url is required to create a partner product' using errcode = '22023';
  end if;
  if new.approved and (new.image_url is null or btrim(new.image_url) = '') then
    raise exception 'image_url is required to publish a partner product' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists partner_products_require_image on public.partner_products;
create trigger partner_products_require_image
  before insert or update on public.partner_products
  for each row execute function public.enforce_partner_product_image();

-- Dados antigos que já estavam approved=true sem imagem (criados antes desta regra)
-- deixam de ser elegíveis à leitura pública (partner_products_public_read exige
-- approved) -- despublicados, não apagados: seguem visíveis/editáveis no admin.
update public.partner_products
  set approved = false
  where approved and (image_url is null or btrim(image_url) = '');
