'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import Sidebar from './Sidebar';
import { Loader2 } from 'lucide-react';

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  const { profile, loading, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push('/login');
      } else if (profile) {
        const isAdmin = profile.tipo_usuario === 'admin';
        const isTrafficManager = profile.tipo_usuario === 'gestor_trafego';
        const isCorretor = profile.tipo_usuario === 'corretor';
        
        const isAdminRoute = pathname.startsWith('/admin');
        const isTrafficRoute = pathname.startsWith('/trafego');
        const isBrokerRoute = ['/dashboard', '/kanban', '/leads', '/minha-pagina', '/perfil'].some(p => pathname.startsWith(p));

        // 1. Corretor Access: Only broker routes
        if (isCorretor && (isAdminRoute || isTrafficRoute)) {
          router.push('/dashboard');
        } 
        // 2. Traffic Manager Access: Traffic routes + Broker List (to select for reports)
        // But NO /admin dashboard or system settings
        else if (isTrafficManager) {
          if (isAdminRoute && !pathname.startsWith('/admin/corretores')) {
             router.push('/trafego/leads');
          } else if (isBrokerRoute) {
             router.push('/trafego/leads');
          }
        }
        // 3. Admin Access: /admin + /trafego (optional but allowed)
        // But NO /dashboard (broker dashboard)
        else if (isAdmin && isBrokerRoute) {
          router.push('/admin');
        }
      }
    }
  }, [loading, user, profile, pathname, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-600" size={40} />
      </div>
    );
  }

  if (!user || !profile) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-[#f8fafc]">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
