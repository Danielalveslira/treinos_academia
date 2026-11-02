-- Restaurar a definição anterior exige revisão explícita do requisito 18+.
-- Não reabrir cadastro de menores por rollback automático.
-- Nenhum dado deve ser apagado ou idade de usuário existente alterada.
raise exception 'ROLLBACK_REQUIRES_MANUAL_REVIEW_FOR_AGE_POLICY';
