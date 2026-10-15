# Publicação — Push compacto na Home

**PUBLICADO — produção READY e verificada.**

- Repositório: `Danielalveslira/treinos_academia`, remoto `origin`, branch `main`.
- Commit local/remoto: `2a2d274339177812115292b7b7c1cfedf7349176` — `feat: add compact push activation notice to home`.
- Conta GitHub confirmada: `Danielalveslira`. Os tokens de ambiente falharam com 401; o credential helper do Git autenticou a conta e passou no `gh auth status`. Push normal, sem force, realizado com essa credencial.
- Vercel: equipe `danielalvesliras-projects`, projeto `treinos_academia`, ID `prj_WYVlCGYu021KZCrqfp62qRH2cbIE`, vínculo GitHub/main confirmado antes da publicação.
- Deployment: `dpl_26w4Gv32q28JzjhmWTrMxbtAJ4SS`, target `production`, estado `READY`, SHA igual ao commit publicado.
- Endereço principal: https://treinosacademia-ten.vercel.app
- Deployment: https://treinosacademia-67nrdqzod-danielalvesliras-projects.vercel.app

## Validação

A validação anterior está em `PUSH_HOME_ATIVACAO.md` e seu JSON: 1.934 testes JavaScript aprovados, 151 testes de funções aprovados e um ignorado, 23 cenários Chromium com APIs simuladas. Antes do push, os 60 testes direcionados de Push/calendário/logout foram repetidos e aprovados, assim como o budget.

Após a publicação, HTTP 200 no domínio principal, login, perfil, Service Worker e assets. O JS servido contém o texto curto e o X acessível; o CSS servido contém a faixa compacta sem gradiente. CSP, X-Frame-Options e X-Content-Type-Options conferidos. Chromium anônimo em 390/1366 px abriu o login corretamente, sem erro de JavaScript, sem overflow horizontal e sem pedido de permissão Push.

O verificador inicialmente não encontrou o CSS lazy por causa do formato da referência no bundle; somente a descoberta de assets no harness foi corrigida e o teste final passou. Não houve correção ou segundo deployment de produto por esse motivo.

O smoke em produção foi anônimo: não comprova uma entrega Push real nem Safari/iOS/Android físicos. O fluxo autenticado da faixa foi validado localmente em Chromium com APIs/backend simulados. Não houve envio real de Push, mensagens de teste ou alteração de dados de usuários.

**Sem migrations necessárias.** Nenhuma migration, Edge Function ou configuração remota foi alterada. Alterações preexistentes em outros documentos ficaram fora do commit. Estes arquivos de evidência pós-publicação foram registrados localmente, sem gerar outro deploy apenas para documentação.

Detalhes: `PUSH_HOME_PUBLICACAO_EVIDENCIAS.json`.
