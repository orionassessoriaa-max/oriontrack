'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import { AlertCircle, Loader2, LogOut, RefreshCw } from 'lucide-react';
import ApoloAiWidget from '@/components/ui/ApoloAiWidget';

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  const { profile, actualProfile, loading, user, signOut, refreshProfile, isViewingAsCorretor } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push('/login');
      } else if (profile) {
        const isAdmin = profile.tipo_usuario === 'admin';
        const isTrafficManager = profile.tipo_usuario === 'gestor_trafego';
        const isCorretor = profile.tipo_usuario === 'corretor' || profile.tipo_usuario === 'corretor_admin';
        const isCorretorMember = profile.tipo_usuario === 'corretor_membro';
        const isDesigner = profile.tipo_usuario === 'designer';
        const isAccountManager = profile.tipo_usuario === 'account_manager';
        
        const isAdminRoute = pathname.startsWith('/admin');
        const isTrafficRoute = pathname.startsWith('/trafego');
        const isDesignerRoute = pathname.startsWith('/designer');
        const isAccountRoute = pathname.startsWith('/account');
        const isCreativeRoute = pathname.startsWith('/criativos');
        const isTeamRoute = pathname.startsWith('/equipe');
        const isSharedRoute = pathname === '/perfil' || pathname === '/notificacoes' || pathname.startsWith('/simulador') || pathname.startsWith('/apolo-one') || pathname.startsWith('/ajuda');
        const isBrokerRoute = ['/dashboard', '/kanban', '/crm', '/leads', '/inbox', '/financeiro', '/minha-pagina', '/time'].some(p => pathname.startsWith(p)) || pathname === '/criativos';
        const isOperationalViewingBroker = isViewingAsCorretor && ['gestor_trafego', 'account_manager'].includes(String(actualProfile?.tipo_usuario));

        if (isOperationalViewingBroker) {
          if (pathname.startsWith('/financeiro')) {
            router.push('/dashboard');
            return;
          }
          if (isBrokerRoute || isSharedRoute || pathname.startsWith('/trafego/relatorios') || pathname.startsWith('/account/inbox')) {
            return;
          }
        }

        if (isSharedRoute) return;

        // 1. Corretor Access: Only broker routes
        if (isCorretor && (isAdminRoute || isTrafficRoute || isDesignerRoute || isAccountRoute || isTeamRoute)) {
          router.push('/dashboard');
        }
        else if (isCorretorMember) {
          const isMemberRoute = ['/crm', '/leads', '/dashboard', '/inbox', '/financeiro', '/perfil', '/notificacoes', '/apolo-one', '/ajuda'].some(p => pathname.startsWith(p));
          if (!isMemberRoute) router.push('/crm');
        }
        // 2. Traffic Manager Access: Traffic routes + Broker List (to select for reports)
        // But NO /admin dashboard or system settings
        else if (isTrafficManager) {
          if (isViewingAsCorretor && isBrokerRoute && !pathname.startsWith('/financeiro')) return;
          if (isAdminRoute && !pathname.startsWith('/admin/corretores') && !pathname.startsWith('/admin/corretoras')) {
             router.push('/trafego');
          } else if (isBrokerRoute || isDesignerRoute || isAccountRoute) {
             router.push('/trafego');
          }
        }
        else if (isDesigner) {
          if (!isDesignerRoute && !isCreativeRoute && !isTeamRoute && pathname !== '/perfil' && pathname !== '/notificacoes') {
            router.push('/designer');
          }
        }
        else if (isAccountManager) {
          if (isViewingAsCorretor && isBrokerRoute && !pathname.startsWith('/financeiro')) return;
          if (!isAccountRoute && !isCreativeRoute && !isTeamRoute && !pathname.startsWith('/trafego/relatorios') && pathname !== '/perfil' && pathname !== '/notificacoes') {
            router.push('/account');
          }
        }
        // 3. Admin Access: /admin + /trafego (optional but allowed)
        // But NO /dashboard (broker dashboard)
        else if (isAdmin && isBrokerRoute) {
          const hasViewingSession = Boolean(
            window.sessionStorage.getItem('orion:viewing_corretor_id') ||
            window.sessionStorage.getItem('orion:viewing_gestor_id') ||
            window.sessionStorage.getItem('orion:viewing_designer_id') ||
            window.sessionStorage.getItem('orion:viewing_account_id')
          );
          if (hasViewingSession) return;
          router.push('/admin');
        }
      }
    }
  }, [loading, user, profile, pathname, router]);

  const [tema, setTema] = useState<string>('noturno');

  useEffect(() => {
    const handleThemeChange = () => {
      const savedTheme = window.localStorage.getItem('orion:tema_sistema') || 'noturno';
      setTema(savedTheme);
      if (savedTheme === 'noturno') {
        document.documentElement.classList.remove('theme-claro');
        document.body.classList.remove('theme-claro');
        document.documentElement.classList.add('theme-noturno');
        document.body.classList.add('theme-noturno');
        document.documentElement.style.colorScheme = 'dark';
      } else {
        document.documentElement.classList.remove('theme-noturno');
        document.body.classList.remove('theme-noturno');
        document.documentElement.classList.add('theme-claro');
        document.body.classList.add('theme-claro');
        document.documentElement.style.colorScheme = 'light';
      }
    };

    handleThemeChange();
    window.addEventListener('orion:theme_changed', handleThemeChange);
    return () => window.removeEventListener('orion:theme_changed', handleThemeChange);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030712] flex items-center justify-center">
        <Loader2 className="animate-spin text-cyan-500" size={40} />
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
          <h1 className="text-xl font-black text-gray-900">Perfil não carregou</h1>
          <p className="mt-2 text-sm font-bold leading-relaxed text-gray-500">
            A sessão existe, mas o perfil do usuário não foi encontrado ou demorou para responder.
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

  const isDark = tema === 'noturno';

  return (
    <div className={`flex min-h-screen flex-col transition-colors duration-300 ${
      isDark ? 'bg-[#020617] text-white' : 'bg-[#f8fafc] text-slate-800'
    }`}>
      <Sidebar onCollapsedChange={setSidebarCollapsed} />
      <main className="w-full min-w-0 px-3 py-5 pt-24 transition-all duration-300 sm:px-5 sm:py-7 lg:p-7 lg:pt-28">
        <div className="mx-auto max-w-none transition-all duration-300">
          {children}
        </div>
      </main>
      <ApoloAiWidget />
    </div>
  );
}

