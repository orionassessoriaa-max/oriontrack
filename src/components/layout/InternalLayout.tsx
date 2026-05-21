'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import { AlertCircle, Loader2, LogOut, RefreshCw } from 'lucide-react';

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  const { profile, loading, user, signOut, refreshProfile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [themeMode, setThemeMode] = useState<'claro' | 'noturno'>('claro');

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push('/login');
      } else if (profile) {
        const isAdmin = profile.tipo_usuario === 'admin';
        const isTrafficManager = profile.tipo_usuario === 'gestor_trafego';
        const isCorretor = profile.tipo_usuario === 'corretor';
        const isDesigner = profile.tipo_usuario === 'designer';
        const isAccountManager = profile.tipo_usuario === 'account_manager';
        
        const isAdminRoute = pathname.startsWith('/admin');
        const isTrafficRoute = pathname.startsWith('/trafego');
        const isDesignerRoute = pathname.startsWith('/designer');
        const isAccountRoute = pathname.startsWith('/account');
        const isCreativeRoute = pathname.startsWith('/criativos');
        const isBrokerRoute = ['/dashboard', '/kanban', '/crm', '/leads', '/inbox', '/minha-pagina', '/perfil'].some(p => pathname.startsWith(p)) || pathname === '/criativos';

        // 1. Corretor Access: Only broker routes
        if (isCorretor && (isAdminRoute || isTrafficRoute || isDesignerRoute || isAccountRoute)) {
          router.push('/dashboard');
        } 
        // 2. Traffic Manager Access: Traffic routes + Broker List (to select for reports)
        // But NO /admin dashboard or system settings
        else if (isTrafficManager) {
          if (isAdminRoute && !pathname.startsWith('/admin/corretores')) {
             router.push('/trafego/leads');
          } else if (isBrokerRoute || isDesignerRoute || isAccountRoute) {
             router.push('/trafego/leads');
          }
        }
        else if (isDesigner) {
          if (!isDesignerRoute && !isCreativeRoute && pathname !== '/perfil' && pathname !== '/notificacoes') {
            router.push('/designer');
          }
        }
        else if (isAccountManager) {
          if (!isAccountRoute && !isCreativeRoute && !pathname.startsWith('/trafego/relatorios') && !pathname.startsWith('/admin/leads') && pathname !== '/perfil' && pathname !== '/notificacoes') {
            router.push('/account');
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

  useEffect(() => {
    const storedTheme = window.localStorage.getItem('orion:tema_sistema') as 'claro' | 'noturno' | null;
    setThemeMode((profile?.tema_sistema as 'claro' | 'noturno' | null) || storedTheme || 'claro');
  }, [profile?.tema_sistema]);

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      const nextTheme = (event as CustomEvent<'claro' | 'noturno'>).detail;
      if (nextTheme === 'claro' || nextTheme === 'noturno') {
        setThemeMode(nextTheme);
      }
    };

    window.addEventListener('orion-theme-change', handleThemeChange);
    return () => window.removeEventListener('orion-theme-change', handleThemeChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('theme-noturno', themeMode === 'noturno');
    document.body.classList.toggle('theme-noturno', themeMode === 'noturno');
    document.documentElement.style.colorScheme = themeMode === 'noturno' ? 'dark' : 'light';
  }, [themeMode]);

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

  const isDarkTheme = themeMode === 'noturno';

  return (
    <div className={`flex min-h-screen ${isDarkTheme ? 'theme-noturno bg-slate-950 text-slate-100' : 'bg-[#f8fafc]'}`}>
      <Sidebar onCollapsedChange={setSidebarCollapsed} />
      <main className={`${sidebarCollapsed ? 'ml-0 w-full' : 'ml-64 w-[calc(100%-16rem)]'} min-w-0 p-8 transition-all duration-300`}>
        <div className={`${sidebarCollapsed ? 'max-w-none' : 'max-w-7xl'} mx-auto transition-all duration-300`}>
          {children}
        </div>
      </main>
    </div>
  );
}
