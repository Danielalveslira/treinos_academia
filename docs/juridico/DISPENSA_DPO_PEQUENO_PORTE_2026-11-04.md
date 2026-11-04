# Encarregado de dados (DPO) — enquadramento na dispensa de pequeno porte

**Natureza deste documento:** análise técnico-jurídica preliminar, baseada em pesquisa pública sobre a norma vigente. **Não substitui parecer de advogado com acesso aos números reais de faturamento/volume de dados do Evolutus** — a resolução usada aqui exige enquadramento em critérios objetivos (porte da empresa/MEI, faturamento, volume de dados) que não foram fornecidos e que esta análise não tenta adivinhar.

## O que a norma diz

A **Resolução CD/ANPD nº 2, de 27/01/2022** regulamenta a aplicação da LGPD para agentes de tratamento de pequeno porte (ME, EPP, MEI, startups, pessoas físicas e entidades sem fins lucrativos, dentro dos critérios de porte que a resolução define).

- **Art. 11:** agentes de pequeno porte **não são obrigados** a indicar o encarregado (DPO) exigido pelo art. 41 da LGPD.
- **§1º:** quem não indicar encarregado deve, em vez disso, **manter um canal de comunicação com o titular dos dados** para atender ao art. 41, §2º, I da LGPD (ou seja, um canal para o titular formular reclamações e se comunicar sobre o tratamento).
- **§2º:** indicar um encarregado mesmo sem ser obrigado é tratado como boa prática de governança.
- **Limite:** a simplificação da resolução **não se aplica** (ou se aplica de forma restrita) quando o agente trata **dados sensíveis** ou dados de crianças, adolescentes e idosos — tratamento classificado como de maior risco pela própria resolução. **Dados de saúde são dados sensíveis** (art. 5º, II, LGPD).

**Fontes consultadas:** análises de escritórios de advocacia e consultorias especializadas (Mayer Brown, Machado Meyer, Felsberg, Demarest, Portal SPED, Confidata — ver seção "Fontes" abaixo). **Não localizei o texto oficial consolidado da Resolução nº 2/2022 diretamente no site da ANPD nesta pesquisa** — recomendo confirmar a redação exata dos artigos citados (em especial o artigo que trata do "tratamento de maior risco" por dados sensíveis, que fontes secundárias atribuem ao art. 3º, mas que não confirmei na fonte primária) antes de publicar qualquer texto jurídico definitivo que cite números de artigo.

## Aplicação ao Evolutus — o que está claro e o que não está

**Claro:**
- O Evolutus trata dados de saúde (medidas corporais, consentimento específico e revogável, conforme já implementado em `privacy_consent_events`/`set_privacy_consent`). Dados de saúde são dados sensíveis.
- Pela leitura das fontes consultadas, tratamento de dados sensíveis tende a tirar o agente da simplificação mais ampla da dispensa, tratando esse tratamento especificamente como de maior risco.

**Não está claro, e não deve ser presumido:**
- Se isso significa que o Evolutus **perde integralmente** o direito à dispensa do art. 11 (precisando nomear encarregado formalmente), ou se significa apenas que **esse tratamento específico** (dados de saúde) exige cuidados adicionais sem necessariamente exigir um DPO nomeado, enquanto o restante do tratamento (perfil, treino, redes sociais) continua na dispensa.
- Se o Evolutus se qualifica como agente de pequeno porte nos critérios objetivos da resolução (isso depende de dados de porte/faturamento que esta análise não recebeu e não deve supor).
- O texto oficial exato do(s) artigo(s) que tratam da exceção por dados sensíveis (ver ressalva acima).

## Determinação (hedged, não uma opinião jurídica definitiva)

**Não nomear um encarregado formal agora, e não declarar dispensa simplificada sem ressalva, até confirmação jurídica própria.** Em vez disso:

