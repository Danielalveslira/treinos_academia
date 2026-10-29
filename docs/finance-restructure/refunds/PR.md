# Solicitações de arrependimento, cancelamento e reembolso com retenção auditada

O usuário registra e acompanha solicitações no histórico de EvoCash e de serviços, com protocolo imediato, prazo calculado no backend e manutenção das demais reclamações após sete dias. A administração analisa e comunica decisões auditadas; aprovação não liquida dinheiro.

Reservas protegem os débitos da carteira existente. Estorno BRL permanece manual na InfinitePay, com evidência e compensação única pelo ledger/reversão existentes. Consumo parcial, origem não rastreável e estorno anterior exigem investigação. Quatro migrations aditivas preservam as 205 anteriores; solicitações financeiras e liquidação nascem desligadas, sem ativar compras, checkout, vendas ou métricas.

Interface de compra usa os textos curtos solicitados, com seção expansível e política completa acessível. Snapshots não aprovados permanecem na auditoria e não são publicados como condições contratuais; a interface apresenta informações gerais dos direitos do consumidor, sem rótulos internos.

Validação: 323 asserções SQL, concorrência PostgreSQL real, fluxo Auth/REST/browser, teclado/mobile/temas, instalação limpa com hashes preservados e build/lint/budget/scanners. O ajuste final de texto tem regressão focada. CI obrigatório deve aprovar antes da integração, sem bypass de proteções.

Autorização atual permite push/PR, integração técnica e implantação segura após os gates. Estornos reais, capacidades do provedor e políticas aplicáveis continuam condicionados à aprovação própria. Plano, evidências e limitações em `docs/finance-restructure/refunds/ENTREGA.md`; registro da publicação em `PUBLICACAO.md`.
