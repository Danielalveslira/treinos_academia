// Imagem de "atleta" usada nos heróis do dashboard (estado vazio e próximo treino) —
// reflete o sexo do próprio usuário quando ele informou no cadastro (ver setBirthInfo em
// usersService.js). Sem essa informação (sexo ausente ou "não informar"), mantém a
// imagem que já era usada antes dessa distinção existir.
export function getProfileHeroImage(sexo) {
  return sexo === 'feminino'
    ? { name: 'sexo_mulher', width: 1024, height: 1536, alt: 'Atleta fazendo levantamento terra em uma academia' }
    : { name: 'capa', width: 1145, height: 1374, alt: 'Atleta fazendo barra fixa em uma academia' }
}
