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
  do erro no pull das camadas pelo ECR, então sua causa exata naquele runner
  continua indeterminada.

## Recuperação segura

O pull tenta cada registry até três vezes, com esperas limitadas de 2 e 8
segundos, antes de mudar de registry. O log registra apenas uma categoria de
disponibilidade, sem expor stderr potencialmente sensível. O cache Docker do
próprio job continua aceito somente após verificação do digest; não há cache
persistente entre runners porque um arquivo de imagem compartilhado exigiria
controles adicionais de tamanho, integridade e procedência.

Se ambos os registries continuarem indisponíveis, `finance-e2e` e
`finance-quality` devem permanecer vermelhos. Reexecute os jobs falhos pela
interface do GitHub quando os registries se recuperarem; examine a categoria
registrada antes de considerar outra mudança. Nunca substitua por tag mutável,
ignore o gate ou aceite uma imagem com digest diferente.
