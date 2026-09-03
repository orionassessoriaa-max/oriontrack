import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Overview | Orion Track',
};

export default function OverviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
