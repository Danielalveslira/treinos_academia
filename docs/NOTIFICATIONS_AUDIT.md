# Auditoria de notificações (código local, 2026-10-05)

`notifications` é a fonte da Central. Inserts chegam por Supabase Realtime e são recuperados
pela leitura paginada ao reconectar. O trigger único cria a outbox apenas quando há preferência
e subscription de Push ativas. Portanto “Push: sim” abaixo significa elegível, não garantia
de exibição pelo sistema operacional.

| Evento / tipo | Sininho | Push | E-mail | Deep link | Preferência |
| --- | --- | --- | --- | --- | --- |
| Curtida em publicação (`post_like`) | Sim | Sim, normal | Não | Publicação na comunidade | `social` |
| Curtida em comentário (`comment_like`) | Sim | Sim, normal | Não | Comentário na publicação | `social` |
| Comentário em publicação (`post_reply`) | Sim | Sim, high | Não | Comentário na publicação | `social` |
| Resposta e resposta de resposta (`comment_reply`) | Sim | Sim, high | Não | Comentário alvo | `social` |
| Menção em comentário (`comment_mention`) | Sim | Sim, high | Não | Comentário alvo | `social` |
| Crédito de EvoCoins/EvoCash, bônus, pagamento confirmado (`economy_credit`) | Sim, exceto razões silenciosas | Sim, normal | Não | `/evocash` | `economy` |
| Débito/ajuste/estorno (`economy_debit`) | Sim, exceto razões silenciosas | Sim, normal | Não | `/evocash` | `economy` |
| Aviso/remoção/suspensão/banimento/restauração (`moderation_notice`) | Sim | Sim, high ou normal | Não | `/atendimento` | `account` |
| Denúncia encerrada, recurso e privacidade (`report_resolved`) | Sim | Sim, normal | Não | `/atendimento` | `account` |
| Nova denúncia (`admin_report`) | Sim, superadmins | Sim, high | Não | `/admin/moderacao` | `administrative` |
| Novo recurso (`admin_appeal`) | Sim, superadmins | Sim, high | Não | `/admin/moderacao` | `administrative` |
| Pedido de privacidade (`admin_privacy_request`) | Sim, superadmins | Sim, high | Não | `/admin/moderacao` | `administrative` |
| Decisão de moderação (`admin_moderation_decision`) | Sim, outros superadmins | Sim, normal | Não | `/admin/moderacao` | `administrative` |
| Restrição (`admin_restriction`) | Sim, outros superadmins | Sim, high | Não | `/admin/moderacao` | `administrative` |
| Exclusão bloqueada por revisão financeira (`admin_deletion_review`) | Sim, superadmins | Sim, high | Não | `/admin/exclusao-contas` | `administrative` |
| Broadcast administrativo (`admin_broadcast`) | Sim | Sim, high | Não | URL interna escolhida | `administrative` |
| Treino planejado: uma hora antes (`workout_reminder_before`) | Sim | Sim, normal | Não | `/novo-treino?planejado=AAAA-MM-DD` | Plano + `workouts` |
| Treino planejado: no horário (`workout_reminder_start`) | Sim | Sim, high | Não | Mesmo destino | Plano + `workouts` |

## E-mail

O repositório só chama o Supabase Auth para confirmação de cadastro e recuperação de senha.
Os templates, tentativas de entrega, logs do provedor e supressão desses e-mails ficam no Auth
e não são observáveis pelo código do app. Não há mailer de produto, tabela de outbox de e-mail,
retry, idempotência ou unsubscribe por tipo. Nenhum dos eventos da matriz envia e-mail hoje.
Avisos de segurança, privacidade, suspensão e transações financeiras relevantes são candidatos
prioritários para uma fila transacional própria; não devem ser ligados a um envio direto de trigger
ou a um e-mail por curtida/comentário.

## Cobertura e lacunas

- Respostas de resposta usam `comment_reply` e a URL do comentário específico.
- Razões de ledger `post_published`, `comment_posted`, `vote_reward`, `vote_charge`,
  `daily_activity`, `workout_completed` e `promotion_purchase` são silenciosas de propósito;
  o objetivo é evitar avisos redundantes por uma ação que o próprio usuário acabou de fazer.
- A agenda semanal anterior só mudava a Home: faltavam Central e Push. Os dois tipos de
  lembrete suprem essa lacuna.
- Criação/convite/entrada/saída de comunidade, convite para treino comunitário e alterações
  de vitrine/profissional não têm produtores de `notifications` identificados nesta auditoria.
  Requerem decisão de destinatário e preferência antes de criar alertas.
- Pedido de exclusão normal não avisa o usuário por sininho/Push/e-mail; só o caso de revisão
  financeira avisa superadmins. O estado da exclusão é consultável no produto.
- A categoria `workouts` já existia no JSON de preferência, mas não havia tipo nem interface
  separada para editá-la. O interruptor do plano desativa os lembretes deste fluxo.

## Lembretes semanais

O plano existente não possui um ID de treino nem exercício específico. A ocorrência é
`(user_id, planned_date, kind)`. O banco converte a data e hora locais no timezone salvo em
`scheduled_at` (`timestamptz`), incluindo regras de horário de verão do PostgreSQL. Um único
cron por minuto busca até 100 linhas vencidas pelo índice parcial e usa `FOR UPDATE SKIP LOCKED`.
Após processar uma etapa, agenda a próxima ocorrência daquela etapa. Jobs com mais de 15 minutos
de atraso são pulados, para não avisar tarde. O Push antecipado expira em 1 hora e o aviso do
horário em 15 minutos; os TTLs dos demais tipos permanecem em 24 horas ou 7 dias. A ausência de subscription impede a outbox de Push,
mas não a notificação na Central. Alterar o plano (horário, dias, fuso ou vigência), desativar o interruptor ou registrar um
exercício cancela jobs futuros e o Push ainda pendente, e arquiva o aviso obsoleto da Central;
salvar o mesmo plano de novo não cancela nada. Migrations: `20261014000003` (tipos) e
`20261014000004` (tabela, gatilhos, cron). A chave de deduplicação da notificação não muda
em retries nem em reagendamentos no mesmo dia.

Um Push já aceito pelo provedor não pode ser revogado pelo aplicativo: se o treino for iniciado
logo após esse aceite e o dispositivo estiver offline, o provedor ainda pode entregá-lo dentro
do TTL. Este limite do Web Push deve ser medido em teste real com o app fechado.

O timezone é fixado ao salvar o planejamento. Ao viajar, salvar o plano novamente atualiza-o
para o timezone atual do dispositivo; com o app fechado o horário segue o timezone salvo.
Não há treino individual para abrir: o deep link entra diretamente no fluxo de iniciar treino,
com a data planejada identificada, e continua útil mesmo se o plano tiver sido removido.
