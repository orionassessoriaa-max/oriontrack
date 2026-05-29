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
  const [collapsed, setCollapsed] = useState(true);
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
      {/* Top Horizontal Navbar Header */}
      <div className="fixed left-0 right-0 top-0 z-50 flex h-20 w-full items-center justify-between border-b border-white/5 bg-[#020617] px-4 text-white shadow-xl transition-all duration-300 sm:px-6">
        <div className="flex items-center gap-6">
          <Link
            href={
              profile?.tipo_usuario === 'admin'
                ? '/admin'
                : profile?.tipo_usuario === 'gestor_trafego'
                  ? '/trafego/relatorios'
                  : profile?.tipo_usuario === 'designer'
                    ? '/designer'
                    : profile?.tipo_usuario === 'account_manager'
                      ? '/account'
                      : profile?.tipo_usuario === 'corretor_membro'
                        ? '/crm'
                        : '/dashboard'
            }
            onClick={closeOnMobile}
            className="block"
          >
            <img src="/brand-logo.png" alt="ORION TRACK" className="h-10 w-auto object-contain sm:h-12" />
          </Link>

          {/* Desktop Horizontal Navigation Items */}
          <nav className="hidden lg:flex items-center gap-1.5 overflow-x-auto py-1 max-w-[45vw] xl:max-w-[55vw] scrollbar-none">
            {loading ? (
              <Loader2 className="animate-spin text-blue-500" size={16} />
            ) : (
              getMenu().map((item) => {
                const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'group flex items-center gap-2 rounded-xl px-3.5 py-2.5 transition-all duration-250 whitespace-nowrap text-xs xl:text-sm font-extrabold',
                      isActive
                        ? 'bg-blue-600/12 text-cyan-400 border border-cyan-500/20'
                        : 'text-slate-400 hover:bg-white/5 hover:text-white'
                    )}
                  >
                    <item.icon
                      size={15}
                      className={cn(isActive ? 'text-cyan-400' : 'text-slate-400 group-hover:text-white')}
                    />
                    <span>{item.label}</span>
                  </Link>
                );
              })
            )}
          </nav>
        </div>

        {/* Right Section: User Profile & Mobile Hamburger Menu */}
        <div className="flex items-center gap-3 sm:gap-4">
          {isViewingAsUser && (
            <div className="hidden xl:flex items-center gap-3 border border-amber-400/20 bg-amber-400/10 px-3.5 py-1.5 rounded-xl">
              <span className="text-[9px] font-black uppercase tracking-widest text-amber-200 animate-pulse">Modo admin</span>
              <button
                onClick={stopViewingAsCorretor}
                className="flex items-center gap-1 bg-white/10 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest text-white transition-colors hover:bg-white/15 cursor-pointer"
              >
                <RotateCcw size={10} /> Sair do Corretor
              </button>
            </div>
          )}

          <div className="flex items-center gap-3 border border-white/5 bg-white/5 p-1.5 rounded-2xl">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-black shadow-inner">
              {initials}
            </div>
            <div className="hidden sm:block text-left min-w-[70px] max-w-[140px]">
              <p className="truncate text-xs font-bold text-white leading-none">{profile?.nome || 'Usuario'}</p>
              <p className="mt-1 text-[8px] font-bold uppercase tracking-tighter text-slate-500 leading-none">{roleLabel}</p>
            </div>
            <button
              onClick={signOut}
              className="p-1.5 text-slate-500 transition-colors hover:text-red-400 cursor-pointer"
              title="Sair"
            >
              <LogOut size={15} />
            </button>
          </div>

          {/* Hamburger button for mobile/tablet */}
          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white transition-all hover:bg-white/10 lg:hidden cursor-pointer"
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
      </div>

      {/* Floating Overlay Mobile Menu Drawer */}
      {!collapsed && (
        <>
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setCollapsed(true)}
            className="fixed inset-0 top-20 z-40 bg-slate-950/75 backdrop-blur-md lg:hidden"
          />
          <div className="fixed left-0 right-0 top-20 z-50 flex h-[calc(100vh-5rem)] w-full flex-col bg-[#020617] border-t border-white/5 p-6 text-white shadow-2xl transition-all duration-300 lg:hidden overflow-y-auto">
            {isViewingAsUser && (
              <div className="mb-4 border border-amber-400/20 bg-amber-400/10 p-4 rounded-2xl">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-200">Modo admin</p>
                <p className="mt-1 text-xs font-bold text-white">
                  Voce esta acessando como corretor.
                </p>
                <button
                  onClick={stopViewingAsCorretor}
                  className="mt-3 flex w-full items-center justify-center gap-2 bg-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-white/15"
                >
                  <RotateCcw size={13} /> Voltar ao admin
                </button>
              </div>
            )}
            <nav className="space-y-1.5 pb-12">
              {getMenu().map((item) => {
                const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setCollapsed(true)}
                    className={cn(
                      'group flex items-center gap-3 rounded-2xl px-5 py-3.5 transition-all duration-200',
                      isActive ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                    )}
                  >
                    <item.icon size={20} className={cn(isActive ? 'text-white' : 'text-slate-400 group-hover:text-white')} />
                    <span className="text-sm font-semibold">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </>
      )}
    </>
  );
}

