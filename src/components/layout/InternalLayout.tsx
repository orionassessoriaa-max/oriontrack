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

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push('/login');
      } else if (profile) {
        const isAdmin = profile.tipo_usuario === 'admin';
        const isTrafficManager = profile.tipo_usuario === 'gestor_trafego';
        const isCorretor = profile.tipo_usuario === 'corretor';
        const isCorretorMember = profile.tipo_usuario === 'corretor_membro';
        const isDesigner = profile.tipo_usuario === 'designer';
        const isAccountManager = profile.tipo_usuario === 'account_manager';
        
        const isAdminRoute = pathname.startsWith('/admin');
        const isTrafficRoute = pathname.startsWith('/trafego');
        const isDesignerRoute = pathname.startsWith('/designer');
        const isAccountRoute = pathname.startsWith('/account');
        const isCreativeRoute = pathname.startsWith('/criativos');
        const isTeamRoute = pathname.startsWith('/equipe');
        const isSharedRoute = pathname === '/perfil' || pathname === '/notificacoes';
        const isBrokerRoute = ['/dashboard', '/kanban', '/crm', '/leads', '/inbox', '/minha-pagina', '/time'].some(p => pathname.startsWith(p)) || pathname === '/criativos';

        if (isSharedRoute) return;

        // 1. Corretor Access: Only broker routes
        if (isCorretor && (isAdminRoute || isTrafficRoute || isDesignerRoute || isAccountRoute || isTeamRoute)) {
          router.push('/dashboard');
        }
        else if (isCorretorMember) {
          const isMemberRoute = ['/crm', '/leads', '/dashboard', '/inbox', '/perfil', '/notificacoes'].some(p => pathname.startsWith(p));
          if (!isMemberRoute) router.push('/crm');
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
          if (!isDesignerRoute && !isCreativeRoute && !isTeamRoute && pathname !== '/perfil' && pathname !== '/notificacoes') {
            router.push('/designer');
          }
        }
        else if (isAccountManager) {
          if (!isAccountRoute && !isCreativeRoute && !isTeamRoute && !pathname.startsWith('/trafego/relatorios') && !pathname.startsWith('/admin/leads') && pathname !== '/perfil' && pathname !== '/notificacoes') {
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

  useEffect(() => {
    window.localStorage.setItem('orion:tema_sistema', 'escuro');
    document.documentElement.classList.add('theme-noturno');
    document.body.classList.add('theme-noturno');
    document.documentElement.style.colorScheme = 'dark';
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#000000] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#0863FF]" size={40} />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#000000] p-6">
        <div className="max-w-md rounded-[22px] border border-white/[0.08] bg-[#111418] p-8 text-center shadow-lg">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
            <AlertCircle size={28} />
          </div>
          <h1 className="text-xl font-black text-white">Perfil não carregou</h1>
          <p className="mt-2 text-sm font-bold leading-relaxed text-[#8C95A3]">
            A sessão existe, mas o perfil do usuário não foi encontrado ou demorou para responder.
          </p>
          <div className="mt-6 flex gap-3">
            <button
              onClick={refreshProfile}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#0863FF] px-4 py-3 text-sm font-black text-white hover:bg-opacity-90 transition-all"
            >
              <RefreshCw size={16} /> Tentar
            </button>
            <button
              onClick={signOut}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-[#161a20] px-4 py-3 text-sm font-black text-[#8C95A3] hover:text-white transition-all"
            >
              <LogOut size={16} /> Sair
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#07111F] bg-gradient-to-br from-[#000000] via-[#07111F] to-[#0c0d1a] relative overflow-hidden text-white">
      {/* Premium Fintech Radial Glow */}
      <div className="absolute top-[-300px] left-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#0863FF]/5 rounded-full blur-[180px] pointer-events-none z-0" />
      
      <Sidebar onCollapsedChange={setSidebarCollapsed} />
      <main className={`${sidebarCollapsed ? 'lg:ml-0 lg:w-full' : 'lg:ml-64 lg:w-[calc(100%-16rem)]'} w-full min-w-0 px-3 py-5 transition-all duration-300 sm:px-5 sm:py-7 lg:p-7 relative z-10`}>
        <div className="mx-auto max-w-none transition-all duration-300">
          {children}
        </div>
      </main>
    </div>
  );
}
