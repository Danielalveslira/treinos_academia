# Publicidade: auditoria da reformulação

Estado desta entrega: pausa voluntária implementada e validada em banco local descartável; exclusão definitiva **bloqueada** até separar evidência imutável de conteúdo editorial. Nenhuma migration foi aplicada em produção.

## Estados e permissões

| Situação | Antes | Com a migration proposta |
|---|---|---|
| Proprietário pausa anúncio pago | `moderation_state=suspended`, igual a sanção administrativa; não pode retomar | `advertiser_paused_at/by` identificam a pausa; a entrega para imediatamente; só o autor ainda autorizado pode retomar durante o período vigente |
| Administrador suspende | `moderation_state=suspended` | Continua `suspended`, exige permissão administrativa e justificativa; retomada do proprietário é negada |
| Suspensão antiga sem origem comprovada | Indistinta na tela | Continua administrativa/desconhecida; nunca ganha `advertiser_paused_by` por inferência |
| Contrato vencido | Não elegível para entrega | Retomada voluntária negada; renovação permanece condicionada ao motor comercial |
| Arquivamento legado | Oculta entrega sem apagar conteúdo | Continua reconhecido, mas a ação saiu da interface principal; não é apresentado como exclusão |

A consulta `get_advertising_campaigns` entrega o sinal autorizado `advertiser_paused` na mesma página de 20 itens. A projeção de status privilegia suspensão administrativa, depois pausa voluntária, depois validade e entrega. O fluxo usa a trava já compartilhada de `commercial_resources`; pausa e retomada só acrescentam operações de auditoria, sem alterar ordens ou reservas.

## Matriz de dependências para exclusão física

| Tabela / objeto | Papel e vínculo | Destino exigido para exclusão segura |
|---|---|---|
| `public.sponsored_ads` | Projeção pública com título, texto, destino e mídia; FK para `commercial_resources` | **Apagar fisicamente** para anúncio gerenciado, após resolver dependências editoriais; nunca confundir com anúncio institucional ou legado |
| `private.advertising_drafts` | Conteúdo privado e FK para `sponsored_ads` | **Apagar fisicamente**, com isolamento de revisão/contratação concorrente |
| `private.advertising_revisions` | Título, texto, destino e mídia históricos; FK para `sponsored_ads`; trigger `advertising_revision_immutable` rejeita `DELETE` | **Apagar conteúdo criativo**, mas antes projetar evidência mínima de decisão editorial e uma política de retenção aprovada; o trigger atual impede a remoção |
| `public.advertiser_campaigns` | Índice legado de associação e título; sem FK para `sponsored_ads` | Apagar a associação operacional; métricas agregadas precisam continuar consultáveis conforme política de privacidade |
| `private.commercial_resources` | Âncora da identidade e moderação; FK de ordens, operações, inventário, mídia e direito | **Reter âncora mínima** enquanto houver referências financeiras ou de auditoria; retirar capacidade de publicação e dados criativos após migração de modelo |
| `private.advertising_resource_inventory` | Escopo preparado, FK para recurso; trigger imutável | Reter enquanto pedidos e capacidade exigirem; a remoção direta é bloqueada |
| `private.advertising_order_inventory`, `private.advertising_reservations` | Escopo e janela de ordens; triggers imutáveis | Reter junto com ordem para contabilidade de capacidade e restituição; exclusão não deve devolver dias ou crédito automaticamente |
| `public.commercial_orders`, eventos, ledger, comprovantes e pedidos de reembolso | Valor, prazo, aceite e direitos financeiros; FKs para recurso | **Reter**; nenhuma cascata ou edição para forçar deleção |
| `public.visibility_entitlements` | Direito vigente, FK para recurso e ordem | Reter como prova financeira, mas impedir seleção do anúncio excluído no mesmo commit |
| `public.advertising_operations` | Auditoria com FK para recurso; trigger imutável | **Reter** e acrescentar evento mínimo de exclusão quando o domínio estiver pronto |
| `public.storefront_media` e Storage | Mídia ligada ao recurso; revisões e projeções podem referenciá-la; existe manutenção com lease e grace period, desativada por padrão | Verificar todas as referências e conectar a exclusão à limpeza pós-commit reconciliável. Nunca apagar Storage antes do commit |
| `public.sponsored_ad_daily_stats` | Métricas históricas sem FK proposital para `sponsored_ads` | Avaliar retenção e anonimização; não permitir que a ausência do cadastro recrie prévias ou associe conteúdo excluído |

### Bloqueios concretos

1. `advertising_revisions` contém material criativo e é imutável. Seu FK impede excluir `sponsored_ads`. Alterar apenas o card ou o status não cumpre a exclusão física.
2. A âncora `commercial_resources` é alvo de FKs de ordens e operações imutáveis. Excluir essa âncora destruiria a cadeia financeira ou falharia por integridade.
3. Mídias prontas usam `storefront_media` e Storage com referências em revisões, rascunho e projeção. A manutenção genérica existente depende de habilitação e prazo de tolerância; ainda não há integração para garantir a limpeza de uma campanha excluída.
4. A Política de Privacidade vigente (`legal/documents.json`) admite retenção restrita de compras, reembolsos, atendimentos, moderação e segurança pelo tempo necessário a deveres legais ou defesa de direitos. Ela não fixa uma regra operacional para separar metadados de decisão do conteúdo criativo de cada revisão; não se pode decidir essa purga por suposição.

Antes de habilitar “Excluir anúncio”, é necessária uma migration que separe evidência mínima de conteúdo criativo, preserve referências comerciais e autorize a purga editorial com um procedimento transacional estrito. A API deve devolver sucesso só depois do `DELETE` efetivo de `sponsored_ads` e `advertising_drafts`; uma fila persistente deve finalizar a mídia após o commit. Até isso estar implementado e testado, a ação de exclusão permanece indisponível para usuários e administradores.

## Validação local

Todas as migrations foram aplicadas na stack Supabase descartável. `advertising_campaigns_test.sql` passou 61 asserções, incluindo pausa, retomada, ausência de débito e autorização cruzada. `advertising_desired_duration_delivery_test.sql` passou 13, `commercial_engine_test.sql` passou 65 e `advertising_progress_banner_test.sql` passou 34. Cada fixture SQL foi revertida ao final da transação. Essa validação não demonstra a exclusão física, que segue indisponível.
