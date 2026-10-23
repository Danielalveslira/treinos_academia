# Economia Evolutus — homologação, rollout e incidentes

## Limites desta entrega

Nenhum deploy, migration remota, segredo real ou pagamento real foi executado. O Vite da porta 5173 permanece servindo `/app`; frontend usa a configuração Supabase já existente do Codespace. Atualizações React são locais, mas operações financeiras remotas continuam executando as funções publicadas anteriormente. Não apresentar testes locais como comprovação de produção.

A API oficial legada confirma apenas pagamento aprovado (`payment_check`). A ajuda atual descreve API Key/opções avançadas e eventos de reembolso, mas não documenta esquema/autenticidade/consulta de reembolso parcial e chargeback suficiente para automatizar débito. O webhook continua sendo indicação; nenhum estorno é autorizado pelo payload público. A ausência de endpoint oficial de busca por pedido significa que compra sem transaction NSU/invoice slug precisa de consulta humana no painel do lojista. Não existem testes com pagamento real, nem autorização para fazê-los.

## Ordem de aplicação candidata

| Migration | Conteúdo | Compatibilidade / custo |
|---|---|---|
| 20261112000001 | grants explícitos, search_path dos helpers, trigger interno | assinaturas preservadas; nenhum rewrite |
| 20261112000002 | unidades inteiras; constraints NOT VALID; ledger imutável; serialização de promoção por usuário | frações rejeitadas; preserva pseudonimização e vinculação aos casos; DDL breve |
| 20261112000003 | NULL inválido, reembolso sem crédito é final, reserva revalida acesso; expiry congelada; lease de payment_check | depende da versão nova das functions para lease; banco primeiro; clientes antigos continuam |
| 20261112000004 | reversões comprovadas e obrigação; recuperação compensatória; gate de exclusão | flag `financialControls.reversalsEnabled=false`; política proporcional exige aprovação antes de ativar |
| 20261112000005 | evidência de negócio para atividade; mídia/treino existentes; fingerprint de conteúdo | muda elegibilidade; não modifica lifetime histórico; teto 10 preservado |
| 20261112000006 | conciliação shadow com cursor/findings; lote externo com lease/backoff | sem cron novo ligado; jobs existentes preservados; sem reparo de saldo |

Após histórico real e drift serem conferidos: aplicar banco em staging descartável → functions (`create-checkout`, `webhook`, `check-payment`, `admin-reconcile`) → frontend → smoke → somente observação shadow. Frontend anterior continua compatível; frontend novo só usa RPC de eventos quando a compra tem estorno. `INFINITEPAY_API_KEY` é opcional para manter compatibilidade com contrato legado; se configurada, habilita `options.single_payment` e `options.valid_until` documentados. Sem ela, proteção de pagamento único no provedor continua pendente, embora o banco sempre impeça dupla concessão. Não inferir que cancelamento local cancelou o link remoto. Não recriar checkout após resultado incerto.

## Pré-check, histórico e validação

1. Confirmar destino e baseline aplicada até 20261111000001; obter backup/restauração e janela operacional. Não editar/renomear migrations históricas. Verificar drift de funções, RLS, grants e schemas antes de publicação.
2. Usar `supabase/tests/finance_preflight_readonly.sql` em transação read-only, com statement timeout. Ele retorna contagens de unidades inválidas, saldos negativos e constraints pendentes. Inspeção de discrepâncias em lotes é `private.finance_reconcile_shadow(50)`; ela grava apenas achados/cursor.
3. Constraints NOT VALID protegem novas linhas imediatamente. Não arredondar nem atualizar históricos inválidos para fazer a migration passar. Investigar origem e aprovar lançamentos compensatórios. Uma fração no ledger histórico é evidência; precisa continuar preservada.
4. Índices novos são fundamentados em queries: fingerprint único; reversões por compra e dívidas pendentes; fila por próximo retry; findings por cursor. Em base grande, estimar tamanho/tempo antes de publicar; construir índices de forma concorrente em preparação operacional autorizada, reconciliando DDL com a migration. A criação padrão em transação pode bloquear escritas; não declarar zero downtime sem medir no staging representativo.
5. Só após diagnóstico limpo: `ALTER TABLE ... VALIDATE CONSTRAINT` separadamente, em janela autorizada. Não há backfill de saldo ou fingerprint antigo: fabricar saldo inicial ou inferir texto apagado violaria rastreabilidade.
6. Smoke de staging: RLS A/B/anon, pagamento simulado e replay, pacote inválido, valor/moeda divergente, pedido cancelado pago tarde, usuário disabled/deleting, caso separado, fraude, idempotência e rollback. Nunca simular crédito com service role no banco remoto real.

