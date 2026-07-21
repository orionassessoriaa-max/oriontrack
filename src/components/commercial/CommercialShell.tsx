'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  Bot, BriefcaseBusiness, CheckSquare2, ChevronLeft, Eye, LayoutDashboard, LogOut, Menu,
  PanelLeftClose, PanelLeftOpen, Sparkles, Table2, UsersRound, X,
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { commercialRoleLabel, type CommercialMember, type CommercialRole } from '@/lib/comercial';
import { canSelectOperationalTeam } from '@/lib/teamSelection';

type CommercialContextValue = {
  role: CommercialRole | null;
  members: CommercialMember[];
  currentProfileId: string | null;
  canViewMetaInvestment: boolean;
  isDevOps: boolean;
  loading: boolean;
  error: string | null;
  api: (url: string, init?: RequestInit) => Promise<any>;
  refreshAccess: () => Promise<void>;
  canViewCommercialAsUser: boolean;
  viewingCommercialProfileId: string | null;
  startViewingCommercialMember: (profileId: string) => void;
  stopViewingCommercialMember: () => void;
};

const CommercialContext = createContext<CommercialContextValue | null>(null);

export function useCommercial() {
  const value = useContext(CommercialContext);
  if (!value) throw new Error('useCommercial deve ser usado dentro do painel comercial.');
  return value;
}

const baseNavigation = [
  { href: '/comercial', label: 'Visão geral', icon: LayoutDashboard },
  { href: '/comercial/kanban', label: 'Kanban', icon: BriefcaseBusiness },
  { href: '/comercial/leads', label: 'Leads', icon: Table2 },
  { href: '/comercial/tarefas', label: 'Tarefas', icon: CheckSquare2 },
  { href: '/comercial/ia', label: 'IA e follow-up', icon: Bot },
];

