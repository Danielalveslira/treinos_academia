# Checklist de validação — escrita offline (`VITE_OFFLINE_WRITE_ENABLED=true`)

Fase 3.1. Roteiro para validar em **aparelho/navegador real contra um Supabase de homologação** antes de ligar a
flag em produção. A coluna "Automático" indica o que já foi executado em Chromium real (IndexedDB, Web Locks,
BroadcastChannel, `fetch` e Service Worker reais) contra um servidor mock com a mesma semântica da RPC; isso **não
substitui** a rodada em aparelho com o backend de verdade.

## Preparação

1. Build de homologação com `VITE_OFFLINE_WRITE_ENABLED=true` (as variáveis do Supabase de homologação).
2. Aplicar as migrations `20261016000001_offline_workout_sync.sql` e `20261016000002_security_hardening_followup.sql`.
3. Duas contas de teste (A e B), cada uma com ao menos um exercício. Instalar o PWA no Android e no iPhone.
4. Ter à mão: o SQL Editor/`psql` da homologação (para conferir `workouts` e `offline_mutation_receipts`) e um
   segundo aparelho ou aba anônima para o cenário de conflito.

## Cenários

| # | Cenário | Passos | Resultado esperado | Automático |
|---|---|---|---|---|
| A | Perder a internet durante o treino | Abrir online → iniciar treino → modo avião → registrar várias séries → editar uma → excluir uma → fechar o PWA → reabrir ainda offline | Os dados continuam; o indicador mostra "N alterações salvas neste aparelho"; nada some | ✅ A1–A9 |
| A′ | A internet volta | Desligar o modo avião e aguardar | Sincroniza sozinho; os dados aparecem no Supabase; a outbox zera; nenhuma duplicação; o registro excluído some | ✅ A10–A11 |
| B | A rede cai durante o sync | Criar várias pendências offline → religar a rede → derrubar de novo durante o envio → religar | Recupera depois; nenhuma linha duplicada; recibos = nº de mutações | ✅ B1–B4 |
| C | Duas abas/PWAs | Abrir 2 abas da mesma conta → criar pendência → religar a rede nas duas | Só uma sincroniza (a outra mostra "locked"/apenas atualiza); o servidor recebe o lote uma vez | ✅ C1–C3 |
| D | Logout com pendência | Criar pendência offline → ver o aviso no menu da conta → sair → entrar com a conta B → sair → entrar com A | O aviso aparece só com a quantidade; B não vê nem sincroniza a fila de A; A recupera e sincroniza | ✅ D1–D7 |
| E | Conflito | Aparelho 1 offline altera um treino; aparelho 2 altera o mesmo treino no servidor; aparelho 1 volta | Conflito detectado, nada sobrescrito; "Manter o meu" aplica; "Usar o do servidor" restaura e esvazia a fila | ✅ E1–E5 |
| F | Resposta perdida depois do INSERT | Simular a resposta perdida após o servidor persistir o registro (queda de socket e timeout de 8 s) | Entra na fila com o mesmo id; a RPC reconhece a linha existente (`already_applied`), 1 linha, 1 recibo, `created_at` intacto | ✅ F1–F7 |
| G | Atualização do PWA com fila cheia | Com pendências (inclusive uma `syncing`), publicar um build novo → aceitar "Atualizar" → reabrir (inclusive offline) | A fila fica idêntica; o texto do diálogo diz que os registros já estão salvos; o shell abre offline pelo cache | ✅ G1–G14 |
| H | Finalizar treino | (1) Offline: tentar finalizar. (2) Online com pendência de ontem em conflito + alterações de hoje pendentes: finalizar | (1) Botão desabilitado, mensagem "Conecte-se à internet…"; nada na fila. (2) Sincroniza as de hoje, conclui e a pendência antiga continua no indicador | ✅ (serviço/regra) · ⬜ UI real |

## Só em aparelho real (não cobertos pela automação)

- **iPhone (Safari/PWA instalada):** persistência do IndexedDB com a PWA fechada por muito tempo, `navigator.storage.persist()`,
  e Web Locks/BroadcastChannel em versões antigas do iOS (o fallback por `localStorage` deve cobrir).
- **Android de entrada com pouco armazenamento:** comportamento com cota quase cheia (a escrita local deve falhar de forma
  visível, nunca "salvar" sem salvar).
- **Rede instável de academia** (Wi‑Fi sem saída, 4G oscilando): confirmar que o indicador não pisca nem fica em
  "Sincronizando…" indefinidamente.
- **Cold start sem internet:** hoje **não** funciona (o `AuthContext` carrega perfil e termos pela rede). Reabrir offline mostra
  o shell, mas não carrega a conta; fora do escopo desta fase.
- **RLS e `has_app_access()` reais** na RPC (termos pendentes, conta desativada) com usuários reais.

## Conferência no banco (homologação)

```sql
-- 1 linha por registro, sem duplicatas
select id, count(*) from public.workouts group by id having count(*) > 1;
-- recibos por usuário (só leitura de quem tem service_role)
select user_id, count(*) from public.offline_mutation_receipts group by user_id;
-- nenhuma moeda criada pela sincronização
select count(*) from public.economy_transactions where created_at > now() - interval '1 hour';
```
