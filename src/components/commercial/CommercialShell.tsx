"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Bot,
  BarChart3,
  BriefcaseBusiness,
  CheckSquare2,
  ChevronDown,
  ClipboardList,
  Eye,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Orbit,
  PhoneCall,
  Target,
  Table2,
  UsersRound,
  X,
} from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  commercialRoleLabel,
  type CommercialMember,
  type CommercialRole,
} from "@/lib/comercial";
import { canSelectOperationalTeam, DUAL_OPERATION_ACCESS_KEY } from "@/lib/teamSelection";

type CommercialContextValue = {
  role: CommercialRole | null;
  canViewCommercialFinancials: boolean;
  canViewCommercialLeadQualification: boolean;
  canEditCommercial: boolean;
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

type CommercialAccessPayload = {
  role: CommercialRole | null;
  canViewCommercialFinancials?: boolean;
  canViewCommercialLeadQualification?: boolean;
  canEditCommercial?: boolean;
  members?: CommercialMember[];
  currentProfileId?: string | null;
  canViewMetaInvestment?: boolean;
  isDevOps?: boolean;
};

type CommercialAccessCacheEntry = {
  key: string;
  payload: CommercialAccessPayload;
};

// Keep the last authorized access result between route remounts. The API is
// still revalidated on every entry, but navigation no longer blanks the app.
const commercialAccessCache = new Map<string, CommercialAccessCacheEntry>();
let lastCommercialAccess: CommercialAccessCacheEntry | null = null;

export function useCommercial() {
  const value = useContext(CommercialContext);
  if (!value)
    throw new Error("useCommercial deve ser usado dentro do painel comercial.");
  return value;
}

const baseNavigation = [
  { href: "/comercial", label: "Visão geral", icon: LayoutDashboard },
  { href: "/overview", label: "Overview", icon: Orbit },
  { href: "/comercial/inbox", label: "Inbox", icon: MessageSquare },
  { href: "/comercial/kanban", label: "Kanban", icon: BriefcaseBusiness },
  { href: "/comercial/leads", label: "Leads", icon: Table2 },
  { href: "/comercial/inteligencia", label: "Inteligência", icon: BarChart3 },
  { href: "/comercial/relatorios", label: "Relatorios", icon: PhoneCall },
  { href: "/comercial/historico", label: "Historico", icon: ClipboardList },
  { href: "/comercial/tarefas", label: "Tarefas", icon: CheckSquare2 },
  { href: "/comercial/metas", label: "Metas", icon: Target },
  { href: "/comercial/sala", label: "Sala", icon: Orbit },
  { href: "/comercial/ia", label: "IA", icon: Bot },
];

// A sala e uma cabine em tela cheia: ela usa o contexto comercial, mas sem a
// barra de navegacao por cima da janela.
const IMMERSIVE_PREFIX = "/comercial/sala";

export default function CommercialShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, actualProfile, loading: authLoading, signOut } = useAuth();
  const initialCachedAccess = lastCommercialAccess?.payload;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [role, setRole] = useState<CommercialRole | null>(
    initialCachedAccess?.role || null,
  );
  const [canViewCommercialFinancials, setCanViewCommercialFinancials] =
    useState(Boolean(initialCachedAccess?.canViewCommercialFinancials));
  const [
    canViewCommercialLeadQualification,
    setCanViewCommercialLeadQualification,
  ] = useState(
    initialCachedAccess?.canViewCommercialLeadQualification !== false,
  );
  const [canEditCommercial, setCanEditCommercial] = useState(
    initialCachedAccess?.canEditCommercial !== false,
  );
  const [members, setMembers] = useState<CommercialMember[]>(
    initialCachedAccess?.members || [],
  );
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(
    initialCachedAccess?.currentProfileId || null,
  );
  const [canViewMetaInvestment, setCanViewMetaInvestment] = useState(
    Boolean(initialCachedAccess?.canViewMetaInvestment),
  );
  const [isDevOps, setIsDevOps] = useState(
    Boolean(initialCachedAccess?.isDevOps),
  );
  const [viewingCommercialProfileId, setViewingCommercialProfileId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(!initialCachedAccess);
  const [error, setError] = useState<string | null>(null);
  const canViewCommercialAsUser =
    actualProfile?.tipo_usuario === "admin" &&
    Boolean(actualProfile?.is_admin_master);

  const applyAccess = useCallback((payload: CommercialAccessPayload) => {
    setRole(payload.role);
    setCanViewCommercialFinancials(
      Boolean(payload.canViewCommercialFinancials),
    );
    setCanViewCommercialLeadQualification(
      payload.canViewCommercialLeadQualification !== false,
    );
    setCanEditCommercial(payload.canEditCommercial !== false);
    setMembers(payload.members || []);
    setCurrentProfileId(payload.currentProfileId || null);
    setCanViewMetaInvestment(Boolean(payload.canViewMetaInvestment));
    setIsDevOps(Boolean(payload.isDevOps));
  }, []);

  const api = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const { data } = await import("@/lib/supabase/client").then(
        ({ supabase }) => supabase.auth.getSession(),
      );
      const token = data.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Entre novamente.");
      const headers = new Headers(init.headers);
      if (!(init.body instanceof FormData))
        headers.set("Content-Type", "application/json");
      headers.set("Authorization", `Bearer ${token}`);
      if (canViewCommercialAsUser && viewingCommercialProfileId)
        headers.set("x-commercial-view-profile-id", viewingCommercialProfileId);
      const response = await fetch(url, { ...init, headers });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          payload.error || "Não foi possível concluir a operação.",
        );
      return payload;
    },
    [canViewCommercialAsUser, viewingCommercialProfileId],
  );

  const refreshAccess = useCallback(async () => {
    const cacheKey = user
      ? `${user.id}:${viewingCommercialProfileId || ""}`
      : null;
    const cached = cacheKey ? commercialAccessCache.get(cacheKey) : null;
    // With cached access, refresh silently so the current page remains usable.
    if (!cached) setLoading(true);
    setError(null);
    try {
      const payload = await api("/api/comercial/members");
      applyAccess(payload);
      if (cacheKey) {
        const entry = { key: cacheKey, payload };
        commercialAccessCache.set(cacheKey, entry);
        lastCommercialAccess = entry;
      }
    } catch (err) {
      // A transient refresh failure must not blank an already authorized view.
      if (!cached)
        setError(
          err instanceof Error ? err.message : "Erro ao abrir o comercial.",
        );
    } finally {
      setLoading(false);
    }
  }, [api, applyAccess, user, viewingCommercialProfileId]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    const cacheKey = `${user.id}:${viewingCommercialProfileId || ""}`;
    const cached = commercialAccessCache.get(cacheKey);
    if (cached) {
      applyAccess(cached.payload);
      setLoading(false);
    }
    void refreshAccess();
  }, [
    applyAccess,
    authLoading,
    refreshAccess,
    router,
    user,
    viewingCommercialProfileId,
  ]);

  useEffect(() => {
    if (!canViewCommercialAsUser || typeof window === "undefined") return;
    const saved = window.sessionStorage.getItem(
      "orion:commercial_view_profile_id",
    );
    if (saved) setViewingCommercialProfileId(saved);
  }, [canViewCommercialAsUser]);

  useEffect(() => {
    setMobileOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (loading || role !== "visualizador") return;
    if (pathname !== "/comercial/kanban" && pathname !== "/comercial/leads")
      router.replace("/comercial/kanban");
  }, [loading, pathname, role, router]);

  const startViewingCommercialMember = useCallback(
    (profileId: string) => {
      if (!canViewCommercialAsUser) return;
      setViewingCommercialProfileId(profileId);
      window.sessionStorage.setItem(
        "orion:commercial_view_profile_id",
        profileId,
      );
      router.push("/comercial");
    },
    [canViewCommercialAsUser, router],
  );

  const stopViewingCommercialMember = useCallback(() => {
    setViewingCommercialProfileId(null);
    window.sessionStorage.removeItem("orion:commercial_view_profile_id");
    router.push("/comercial/usuarios");
  }, [router]);

  const navigation = useMemo(
    () =>
      role === "visualizador"
        ? baseNavigation.filter(
            (item) =>
              item.href === "/comercial/kanban" ||
              item.href === "/comercial/leads",
          )
        : role === "coordenador"
          ? [
              ...baseNavigation,
              {
                href: "/comercial/usuarios",
                label: "Usuários",
                icon: UsersRound,
              },
            ]
          : baseNavigation,
    [role],
  );
  const currentMember = members.find(
    (member) => member.profile_id === currentProfileId,
  );

  if (authLoading || loading)
    return (
      <div className="kh-loading">
        <img
          src="/brand-logo.png"
          alt="ORION TRACK"
          className="kh-loading-logo"
        />
        <span>Preparando operação comercial</span>
      </div>
    );
  if (error)
    return (
      <div className="kh-loading kh-error-state">
        <div className="kh-error-icon">
          <X size={24} />
        </div>
        <h1>Não foi possível abrir o comercial</h1>
        <p>{error}</p>
        <button type="button" onClick={() => void refreshAccess()}>
          Tentar novamente
        </button>
      </div>
    );

  const directNavigation = navigation.slice(0, 5);
  const overflowNavigation = navigation.slice(5);
  const currentMemberName =
    currentMember?.nome || actualProfile?.nome || "Usuário";
  const initials = currentMemberName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const overflowActive = overflowNavigation.some((item) =>
    pathname.startsWith(item.href),
  );
  const canSwitchOperation = canSelectOperationalTeam(actualProfile, Boolean(role));
  const rememberDualOperationAccess = () => {
    if (actualProfile?.id) window.sessionStorage.setItem(DUAL_OPERATION_ACCESS_KEY, actualProfile.id);
  };

  const contextValue = {
    role,
    canViewCommercialFinancials,
    canViewCommercialLeadQualification,
    canEditCommercial,
    members,
    currentProfileId,
    canViewMetaInvestment,
    isDevOps,
    loading,
    error,
    api,
    refreshAccess,
    canViewCommercialAsUser,
    viewingCommercialProfileId,
    startViewingCommercialMember,
    stopViewingCommercialMember,
  };

  if (pathname.startsWith(IMMERSIVE_PREFIX))
    return (
      <CommercialContext.Provider value={contextValue}>
        {children}
      </CommercialContext.Provider>
    );

  return (
    <CommercialContext.Provider value={contextValue}>
      <div className="kh">
        <div className="kh-workspace">
          <header className="kh-topbar">
            <div className="kh-topbar-left">
              <button
                className="kh-menu"
                aria-label="Abrir menu"
                onClick={() => setMobileOpen((value) => !value)}
              >
                <Menu size={20} />
              </button>
              <Link
                href="/comercial"
                className="kh-logo-link"
                aria-label="Visão geral do Kripto Hunters"
              >
                <img
                  src="/brand-logo.png"
                  alt="ORION TRACK"
                  className="kh-orion-logo"
                />
              </Link>
              <nav className="kh-top-nav" aria-label="Navegação comercial">
                {directNavigation.map((item) => {
                  const Icon = item.icon;
                  const active =
                    item.href === "/comercial"
                      ? pathname === item.href
                      : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={active ? "active" : ""}
                    >
                      <Icon size={14} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
                {overflowNavigation.length > 0 && (
                  <div className="kh-more-wrap">
                    <button
                      type="button"
                      className={moreOpen || overflowActive ? "active" : ""}
                      onClick={() => setMoreOpen((value) => !value)}
                    >
                      <span>Mais</span>
                      <ChevronDown
                        size={14}
                        className={moreOpen ? "rotate" : ""}
                      />
                    </button>
                    {moreOpen && (
                      <div className="kh-more-menu">
                        {overflowNavigation.map((item) => {
                          const Icon = item.icon;
                          const active = pathname.startsWith(item.href);
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              className={active ? "active" : ""}
                              onClick={() => setMoreOpen(false)}
                            >
                              <Icon size={15} />
                              <span>{item.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </nav>
            </div>
            <div className="kh-topbar-right">
              {viewingCommercialProfileId && canViewCommercialAsUser && (
                <button
                  type="button"
                  className="kh-viewing-pill"
                  onClick={stopViewingCommercialMember}
                  title="Sair da visualização do integrante"
                >
                  <Eye size={14} /> Vendo como {currentMemberName}{" "}
                  <X size={13} />
                </button>
              )}
              {canSwitchOperation && (
                <Link href="/selecionar-time" className="kh-switch-operation" onClick={rememberDualOperationAccess}>
                  Trocar operação
                </Link>
              )}
              <div className="kh-profile">
                <div className="kh-avatar">{initials}</div>
                <div>
                  <strong>{currentMemberName}</strong>
                  <span>
                    {isDevOps ? "DevOps Manager" : commercialRoleLabel(role)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="kh-logout"
                onClick={signOut}
                aria-label="Sair"
                title="Sair"
              >
                <LogOut size={16} />
              </button>
            </div>
          </header>
          {mobileOpen && (
            <>
              <button
                className="kh-scrim"
                aria-label="Fechar menu"
                onClick={() => setMobileOpen(false)}
              />
              <nav className="kh-mobile-nav" aria-label="Menu comercial">
                {navigation.map((item) => {
                  const Icon = item.icon;
                  const active =
                    item.href === "/comercial"
                      ? pathname === item.href
                      : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={active ? "active" : ""}
                      onClick={() => setMobileOpen(false)}
                    >
                      <Icon size={17} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
                {canSwitchOperation && (
                  <Link
                    href="/selecionar-time"
                    onClick={() => {
                      rememberDualOperationAccess();
                      setMobileOpen(false);
                    }}
                  >
                    <span>Trocar operação</span>
                  </Link>
                )}
              </nav>
            </>
          )}
          <main className="kh-main">{children}</main>
        </div>
      </div>
    </CommercialContext.Provider>
  );
}
