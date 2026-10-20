import { createElement } from 'react'

// Marca "Z" (Evolutus) com a seta de crescimento embutida no traço — dois <path>
// separados (não um só com fill-rule evenodd, como veio o original) justamente pra
// poder colorir a seta e a letra de forma independente: a seta sempre em
// --fitness-accent (verde da marca), a letra em --fitness-ink (preto/quase-branco,
// já troca sozinho entre claro/escuro via [data-color-mode] em app.css).
//
// `color` é opcional e sobrescreve as DUAS partes pra uma cor sólida única via style
// inline (sempre vence a classe CSS, sem depender de especificidade) -- usado pelos
// indicadores de saldo no header (WalletHeaderBadges.jsx), onde a marca precisa ficar
// toda azul (EvoCoins) ou toda verde (EvoCash) em vez do bicolor padrão. Sem essa prop,
// nenhum uso existente da marca muda de comportamento.
export function BrandMark({ size = 28, className = '', color }) {
  const soloColorStyle = color ? { fill: color } : undefined
  return createElement(
    'svg',
    {
      className: `brand-mark-svg ${className}`.trim(),
      width: size,
      height: size,
      viewBox: '0 0 920 876',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    createElement('path', {
      className: 'brand-mark-arrow',
      style: soloColorStyle,
      d: 'M 919 0 L 681 138 L 761 138 L 763 140 L 729 201 L 702 242 L 681 270 L 644 313 L 605 352 L 569 383 L 529 413 L 481 443 L 334 519 L 251 566 L 177 614 L 119 660 L 85 695 L 50 744 L 33 777 L 21 807 L 0 875 L 635 873 L 651 870 L 665 865 L 682 854 L 693 843 L 705 827 L 765 731 L 245 731 L 244 728 L 287 630 L 226 662 L 176 694 L 131 726 L 76 771 L 53 793 L 52 791 L 98 738 L 131 707 L 194 657 L 244 624 L 308 587 L 387 547 L 468 511 L 549 478 L 611 448 L 652 424 L 688 400 L 741 356 L 783 314 L 830 256 L 867 200 L 919 251 Z',
    }),
    createElement('path', {
      className: 'brand-mark-letter',
      style: soloColorStyle,
      d: 'M 121 441 L 255 441 L 281 378 L 297 347 L 314 329 L 323 323 L 338 317 L 355 314 L 605 313 L 622 296 L 657 254 L 685 214 L 711 169 L 328 168 L 302 171 L 273 180 L 257 188 L 235 204 L 223 216 L 208 237 L 193 268 Z M 805 456 L 657 456 L 641 466 L 606 483 L 448 549 L 379 582 L 345 601 L 714 601 L 781 498 Z',
    })
  )
}
