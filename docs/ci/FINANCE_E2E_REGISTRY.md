# Imagens do finance-e2e

O job `finance-e2e` usa cinco imagens oficiais do Supabase, com versão e digest OCI
fixos em `scripts/homolog/finance/images.mjs`. Cada imagem obtida é inspecionada
contra o digest esperado antes de executar seu ID imutável. Erros de digest,
certificado, autenticação ou origem desconhecida interrompem o job.

## Falhas observadas em 29/10/2026

- Na execução `40913214336`, a aquisição de `storage-api` falhou após tentativas
  no GHCR e no ECR; os testes financeiros não começaram.
- Na execução `40917429740`, o mesmo ocorreu com `gotrue`. `js`, `sql` e
  `secrets` passaram; `finance-quality` falhou como consequência obrigatória.
- Consultas diretas aos dois digests no GHCR responderam
  `toomanyrequests` (HTTP 429). O ECR serviu os manifestos fixados de ambas
  as imagens durante a investigação. Os logs antigos não preservavam a categoria
  do erro no pull das camadas pelo ECR.
- A execução `40929761592`, já com o diagnóstico novo, recebeu `rate_limit`
  nas três tentativas de **cada** registry para `postgres`. Isso confirma HTTP
  429 em ambos os caminhos naquele runner; o digest não foi rejeitado.

## Recuperação segura

O pull tenta cada registry até três vezes, com esperas limitadas de 2 e 8
segundos, antes de mudar de registry. Isso recupera falhas transitórias, mas
não vence um bloqueio 429 sustentado. O log registra apenas uma categoria de
disponibilidade, sem expor stderr potencialmente sensível. O cache Docker do
próprio job continua aceito somente após verificação do digest. Cada job do
GitHub usa uma VM nova; um cache persistente precisaria de um produtor confiável,
verificação após a restauração e controle do tamanho. Não habilitamos gravação
de cache por PRs para evitar envenenamento de cache.

Se ambos os registries continuarem indisponíveis, `finance-e2e` e
`finance-quality` devem permanecer vermelhos. Reexecute os jobs falhos pela
interface do GitHub quando os registries se recuperarem; examine a categoria
registrada antes de considerar outra mudança. Para disponibilidade sustentada,
um responsável pode provisionar acesso autenticado aos registries ou um espelho
confiável com os mesmos digests, após revisão da origem e das credenciais. Nunca
substitua por tag mutável, ignore o gate ou aceite uma imagem com digest diferente.
