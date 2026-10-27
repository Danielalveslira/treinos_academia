# PR #83 — obtenção das imagens do E2E

O ECR Public recusou o PostgreSQL com `toomanyrequests: Data limit exceeded` em duas
execuções completas. Aumentar retries não resolveu a indisponibilidade do registro.

## Verificação real

A API Registry V2 do GHCR oficial (`ghcr.io/supabase`) respondeu HTTP 200 tanto para
as tags existentes quanto para os cinco digests já fixados na stack. Em cada resposta,
o SHA-256 calculado sobre os bytes recebidos foi idêntico ao header
`Docker-Content-Digest` e ao digest original. Nenhuma versão ou digest foi atualizado.
Os registros e plataformas estão em [pr83-registry-evidence.json](pr83-registry-evidence.json).
Distribuição oficial: <https://github.com/supabase/postgres/pkgs/container/postgres>.

PostgreSQL preservado: `17.6.1.166`, índice OCI
`sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86`.
O manifest Linux/amd64 referenciado continua sendo
`sha256:d5424e9f4d0c21d63991c3f3dd77881f23f722c3a212452a61bc91924b79e8c8`.
O pull real por digest passou, `docker image inspect` confirmou o RepoDigest e
um container efêmero sem rede/volumes executou somente `postgres --version`, retornando
`postgres (PostgreSQL) 17.6`. Nenhum banco foi iniciado nesse teste.

## Estratégia

- Lista fechada das mesmas cinco versões e digests; GHCR oficial primeiro.
- Duas tentativas por registro, com espera limitada; ECR oficial como fallback somente
  em erros de disponibilidade. Os dois registros recebem o mesmo `tag@sha256`.
- Docker verifica os hashes do índice, manifest, configuração e camadas no pull.
  Tanto cache quanto imagem recém-baixada precisam apresentar o RepoDigest esperado,
  ID imutável válido e plataforma Linux suportada antes de serem usados.
- Containers usam o ID verificado com `--pull=never`, impedindo nova resolução por tag.
- Erros de autenticação, certificado, integridade ou outros erros desconhecidos abortam
  sem fallback. Esgotar os dois registros também falha o job.
- Não há novo token, secret, permissão de pacote ou cache `docker save/load`.

## Validação

20 testes do resolvedor aprovados, incluindo fallback para o mesmo digest, falha dos
dois registros, cache divergente, erro de certificado/autenticação e pull com digest
inesperado. Os testes também são executados no próprio job `finance-e2e`.
88 testes de release aprovados; lint sem erros (16 avisos anteriores); scanner sem
achados. Comparação estrutural confirmou os mesmos digests e a preservação dos demais
jobs, de todos os testes existentes e do gate `finance-quality`.

O CI remoto do commit final e seus resultados serão registrados na descrição do PR.
Migrations, código financeiro, Home V4 e PR #82 não foram alterados. Não houve merge
nem publicação em produção nesta correção.
