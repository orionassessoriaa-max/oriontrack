'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import Sidebar from './Sidebar';
import { AlertCircle, Loader2, LogOut, RefreshCw } from 'lucide-react';

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  const { profile, loading, user, signOut, refreshProfile } = useAuth();
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
        const isBrokerRoute = ['/dashboard', '/kanban', '/crm', '/leads', '/minha-pagina', '/perfil'].some(p => pathname.startsWith(p));

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

  if (!user) {
    return null;
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8fafc] p-6">
        <div className="max-w-md rounded-[2rem] border border-amber-100 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <AlertCircle size={28} />
          </div>
          <h1 className="text-xl font-black text-gray-900">Perfil nÃ£o carregou</h1>
          <p className="mt-2 text-sm font-bold leading-relaxed text-gray-500">
            A sessÃ£o existe, mas o perfil do usuÃ¡rio nÃ£o foi encontrado ou demorou para responder.
          </p>
          <div className="mt-6 flex gap-3">
            <button
              onClick={refreshProfile}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white"
            >
              <RefreshCw size={16} /> Tentar
            </button>
            <button
              onClick={signOut}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-gray-100 px-4 py-3 text-sm font-black text-gray-600"
            >
              <LogOut size={16} /> Sair
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#f8fafc]">
      <Sidebar />
      <main className="ml-64 w-[calc(100%-16rem)] min-w-0 p-8">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
