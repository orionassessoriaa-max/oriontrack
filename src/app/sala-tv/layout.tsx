import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './tv.css';

// Numeros gigantes pedem uma grotesca com eixo de largura e digito tabular:
// sem tabular-nums o placar "dança" a cada atualizacao.
const tvDisplay = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-tv-display',
  display: 'swap',
});

const tvSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-tv-sans',
  display: 'swap',
});

// A mono maiuscula espacada faz o papel das etiquetas de instrumento da cabine.
const tvMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-tv-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Kripto Hunters | Painel da Sala',
};

export default function SalaTvLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${tvDisplay.variable} ${tvSans.variable} ${tvMono.variable}`}>
      {children}
    </div>
  );
}
