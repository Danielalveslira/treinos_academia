# Manifesto do release AUD-01 / AUD-02 e catálogo offline

Release de produção autorizado pelo responsável. Destinos confirmados: GitHub `Danielalveslira/treinos_academia`, branch `main`; Supabase `ywrjojrjgozdfpddkkuy`, nome `treinos_academia`; Vercel `prj_WYVlCGYu021KZCrqfp62qRH2cbIE`, equipe `danielalvesliras-projects`, domínio https://treinosacademia-ten.vercel.app.

## Banco — somente duas migrations executáveis novas

1. `20261026000005_aud_security_atomic.sql`: quatro fontes AUD em uma transação gerenciada pela CLI, sem BEGIN/COMMIT internos ou escrita manual no journal. Limites locais: lock 5 s e statement 60 s. Fecha rollback destrutivo, allowlist/autoria de posts e manipulação direta da promoção de comunidades. Grants legados de nome/selo continuam apenas como dicas descartadas pelo trigger. Não modifica dados históricos.
2. `20261026000006_exercise_catalog_offline_converge.sql`: converge funções/trigger do catálogo offline de forma idempotente; inclui apenas a funcionalidade auditada da fonte 25. `CREATE OR REPLACE FUNCTION`, recriação do mesmo trigger e grants de execução. Sem DML, remoção de dados ou alteração de search/RLS. Mesmos contratos keyset, revisão e clamp de 1–50.

Fonte offline 25 já tinha seus três objetos presentes em produção, com corpos equivalentes, sem registro no journal. A versão original não idempotente falhou no ensaio sobre a cópia real. Foi arquivada em `supabase/migration_sources/exercise_catalog_offline/`; nenhuma migration publicada no journal remoto foi editada. As quatro fontes AUD, nunca publicadas no journal remoto, foram arquivadas em `supabase/migration_sources/aud_01_aud_02/`. Não marcar essas cinco versões como aplicadas nem executar repair. O journal remoto inicial possui 123 versões até 20261024000001; o final esperado tem 125, acrescentando somente 05 e 06. Arquivos executáveis e histórico precisam corresponder a esse inventário.

CLI fixada em 2.119.0. Produção usa `db push --skip-vault`, sem include-all, roles, seeds ou mudanças de configuração. Dry-run confirmou somente 05/06 e zero seeds/roles. Caso apareça qualquer outra pendência, abortar.

## Recuperação comprovada

Plano Supabase Free confirmado administrativamente; PITR false e lista de backups vazia. Foi produzido manualmente um snapshot consistente `pg_dump --format=custom` do banco inteiro, com schema, dados, ACLs, Auth, Storage metadata, Vault, journal e dados financeiros. Roles/memberships e configurações/chaves de recuperação capturadas separadamente, sem senhas/PII no Git.

Backup privado fora do Git: `/home/codespace/.local/share/evolutus-backups/release-aud-20261012/backup-payload.enc`. Chave de recuperação em arquivo separado, privado, no diretório pai; não imprimir, enviar no chat ou versionar. Diretórios restritos e arquivo criptografado AES-256/PBKDF2. A decriptação do arquivo foi comparada byte a byte com o payload original; manifestos/hashes detalhados permanecem privados. O proprietário precisa conservar uma cópia segura do arquivo e da chave fora do ciclo de vida do Codespaces antes de excluí-lo; não há rotina automática nem upload a outro provedor nesta tarefa.

Restauração real em PostgreSQL isolado `evolutus_release_restore`, network none, sem portas expostas e cron desativado. Corrigidos apenas conflitos de bootstrap da imagem local, recriadas roles/owners e carregado schema/dados/constraints/ACL/RLS. **130 tabelas idênticas ao snapshot**; Auth e finanças incluídos. Vault descriptografado com chave recuperada e digest igual à origem, sem revelar valores. **60 objetos Storage do snapshot** copiados; inventário dos objetos comuns não mudou, arquivos faltantes da primeira cópia foram recuperados por GET. Recuperação dos arquivos exercitada no backend Storage real sem rede, mantendo metadados/ownership SQL. Uploads posteriores ao snapshot não integram aquele ponto de recuperação.

O backup corresponde ao seu snapshot, não a RPO zero. Não restaurar automaticamente por falha de frontend ou reabrir grants/RPC destrutiva. Depois de COMMIT, usar migration corretiva auditada; frontend pode voltar ao deployment anterior compatível com banco endurecido. Um restore de incidente requer reconciliar transações e uploads posteriores ao ponto de recuperação e preservar financeiro/webhooks. Não reativar jobs ou serviços externos na cópia local.

## Validação nova necessária, sem repetir a suíte aprovada

- Offline: 57 JS e 18 SQL; assertions mantidas. Corrigidas somente a função auxiliar de teste (alias de SETOF UUID, ordenação do cursor e tipos bigint de pgTAP), sem alterar o contrato offline revisado.
- Pacote final aplicado pela CLI real na cópia restaurada de produção: somente 05/06, journal 123 → 125. **129 tabelas de dados preservadas**, excluindo o journal atualizado; Auth, financeiro e Storage sem mudanças.
- Grants locais finais: RPC rollback sem EXECUTE authenticated, metadata promocional/retention sem INSERT, dicas de autor com INSERT e sem UPDATE. Offline 18 SQL também aprovados sobre o schema real restaurado após convergência.
- Lint: zero erros, 14 avisos conhecidos. Diff sem whitespace errors.
- As provas anteriores 1.888 JS, 534 SQL, 105 HTTP, 21 PWA e 20 INSERTs concorrentes permanecem evidências anteriores aprovadas; não foram reexecutadas indiscriminadamente nem tratadas como provas novas de produção.

## Frontend/escopo do commit

Inclui Register (UID preservado/retry), remoção dos helpers de rollback, contrato de publicação compatível antigo/novo, testes/regressões e artefatos/scripts específicos deste release. Atualizações de Exercícios e menu mobile já constam do HEAD f036475 publicado anteriormente; não são mudanças novas deste commit. São verificadas após publicação. Nenhum código incompleto ou arquivo local de usuário deve ser adicionado por `git add .`.

Excluir a auditoria preexistente não versionada, prompts locais e exclusão preexistente do prompt de menu mobile. Backups, chaves, envs e dados reais não pertencem ao commit. Vercel confirmado com vínculo GitHub/main; env de produção aponta ao Supabase correto e usa chave de cliente anon, com offline cold start/write já true. Nenhuma flag remota foi alterada.

## Ordem operacional

Conferir hashes/HEAD/destinos e dry-run → registrar commit exato localmente, sem push → aplicar banco controlado → conferir journal/ACL/RLS/RPCs e cache PostgREST → push do commit validado → acompanhar deployment Vercel production desse SHA → conferir saúde/Auth/contratos, catálogo, navegação desktop/mobile e PWA. Sem promoções/pagamentos reais, testes destrutivos ou dados de terceiros.

Falha crítica antes do COMMIT aborta a transação afetada; após COMMIT registrar estado PARCIAL e preparar corretiva/rollback frontend compatível. Não afirmar deploy concluído sem READY da Vercel e SHA correspondente. Status final e URL serão atualizados em `STATUS_PUBLICACAO_AUD_01_AUD_02.md`.
