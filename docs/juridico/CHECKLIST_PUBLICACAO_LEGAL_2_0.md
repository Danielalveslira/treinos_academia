# Antes de publicar a versão jurídica 2.0.0

**Estado:** minutas do PR #123 em revisão; 1.5.0 vigente. Nenhuma venda, documento comercial ou versão 2.0.0 foi ativada. O [dossiê jurídico único](DOSSIE_DECISAO_LEGAL_2_0.md) contém os fundamentos e as evidências faltantes; o [backlog](BACKLOG_POS_LANCAMENTO_LEGAL_2_0.md) separa revisões posteriores da integração técnica.

1. Integrar o PR com CI obrigatória aprovada e aplicar somente a migration `20261212000009_height_health_consent.sql`. Verificar a revogação e a exclusão de altura.
2. Conferir o deployment automático e o commit em `/.well-known/evolutus-build.json`. Manter Analytics, Speed Insights e as travas comerciais.
3. Conferir e aprovar expressamente as sete minutas. A data efetiva deve ser a data real da aprovação/publicação, por isso permanece `AAAA-MM-DD` nas minutas; não antecipar `published`, `approved` ou os digests.
4. Antes de qualquer declaração de conformidade, resolver as evidências indispensáveis para a afirmação feita. Em particular, a transferência internacional atual dos serviços essenciais exige mecanismo comprovado do art. 33 da LGPD. As análises complementares estão no backlog e não impedem o merge técnico.
5. Após aprovação, seguir o procedimento de publicação individual. Preservar o histórico 1.5.0 e obter autorização separada para qualquer venda.

A página pública do fornecedor já foi conferida com os três campos completos, sem registrar os valores pessoais. A trava `supplierInfo.configured` continua fechada; sua abertura e qualquer venda exigem autorização posterior.