1. **Documentar, na Política de Privacidade 2.0.0, a situação real**: o Evolutus mantém um canal de comunicação com os titulares de dados (ver abaixo) e está avaliando, com assessoria jurídica própria, se o tratamento de dados de saúde (opcional e revogável) exige a nomeação formal de encarregado nos termos da Resolução CD/ANPD nº 2/2022. Não afirmar nem a dispensa total, nem a obrigatoriedade — afirmar apenas o que é fato (existe canal; a análise está em andamento).
2. **O canal de comunicação com o titular já existe e já funciona como tal** — não é necessário criar um mecanismo novo e redundante:
   - A rota pública `/atendimento`, já referenciada em `LegalGate.jsx` e `LegalDocument.jsx` ("Atendimento, recursos e privacidade"), é o canal operacional onde o titular pode se comunicar, pedir correções, reembolsos e exercer direitos.
   - As RPCs `get_my_privacy_consents`/`set_privacy_consent` já dão ao titular controle direto sobre o consentimento de dados de saúde, sem precisar de intermediação humana para o caso mais comum (revogar o consentimento).
   - A nova página `/informacoes-do-fornecedor` (implementada nesta mesma branch) traz o e-mail de contato oficial (`dnllira1@gmail.com`) do responsável, reforçando o canal.
   - Isso já cobre o requisito do §1º do art. 11 mesmo que a dispensa total não se confirme — o canal existe independentemente da resposta final sobre o DPO.
3. **Antes de publicar a versão 2.0.0, buscar confirmação jurídica específica** sobre se o volume/porte do Evolutus se qualifica como "pequeno porte" nos critérios objetivos da resolução, e se o tratamento de dados de saúde (mesmo opcional/revogável e em volume provavelmente pequeno) exige encarregado formal nomeado. Isso não bloqueia o resto da publicação 2.0.0 — é um item a resolver em paralelo, documentado como pendência explícita e não inventada.

## Fontes

- [Resolução CD/ANPD nº 2 DE 27/01/2022 — Normas Brasil](https://www.normasbrasil.com.br/norma/resolucao-2-2022_426801.html)
- [Mayer Brown — Legal update: regulamento para agentes de pequeno porte](https://www.mayerbrown.com/-/media/files/perspectives-events/publications/2022/02/regulation-for-the-application-of-the-general-data-protection-law-lgpd-for-small-business-data-processing-agents/legal-update--regulamento-agentes-de-pequeno-porte.pdf)
- [Machado Meyer — Empresas de pequeno porte podem ser dispensadas de ter DPO](https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/direito-digital/empresas-de-pequeno-porte-podem-ser-dispensadas-de-ter-dpo)
- [Demarest — Conselho Diretor aprova regulamento de aplicação da LGPD para agentes de tratamento de pequeno porte](https://www.demarest.com.br/conselho-diretor-aprova-regulamento-de-aplicacao-da-lgpd-para-agentes-de-tratamento-de-pequeno-porte/)
- [Confidata — LGPD para pequenas empresas: Resolução de pequeno porte](https://confidata.com.br/blog/lgpd-pequenas-empresas-resolucao-pequeno-porte)
- [Portal SPED Brasil — fórum sobre a Resolução CD/ANPD nº 2/2022](https://portalspedbrasil.com.br/forum/lgpd-resolucao-cd-anpd-no-2-2022-aprovado-o-regulamento-da-lgpd-para-me-epp-mei-startups-e-demais-agentes-de-pequeno-porte/)
- [Felsberg Advogados — ANPD publica nova resolução que regulamenta a aplicação da LGPD para agentes de tratamento de pequeno porte](https://www.felsberg.com.br/no-dia-internacional-da-protecao-de-dados-anpd-publica-nova-resolucao-que-regulamenta-a-aplicacao-da-lgpd-para-agentes-de-tratamento-de-pequeno-porte/)

**Pendência registrada, não resolvida por este documento:** confirmação jurídica final sobre encarregado, com acesso ao texto oficial consolidado da resolução e aos dados reais de porte do Evolutus.
