// Fotografias fitness aprovadas para o painel "Próxima ficha recomendada" da Home, uma por dia (ver
// useDailyBanner.js/dailyRotation.js). Sem texto nem botão embutido na imagem -- todo o conteúdo é
// renderizado pelos componentes React por cima.
//
// Originais em imports/images-source/; as variantes responsivas (480/800/1024, AVIF -> WebP, mesma
// convenção de src/components/ResponsivePicture.jsx) foram geradas com
// scripts/generate-home-banner-images.mjs e versionadas em public/img/.
//
// Para adicionar uma foto: gere as variantes com o script acima e acrescente uma entrada aqui --
// nenhuma outra parte do sistema de rotação muda. Com uma única foto aprovada, ela permanece fixa
// até outras serem cadastradas (ver dailyRotation.js).
export const DASHBOARD_BANNER_PHOTOS = [
  {
    name: 'home-banner-anilhas',
    alt: 'Anilhas de musculação enfileiradas em um rack de academia',
    width: 1024,
    height: 576,
  },
  {
    name: 'home-banner-equipe',
    alt: 'Grupo de pessoas comemorando um treino em equipe em uma academia',
    width: 1024,
    height: 576,
  },
]
