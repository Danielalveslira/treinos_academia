> **Estado mais recente:** [PR_READINESS.md](PR_READINESS.md). GitHub/SSH Daniel confirmados, 69 SQL/3.035 assertivas e demais suítes locais aprovadas; Supabase/Vercel precisam de nova autenticação neste Codespace. O conteúdo abaixo preserva a etapa anterior.

> **Atualização de segurança:** o backup lógico agora foi restaurado e conferido em isolamento; os gates locais de CI/Vercel foram preparados. Estado atual, evidências e autorizações pendentes: [LIBERACAO_SEGURANCA.md](LIBERACAO_SEGURANCA.md). O conteúdo abaixo preserva o diagnóstico anterior.

# Verificação remota e preparação de publicação

**BLOQUEADO PARA PUBLICAÇÃO.** Supabase autenticado e destino confirmado: `ywrjojrjgozdfpddkkuy`, evolutus.com.br, us-east-2, ACTIVE_HEALTHY, PostgreSQL 17.6.1.166. Este relatório sucede o impedimento de autenticação do relatório de estabilização; seus testes anteriores permanecem históricos, sem repetição desnecessária.

## Banco e integridade

O remoto registra 148 migrations até `20261111000001`. O dry-run final relacionou **14 pendentes**, sem seeds/roles e com `--skip-vault`; nenhuma foi aplicada. As 13 inicialmente previstas foram preservadas e foi acrescentada `20261115000002_cash_reminder_session_guard.sql`.

Comparação contra reconstrução local das 148 históricas: 297 funções, 92 relações, 66 triggers, cinco views, dois enums e 14 jobs. Corpos de funções, RLS, colunas, índices, constraints, triggers e jobs coincidem. Três diferenças de grants foram encontradas: falta no remoto de grants explícitos anon em dois triggers (`_touch_exercise_catalog_updated_at`, `enforce_partner_product_image`) e na tabela `cash_purchase_reminder_emails`. O remoto é mais restritivo; PUBLIC EXECUTE permanece nos dois triggers. A migration de integração 20261114000001 revoga os acessos de clientes e converge essas diferenças. Não houve correção remota. Owners DBA locais/remotos foram normalizados explicitamente; cliente e corpo SQL não foram normalizados. pgTAP existe apenas no ambiente de teste.

Diagnóstico: **6 carteiras, 166 lançamentos, 25 compras; zero divergências carteira/ledger/lifetime**, zero saldos/unidades inválidos, créditos duplicados, compras creditadas sem identidade ou lançamento, referências financeiras órfãs ou excesso do teto diário de 10. Nenhuma FK desabilitada ou constraint inválida identificada. Deadlocks acumulados: zero na amostra; houve uma transação ativa no snapshot de catálogo, o que exige nova inspeção na janela, sem presumir ausência futura de bloqueios.

Compras: 15 canceladas, nove creditadas, uma pendente. A pendente tem menos de sete dias e não possui identidade completa do provedor; não há evidência de pagamento. Exige revisão pelo lojista se continuar pendente, sem fabricar identidade/crédito nem assumir inadimplência. A autorização atual não permite alteração de dados.

O owner remoto `postgres` possui USAGE em Auth/Storage, SELECT em auth.sessions/storage.objects e EXECUTE em auth.uid/jwt. As colunas de sessão esperadas existem. anon/authenticated não podem criar em public, alterar carteira, inserir ledger ou executar confirmação/helper de crédito. service_role ainda possui DML legado de carteira, que a migration financeira 01 revoga; trata-se de credencial privilegiada e não de permissão de frontend.

Queries usam transação READ ONLY, search_path pg_catalog, statement_timeout 10s e lock_timeout 2s. Somente catálogos e leituras; nenhuma função de reconciliação que grave findings foi chamada. A CLI pode inicializar sua role de conexão no plano de acesso: isso não representa aplicação de migrations ou escrita em dados financeiros. Metadados brutos ficam privados em `.finance-local/remote`, sem tokens/valores de secrets na evidência versionada.

