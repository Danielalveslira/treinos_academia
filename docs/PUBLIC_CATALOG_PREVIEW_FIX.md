# Contador nas prévias protegidas

Causas confirmadas em 27/10/2026:

- `VITE_SUPABASE_ANON_KEY` tinha somente target Production na Vercel. A função existia no deploy Preview, mas retornava 503 por falta dessa configuração.
- O cliente usava `credentials: 'omit'`, descartando a sessão do proxy de acesso do Codespaces/Vercel. A requisição do JSON podia ser redirecionada ao login do provedor; o fallback neutro preservava a página, mas escondia a contagem.

Correção: disponibilizar a mesma chave **pública anon** também em Preview, preservando criptografia/valor e escopo Production, e usar `credentials: 'same-origin'` na leitura do endpoint. Nenhum JWT do usuário ou cookie é repassado ao Supabase pelo backend: a função continua lendo somente o snapshot com a chave anon fixa. O endpoint de produção continua anônimo e público; a proteção do deploy não foi desativada.

Banco verificado: 867 exercícios `published`/ativos. Snapshot de produção: 867, revisão 2, gerado inicialmente pela migration e reconciliado automaticamente pelo pg_cron. Não há nova migration nesta correção.

A arquitetura de cache não muda: o browser lê apenas `/api/public-catalog-snapshot`; a função consulta somente `public_catalog_snapshot` em um miss do CDN. O worker recalcula o catálogo após eventos confirmados. CDN 60 s, navegador revalida, sem polling ou Realtime.

Validação direcionada: quatro testes do contador, com nova asserção sobre credenciais same-origin. O deploy Preview deve ser reconstruído para receber a variável. A prova visual usa uma sessão de acesso ao deploy e depois remove os cabeçalhos de automação: o JSON e o número precisam funcionar apenas com o cookie da sessão, reproduzindo a navegação real. Nenhuma suíte JS/SQL completa foi repetida manualmente.
