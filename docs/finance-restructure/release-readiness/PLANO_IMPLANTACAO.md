# Implantação controlada — preparação, execução não autorizada

## Ordem e critérios de interrupção

1. Aprovação humana do PR, HEAD e CI verde; main atualizada sem conflitos. Auto-merge desligado. Nenhum merge nesta execução.
2. Encerrar bloqueio do transporte de auditoria; coletar inventário integral e comparar versões/ACL/RLS/contratos e dados legados. Revisar a possível role temporária da CLI com operador autorizado. Qualquer diferença financeira, grant inesperado ou migration desconhecida interrompe o plano.
3. Responsável de infraestrutura produz backup consistente do banco, roles/configurações necessárias e manifesto privado do Storage com cópia/versionamento dos objetos. Validar restauração em projeto isolado, contagens, FKs, saldo/ledger por moeda, pedidos/reversões, links editoriais e amostra autorizada de mídias. Registrar checksum, horário, RPO/RTO medidos e responsável nominal. Backup/restore ainda NÃO executado nem validado nesta etapa.
4. Confirmar secrets por nomes/presença, sem valores em logs: merchant/API key, URLs permitidas, JWT/Auth, gateway e jobs. Confirmar contratos do provedor sem cobrança. Realtime hospedado e Storage/CDN permanecem dependências não homologadas aqui.
5. Planejar janela conjunta backend/frontend. Suspender novas operações comerciais por controles oficiais antes de qualquer mudança incompatível. Não deixar frontend antigo chamar RPC removida/alterada; usar janela de manutenção ou compatibilidade comprovada, sem adapters improvisados.
6. Após autorização explícita de produção, aplicar somente sequência revisada em MIGRATIONS_DEPLOY.md, em ordem, com pré/pós-checks por migration. Definir limites de lock e plano de interrupção. Não usar supabase db push indiscriminado, reparar registry por suposição ou rodar fixtures.
7. Publicar Edge Functions compatíveis e políticas/gateway/Storage antes do frontend dependente; confirmar grants, RLS, buckets privados, jobs e publicação Realtime. Não trocar secretos/configuração real por fixtures. Deploy depende de autorização separada.
8. Publicar frontend compatível; executar verificações seguras abaixo, mantendo vendas e métricas desligadas. Só depois, nova aprovação específica poderá autorizar preços e ativação comercial.

## Estado obrigatório dos gates

Compras EvoCash, checkout real, sales_enabled/integration_ready dos offerings e coleta de métricas permanecem desativados, sem preços de fixtures, grants gratuitos, crédito por migration ou renovação automática. Consultar estado real no destino antes e depois: ainda não verificado integralmente. Ausência de uma configuração não autoriza habilitar outra. Manter conciliação de pedidos existentes disponível conforme mecanismo atual, mesmo ao pausar novas vendas.

## Pós-instalação seguro

Sem inserir fixtures ou executar compra/débito: consultar carteira própria autorizada e configuração; comprovar recusa de cotação/contratação sob gate fechado; conferir ACL/RLS sem bypass e sessão inválida; examinar estruturas ledger e diagnostics read-only. Conferir diretórios públicos, moderação, vigência/suspensão, SEO/canonical/sitemap/404/503, metadados sem revisão privada, gateway e cache, service worker, rewrites e console. Testar Realtime desconectado/reconectado e fallback limitado sem restaurar resposta antiga. Operações que precisem criar usuário/recurso ou alterar estado no destino exigem autorização e limpeza auditável específica.

## Monitoramento e recuperação

Responsável de operação acompanha erros/latência das funções, pedidos pendentes/incertos, falhas de conciliação, divergências ledger, autorização, indisponibilidade técnica de publicidade, Realtime, Storage e jobs. Usar IDs técnicos e agregados sem payloads pessoais/segredos; não inferir indisponibilidade pela ausência de impressões. Definir destino de alertas, retenção, plantão e limiares com responsáveis antes do lançamento; não foram provisionados nesta etapa.

Incidente: desligar novas vendas/contratações pelos gates, preservar pedidos/ledger/direitos e conciliação; pausar exibição quando autorização não puder ser comprovada. Investigar read-only. Preferir correção aditiva e reprocessamento idempotente oficial. Reverter frontend apenas se contratos compatíveis comprovados. Não desfazer migrations destrutivamente, apagar operações ou ajustar saldo manualmente. Restauração de backup financeiro exige análise de todos os pagamentos posteriores e plano de replay/conciliação autorizado; não sobrescrever produção para simular rollback.

Responsáveis nominais por banco, Storage, aplicação, finanças, segurança e recuperação continuam pendentes de designação pelo proprietário. Não há RTO/RPO ou SLA de produção comprovado.
