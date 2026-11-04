# hCaptcha no Supabase Auth

Configure `VITE_HCAPTCHA_SITE_KEY` com a chave **pública** do site no build da Vercel. A chave secreta fica somente na configuração de CAPTCHA do Supabase Auth. Não a coloque em variáveis `VITE_*`, arquivos do repositório ou logs.

Todo build de produção do Vite, inclusive previews da Vercel, exige CAPTCHA e uma Site Key pública válida para o respectivo domínio. Sem a Site Key, as telas mostram uma mensagem de indisponibilidade e as funções de autenticação não chamam o Supabase. A flag `VITE_HCAPTCHA_ENABLED=true` serve para habilitar o widget durante `vite dev`; ela não desliga a exigência em builds de produção. O servidor continua sendo o responsável pela validação. Se uma preview apontar para o Supabase de produção, configure uma Site Key autorizada também para o domínio dessa preview.

Para desenvolvimento local com CAPTCHA habilitado, use as [chaves oficiais de teste do hCaptcha](https://docs.hcaptcha.com/#integration-testing-test-keys) e configure a chave secreta correspondente apenas na instância **local** do Supabase. Não configure a chave de teste no Supabase hospedado.

Antes de publicar:

1. Confirme que os domínios de produção e preview necessários estão autorizados no hCaptcha e que cada build usa a Site Key correspondente.
2. Confirme que o Supabase Auth do mesmo ambiente está configurado para hCaptcha com a Secret Key correspondente.
3. Teste cadastro, login, recuperação, reenvio de OTP e reautenticação administrativa em preview, incluindo expiração, erro de rede e nova tentativa. Não use contas reais de produção para esses testes.
4. Verifique que o bundle da Home não contém o widget e que a chave secreta não aparece nos artefatos ou logs.

A CSP de `vercel.json` autoriza os domínios do hCaptcha apenas em `script-src`, `style-src`, `connect-src` e `frame-src`, conforme a [orientação oficial](https://docs.hcaptcha.com/#content-security-policy-settings). Preserve essas entradas ao alterar os headers: sem elas, o widget é bloqueado pelo navegador antes de gerar qualquer token.

O token é mantido apenas em memória, consumido uma vez e descartado após cada tentativa. A aplicação não valida o token por conta própria.

## Ativação controlada em produção

1. Confirme que a validação CAPTCHA do Supabase está **desativada**. Revogue a Secret Key exposta em captura de tela, gere outra no hCaptcha e configure-a somente no Supabase Auth. Não copie o valor para o repositório, Vercel, navegador ou logs. Mantenha a validação desativada até a etapa 5.
2. Configure `VITE_HCAPTCHA_SITE_KEY` na Vercel Production e autorize o domínio de produção no site correspondente do hCaptcha. Confira a associação entre essa Site Key e a nova Secret Key sem divulgar os valores. Configure separadamente os domínios e as chaves de Preview que serão usados para testes.
3. Após aprovação, faça merge do PR de hCaptcha e publique o frontend. O build de produção **já exige** o widget mesmo com a validação desativada no Supabase; portanto, a Site Key e os domínios precisam estar corretos **antes** do deploy. Sem Site Key, cadastro, login, recuperação e reenvio ficam bloqueados pelo cliente.
4. Com a validação do Supabase ainda desativada, confirme no frontend publicado que o widget carrega e permite concluir cada formulário, inclusive em celular. Use contas de teste no ambiente apropriado; não dispare cadastros ou e-mails reais desnecessários.
5. Somente então, mediante autorização específica, habilite a validação CAPTCHA no Supabase Auth. Valide novamente cadastro, login, recuperação, reenvio de OTP e reautenticação administrativa. Confirme também o tratamento de token expirado e de nova tentativa.

### Reversão em caso de falha

1. Desative a validação CAPTCHA no Supabase Auth para restaurar a compatibilidade do servidor com o frontend anterior.
2. Se o problema for carregamento do widget, domínio ou Site Key, reverta o frontend na Vercel para um deployment anterior ao hCaptcha. **Desativar somente o Supabase não basta**: este frontend continua exigindo o widget em todos os builds de produção.
3. Confirme login e recuperação no frontend restaurado. Corrija a configuração e repita a ativação controlada antes de habilitar novamente a validação no Supabase.

Merge, deploy, mudança no Supabase e reversão em produção exigem autorização operacional; este procedimento não os executa.