## Correções locais e validação afetada

A política de leitura de lembretes financeiros exigia superadmin, mas aceitava JWT de sessão revogada/malformada. Reprodução anterior: duas das sete assertivas falharam. Nova migration forward-only exige também `is_session_active()`, sem alterar dados, workers ou grants administrativos. Após a correção: **7/7** novas assertivas, **42/42** de lembretes financeiros e **93/93** de lembretes de treino; zero skips/falhas.

Os testes PostgreSQL do worker Push dependiam de `\ir /workspace/...`, caminho ausente no container padrão do CI. Agora leem o helper no host e enviam o SQL pela entrada padrão, conservando sessões reais/assertivas. **3/3** testes reais aprovados, zero skips. Comparador offline de catálogo: **4/4** aprovados. Lint: zero erros e 16 avisos anteriores.

CI local preparado com contents:read, checkout sem persistência de credenciais, CLI 2.119.0 e testes de Functions com PostgreSQL real. Não foi publicado nem executado no GitHub. Os checks remotos antigos não aprovam estas alterações novas.

Após a pausa, os containers antigos falharam com `RWLayer ... unexpectedly nil`. A repetição inicial não executou SQL e foi registrada como tentativa de infraestrutura, sem mascarar o erro. O banco descartável foi reconstruído com Auth/Storage reais: **148 históricas + 14 candidatas = 162 migrations aprovadas**, seguidas de **142 assertivas afetadas aprovadas** novamente, zero skips/falhas. Não foi repetida a comparação completa entre duas instalações de 162; a comparação limpa/incremental de 161 e a preservação de dados anteriores permanecem evidências históricas. A única migration adicional altera policy, sem DML/regravação.

A validação histórica permanece: 68 SQL/3.028 assertivas, 2.092 aplicação, 207 Functions e oito HTTP. Esses totais não são uma nova execução após a policy. A nova suíte de sete assertivas foi validada separadamente e não foi artificialmente somada ao total histórico.

## Backup e recuperação

A API retornou `backups:null`, `physical_backup_data:{}`, `pitr_enabled:false`, `walg_enabled:true`. Isso **não comprova backup utilizável**, nem ausência absoluta de cópias externas. Não há data/ponto recuperável validado e nenhuma restauração isolada foi verificada. A pergunta sobre eventual cópia externa permanece sem resposta. Este é um bloqueio de publicação.

