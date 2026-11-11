# Publicidade no Progresso: regra e publicação

## Distribuição

Cada chamada a `select_advertising` seleciona uma amostra uniforme, sem pesos, entre os anúncios elegíveis para **um posicionamento e contexto**. Anúncios institucionais legados e campanhas pagas concorrem em igualdade quando estão no mesmo espaço; legados globais só participam de `home_banner`, nunca de `progress_banner`. O banner alterna localmente os até quatro anúncios retornados, sem outra consulta por troca. Isso equilibra oportunidades de seleção ao longo de chamadas; não garante impressões nem compensação financeira. Métricas dependem da coleta consentida e da exposição visível, então ausência de dados deve ser mostrada como indisponibilidade, não zero.

## Publicação

1. Conferir projeto Supabase de destino e histórico de migrations. Aplicar, nesta ordem, `20261216000001_advertising_legacy_delivery_scope_fix.sql` e `20261216000002_advertising_progress_banner.sql` em homologação; executar os testes SQL de publicidade com PostgreSQL real antes de produção.
2. Validar em homologação seleção, bloqueio administrativo, relatórios, compra, reversão e concorrência de reservas. Fazer smoke de `/progresso` em mobile e desktop, claro/escuro, com e sem anúncio e com coleta desativada.
3. Publicar o frontend após a migration. O novo espaço começa com capacidade zero, venda e entrega desligadas. A ausência de anúncios não cria bloco vazio.
4. Para abrir comercialmente, publicar preço e termos vigentes, configurar capacidade e habilitar **Aceitar contratações** e **Permitir exibição** na gestão existente. Verificar as duas configurações separadas da oferta comercial e a sinalização de disponibilidade no assistente. Não acrescentar `progress_banner` automaticamente ao pacote `network`.
5. Se houver incidente, desligar **Permitir exibição** em `progress_banner`. A veiculação para dentro da janela de autorização; a operação é auditada. Identificar contratos ativos nas reservas e comunicar os afetados. Suspensão não gera estorno, crédito ou prazo adicional automático.

`sales_enabled` controla novas contratações; desligá-lo não cancela as reservas vigentes. A redução de capacidade é barrada quando inferior ao pico já comprometido. Escopo e snapshots de contratos antigos permanecem imutáveis.
