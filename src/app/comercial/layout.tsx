import './commercial.css';
import CommercialShell from '@/components/commercial/CommercialShell';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';

const intelligenceSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-intelligence-sans',
});
const intelligenceMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-intelligence-mono',
});

export default function CommercialLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${intelligenceSans.variable} ${intelligenceMono.variable}`}><CommercialShell>{children}</CommercialShell></div>;
}
