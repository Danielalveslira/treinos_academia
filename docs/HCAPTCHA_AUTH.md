# hCaptcha no Supabase Auth

## Política do frontend

O Supabase Auth valida o token no servidor. O frontend apenas mostra o widget e
impede chamadas sem token quando ele é exigido. A política usa
`VITE_SUPABASE_URL`, independentemente de `vite dev`, preview ou produção:

| Destino da API | `VITE_HCAPTCHA_ENABLED` | Resultado |
| --- | --- | --- |
| `localhost`, `127.0.0.1` ou `[::1]` | ausente/`false` | Sem widget; use somente se o Auth local não exigir CAPTCHA. |
| API local | `true` | Widget obrigatório; configure a Site Key pública e a Secret Key no Auth local. |
| API hospedada | ausente/`true` | Widget e token obrigatórios. |
| API hospedada | `false` | Erro de configuração; nenhuma requisição protegida é enviada. |

Valores diferentes de `true`/`false` também bloqueiam o fluxo. Quando o widget é
obrigatório, `VITE_HCAPTCHA_SITE_KEY` precisa estar preenchida. O erro aparece
sem detalhes sensíveis na interface e com o código técnico no console de
desenvolvimento. Tokens são mantidos só em memória, consumidos uma vez e
descartados após cada tentativa, inclusive quando o Supabase os rejeita.

## Desenvolvimento local com Supabase hospedado protegido

1. No [painel hCaptcha](https://dashboard.hcaptcha.com/sites), use uma Site Key
   pública cujo site aceite um hostname de desenvolvimento sob um domínio que
   você controla. Se Domain allowlisting estiver ativo, adicione esse hostname
   (somente o nome, sem protocolo ou porta). A Secret Key associada deve estar
   configurada em **Supabase Dashboard → Authentication → Bot and Abuse
   Protection → CAPTCHA** do projeto hospedado. Nunca coloque a Secret Key em
   `VITE_*` ou no repositório.
2. Mapeie o hostname de desenvolvimento para `127.0.0.1` em `/etc/hosts`, por
   exemplo `127.0.0.1 dev.seu-dominio.com`. O hCaptcha não aceita `localhost` ou
   `127.0.0.1` como hostname do widget. Se o site exigir HTTPS, use um proxy/TLS
   local ou túnel HTTPS com hostname autorizado.
3. No `.env` local, configure `VITE_SUPABASE_URL` para a API hospedada,
   `VITE_SUPABASE_ANON_KEY` para a chave pública desse projeto,
   `VITE_HCAPTCHA_ENABLED=true` e `VITE_HCAPTCHA_SITE_KEY` para a chave pública
   do site hCaptcha associado ao mesmo projeto. A configuração atual que usa
   `VITE_HCAPTCHA_ENABLED=false` com Supabase hospedado precisa ser corrigida.
4. Inicie o Vite autorizando **somente** esse hostname:

   ```bash
   __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=dev.seu-dominio.com npm run dev -- --host 127.0.0.1
   ```

   Abra `http://dev.seu-dominio.com:5173/login`. Reinicie o Vite após editar
   `.env`. Caso o hCaptcha ou o navegador exija HTTPS neste contexto, use o
   endereço HTTPS do proxy/túnel e autorize o hostname correspondente.

Para Supabase **local sem CAPTCHA**, use a URL local da CLI e
`VITE_HCAPTCHA_ENABLED=false`; a seção `[auth.captcha]` de
`supabase/config.toml` está comentada. Não use essa configuração para um
projeto hospedado protegido. Se habilitar CAPTCHA no Auth local, use
`VITE_HCAPTCHA_ENABLED=true`, uma Site Key apropriada e a Secret Key somente
na configuração local do Supabase. Chaves oficiais de teste hCaptcha só podem
ser usadas com a Secret Key de teste correspondente em uma instância local.

## Preview e produção

Em **Vercel → Project → Settings → Environment Variables**, configure a
`VITE_HCAPTCHA_SITE_KEY` pública e a URL/chave pública do Supabase para cada
ambiente (Preview e Production). Use `VITE_HCAPTCHA_ENABLED=true` ou remova a
variável. Autorize os hostnames reais de preview e produção no site hCaptcha e
confirme que a Secret Key correspondente está no Supabase Auth desse ambiente.
O build da Vercel precisa ser refeito após mudar variáveis `VITE_*`.

A CSP em `vercel.json` já permite os domínios de script, frame, estilo e rede
do hCaptcha. Os componentes de autenticação são carregados por rota; o script
do hCaptcha não é carregado nas páginas que não usam o widget.

## Verificação

Teste login, cadastro, reenvio de confirmação, recuperação de senha e
reautenticação administrativa no ambiente correspondente. Verifique token
expirado, erro de rede e nova tentativa. Não envie tokens ou senhas para logs.
A proteção do Supabase deve continuar ativa em projetos hospedados protegidos.

Referências: [Supabase CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha),
[hCaptcha Local Development](https://docs.hcaptcha.com/#local-development) e
[Vite allowedHosts](https://vite.dev/config/server-options#server-allowedhosts).
