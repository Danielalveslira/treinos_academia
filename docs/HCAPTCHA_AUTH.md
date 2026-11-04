# hCaptcha no Supabase Auth

Configure `VITE_HCAPTCHA_SITE_KEY` com a chave **pública** do site no build da Vercel. A chave secreta fica somente na configuração de CAPTCHA do Supabase Auth. Não a coloque em variáveis `VITE_*`, arquivos do repositório ou logs.

Todo build de produção do Vite, inclusive previews da Vercel, exige CAPTCHA e uma Site Key pública válida para o respectivo domínio. Sem a Site Key, as telas mostram uma mensagem de indisponibilidade e as funções de autenticação não chamam o Supabase. A flag `VITE_HCAPTCHA_ENABLED=true` serve para habilitar o widget durante `vite dev`; ela não desliga a exigência em builds de produção. O servidor continua sendo o responsável pela validação. Se uma preview apontar para o Supabase de produção, configure uma Site Key autorizada também para o domínio dessa preview.

Para desenvolvimento local com CAPTCHA habilitado, use as [chaves oficiais de teste do hCaptcha](https://docs.hcaptcha.com/#integration-testing-test-keys) e configure a chave secreta correspondente apenas na instância **local** do Supabase. Não configure a chave de teste no Supabase hospedado.

Antes de publicar:

1. Confirme que os domínios de produção e preview necessários estão autorizados no hCaptcha e que cada build usa a Site Key correspondente.
2. Confirme que o Supabase Auth do mesmo ambiente está configurado para hCaptcha com a Secret Key correspondente.
3. Teste cadastro, login, recuperação, reenvio de OTP e reautenticação administrativa em preview, incluindo expiração, erro de rede e nova tentativa. Não use contas reais de produção para esses testes.
4. Verifique que o bundle da Home não contém o widget e que a chave secreta não aparece nos artefatos ou logs.

O token é mantido apenas em memória, consumido uma vez e descartado após cada tentativa. A aplicação não valida o token por conta própria.