Antes de publicar: responsável, cópia protegida/off-site, retenção, ponto recuperável e teste isolado de recuperação com conferência de ledger/carteiras/compras/Auth; inventariar funções/configurações e secrets em cofre e objetos Storage separadamente. Definir RPO/RTO com responsáveis, sem inventar garantia. [Backups Supabase](https://supabase.com/docs/guides/platform/backups) não incluem objetos Storage. Recuperação deve contabilizar transações posteriores ao ponto escolhido e nunca sobrescrever produção como teste.

## Edge Functions e InfinitePay

Inventário remoto: 14 funções ACTIVE. Oito fontes publicadas foram baixadas em diretório privado isolado. Quatro entradas de mídia coincidem com as locais, mas dependências compartilhadas administrativas precisam acompanhar o rollout. As quatro financeiras diferem e devem ser atualizadas após o banco. Checkout publicado já usa RPCs de reserva/finalização; confirmação publicada usa `confirm_infinitepay_cash_purchase`, sem DML direto na carteira. O backend novo preserva essas assinaturas, permitindo banco antes das Edge. A nova Edge depende dos RPCs de sessão/lease/conciliação do banco novo.

Webhook remoto mantém verify_jwt=false; demais funções JWT=true. Preservar o webhook para pagamentos em curso durante a publicação. Sua entrada pública não prova pagamento: a implementação confirma servidor-servidor. Nomes de secrets necessários estão presentes; valores/validade do lojista não foram testados. `INFINITEPAY_API_KEY` está ausente: opções avançadas continuam desativadas. Nenhum pagamento/chamada financeira real foi realizado.

[Contrato oficial InfinitePay](https://www.infinitepay.io/checkout-documentacao): links, preços em centavos e payment_check com handle/order_nsu/transaction_nsu/slug. Não presumir consulta por pedido sem identidade, endpoint de estorno ou autenticação de chargeback. Provedor real, opções avançadas e política de reembolso dependem de validação separada. Estornos e novos cron de conciliação continuam desativados.

## GitHub, Vercel e riscos de implantação

Base remota observada: `0cdde0e`; main local tem três commits adicionais (`7b6738e`, `c3cb962`, `341c819`). Alterações desta verificação permanecem no working tree, sem novo commit, push ou descarte. Assinatura automática anterior falhou com 403 Author is invalid; não foi desativada configuração nem criado novo commit sem assinatura nesta etapa.

GitHub main informa protected=false; APIs de proteção/rulesets retornaram 403 exigindo plano compatível para repositório privado. Não foi estabelecida obrigatoriedade de checks/assinatura. Último CI da base passou JS/SQL, preview Supabase pulado por ausência de homologação. Mudanças atuais exigem CI em branch autorizada antes de integração.

Vercel confirmada por leitura: equipe danielalvesliras-projects, projeto treinos_academia, GitHub Danielalveslira/treinos_academia, productionBranch main, createDeployments enabled e autoAssignCustomDomains true. Produção READY aponta para 0cdde0e. **Push/merge em main pode publicar frontend automaticamente.** Antes de qualquer envio, estabelecer sob autorização um bloqueio de publicação automática ou uma janela que assegure banco/Edge antes de promoção. Não alterar configuração remota ou proteção sem autorização.

Tamanho financeiro atual: wallets 57.344 bytes, ledger 180.224 bytes, purchases 237.568 bytes. Isso reduz custo esperado de índices, mas não garante locks curtos em presença de transações concorrentes. A nova policy altera somente metadados, com lock_timeout 5s; sem reescrita de histórico ou novo índice. Não há nova medição de latência; o benchmark histórico não mede esta correção.

## Plano e contingência

Comandos detalhados no [runbook](../ECONOMIA_RUNBOOK.md). Ordem: recuperação comprovada → gate de publicação e CI → pré-check atual/dry-run14 → banco → oito Edge Functions → verificações backend → build Vercel controlado sem domínio → smoke autorizado → promoção do mesmo build → observação. Não executar automaticamente.

Em 0/5/15/60 minutos: executar `finance-postdeploy-readonly.sql`, comparar contagens/deltas com baseline e observar erros Auth/Edge/InfinitePay, pending/needs_review, crédito sem ledger, duplicidade, reversões/obrigações e deadlocks. O script depende do schema novo, foi validado somente localmente e não foi executado em produção. Não iniciar cron novo nem alterar saldo automaticamente.

Contenção sob aprovação: desativar novos pacotes cashPackages.active e/ou ações específicas economy_reward_rules.enabled, mantendo confirmação dos pagamentos iniciados. Conservar ledger, evidências, leases e backoff. Reverter frontend/Edge somente para versão compatível com o banco; reparar schema por roll-forward testado. Não restaurar snapshot por rotina nem apagar transações. Se DDL falhar: interromper rollout, conferir journal real e locks, corrigir a causa e repetir apenas pendentes, sem migration repair artificial.

**Decisão: BLOQUEADO.** Dados financeiros diagnosticados consistentes, correção local adicional validada de forma focal; publicação depende de backup/restauração comprovados, controle do deploy automático, validação CI atual. Nenhuma alteração financeira remota, deploy, push, merge ou pagamento foi autorizado/executado.

## Encerramento local

Banco descartável parado após validação; nenhuma carga ficou em execução. Disco com 9,5 GB livres (69% utilizado). Servidor Vite 5173 reiniciado após constatar que havia parado durante a pausa. Alterações novas permanecem não commitadas para revisão/assinatura; os três commits anteriores continuam locais. `git diff --check`, sintaxe Node, YAML e hashes das 13 candidatas originais aprovados.