## Política candidata de reversão (desativada até aprovação)

- Registrar apenas reversão **concluída e comprovada** no painel/relatório oficial, com ID único do evento, referência verificável, valor BRL em centavos, tipo, motivo e superadmin autenticado com acesso ao app. Nota ou webhook isolado não constitui prova.
- `admin_record_cash_reversal` não manda reembolsar ao provedor nem confirma pagamento novo. Aceita só compra já creditada com identidade do provedor; acumula valores até o máximo realmente pago. Evento repetido retorna o evento original; identidade/valor conflitante é recusado.
- Alocação inteira candidata: diferença entre `floor(EvoCash * BRL_revertido_acumulado / BRL_pago)` antes/depois. Duas metades de compra de 25 unidades recuperam 12 e 13, nunca 24/26. BRL não sofre arredondamento.
- Recuperar apenas o crédito correspondente ao estorno; debitar o que houver disponível, com ledger compensatório. Se já gasto, registrar diferença em `cash_purchase_reversals.cash_units-recovered_units`. Nenhum saldo disponível negativo. Próximos créditos recuperam somente essa obrigação, deixando excedente livre; operações antigas permanecem auditáveis. Ativação desta política de compensação exige validação comercial/jurídica.
- Caso sem conta: manter evento ligado à compra e ao caso financeiro existente; não recriar carteira nem alterar snapshots do caso. Atendimento precisa decidir como tratar saldo já retido no caso.
- Serviços/promoções já prestados não são apagados. Serviços futuros vinculados à conta precisam de revisão humana antes de suspensão/cancelamento pelos fluxos administrativos existentes; não há regra comercial presumida para desfazer publicidade consumida.
- Não registrar disputa em aberto como chargeback final, nem reembolso apenas solicitado como confirmado. Conservar evidência operacional até decisão. Reversão da própria contestação/ganho de disputa exige política e novo evento compensatório aprovado; esta entrega não transforma isso silenciosamente em crédito.

## Conciliação e operação

`private.finance_reconcile_shadow(50)` compara carteiras/ledger em lote com cursor persistente, bloqueio curto de cada carteira e chave de finding única. Diferença histórica pode ser saldo inicial legítimo não documentado: o achado sempre exige investigação, nunca reparo automático. Carteira comum continua por PK, sem somar ledger. Job não agenda outro job e não altera saldo.

`infinitepay-admin-reconcile` aceita `{ "mode": "batch", "limit": 10 }` com autorização superadmin. Reusa o mesmo `verifyAndConfirm`; lote sequencial, máximo 25, tentativas persistentes <=10, backoff exponencial e jitter. Compras sem identidade suficiente continuam visíveis nos findings para conciliação humana. A expiração existente continua separada de confirmação; nenhum cron duplicado foi criado. Agendamento backend só depois de staging, sem polling por usuário. Tempo máximo do lote é proporcional ao limite (12s de timeout por chamada); usar lote pequeno segundo o limite da Edge Function do ambiente.

Consultar `admin_finance_findings(cursor, limit)` e `admin_cash_reversal_events(purchase_id)` por RPC autorizada. Findings têm retenção operacional de 30 dias após última observação; cursor não contém dados pessoais. Eventos de estorno seguem a retenção financeira da compra/caso: não há purge automático. `confirmed_by` pode virar NULL na exclusão do ator, mantendo evidência financeira. Não inserir CPF, cartão, token, recibo completo ou segredo em notas/evidências.

Monitorar: falhas por código seguro; idade/quantidade de pendências; tentativas esgotadas; diferenças wallet/ledger; compra creditada sem identidade/ledger; casos sem conta; dívida pendente; latência e erros de payment_check. Limites de corpo e lease por pedido não substituem proteção de tráfego volumétrico do gateway. Ajustar alertas e limites de infraestrutura no ambiente autorizado.

## Incidentes e rollback operacional

