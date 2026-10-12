// Emite um pacote SQL revisável; nunca conecta nem aplica migrations.
// Evita a janela de incompatibilidade entre a allowlist estrita (02) e a compatibilidade (03).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const files = [
  '20261026000001_close_account_rollback.sql',
  '20261026000002_status_write_allowlist.sql',
  '20261026000003_status_legacy_author_compat.sql',
  '20261026000004_community_promotion_server_only.sql',
]
const body = "SET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '60s';\n" + files
  .map((file) => {
    const archived = new URL(`../supabase/migration_sources/aud_01_aud_02/${file}`, import.meta.url)
    const source = readFileSync(
      existsSync(archived) ? archived : new URL(`../supabase/migrations/${file}`, import.meta.url),
      'utf8'
    )
    const statements = source.replace(/^begin;\r?$/gm, '').replace(/^commit;\r?$/gm, '')
    const hash = createHash('sha256').update(source).digest('hex')
    return `-- SOURCE ${file}; SHA256 ${hash}\n${statements}\n`
  })
  .join('\n')
const output = process.argv[2] || '/tmp/evolutus-aud-rollout.sql'
// A CLI deve envolver o arquivo E seu registro de histórico na mesma transação.
// COMMIT explícito no arquivo encerraria essa proteção antes do journal.
const cli = process.argv.includes('--cli')
writeFileSync(
  output,
  `-- Pacote indivisível AUD-01/AUD-02; requer revisão e autorização do destino.\n-- Sem escrita manual no journal. Para release, uma migration consolidada via CLI;\n-- somente após confirmar que as quatro fontes nunca foram publicadas.\n${cli ? '-- Transação e histórico sob responsabilidade da CLI.\n' : 'BEGIN;\n'}${body}\nNOTIFY pgrst, 'reload schema';\n${cli ? '' : 'COMMIT;\n'}`
)
console.log(`Pacote SQL gerado: ${output}; nenhuma migration executada.`)
