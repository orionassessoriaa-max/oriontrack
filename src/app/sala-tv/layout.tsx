import type { Metadata } from 'next';
import { tvFontClass } from '@/lib/tvFonts';

export const metadata: Metadata = {
  title: 'Kripto Hunters | Painel da Sala',
};

export default function SalaTvLayout({ children }: { children: React.ReactNode }) {
  return <div className={tvFontClass}>{children}</div>;
}