| Incidente | Contenção e recuperação |
|---|---|
| Crédito indevido | suspender fonte afetada na regra do servidor; preservar evidência/ledger; investigar referência; compensação aprovada, nunca DELETE/UPDATE de valor |
| Pagamento aprovado sem saldo | buscar pedido no painel, copiar identidades; admin reconcile → payment_check; distinguir needs_review/held_in_case; conferir exatamente uma linha de crédito |
| Cobrança duplicada | não criar novo link; identificar cada transação no provedor; conciliar um crédito por pedido; reembolso externo comprovado dos excedentes conforme contrato |
| Contestação | confirmar se concluída; preservar evento/evidência; com política ativa registrar reversão; dívida separada se gasto; revisão de serviços futuros |
| Divergência ledger | rodar shadow paginado; investigar saldo inicial/importação/eventos; reparo auditável aprovado; não somar/regravar saldo automaticamente |
| Provedor indisponível | conservar pending/uncertain; respeitar leases/backoff; não repetir criação; verificar manualmente tentativas esgotadas |
| Credencial comprometida | revogar/rotacionar no ambiente autorizado, revisar logs/eventos e grants; nunca copiar segredo para cliente |
| Regressão após COMMIT | voltar frontend/functions compatíveis e desativar fontes/feature flag afetada; manter ledger/grants; preparar roll-forward testado. Reversões já registradas e dívidas não desaparecem ao desligar flag |

Antes de COMMIT, falha da migration reverte sua transação. Depois, não há `down` seguro que apague eventos, restaure saldo anterior ou reabra permissões. PITR/restauração requer decisão de incidente com RPO/RTO e conciliação dos pagamentos recebidos após o backup.

## Homologação local reproduzível e uso de recursos

- `bash scripts/finance-prepare-local.sh baseline`: container fixo descartável, sem portas públicas, CPU 0,75 e RAM 1 GiB; cron desativado; schemas sintéticos Auth/Storage conforme baseline já existente no repositório; 148 migrations históricas.
- `python3 scripts/finance-audit-local.py sql --container evolutus_finance_clean --baseline`: testes de HEAD, sem candidatas; distingue falhas pré-existentes/serviços ausentes.
- `bash scripts/finance-prepare-local.sh candidate`: seis migrations novas, cada uma transacional.
- `python3 scripts/finance-audit-local.py sql --container evolutus_finance_clean`: suíte candidata completa. Storage sintético não comprova fluxo do serviço Storage real.
- `python3 scripts/finance-audit-local.py concurrency --container evolutus_finance_clean`: 100 tentativas/caso, máximo quatro sessões simultâneas; preserva fixtures sintéticas no banco descartável. Não rodar enquanto testa UI/build.
- `python3 scripts/finance-audit-local.py performance --container evolutus_finance_clean`: cinco amostras antes/depois, 2.000 chamadas/amostra, mesma transação revertida/massa/limites.
- `npm run lint`, `npm test`, `npm run test:functions`, `npm run build`: sequenciais; concorrência dos runners Node reduzida a 1 para preservar Codespace/Vite.
- Ao terminar, parar os containers `evolutus_finance_audit`/`evolutus_finance_clean`. Vite da porta 5173 permanece ativo. Não remover containers/processos do usuário ou fazer prune global.

## Pendências de produção

Aprovação de publicação e janela de índices/constraints; drift e pré-check em dados reais; política de recuperação/reembolso e serviços prestados; contrato/autenticidade de estorno/chargeback InfinitePay; API Key para opções avançadas; homologação com provedor autorizado/contas de teste; Storage/Auth reais e fluxos de exclusão; limites/alertas/agendamento no backend; carga representativa e restauração operacional. Sem afirmar segurança absoluta ou baixa latência do provedor a partir de Docker local.

Um segundo pagamento comprovado em link legado reutilizável é registrado como `verified_payment_conflict`, com identidade do evento, em vez de ser creditado novamente ou ignorado. Sua evidência não entra no purge operacional de 30 dias; depende de resolução/retenção financeira aprovada. Alertar e resolver com o lojista, preservando a compra original. A API de registro é exclusiva do backend, depois de `payment_check`.

Há uma migration de revogação de sessão (`20261113000001`) produzida por outro trabalho paralelo. Ela não faz parte das seis candidatas financeiras nem foi aplicada por esta auditoria. O preparador local restringe a fase candidata ao prefixo 20261112 para não aplicar silenciosamente trabalho de outra sessão.
