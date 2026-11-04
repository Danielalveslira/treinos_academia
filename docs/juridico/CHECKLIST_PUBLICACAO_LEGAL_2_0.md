# Evolutus — fechamento jurídico antes da publicação 2.0.0

## Cláusulas consolidadas para decisão
- Idade mínima 18+ e marca Evolutus.
- Arrependimento de 7 dias corridos quando aplicável, sem renúncia automática por início de uso.
- EvoCash: valor total claro; sem taxa administrativa adicional do Evolutus fora da cotação; restituição do saldo pago e não consumido ao encerrar a conta ou descontinuar o produto.
- Anúncios e vitrines: recusa antes da entrega não gera perda da quantia paga; dias não prestados por falha ou suspensão sem culpa geram análise de compensação ou restituição proporcional.
- Reembolsos continuam com atendimento e processamento manual — sem prometer automação.
- **Decisão de 04/11/2026:** revogar o consentimento de medidas de saúde apaga automática e imediatamente o histórico de medidas, sem exigir solicitação pelo atendimento — ressalvada apenas uma base legal independente de conservação, que hoje não existe em nenhuma medida (nenhuma FK de tabela financeira/jurídica aponta para `body_measurements`). O evento de concessão/revogação do consentimento é mantido como comprovação mínima, sem o conteúdo das medidas. Texto já corrigido na minuta geral 2.0.0.
- Documentos 1.x e seus digests são históricos imutáveis.

## Bloqueios para publicar (não preenchidos por suposição)
1. ~~Identificação do fornecedor e controlador~~ **Resolvido em texto (04/11/2026):** Evolutus opera por pessoa física, sem CNPJ; a minuta geral aponta para `/informacoes-do-fornecedor` em vez de listar os dados. **Ainda pendente, fora do texto:** os valores reais de nome civil, CPF e endereço, que só serão configurados depois diretamente na hospedagem (variáveis `SUPPLIER_LEGAL_NAME`/`SUPPLIER_CPF`/`SUPPLIER_ADDRESS`), nunca no repositório. A página fica "Em configuração" até lá.
2. **Ainda aberto:** encarregado de dados ou enquadramento comprovado na dispensa para agentes de pequeno porte, considerando que o Evolutus trata dados de saúde — decisão jurídica não resolvida nesta sessão, não presumir nem a dispensa nem a obrigação. O canal de privacidade já existe independentemente disso (atendimento + `get_my_privacy_consents`/`set_privacy_consent` + `/informacoes-do-fornecedor`). Análise preliminar em `DISPENSA_DPO_PEQUENO_PORTE_2026-11-04.md`; confirmar com os dados reais de porte.
3. Hipóteses legais para indicadores que revelem saúde e avaliação de legítimo interesse para analytics seguem **abertas**. A retenção dos registros gerais da conta (aceite, compras, contratações, reembolsos, moderação, segurança) já está descrita corretamente no texto e é compatível com a exclusão de conta implementada; só os **prazos exatos por categoria** e a **retenção dos leads do formulário Para Empresas** continuam pendentes de decisão.
4. Mapeamento de países, transferências de dados e mecanismo do art. 33 da LGPD em contratos de cada prestador (Resolução ANPD 19/2024) — **ainda aberto**, não declarar conformidade sem fundamentação. Levantamento preliminar em `TRANSFERENCIAS_INTERNACIONAIS_2026-11-04.md`; verificar os contratos efetivamente aceitos pelo Evolutus. O prazo geral de adequação já terminou em agosto de 2025.
5. Confirmar que os fluxos operacionais e financeiros conseguem atender aos compromissos de estorno, devolução de saldo pago e compensação.
6. ~~Revisão do formulário Para Empresas para não exigir falso consentimento~~ — corrigido fora desta branch, ver PR de correção do checkbox de consentimento do formulário Para Empresas.
7. Aprovação humana dos cinco textos completos e definição das datas reais de publicação. Nenhum documento pode ser ativado com marcadores `[PENDENTE]` ou `AAAA-MM-DD` — **ainda restam 6 marcadores `[PENDENTE]` na minuta geral** (DPO/encarregado, aferição adicional de idade, legítimo interesse de analytics, retenção dos leads comerciais, transferência internacional, prazos por categoria e prática de retenção de log de acesso dos provedores), todos genuinamente abertos.

## Sequência após resolução
1. Mover documentos gerais revisados para `legal/manifest.json` e `legal/documents.json`; versionar a 1.5.0 em fixture sem modificá-la e adicionar o novo digest aprovado.
2. Publicar frontend que reconhece a versão 2.0.0.
3. Registrar com `seed-legal.mjs` e ativar com `--activate` e `CONFIRM_LEGAL_ACTIVATION=2.0.0`.
4. Aprovar os quatro documentos comerciais e publicar um a um por `publish-legal-document.mjs` com confirmação nominal.
5. Verificar as rotas públicas e as versões históricas; não liberar vendas. Em particular, desabilitar `ad_home` antes de disponibilizar contratação comercial.
6. Não repetir testes já aprovados, apenas verificações dirigidas às mudanças.

**Estado:** revisão de redação em branch; textos `approved:false`/`published:false` e nada publicado em produção. A revisão de informações empresariais e transferência internacional é indispensável.
