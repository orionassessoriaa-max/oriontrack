'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  Bot,
  Building2,
  Calculator,
  ChevronDown,
  CheckCircle2,
  ClipboardList,
  Cpu,
  FileSearch,
  FileText,
  GitBranch,
  Globe,
  HelpCircle,
  Home,
  Inbox,
  Loader2,
  LogOut,
  MessageSquare,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Settings,
  Shield,
  Sparkles,
  Sun,
  TrendingUp,
  Trophy,
  User,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { canUseFerramentasPreview } from '@/lib/ferramentasAccess';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type SidebarProps = {
  onCollapsedChange?: (collapsed: boolean) => void;
};

export default function Sidebar({ onCollapsedChange }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(true);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toast, setToast] = useState<{ id: string; titulo: string; mensagem: string } | null>(null);
  const [tema, setTema] = useState<string>('noturno');
  const [hasTeamMembers, setHasTeamMembers] = useState(true);

  useEffect(() => {
    const handleThemeChange = () => {
      setTema(window.localStorage.getItem('orion:tema_sistema') || 'noturno');
    };
    handleThemeChange();
    window.addEventListener('orion:theme_changed', handleThemeChange);
    return () => window.removeEventListener('orion:theme_changed', handleThemeChange);
  }, []);

  const isDark = tema === 'noturno';

  const { profile, actualProfile, loading, signOut, isViewingAsCorretor, isViewingAsGestor, isViewingAsDesigner, isViewingAsAccount, stopViewingAsCorretor } = useAuth();

  useEffect(() => {
    if (!profile?.corretor_id) return;
    if (!['corretor', 'corretor_admin'].includes(profile.tipo_usuario || '')) return;

    const checkTeamMembers = async () => {
      try {
        const { count, error } = await supabase
          .from('corretor_time_membros')
          .select('*', { count: 'exact', head: true })
          .eq('corretor_id', profile.corretor_id);

        if (!error && count !== null) {
          setHasTeamMembers(count > 0);
        }
      } catch (err) {
        console.error('Error checking team members:', err);
      }
    };

    checkTeamMembers();
  }, [profile?.corretor_id, profile?.tipo_usuario]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!profile?.id) return;

    const fetchUnreadCount = async () => {
      try {
        let query = supabase
          .from('notificacoes')
          .select('id', { count: 'exact', head: true })
          .eq('lida', false);

        if (profile.tipo_usuario !== 'admin') {
          query = query.or(`destinatario_profile_id.eq.${profile.id},destinatario_tipo.eq.${profile.tipo_usuario},destinatario_tipo.eq.todos`);
        }

        const { count, error } = await query;
        if (!error && count !== null) {
          setUnreadCount(count);
        }
      } catch (err) {
        console.error('Error fetching unread count:', err);
      }
    };

    fetchUnreadCount();

    const channel = supabase
      .channel('realtime:notificacoes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notificacoes' },
        (payload) => {
          const newNotif = payload.new;
          const forMe = 
            profile.tipo_usuario === 'admin' ||
            newNotif.destinatario_profile_id === profile.id ||
            newNotif.destinatario_tipo === profile.tipo_usuario ||
            newNotif.destinatario_tipo === 'todos';

          if (forMe) {
            setUnreadCount((prev) => prev + 1);
            setToast({
              id: String(Date.now()),
              titulo: newNotif.titulo || 'Nova Notificação',
              mensagem: newNotif.mensagem || 'Você recebeu um novo aviso.'
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notificacoes' },
        (payload) => {
          if (payload.new.lida && !payload.old.lida) {
            const forMe = 
              profile.tipo_usuario === 'admin' ||
              payload.new.destinatario_profile_id === profile.id ||
              payload.new.destinatario_tipo === profile.tipo_usuario ||
              payload.new.destinatario_tipo === 'todos';
            
            if (forMe) {
              setUnreadCount((prev) => Math.max(0, prev - 1));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, profile?.tipo_usuario]);
  const isViewingAsUser = isViewingAsCorretor || isViewingAsGestor || isViewingAsDesigner || isViewingAsAccount;
  const impersonationRoleLabel = (() => {
    if (isViewingAsGestor) return 'Gestor';
    if (isViewingAsDesigner) return 'Designer';
    if (isViewingAsAccount) return 'Account';
    return 'Corretor';
  })();
  const isMasterAdmin = Boolean(actualProfile?.is_admin_master) || [actualProfile?.email, actualProfile?.email_real]
    .filter(Boolean)
    .map((email) => String(email).toLowerCase())
    .includes('ewerttonherculano@gmail.com');

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setMoreMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const adminMenu = [
    { icon: Home, label: 'Visao Geral', href: '/admin' },
    { icon: Shield, label: 'Usuarios', href: '/admin/usuarios' },
    { icon: Building2, label: 'Concessionarias', href: '/admin/corretoras' },
    { icon: Cpu, label: 'IA', href: '/admin/ia' },
    { icon: GitBranch, label: 'Bot', href: '/admin/bot' },
    { icon: Sparkles, label: 'Ferramentas', href: '/admin/ferramentas' },
    { icon: Users, label: 'Corretores', href: '/admin/corretores' },
    { icon: UserCog, label: 'Gestores de Trafego', href: '/admin/gestores' },
    { icon: Palette, label: 'Designer', href: '/admin/designers' },
    { icon: MessageSquare, label: 'Account', href: '/admin/accounts' },
    { icon: FileSearch, label: 'Todos os Leads', href: '/admin/leads' },
    { icon: CheckCircle2, label: 'Tarefas', href: '/tarefas' },
    { icon: Calculator, label: 'Simulador', href: '/simulador' },
    { icon: Globe, label: 'Paginas', href: '/admin/paginas' },
    { icon: Settings, label: 'Meta Ads', href: '/admin/meta' },
    { icon: Bot, label: 'Apolo WhatsApp', href: '/admin/configuracoes' },
    { icon: Trophy, label: 'Meu time', href: '/equipe/apollo' },
    { icon: TrendingUp, label: 'Relatorios', href: '/trafego/relatorios' },
    { icon: ClipboardList, label: 'Historico Leads', href: '/historico' },
    { icon: ClipboardList, label: 'Historico', href: '/admin/historico' },
    { icon: Bell, label: 'Notificacoes', href: '/notificacoes' },
    { icon: HelpCircle, label: 'Solicitacoes de suporte', href: '/admin/suporte' },
    { icon: Settings, label: 'Configurações', href: '/admin/configuracoes' },
    { icon: User, label: 'Perfil', href: '/perfil' },
  ];

  const trafficMenu = [
    { icon: Home, label: 'Dashboard', href: '/trafego' },
    { icon: Building2, label: 'Concessionarias', href: '/admin/corretoras' },
    { icon: Palette, label: 'Criativos', href: '/criativos' },
    { icon: TrendingUp, label: 'Otimizacoes', href: '/trafego/otimizacoes' },
    { icon: FileSearch, label: 'Leads dos corretores', href: '/trafego/leads' },
    { icon: UserPlus, label: 'Entrada', href: '/trafego/entrada' },
    { icon: CheckCircle2, label: 'Tarefas', href: '/tarefas' },
    { icon: TrendingUp, label: 'Relatorios', href: '/trafego/relatorios' },
    { icon: Users, label: 'Corretores', href: '/trafego/corretores' },
    { icon: Trophy, label: 'Meu time', href: '/equipe/apollo' },
    { icon: Bell, label: 'Notificacoes', href: '/notificacoes' },
    { icon: HelpCircle, label: 'Ajuda Orion', href: '/ajuda' },
    { icon: User, label: 'Perfil', href: '/perfil' },
  ];

  const designerMenu = [
    { icon: Palette, label: 'Designer', href: '/designer' },
    { icon: FileText, label: 'Ofertas', href: '/designer/ofertas' },
    { icon: Trophy, label: 'Meu time', href: '/equipe/apollo' },
    { icon: Bell, label: 'Notificacoes', href: '/notificacoes' },
    { icon: User, label: 'Perfil', href: '/perfil' },
  ];

  const accountMenu = [
    { icon: Home, label: 'Account', href: '/account' },
    { icon: Users, label: 'Corretores', href: '/account/corretores' },
    { icon: MessageSquare, label: 'Inbox', href: '/account/inbox' },
    { icon: CheckCircle2, label: 'Tarefas', href: '/tarefas' },
    { icon: TrendingUp, label: 'Relatorios', href: '/trafego/relatorios' },
    { icon: Trophy, label: 'Meu time', href: '/equipe/apollo' },
    { icon: Bell, label: 'Notificacoes', href: '/notificacoes' },
    { icon: User, label: 'Perfil', href: '/perfil' },
  ];

  const canSeeFerramentas = canUseFerramentasPreview(profile as any);

  const corretorMenu = [
    { icon: Home, label: 'Inicio', href: '/dashboard' },
    { icon: Users, label: 'Leads', href: '/leads' },
    { icon: Inbox, label: 'CRM', href: '/crm' },
    { icon: MessageSquare, label: 'Inbox', href: '/inbox' },
    { icon: CheckCircle2, label: 'Tarefas', href: '/tarefas' },
    { icon: Globe, label: 'Minha Pagina', href: '/minha-pagina' },
    { icon: Palette, label: 'Solicitar Criativo', href: '/criativos' },
    ...(canSeeFerramentas ? [{ icon: Sparkles, label: 'Ferramentas', href: '/ferramentas' }] : []),
    { icon: Calculator, label: 'Simulador em dev', href: '/simulador' },
    { icon: Trophy, label: 'Meu time', href: '/time' },
    { icon: ClipboardList, label: 'Historico', href: '/historico' },
    { icon: Bell, label: 'Notificacoes', href: '/notificacoes' },
    { icon: User, label: 'Perfil', href: '/perfil' },
  ];

  const corretorMemberMenu = [
    { icon: Home, label: 'Inicio', href: '/dashboard' },
    { icon: Users, label: 'Leads', href: '/leads' },
    { icon: Inbox, label: 'CRM', href: '/crm' },
    { icon: MessageSquare, label: 'Inbox', href: '/inbox' },
    { icon: CheckCircle2, label: 'Tarefas', href: '/tarefas' },
    ...(canSeeFerramentas ? [{ icon: Sparkles, label: 'Ferramentas', href: '/ferramentas' }] : []),
    { icon: Calculator, label: 'Simulador em dev', href: '/simulador' },
    { icon: ClipboardList, label: 'Historico', href: '/historico' },
    { icon: Bell, label: 'Notificacoes', href: '/notificacoes' },
    { icon: User, label: 'Perfil', href: '/perfil' },
  ];

  const getMenu = () => {
    let items = [];
    if (isViewingAsCorretor && ['gestor_trafego', 'account_manager'].includes(String(actualProfile?.tipo_usuario))) {
      const base = corretorMenu;
      if (actualProfile?.tipo_usuario === 'account_manager') {
        items = [
          ...base,
          { icon: MessageSquare, label: 'Inbox Account', href: '/account/inbox' },
          { icon: TrendingUp, label: 'Relatorios', href: '/trafego/relatorios' },
        ];
      } else {
        items = [
          ...base,
          { icon: TrendingUp, label: 'Relatorios', href: '/trafego/relatorios' },
        ];
      }
    } else if (profile?.tipo_usuario === 'gestor_trafego') {
      items = trafficMenu;
    } else if (profile?.tipo_usuario === 'admin') {
      items = adminMenu;
    } else if (profile?.tipo_usuario === 'designer') {
      items = designerMenu;
    } else if (profile?.tipo_usuario === 'account_manager') {
      items = accountMenu;
    } else if (profile?.tipo_usuario === 'corretor_membro') {
      items = corretorMemberMenu;
    } else if (profile?.tipo_usuario === 'corretor_admin') {
      items = corretorMenu;
    } else {
      items = corretorMenu;
    }



    return items;
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
          : ['corretor', 'corretor_admin'].includes(profile?.tipo_usuario || '')
            ? 'Corretor Admin'
          : profile?.tipo_usuario === 'corretor_membro'
            ? 'Corretor integrante'
          : 'Corretor integrante';

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
      <div className={cn(
        "orion-topbar",
        "fixed left-0 right-0 top-0 z-50 flex h-20 w-full items-center justify-between border-b px-4 text-white shadow-xl transition-all duration-300 sm:px-6",
        isDark ? "bg-[#020617] border-white/5" : "bg-[#0f172a] border-white/10"
      )}>
        <div className="flex items-center gap-6">
          <Link
            href={
              profile?.tipo_usuario === 'admin'
                ? '/admin'
                : profile?.tipo_usuario === 'gestor_trafego'
                  ? '/trafego'
                  : profile?.tipo_usuario === 'designer'
                    ? '/designer'
                    : profile?.tipo_usuario === 'account_manager'
                      ? '/account'
                      : profile?.tipo_usuario === 'corretor_membro'
                        ? '/crm'
                        : '/dashboard'
            }
            onClick={closeOnMobile}
            className="block shrink-0"
          >
            <img src="/brand-logo.png" alt="ORION TRACK" className="h-10 w-auto object-contain sm:h-12" />
          </Link>
 
          {/* Desktop Horizontal Navigation Items */}
          <nav className="hidden lg:flex items-center gap-0.5 xl:gap-1 py-1 relative">
            {loading ? (
              <Loader2 className="animate-spin text-blue-500" size={16} />
            ) : (() => {
              const menuItems = getMenu();
              const pinnedMeta = profile?.tipo_usuario === 'admin'
                ? menuItems.find((item) => item.href === '/admin/meta')
                : undefined;
              const pinnedSettings = profile?.tipo_usuario === 'admin'
                ? menuItems.find((item) => item.href === '/admin/configuracoes')
                : undefined;
              const pinnedItems = [pinnedMeta, pinnedSettings].filter(
                (item): item is NonNullable<typeof item> => Boolean(item)
              );
              const menuWithoutPinned = pinnedItems.length
                ? menuItems.filter((item) => !pinnedItems.includes(item))
                : menuItems;
              const hasMore = menuItems.length > 5;
              const visibleBaseCount = pinnedItems.length ? Math.max(1, 5 - pinnedItems.length) : 4;
              const directItems = hasMore
                ? [...menuWithoutPinned.slice(0, visibleBaseCount), ...pinnedItems]
                : menuItems;
              const dropdownItems = hasMore
                ? menuWithoutPinned.slice(visibleBaseCount)
                : [];
              
              return (
                <>
                  {directItems.map((item) => {
                    const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
                    const isNotification = item.label === 'Notificacoes';
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'group flex items-center gap-1.5 rounded-xl px-2.5 py-2 xl:px-3 xl:py-2.5 transition-all duration-250 whitespace-nowrap text-[10px] xl:text-[11px] 2xl:text-xs font-black uppercase tracking-wider shrink-0 relative',
                          isActive
                            ? 'bg-blue-600/12 text-cyan-400 border border-cyan-500/20'
                            : 'text-slate-400 hover:bg-white/5 hover:text-white'
                        )}
                      >
                        <item.icon
                          size={14}
                          className={cn(isActive ? 'text-cyan-400' : 'text-slate-400 group-hover:text-white')}
                        />
                        <span>{item.label}</span>
                        {isNotification && unreadCount > 0 && (
                          <span className="absolute -top-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-rose-500 text-[8px] font-black text-white shadow-[0_0_8px_rgba(244,63,94,0.6)] animate-pulse">
                            {unreadCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                  
                  {hasMore && (
                    <div className="relative animate-in fade-in duration-300" ref={dropdownRef}>
                      <button
                        onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                        className={cn(
                          'group flex items-center gap-1 xl:gap-1.5 rounded-xl px-2.5 py-2 xl:px-3 xl:py-2.5 transition-all duration-250 whitespace-nowrap text-[10px] xl:text-[11px] 2xl:text-xs font-black uppercase tracking-wider cursor-pointer select-none border border-transparent shrink-0',
                          moreMenuOpen
                            ? 'bg-blue-600/12 text-cyan-400 border border-cyan-500/20'
                            : 'text-slate-400 hover:bg-white/5 hover:text-white'
                        )}
                      >
                        <span>Mais</span>
                        <ChevronDown
                          size={14}
                          className={cn(
                            'transition-transform duration-200',
                            moreMenuOpen ? 'rotate-180 text-cyan-400' : 'text-slate-400 group-hover:text-white'
                          )}
                        />
                      </button>
                      
                      {moreMenuOpen && (
                        <div className={cn(
                          "orion-more-menu",
                          "absolute right-0 top-full mt-2.5 z-50 w-64 rounded-2xl backdrop-blur-md border p-2 shadow-2xl orion-dropdown-animate animate-in fade-in-50 slide-in-from-top-2 duration-200",
                          isDark ? "bg-[#090e1a]/95 border-white/5" : "bg-[#0f172a]/95 border-white/10"
                        )}>
                          <div className="max-h-[380px] overflow-y-auto pr-1 scrollbar-none">
                            {dropdownItems.map((item) => {
                              const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
                              const isNotification = item.label === 'Notificacoes';
                              return (
                                <Link
                                  key={item.href}
                                  href={item.href}
                                  onClick={() => setMoreMenuOpen(false)}
                                  className={cn(
                                    'group flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-200 text-xs xl:text-sm font-extrabold mb-1 last:mb-0 relative',
                                    isActive
                                      ? 'bg-blue-600/15 text-cyan-400 border border-cyan-500/20 shadow-inner'
                                      : 'text-slate-400 hover:bg-white/5 hover:text-white'
                                  )}
                                >
                                  <item.icon
                                    size={15}
                                    className={cn(isActive ? 'text-cyan-400' : 'text-slate-400 group-hover:text-white')}
                                  />
                                  <span>{item.label}</span>
                                  {isNotification && unreadCount > 0 && (
                                    <span className="absolute right-4 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[9px] font-black text-white shadow-[0_0_8px_rgba(244,63,94,0.6)]">
                                      {unreadCount}
                                    </span>
                                  )}
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </nav>
        </div>
 
        {/* Right Section: User Profile & Mobile Hamburger Menu */}
        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          {isViewingAsUser && (
            <div className="hidden xl:flex items-center gap-2 border border-amber-400/20 bg-amber-400/10 px-2.5 py-1.5 rounded-xl shrink-0">
              <span className="text-[8px] 2xl:text-[9px] font-black uppercase tracking-[0.2em] 2xl:tracking-[0.32em] text-amber-200 animate-pulse">Modo admin</span>
              <button
                onClick={stopViewingAsCorretor}
                className="flex items-center gap-1 bg-white/10 px-2 py-1 rounded-lg text-[8px] 2xl:text-[9px] font-black uppercase tracking-wider text-white transition-colors hover:bg-white/15 cursor-pointer shrink-0"
              >
                <RotateCcw size={8} /> Sair do {impersonationRoleLabel}
              </button>
            </div>
          )}

          {/* Theme Toggle Button */}
          <button
            onClick={() => {
              const newTheme = tema === 'noturno' ? 'claro' : 'noturno';
              window.localStorage.setItem('orion:tema_sistema', newTheme);
              window.dispatchEvent(new Event('orion:theme_changed'));
            }}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 bg-white/5 text-slate-400 hover:text-white transition-all cursor-pointer"
            title={tema === 'noturno' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
          >
            {tema === 'noturno' ? (
              <Sun size={16} className="text-amber-400 animate-pulse" />
            ) : (
              <Moon size={16} className="text-slate-400" />
            )}
          </button>

          <div className="flex items-center gap-3 border border-white/5 bg-white/5 p-1.5 rounded-2xl">
            <Link href="/perfil" className="flex items-center gap-3 hover:opacity-80 transition-opacity duration-200" title="Ver meu Perfil">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-black shadow-inner">
                {initials}
              </div>
              <div className="hidden sm:block text-left min-w-[70px] max-w-[140px]">
                <p className="truncate text-xs font-bold text-white leading-none">{profile?.nome || 'Usuario'}</p>
                <p className="mt-1 text-[8px] font-bold uppercase tracking-tighter text-slate-500 leading-none">{roleLabel}</p>
              </div>
            </Link>
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
          <div className={cn(
            "orion-mobile-drawer",
            "fixed left-0 right-0 top-20 z-50 flex h-[calc(100vh-5rem)] w-full flex-col border-t p-6 text-white shadow-2xl transition-all duration-300 lg:hidden overflow-y-auto",
            isDark ? "bg-[#020617] border-white/5" : "bg-[#0f172a] border-white/10"
          )}>
            {isViewingAsUser && (
              <div className="mb-4 border border-amber-400/20 bg-amber-400/10 p-4 rounded-2xl">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-200">Modo admin</p>
                <p className="mt-1 text-xs font-bold text-white">
                  Voce esta acessando como {impersonationRoleLabel.toLowerCase()}.
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
                const isNotification = item.label === 'Notificacoes';
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setCollapsed(true)}
                    className={cn(
                      'group flex items-center gap-3 rounded-2xl px-5 py-3.5 transition-all duration-200 relative',
                      isActive ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                    )}
                  >
                    <item.icon size={20} className={cn(isActive ? 'text-white' : 'text-slate-400 group-hover:text-white')} />
                    <span className="text-sm font-semibold">{item.label}</span>
                    {isNotification && unreadCount > 0 && (
                      <span className="absolute right-5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[9px] font-black text-white shadow-[0_0_8px_rgba(244,63,94,0.6)]">
                        {unreadCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>
        </>
      )}

      {/* Real-time Floating Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[9999] w-[350px] animate-in fade-in-50 slide-in-from-bottom-5 duration-300">
          <div className="orion-toast rounded-3xl border border-blue-500/30 bg-[#090e1a]/95 backdrop-blur-md p-5 shadow-[0_0_30px_rgba(59,130,246,0.3)]">
            <div className="flex items-center gap-3 mb-2.5">
              <div className="p-2 rounded-xl bg-blue-500/20 text-cyan-400">
                <Bell size={18} className="animate-bounce" />
              </div>
              <h4 className="font-black text-sm text-white">{toast.titulo}</h4>
            </div>
            <p className="text-xs font-semibold text-slate-300 leading-normal mb-3.5">{toast.mensagem}</p>
            <div className="flex justify-between items-center border-t border-white/5 pt-3">
              <Link
                href="/notificacoes"
                onClick={() => {
                  setToast(null);
                  closeOnMobile();
                }}
                className="text-[10px] font-black text-cyan-400 uppercase tracking-widest hover:text-cyan-300 transition-colors"
              >
                Ver tudo
              </Link>
              <button
                onClick={() => setToast(null)}
                className="text-[10px] font-black text-slate-500 uppercase tracking-widest hover:text-white transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

