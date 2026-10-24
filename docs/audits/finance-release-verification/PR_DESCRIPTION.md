# fix: concluir segurança financeira e preparar publicação controlada

A leitura administrativa de lembretes financeiros aceitava JWT de sessão revogada, e `set_training_preferences` permitia shadowing do catálogo de fusos. Este conjunto exige sessão ativa nessa política e qualifica o catálogo PostgreSQL, preservando saldos, lançamentos e regras econômicas. Também bloqueia por HTTP os arquivos privados de auditoria no Vite, com regressão real de servidor.

O CI passa a testar migrations/SQL/Functions em Supabase local descartável, reutiliza a CLI do lockfile e agrega JS/SQL/scanner em `finance-quality`. Os testes reais de Push deixam de depender de um caminho específico do container. Os scripts de release validam diagnósticos e preparam um hold Vercel; a configuração Git impede publicação automática de main e desta branch quando o arquivo for integrado.

Os três commits locais anteriores foram preservados; os commits novos são preparados com assinatura SSH de Danielalveslira. Nenhuma migration histórica ou candidata original foi reescrita. Há 14 migrations pendentes no último diagnóstico remoto bem-sucedido, incluindo a nova policy de sessão.

## Validação

SQL: 69 suítes/3.035 assertivas; aplicação: 2.092; Functions: 207; scripts: 17; todos sem falhas/skips. Instalação limpa/upgrade: 162/148+14, dados preservados. Lint zero erros/16 avisos antigos; build aprovado. Os resultados finais desta preparação estão em `PR_READINESS.md` e `pr-readiness-evidence.json`. Logs e resultados históricos permanecem separados. Não considerar os checks de uma execução antiga como aprovação deste SHA; o CI real desta branch depende do push autorizado.

## Publicação bloqueada

- Backup lógico restaurado e conferido; custódia externa e chave independente ainda não comprovadas. Container temporário com cópia real descriptografada removido.
- GitHub CLI/HTTPS autenticados como Danielalveslira, com admin; assinatura SSH verificada. Main sem proteção; API de proteção retorna 403 por plano. `finance-quality` falha corretamente, mas não é requisito de merge imposto pelo GitHub hoje.
- Logins Supabase/Vercel confirmados em 2026-10-24. Leitura/dry-run confirmam 148 versões/14 pendentes e zero divergências financeiras. Vercel ainda está com autoAssignCustomDomains=true; o hold depende de autorização. A configuração local não comprova hold remoto ativo.
- Sem push, merge, deploy, pagamentos reais ou migrations remotas nesta entrega. O template de promoção continua desativado, fora de `.github/workflows`.

Somente após sanar esses impedimentos e obter autorização: enviar esta branch, acompanhar CI do SHA exato e abrir este PR como draft. Banco → oito Edge Functions → validação backend → build production sem domínio → smoke aprovado → promover o mesmo build. Estornos automáticos e novos cron continuam desativados.
