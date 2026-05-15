'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Home, 
  Users, 
  Globe, 
  HelpCircle, 
  FileText, 
  User, 
  Settings,
  LogOut,
  Loader2,
  UserPlus,
  FileSearch,
  Toolbox,
  TrendingUp,
  UserCog,
  RotateCcw,
  Bell,
  Shield,
  Inbox,
  AlertTriangle
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function Sidebar() {
  const pathname = usePathname();
  const { profile, actualProfile, loading, signOut, isViewingAsCorretor, isViewingAsGestor, stopViewingAsCorretor } = useAuth();
  const isViewingAsUser = isViewingAsCorretor || isViewingAsGestor;
  const isMasterAdmin = Boolean(actualProfile?.is_admin_master) || [actualProfile?.email, actualProfile?.email_real]
    .filter(Boolean)
    .map((email) => String(email).toLowerCase())
    .includes('ewerttonherculano@gmail.com');

  const adminMenu = [
    { icon: Home, label: 'Visão Geral', href: '/admin' },
    { icon: Shield, label: 'Usuários', href: '/admin/usuarios' },
    { icon: Users, label: 'Corretores', href: '/admin/corretores' },
    { icon: UserCog, label: 'Gestores de Tráfego', href: '/admin/gestores' },
    { icon: FileSearch, label: 'Todos os Leads', href: '/admin/leads' },
    { icon: Globe, label: 'Páginas', href: '/admin/paginas' },
    ...(isMasterAdmin ? [{ icon: Settings, label: 'Meta Ads', href: '/admin/meta' }] : []),
    { icon: TrendingUp, label: 'Relatórios', href: '/trafego/relatorios' },
    { icon: Bell, label: 'Notificações', href: '/notificacoes' },
    { icon: HelpCircle, label: 'Solicitações de suporte', href: '/admin/suporte' },
  ];

  const trafficMenu = [
    { icon: FileSearch, label: 'Meus Leads', href: '/trafego/leads' },
    { icon: UserPlus, label: 'Entrada', href: '/trafego/entrada' },
    { icon: AlertTriangle, label: 'Avisos Meta', href: '/trafego/avisos-meta' },
    { icon: TrendingUp, label: 'Relatórios', href: '/trafego/relatorios' },
    { icon: Users, label: 'Corretores', href: '/trafego/corretores' },
    { icon: Bell, label: 'Notificações', href: '/notificacoes' },
    { icon: HelpCircle, label: 'Ajuda Orion', href: '/ajuda' },
  ];

  const corretorMenu = [
    { icon: Home, label: 'Início', href: '/dashboard' },
    { icon: Inbox, label: 'CRM', href: '/crm' },
    { icon: Users, label: 'Meus Leads', href: '/leads' },
    { icon: Globe, label: 'Minha Página', href: '/minha-pagina' },
    { icon: Bell, label: 'Notificações', href: '/notificacoes' },
    { icon: HelpCircle, label: 'Ajuda Orion', href: '/ajuda' },
    { icon: User, label: 'Perfil', href: '/perfil' },
  ];

  const getMenu = () => {
    if (profile?.tipo_usuario === 'admin') return adminMenu;
    if (profile?.tipo_usuario === 'gestor_trafego') return trafficMenu;
    return corretorMenu;
  };

  const menuItems = getMenu();

  const initials = profile?.nome 
    ? profile.nome.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : '??';

  const roleLabel = profile?.tipo_usuario === 'admin' 
    ? isMasterAdmin ? 'Admin master' : 'Admin Orion' 
    : profile?.tipo_usuario === 'gestor_trafego' 
      ? 'Gestor de Tráfego' 
      : 'Corretor Parceiro';

  return (
    <div className="w-64 bg-[#0f172a] text-white h-screen flex flex-col fixed left-0 top-0 z-50 shadow-2xl">
      <div className="p-6 mb-2">
        <Link href={profile?.tipo_usuario === 'admin' ? '/admin' : profile?.tipo_usuario === 'gestor_trafego' ? '/trafego/relatorios' : '/dashboard'} className="block">
          <img 
            src="/brand-logo.png" 
            alt="ORION TRACK" 
            className="h-24 w-auto" 
          />
        </Link>
        {isViewingAsUser && (
          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-200">Modo admin</p>
            <p className="mt-1 text-xs font-bold text-white">Você está acessando como {isViewingAsGestor ? 'gestor' : 'corretor'}.</p>
            <button
              onClick={stopViewingAsCorretor}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-white/15"
            >
              <RotateCcw size={13} /> Voltar ao admin
            </button>
          </div>
        )}
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-blue-500" size={24} />
          </div>
        ) : menuItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group",
                isActive 
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" 
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              )}
            >
              <item.icon size={20} className={cn(isActive ? "text-white" : "text-gray-400 group-hover:text-white")} />
              <span className="font-semibold text-sm">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 mt-auto border-t border-white/5 bg-white/[0.02]">
        <div className="flex items-center gap-3 p-2 bg-white/5 rounded-2xl border border-white/5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-black text-sm shadow-inner">
            {initials}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-xs font-bold truncate text-white">
              {profile?.nome || 'Usuário'}
            </p>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tighter">
              {isViewingAsUser ? `Admin: ${actualProfile?.nome || 'Orion'}` : roleLabel}
            </p>
          </div>
          <button 
            onClick={signOut}
            className="p-2 text-gray-500 hover:text-red-400 transition-colors"
            title="Sair"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
