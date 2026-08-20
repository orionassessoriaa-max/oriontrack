'use client';

import WallPanel from '@/components/commercial/sala/WallPanel';
import { tvFontClass } from '@/lib/tvFonts';

// A Sala e o painel de parede. O CommercialShell ja renderiza esta rota sem a
// barra de navegacao, entao a tela ocupa a TV inteira.
export default function CommercialSalaPage() {
  return <div className={tvFontClass}><WallPanel /></div>;
}
