'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  Bell,
  ClipboardList,
  FileSearch,
  FileText,
  Globe,
  HelpCircle,
  Home,
  Inbox,
  Loader2,
  LogOut,
  MessageSquare,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Settings,
  Shield,
  TrendingUp,
  Trophy,
  User,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type SidebarProps = {
  onCollapsedChange?: (collapsed: boolean) => void;
};

export default function Sidebar({ onCollapsedChange }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { profile, actualProfile, loading, signOut, isViewingAsCorretor, isViewingAsGestor, isViewingAsDesigner, isViewingAsAccount, stopViewingAsCorretor } = useAuth();
  const isViewingAsUser = isViewingAsCorretor || isViewingAsGestor || isViewingAsDesigner || isViewingAsAccount;
  const isMasterAdmin = Boolean(actualProfile?.is_admin_master) || [actualProfile?.email, actualProfile?.email_real]
    .filter(Boolean)
    .map((email) => String(email).toLowerCase())
    .includes('ewerttonherculano@gmail.com');

  const adminMenu = [
    { icon: Home, label: 'Visao Geral', href: '/admin' },
    { icon: Shield, label: 'Usuarios', href: '/admin/usuarios' },
    { icon: Users, label: 'Corretores', href: '/admin/corretores' },
    { icon: UserCog, label: 'Gestores de Trafego', href: '/admin/gestores' },
    { icon: Palette, label: 'Designer', href: '/admin/designers' },
    { icon: MessageSquare, label: 'Account', href: '/admin/accounts' },
    { icon: FileSearch, label: 'Todos os Leads', href: '/admin/leads' },
    { icon: Palette, label: 'Demandas criativas', href: '/criativos/demandas' },
    { icon: Globe, label: 'Paginas', href: '/admin/paginas' },
    { icon: Settings, label: 'Meta Ads', href: '/admin/meta' },
    { icon: Trophy, label: 'Meu time', href: '/equipe/apollo' },
    { icon: TrendingUp, label: 'Relatorios', href: '/trafego/relatorios' },
    { icon: ClipboardList, label: 'Historico', href: '/admin/historico' },
    { icon: Bell, label: 'Notificacoes', href: '/notificacoes' },
    { icon: HelpCircle, label: 'Solicitacoes de suporte', href: '/admin/suporte' },
    { icon: User, label: 'Perfil', href: '/perfil' },
  ];

  const trafficMenu = [
    { icon: FileSearch, label: 'Leads dos corretores', href: '/trafego/leads' },
    { icon: UserPlus, label: 'Entrada', href: '/trafego/entrada' },
    { icon: AlertTriangle, label: 'Avisos Meta', href: '/trafego/avisos-meta' },
    { icon: TrendingUp, label: 'Relatorios', href: '/trafego/relatorios' },
    { icon: Users, label: 'Corretores', href: '/trafego/corretores' },
    { icon: Palette, label: 'Demandas criativas', href: '/criativos/demandas' },
    { icon: Trophy, label: 'Meu time', href: '/equipe/apollo' },
    { icon: Bell, label: 'Notificacoes', href: '/notificacoes' },
    { icon: HelpCircle, label: 'Ajuda Orion', href: '/ajuda' },
    { icon: User, label: 'Perfil', href: '/perfil' },
  ];

  const designerMenu = [
    { icon: Palette, label: 'Designer', href: '/designer' },
    { icon: ClipboardList, label: 'Demandas', href: '/designer/demandas' },
    { icon: FileText, label: 'Ofertas', href: '/designer/ofertas' },
    { icon: Trophy, label: 'Meu time', href: '/equipe/apollo' },
    { icon: Bell, label: 'Notificacoes', href: '/notificacoes' },
    { icon: User, label: 'Perfil', href: '/perfil' },
  ];

  const accountMenu = [
    { icon: Home, label: 'Account', href: '/account' },
    { icon: MessageSquare, label: 'Inbox', href: '/account/inbox' },
    { icon: TrendingUp, label: 'Relatorios', href: '/trafego/relatorios' },
    { icon: FileSearch, label: 'Leads', href: '/admin/leads' },
    { icon: Palette, label: 'Demandas criativas', href: '/criativos/demandas' },
    { icon: Trophy, label: 'Meu time', href: '/equipe/apollo' },
    { icon: Bell, label: 'Notificacoes', href: '/notificacoes' },
    { icon: User, label: 'Perfil', href: '/perfil' },
  ];

  const corretorMenu = [
    { icon: Home, label: 'Inicio', href: '/dashboard' },
    { icon: Inbox, label: 'CRM', href: '/crm' },
    { icon: MessageSquare, label: 'Inbox', href: '/inbox' },
    { icon: Users, label: 'Leads', href: '/leads' },
    { icon: UserPlus, label: 'Meu time', href: '/time' },
    { icon: Palette, label: 'Criativos', href: '/criativos' },
    { icon: Globe, label: 'Minha Pagina', href: '/minha-pagina' },
    { icon: Bell, label: 'Notificacoes', href: '/notificacoes' },
    { icon: HelpCircle, label: 'Ajuda Orion', href: '/ajuda' },
    { icon: User, label: 'Perfil', href: '/perfil' },
  ];

  const corretorMemberMenu = [
    { icon: Home, label: 'Inicio', href: '/dashboard' },
    { icon: Inbox, label: 'CRM', href: '/crm' },
    { icon: Users, label: 'Leads', href: '/leads' },
    { icon: MessageSquare, label: 'Inbox', href: '/inbox' },
    { icon: Bell, label: 'Notificacoes', href: '/notificacoes' },
    { icon: User, label: 'Perfil', href: '/perfil' },
  ];

  const getMenu = () => {
    if (profile?.tipo_usuario === 'admin') return adminMenu;
    if (profile?.tipo_usuario === 'gestor_trafego') return trafficMenu;
    if (profile?.tipo_usuario === 'designer') return designerMenu;
    if (profile?.tipo_usuario === 'account_manager') return accountMenu;
    if (profile?.tipo_usuario === 'corretor_membro') return corretorMemberMenu;
    return corretorMenu;
  };

  const initials = profile?.nome
    ? profile.nome.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : '??';

  const roleLabel = profile?.tipo_usuario === 'admin'
    ? isMasterAdmin ? 'DevOps Manager' : 'Admin Orion'
    : profile?.tipo_usuario === 'gestor_trafego'
      ? 'Gestor de Trafego'
      : profile?.tipo_usuario === 'designer'
        ? 'Designer'
        : profile?.tipo_usuario === 'account_manager'
          ? 'Account manager'
          : profile?.tipo_usuario === 'corretor_membro'
            ? 'Equipe comercial'
          : 'Corretor Parceiro';

  useEffect(() => {
    onCollapsedChange?.(collapsed);
  }, [collapsed, onCollapsedChange]);

  useEffect(() => {
    const syncMobileState = () => {
      if (window.innerWidth < 1024) setCollapsed(true);
    };

    syncMobileState();
    window.addEventListener('resize', syncMobileState);
    return () => window.removeEventListener('resize', syncMobileState);
  }, []);

  const closeOnMobile = () => {
    if (window.innerWidth < 1024) setCollapsed(true);
  };

  return (
    <>
      {!collapsed && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setCollapsed(true)}
          className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-sm lg:hidden"
        />
      )}
      <div className={cn('fixed left-0 top-0 z-50 flex h-screen max-w-[86vw] flex-col bg-[#0f172a] text-white shadow-2xl transition-all duration-300', collapsed ? 'w-0 overflow-visible' : 'w-72 lg:w-64')}>
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        className={cn('absolute top-4 z-[60] flex h-10 w-10 items-center justify-center border border-white/10 bg-[#0f172a] text-white shadow-lg transition-all', collapsed ? 'left-2 rounded-r-lg' : 'right-[-18px] rounded-lg')}
        title={collapsed ? 'Expandir menu' : 'Recolher menu'}
      >
        {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
      </button>

      <div className={cn('flex h-full flex-col transition-opacity duration-200', collapsed ? 'pointer-events-none opacity-0' : 'opacity-100')}>
        <div className="mb-2 p-6">
          <Link href={profile?.tipo_usuario === 'admin' ? '/admin' : profile?.tipo_usuario === 'gestor_trafego' ? '/trafego/relatorios' : profile?.tipo_usuario === 'designer' ? '/designer' : profile?.tipo_usuario === 'account_manager' ? '/account' : profile?.tipo_usuario === 'corretor_membro' ? '/crm' : '/dashboard'} onClick={closeOnMobile} className="block">
            <img src="/brand-logo.png" alt="ORION TRACK" className="h-24 w-auto" />
          </Link>
          {isViewingAsUser && (
            <div className="mt-4 border border-amber-400/20 bg-amber-400/10 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-200">Modo admin</p>
              <p className="mt-1 text-xs font-bold text-white">
                Voce esta acessando como {isViewingAsGestor ? 'gestor' : isViewingAsDesigner ? 'designer' : isViewingAsAccount ? 'account' : 'corretor'}.
              </p>
              <button
                onClick={stopViewingAsCorretor}
                className="mt-3 flex w-full items-center justify-center gap-2 bg-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-white/15"
              >
                <RotateCcw size={13} /> Voltar ao admin
              </button>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="animate-spin text-blue-500" size={24} />
            </div>
          ) : getMenu().map((item) => {
            const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeOnMobile}
                className={cn(
                  'group flex items-center gap-3 px-4 py-3 transition-all duration-200',
                  isActive ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'
                )}
              >
                <item.icon size={20} className={cn(isActive ? 'text-white' : 'text-gray-400 group-hover:text-white')} />
                <span className="text-sm font-semibold">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-white/5 bg-white/[0.02] p-4">
          <div className="flex items-center gap-3 border border-white/5 bg-white/5 p-2">
            <div className="flex h-10 w-10 items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-black shadow-inner">
              {initials}
            </div>
            <div className="min-w-0 flex-1 overflow-hidden">
              <p className="truncate text-xs font-bold text-white">{profile?.nome || 'Usuario'}</p>
              <p className="text-[10px] font-bold uppercase tracking-tighter text-gray-500">
                {isViewingAsUser ? `Admin: ${actualProfile?.nome || 'Orion'}` : roleLabel}
              </p>
            </div>
            <button onClick={signOut} className="p-2 text-gray-500 transition-colors hover:text-red-400" title="Sair">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
