# Evolutus — fechamento jurídico antes da publicação 2.0.0

## Cláusulas consolidadas para decisão
- Idade mínima 18+ e marca Evolutus.
- Arrependimento de 7 dias corridos quando aplicável, sem renúncia automática por início de uso.
- EvoCash: valor total claro; sem taxa administrativa adicional do Evolutus fora da cotação; restituição do saldo pago e não consumido ao encerrar a conta ou descontinuar o produto.
- Anúncios e vitrines: recusa antes da entrega não gera perda da quantia paga; dias não prestados por falha ou suspensão sem culpa geram análise de compensação ou restituição proporcional.
- Reembolsos continuam com atendimento e processamento manual — sem prometer automação.
- Consentimento para medidas de saúde é opcional e revogável; apagamento dos dados históricos exige fluxo de solicitação e avaliação das hipóteses de conservação.
- Documentos 1.x e seus digests são históricos imutáveis.

## Bloqueios para publicar (não preenchidos por suposição)
1. **Identificação do fornecedor e controlador — decisão de produto registrada (04/11/2026): pessoa física, sem CNPJ.** Página `/informacoes-do-fornecedor` implementada (branch `legal/supplier-info-and-compliance-research-20261104`), com nome comercial, natureza jurídica, e-mail oficial (`dnllira1@gmail.com`) e processador de pagamento (InfinitePay) já publicados. **Nome civil, CPF e endereço físico ficam pendentes de propósito** — lidos de variáveis de ambiente (`SUPPLIER_LEGAL_NAME`, `SUPPLIER_CPF`, `SUPPLIER_ADDRESS`) a configurar diretamente na hospedagem, nunca no código-fonte. **Não publicar a 2.0.0 sem essas três variáveis configuradas em produção** — a página funciona sem elas (mostra "Em configuração"), mas o Decreto 7.962/2013 exige a identificação completa antes da publicação valer como cumprida.
2. Encarregado de dados ou enquadramento comprovado na dispensa para agentes de pequeno porte; manter canal de privacidade. **Análise preliminar registrada em `DISPENSA_DPO_PEQUENO_PORTE_2026-11-04.md`**: o canal de comunicação com o titular já existe (`/atendimento`, `get_my_privacy_consents`, e agora `/informacoes-do-fornecedor`), mas a obrigatoriedade de encarregado formal diante do tratamento de dados de saúde **não foi confirmada nem descartada** — exige confirmação jurídica própria antes da publicação, com acesso ao texto oficial da Resolução CD/ANPD nº 2/2022 e aos dados reais de porte do Evolutus.
3. Hipóteses legais para indicadores que revelem saúde, avaliação de legítimo interesse para analytics, retenção real dos leads e de registros.
4. Mapeamento de países, transferências de dados e mecanismo do art. 33 da LGPD em contratos de cada prestador (Resolução ANPD 19/2024). **Levantamento preliminar registrado em `TRANSFERENCIAS_INTERNACIONAIS_2026-11-04.md`**: nenhuma não-conformidade comprovada, mas Supabase/Vercel/Resend carecem de verificação direta do mecanismo de transferência (CPC da ANPD vs. SCCs europeias) nos contratos reais aceitos pela conta do Evolutus — **o prazo de adequação da Resolução nº 19/2024 já venceu em 23/08/2025**, então isso não é mais uma pendência de prazo futuro.
5. Confirmar que os fluxos operacionais e financeiros conseguem atender aos compromissos de estorno, devolução de saldo pago e compensação.
6. ~~Revisão do formulário Para Empresas para não exigir falso consentimento da Política de Privacidade.~~ **Resolvido** (PR #115, `legal/for-business-privacy-fix`): checkbox de "consentimento" substituído por aviso informativo, sem gate de opt-in indevido.
7. Aprovação humana dos cinco textos completos e definição das datas reais de publicação. Nenhum documento pode ser ativado com marcadores `[PENDENTE]` ou `AAAA-MM-DD`.

## Sequência após resolução
1. Mover documentos gerais revisados para `legal/manifest.json` e `legal/documents.json`; versionar a 1.5.0 em fixture sem modificá-la e adicionar o novo digest aprovado.
2. Publicar frontend que reconhece a versão 2.0.0.
3. Registrar com `seed-legal.mjs` e ativar com `--activate` e `CONFIRM_LEGAL_ACTIVATION=2.0.0`.
4. Aprovar os quatro documentos comerciais e publicar um a um por `publish-legal-document.mjs` com confirmação nominal.
5. Verificar as rotas públicas e as versões históricas; não liberar vendas. Em particular, desabilitar `ad_home` antes de disponibilizar contratação comercial.
6. Não repetir testes já aprovados, apenas verificações dirigidas às mudanças.

**Estado:** revisão de redação em branch; textos `approved:false`/`published:false` e nada publicado em produção. A revisão de informações empresariais e transferência internacional é indispensável.
