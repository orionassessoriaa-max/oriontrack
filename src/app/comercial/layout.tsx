import './commercial.css';
import CommercialShell from '@/components/commercial/CommercialShell';

export default function CommercialLayout({ children }: { children: React.ReactNode }) {
  return <CommercialShell>{children}</CommercialShell>;
}

