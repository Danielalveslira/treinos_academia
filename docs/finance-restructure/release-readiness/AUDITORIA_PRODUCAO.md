# Auditoria de produção — parcial, bloqueada

Em 2026-10-28, projeto confirmado `ywrjojrjgozdfpddkkuy` (evolutus.com.br). Única consulta executada: `scripts/release/finance-production-audit-probe.sql`, BEGIN READ ONLY, timeouts de 5 s/2 s e ROLLBACK. Resultado agregado: read_only=on, PostgreSQL 17.6, database postgres, role postgres, superuser=false e bypassrls=true. Registro contém 176 migrations; maior versão 20261127000001. Tabelas commercial_orders, evocash_price_versions, product_storefronts e advertising_placements ausentes. Captura: 2026-10-28T19:54:39.68667Z. Nenhuma consulta de registros financeiros/editoriais foi feita.

## Ocorrência de transporte e interrupção

A CLI 2.119 emitiu `Initialising login role...` antes da consulta. Seu [handler oficial](https://github.com/supabase/cli/blob/v2.119.0/apps/cli/src/commands/db/query/query.handler.ts) executa preflight que pode criar/rotacionar login temporário antes de usar a Management API. Esse comportamento deveria ter sido verificado antes. As instruções SQL foram somente leitura, mas não é possível atestar ausência de alteração de metadados de autenticação pelo transporte. O efeito remoto exato não foi auditado independentemente. Nenhuma tentativa de desfazer permissões, excluir role ou repetir o comando foi executada.

Toda consulta adicional por esse caminho foi interrompida. Auditoria completa BLOQUEADA: não há credencial disponível para conexão previamente provisionada somente leitura sem preflight. A versão 2.122 também contém esse preflight; atualizar a CLI não resolve. Operador autorizado deverá verificar logs/role temporária e definir o tratamento; não executar limpeza automática.

Próxima coleta deve usar conexão read-only existente ou a [API dedicada de consultas somente leitura](https://supabase.com/docs/reference/api/v1-read-only-query), com escopo mínimo e segredo fora de logs. Não extrair credenciais nem criar usuários para contornar o bloqueio. Usar transações READ ONLY, timeouts, consultas limitadas, sem RPCs com efeitos colaterais; guardar resultados brutos privadamente e publicar apenas hashes/agregados.

## Classificação das diferenças

| Evidência | Classificação | Tratamento |
|---|---|---|
| 176 registros versus 205 arquivos locais | Esperada, necessita investigação/migrations | Comparar lista completa e definições antes de determinar conjunto faltante |
| Quatro tabelas novas ausentes | Necessita migration | Sequência candidata em MIGRATIONS_DEPLOY.md; aplicação não autorizada |
| Maior versão coincide com baseline da main | Compatível apenas como indicador | Contagem e máximo não provam equivalência de versões/hashes |
| Role consultada bypassa RLS | Potencialmente perigosa | Exigir transporte mínimo e testar RLS isoladamente, sem escrita em produção |
| Possível criação/rotação de login pelo preflight | Necessita intervenção operacional | Auditar efeito com responsável pelo ambiente |
| Inventário completo/financeiro/editorial não coletado | Bloqueante | Não inferir tabelas vazias ou inexistência de divergências |

## Inventário ainda necessário

Comparar tabelas/colunas, PK/FK/checks/índices, triggers, views, funções e search_path, SECURITY DEFINER, ACL/grants, RLS/policies, Auth, Storage e publicação Realtime. Coletar lista integral de versões; hashes só podem ser comparados quando houver fonte equivalente ao arquivo original, não presumir que registry armazena SHA256.

Usar os SQLs existentes em scripts/release: finance-production-readonly.sql, finance-catalog-readonly.sql, finance-dependencies-readonly.sql e commercial-baseline-readonly.sql, após revisão para o schema efetivo. Ausência de objeto deve ser tratada na coleta, sem instalar objetos auxiliares. O checker histórico com versão fixa não constitui gate desta implantação.

Auditoria financeira pendente: saldo versus ledger por moeda, compras confirmadas sem crédito, duplicidades, órfãos, reversões, contratos/direitos e estados parciais. Auditoria editorial pendente: contagens e vínculos de produtos, comunidades, anúncios, promoções, proprietários e mídias. Não foram classificados registros como sintéticos ou reais, nem concedidos direitos ou saldos. A informação de ausência de clientes EvoCash não substitui consulta.
