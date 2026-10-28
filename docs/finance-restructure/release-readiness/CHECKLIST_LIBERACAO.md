# Checklist de liberação

- [x] PR #87 publicado; correções de duas rodadas remotas registradas.
- [x] CI do commit bf8b556 aprovado (js/sql/finance-e2e/secrets/finance-quality).
- [x] Main strict, gate obrigatório e administradores protegidos; uma revisão e aprovação do último push exigidas; auto-merge null.
- [ ] CI do HEAD final de documentação confirmado (atualizar evidência ao concluir).
- [ ] Aprovação humana do PR e autorização de integração. Nenhum merge executado.
- [x] Probe SQL de produção READ ONLY coletado e limitação do transporte comunicada.
- [ ] Operador verifica efeito do preflight da CLI; acesso sem role mint disponível.
- [ ] Inventário completo, drift, financeiro/editorial e conjunto exato de migrations faltantes confirmados.
- [x] Manifesto local SHA256 e sequência candidata preparados.
- [ ] Backup e Storage copiados; restauração isolada comprovada e responsáveis designados.
- [x] Propostas comerciais preparadas sem publicar preços.
- [ ] Preços, limites, margem, termos, reembolsos, privacidade e retenção aprovados pelo proprietário/jurídico/contábil.
- [x] 26 testes InfinitePay locais simulados aprovados; limites documentados.
- [ ] Conta, contrato e ambiente oficial InfinitePay verificados; homologação necessária autorizada.
- [ ] Pagamento real controlado, se necessário, autorizado separadamente e reconciliado.
- [x] Plano de instalação, recuperação e pós-checks preparado.
- [ ] Plano executável contra destino validado após auditoria integral e restore.
- [ ] Autorização explícita para migrations/deploy; nenhuma execução feita.
- [ ] Estado real pós-instalação dos gates comerciais/checkout/métricas confirmado desligado.
- [ ] Nova autorização específica para ativação comercial após validação.

Critério atual: preparação documental entregue; liberação de produção BLOQUEADA. Supabase Preview foi SKIPPED no CI externo (não obrigatório); os testes locais/Actions não substituem Realtime/Storage/provedor hospedados. Vercel Preview reportou sucesso automático de integração GitHub; isso não é deploy manual de produção nem homologação financeira do preview.
