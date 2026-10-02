-- Compartilhar progresso nas comunidades: o card gerado (PNG/WebP) é publicado como uma publicação de FOTO
-- normal (mesmo bucket status-photos, mesmas policies de criação/exclusão, curtidas, comentários, moderação e
-- feed). O único acréscimo é um METADADO opcional dizendo que aquela foto é um card de progresso e qual
-- período ele cobre -- usado só para rotular o post ("Progresso") e para o card poder ser identificado.
-- Nada de SVG/base64 no banco: só a referência da imagem (photo_path, já existente) e estes três campos.
--
-- Regras (no banco, não só no cliente):
--  * progress_* só existem em type = 'photo';
--  * progress_kind ∈ (daily, perfect_week, week, month, quarter) e o período é obrigatório e coerente
--    (fim >= início, no máximo ~um trimestre).
alter table public.statuses
  add column progress_kind text,
  add column progress_period_start date,
  add column progress_period_end date;

alter table public.statuses add constraint statuses_progress_shape check (
  (progress_kind is null and progress_period_start is null and progress_period_end is null)
  or (
    type = 'photo'
    and progress_kind is not null
    and progress_kind in ('daily', 'perfect_week', 'week', 'month', 'quarter')
    and progress_period_start is not null
    and progress_period_end is not null
    and progress_period_end >= progress_period_start
    and progress_period_end - progress_period_start <= 100
  )
);