export default function CommercialShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, actualProfile, loading: authLoading, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [role, setRole] = useState<CommercialRole | null>(null);
  const [members, setMembers] = useState<CommercialMember[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [canViewMetaInvestment, setCanViewMetaInvestment] = useState(false);
  const [isDevOps, setIsDevOps] = useState(false);
  const [viewingCommercialProfileId, setViewingCommercialProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canViewCommercialAsUser = actualProfile?.tipo_usuario === 'admin' && Boolean(actualProfile?.is_admin_master);

  const api = useCallback(async (url: string, init: RequestInit = {}) => {
    const { data } = await import('@/lib/supabase/client').then(({ supabase }) => supabase.auth.getSession());
    const token = data.session?.access_token;
    if (!token) throw new Error('Sessão expirada. Entre novamente.');
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${token}`);
    if (canViewCommercialAsUser && viewingCommercialProfileId) {
      headers.set('x-commercial-view-profile-id', viewingCommercialProfileId);
    }
    const response = await fetch(url, {
      ...init,
      headers,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível concluir a operação.');
    return payload;
  }, [canViewCommercialAsUser, viewingCommercialProfileId]);

  const refreshAccess = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api('/api/comercial/members');
      setRole(payload.role);
      setMembers(payload.members || []);
      setCurrentProfileId(payload.currentProfileId || null);
      setCanViewMetaInvestment(Boolean(payload.canViewMetaInvestment));
      setIsDevOps(Boolean(payload.isDevOps));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao abrir o comercial.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    void refreshAccess();
  }, [authLoading, refreshAccess, router, user, viewingCommercialProfileId]);

  useEffect(() => {
    if (!canViewCommercialAsUser || typeof window === 'undefined') return;
    const saved = window.sessionStorage.getItem('orion:commercial_view_profile_id');
    if (saved) setViewingCommercialProfileId(saved);
  }, [canViewCommercialAsUser]);

  useEffect(() => setMobileOpen(false), [pathname]);

  const startViewingCommercialMember = useCallback((profileId: string) => {
    if (!canViewCommercialAsUser) return;
    setViewingCommercialProfileId(profileId);
    window.sessionStorage.setItem('orion:commercial_view_profile_id', profileId);
    router.push('/comercial');
  }, [canViewCommercialAsUser, router]);

  const stopViewingCommercialMember = useCallback(() => {
    setViewingCommercialProfileId(null);
    window.sessionStorage.removeItem('orion:commercial_view_profile_id');
    router.push('/comercial/usuarios');
  }, [router]);

  const navigation = useMemo(() => role === 'coordenador'
    ? [...baseNavigation, { href: '/comercial/usuarios', label: 'Usuários', icon: UsersRound }]
    : baseNavigation, [role]);
  const currentMember = members.find((member) => member.profile_id === currentProfileId);

  if (authLoading || loading) {
    return <div className="kh-loading"><Sparkles className="kh-spin" size={26} /><span>Preparando operação comercial</span></div>;
  }

  if (error) {
    return (
      <div className="kh-loading kh-error-state">
        <div className="kh-error-icon"><X size={24} /></div>
        <h1>Não foi possível abrir o comercial</h1>
        <p>{error}</p>
        <button type="button" onClick={() => void refreshAccess()}>Tentar novamente</button>
      </div>
    );
  }

  return (
    <CommercialContext.Provider value={{ role, members, currentProfileId, canViewMetaInvestment, isDevOps, loading, error, api, refreshAccess, canViewCommercialAsUser, viewingCommercialProfileId, startViewingCommercialMember, stopViewingCommercialMember }}>
      <div className={`kh ${collapsed ? 'kh-collapsed' : ''}`}>
        {mobileOpen && <button className="kh-scrim" aria-label="Fechar menu" onClick={() => setMobileOpen(false)} />}
        <aside className={`kh-sidebar ${mobileOpen ? 'is-open' : ''}`}>
          <div className="kh-brand">
            <div className="kh-brand-mark"><span>K</span></div>
            {!collapsed && <div><strong>KRIPTO</strong><span>HUNTERS</span></div>}
            <button className="kh-mobile-close" aria-label="Fechar menu" onClick={() => setMobileOpen(false)}><X size={20} /></button>
          </div>

          <nav className="kh-nav" aria-label="Navegação comercial">
            {navigation.map((item) => {
              const active = item.href === '/comercial' ? pathname === item.href : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className={active ? 'active' : ''} title={collapsed ? item.label : undefined}>
                  <Icon size={19} strokeWidth={1.8} />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
          </nav>

          <div className="kh-sidebar-bottom">
            {canSelectOperationalTeam(actualProfile) && (
              <Link href="/selecionar-time" title={collapsed ? 'Trocar operação' : undefined}>
                <ChevronLeft size={18} />{!collapsed && <span>Trocar operação</span>}
              </Link>
            )}
            <button type="button" onClick={signOut} title={collapsed ? 'Sair' : undefined}>
              <LogOut size={18} />{!collapsed && <span>Sair</span>}
            </button>
          </div>
          <button className="kh-collapse" type="button" aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'} onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </aside>

        <div className="kh-workspace">
          <header className="kh-topbar">
            <button className="kh-menu" aria-label="Abrir menu" onClick={() => setMobileOpen(true)}><Menu size={21} /></button>
            <div className="kh-topbar-context"><span>Operação comercial</span><strong>{pathname === '/comercial' ? 'Visão geral' : navigation.find((item) => pathname.startsWith(item.href) && item.href !== '/comercial')?.label || 'Kripto Hunters'}</strong></div>
            {viewingCommercialProfileId && canViewCommercialAsUser && (
              <button type="button" className="kh-viewing-pill" onClick={stopViewingCommercialMember} title="Sair da visualizacao do integrante">
                <Eye size={15} /> Vendo como {currentMember?.nome || 'integrante'} <X size={14} />
              </button>
            )}
            <div className="kh-profile">
              <div className="kh-avatar">{String(currentMember?.nome || actualProfile?.nome || 'KH').split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</div>
              <div><strong>{currentMember?.nome || actualProfile?.nome}</strong><span>{isDevOps ? 'DevOps Manager' : commercialRoleLabel(role)}</span></div>
            </div>
          </header>
          <main className="kh-main">{children}</main>
        </div>
      </div>
    </CommercialContext.Provider>
  );
}
