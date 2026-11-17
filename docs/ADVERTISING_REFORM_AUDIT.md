# Publicidade: auditoria da reformulação

Estado desta entrega: pausa voluntária implementada e validada em banco local descartável, com retomada liberada para qualquer editor autorizado da conta (proprietário ou gerente ativo), não apenas quem originou a pausa. **Exclusão física de anúncios foi retirada definitivamente do planejamento** (decisão de produto, não limitação técnica temporária): arquivar continua sendo a única forma de remover um anúncio da listagem principal. A matriz de dependências abaixo é mantida só como registro histórico de por que uma exclusão física seria arriscada, não como trabalho pendente. Nenhuma migration foi aplicada em produção.

## Estados e permissões

| Situação | Antes | Com a migration proposta |
|---|---|---|
| Proprietário ou gerente autorizado pausa anúncio pago | `moderation_state=suspended`, igual a sanção administrativa; não pode retomar | `advertiser_paused_at/by` identificam a pausa e quem a originou; a entrega para imediatamente; **qualquer** editor ainda autorizado da mesma conta (proprietário ou gerente ativo) pode retomar durante o período vigente -- a pausa é uma ação da conta, não uma trava pessoal de quem clicou primeiro |
| Administrador suspende | `moderation_state=suspended` | Continua `suspended`, exige permissão administrativa e justificativa; retomada do proprietário/gerente é negada |
| Suspensão antiga sem origem comprovada | Indistinta na tela | Continua administrativa/desconhecida; nunca ganha `advertiser_paused_by` por inferência |
| Contrato vencido | Não elegível para entrega | Retomada voluntária negada; renovação permanece condicionada ao motor comercial |
| Arquivamento legado | Oculta entrega sem apagar conteúdo | Continua reconhecido, mas a ação saiu da interface principal; não é apresentado como exclusão |

A consulta `get_advertising_campaigns` entrega o sinal autorizado `advertiser_paused` na mesma página de 20 itens. A projeção de status privilegia suspensão administrativa, depois pausa voluntária, depois validade e entrega. O fluxo usa a trava já compartilhada de `commercial_resources`; pausa e retomada só acrescentam operações de auditoria, sem alterar ordens ou reservas.

## Matriz de dependências para exclusão física (descartada do planejamento)

A exclusão física de anúncios **não será implementada**. A tabela abaixo documenta por que essa
ação seria arriscada -- registro histórico da investigação, para não reabrir a discussão sem essa
base -- e não um roteiro de próximo PR.

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

A ação **“Excluir anúncio”** não existe e não será adicionada à interface. Arquivar (`archive_advertising_campaign`) permanece a única forma de um anúncio sair da listagem principal sem apagar conteúdo criativo, contratos, comprovantes ou auditoria. Se o produto reconsiderar exclusão física no futuro, esta auditoria deve ser refeita do zero contra o esquema vigente naquele momento, não retomada a partir deste documento.

## Validação local

Todas as migrations foram aplicadas na stack Supabase descartável. `advertising_campaigns_test.sql` passou 66 asserções (61 originais + 5 cobrindo retomada por um gerente autorizado diferente de quem pausou), incluindo pausa, retomada, ausência de débito e autorização cruzada. `advertising_desired_duration_delivery_test.sql` passou 13, `commercial_engine_test.sql` passou 65, `advertising_progress_banner_test.sql` passou 34, `advertising_home_banner_rotation_test.sql` passou 16 e `product_storefronts_test.sql` passou 75. Cada fixture SQL foi revertida ao final da transação. Exclusão física não foi implementada e não há plano para implementá-la.
