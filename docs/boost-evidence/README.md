# Impulsionamento direto — evidência de interface

As capturas são do componente real `PromoteDialog` e do `CommercialLeasePurchase`, montados com respostas **sintéticas** das RPCs. O preço de 7 EvoCash/dia e o saldo de 100 EvoCash são fixtures de teste, não tarifas de produção. Nenhuma compra foi executada.

- [Mobile, 390 px](mobile-390.png)
- [Desktop, 1024 px](desktop-1024.png)

O smoke test `scripts/post-boost-browser-smoke.mjs` executou o mesmo componente nas larguras 320, 360, 390, 768, 1024 e 1440 px. Em todas, o modal ficou centralizado, sem rolagem horizontal, e o botão de confirmação permaneceu dentro do viewport de 800 px. Ao abrir, houve somente `get_direct_post_boost_offer`; ao pedir revisão, `prepare_direct_post_boost` e `quote_commercial_order`; depois do aceite, uma chamada de confirmação. Não houve consulta de histórico.

A medição de latência de abertura com banco real não foi possível no ambiente local: o contêiner Supabase falhou durante a inicialização. A CI usa um banco descartável para validar a migration e os testes SQL; latência real deve ser observada no preview antes da publicação.
