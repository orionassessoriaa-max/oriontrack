'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { User } from '@supabase/supabase-js';
import { Profile } from '@/types';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  actualProfile: Profile | null;
  loading: boolean;
  isViewingAsCorretor: boolean;
  isViewingAsGestor: boolean;
  isViewingAsDesigner: boolean;
  isViewingAsAccount: boolean;
  startViewingAsCorretor: (corretorId: string, profileId?: string | null) => Promise<void>;
  startViewingAsGestor: (gestorId: string) => Promise<void>;
  startViewingAsDesigner: (designerId: string) => Promise<void>;
  startViewingAsAccount: (accountId: string) => Promise<void>;
  stopViewingAsCorretor: () => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  actualProfile: null,
  loading: true,
  isViewingAsCorretor: false,
  isViewingAsGestor: false,
  isViewingAsDesigner: false,
  isViewingAsAccount: false,
  startViewingAsCorretor: async () => {},
  startViewingAsGestor: async () => {},
  startViewingAsDesigner: async () => {},
  startViewingAsAccount: async () => {},
  stopViewingAsCorretor: () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const BROKER_VIEW_ROLES = ['corretor', 'corretor_admin', 'corretor_membro'];
const AUTH_SESSION_TIMEOUT_MS = 10_000;
const AUTH_PROFILE_TIMEOUT_MS = 8_000;
const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const profileRequests = new Map<string, Promise<Profile | null>>();

type CachedProfile = {
  profile: Profile;
  cachedAt: number;
};

function profileCacheKey(userId: string) {
  return `orion:auth_profile:${userId}`;
}

function readCachedProfile(userId: string) {
  try {
    const raw = window.localStorage.getItem(profileCacheKey(userId));
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedProfile;
    if (cached?.profile?.id !== userId || Date.now() - Number(cached.cachedAt || 0) > PROFILE_CACHE_TTL_MS) {
      window.localStorage.removeItem(profileCacheKey(userId));
      return null;
    }
    return cached.profile;
  } catch {
    return null;
  }
}

function cacheProfile(userId: string, profile: Profile) {
  try {
    window.localStorage.setItem(profileCacheKey(userId), JSON.stringify({ profile, cachedAt: Date.now() }));
  } catch {
    // O cache e apenas uma protecao contra indisponibilidade temporaria.
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [actualProfile, setActualProfile] = useState<Profile | null>(null);
  const [viewingProfile, setViewingProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionRequestRef = useRef(0);
  const router = useRouter();

  const fetchProfile = async (userId: string, accessToken?: string | null) => {
    const currentRequest = profileRequests.get(userId);
    if (currentRequest) return currentRequest;

    const request = (async (): Promise<Profile | null> => {
      try {
      let token = accessToken;
      if (!token) {
        const { data } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_SESSION_TIMEOUT_MS,
          'Tempo esgotado ao recuperar a sessao.',
        );
        token = data.session?.access_token;
      }
      if (!token) return readCachedProfile(userId);

      const loadFromApi = async () => {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), AUTH_PROFILE_TIMEOUT_MS);
        try {
          const response = await fetch('/api/auth/profile', {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal: controller.signal,
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload.profile) {
            throw new Error(payload?.error || response.statusText || 'Perfil nao retornado pela API.');
          }
          return payload.profile as Profile;
        } finally {
          window.clearTimeout(timeout);
        }
      };

      const loadDirectly = async () => {
        const { data: directProfile, error: directError } = await withTimeout(
          Promise.resolve(
            supabase
              .from('profiles')
              .select('id, email, email_real, nome, tipo_usuario, corretor_id, status, foto_url, nome_empresa, precisa_trocar_senha, is_admin_master, tema_sistema, equipe_orion, created_at, telefone')
              .eq('id', userId)
              .maybeSingle(),
          ),
          AUTH_PROFILE_TIMEOUT_MS,
          'Tempo esgotado na consulta direta do perfil.',
        );

        if (directError || !directProfile) {
          throw directError || new Error('Perfil nao retornado pela consulta direta.');
        }
        return directProfile as Profile;
      };

      let loadedProfile: Profile;
      try {
        loadedProfile = await loadFromApi();
      } catch (apiError) {
        console.warn('Profile API failed; using direct fallback:', apiError);
        loadedProfile = await loadDirectly();
      }
      cacheProfile(userId, loadedProfile);
      return loadedProfile;

      } catch (error) {
        console.error('All profile loading strategies failed:', error);
        return readCachedProfile(userId);
      }
    })();

    profileRequests.set(userId, request);
    try {
      return await request;
    } finally {
      if (profileRequests.get(userId) === request) profileRequests.delete(userId);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      const p = await fetchProfile(user.id);
      if (p) setActualProfile(p);
    }
  };

  const fetchCorretorViewProfile = async (corretorId: string, adminUserId: string) => {
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, email_real, nome, tipo_usuario, corretor_id, status, foto_url, nome_empresa, precisa_trocar_senha, is_admin_master, tema_sistema, equipe_orion, created_at, telefone')
      .eq('corretor_id', corretorId)
      .in('tipo_usuario', BROKER_VIEW_ROLES)
      .eq('status', 'active')
      .order('tipo_usuario', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (profileError) throw profileError;
    if (profileData) return profileData as Profile;

    const { data, error } = await supabase
      .from('corretores')
      .select('id, nome, email, nome_empresa, status, created_at')
      .eq('id', corretorId)
      .maybeSingle();

    if (error || !data) {
      throw error || new Error('Corretor não encontrado.');
    }

    return {
      id: adminUserId,
      email: data.email,
      nome: data.nome,
      nome_empresa: data.nome_empresa || null,
      tipo_usuario: 'corretor',
      corretor_id: data.id,
      status: data.status === 'inativo' || data.status === 'inactive' ? 'inactive' : 'active',
      created_at: data.created_at || new Date().toISOString(),
    } as Profile;
  };

  const fetchGestorViewProfile = async (gestorId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, email_real, nome, tipo_usuario, corretor_id, status, foto_url, nome_empresa, precisa_trocar_senha, is_admin_master, tema_sistema, equipe_orion, created_at, telefone')
      .eq('id', gestorId)
      .eq('tipo_usuario', 'gestor_trafego')
      .maybeSingle();

    if (error || !data) {
      throw error || new Error('Gestor não encontrado.');
    }

    return data as Profile;
  };

  const fetchProfileViewProfile = async (profileId: string, role: Profile['tipo_usuario'], message: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, email_real, nome, tipo_usuario, corretor_id, status, foto_url, nome_empresa, precisa_trocar_senha, is_admin_master, tema_sistema, equipe_orion, created_at, telefone')
      .eq('id', profileId)
      .eq('tipo_usuario', role)
      .maybeSingle();

    if (error || !data) {
      throw error || new Error(message);
    }

    return data as Profile;
  };

  const clearViewingStorage = () => {
    window.sessionStorage.removeItem('orion:viewing_corretor_id');
    window.sessionStorage.removeItem('orion:viewing_profile_id');
    window.sessionStorage.removeItem('orion:viewing_gestor_id');
    window.sessionStorage.removeItem('orion:viewing_designer_id');
    window.sessionStorage.removeItem('orion:viewing_account_id');
  };

  const startViewingAsCorretor = async (corretorId: string, profileId?: string | null) => {
    if (!user || !actualProfile || !['admin', 'gestor_trafego', 'account_manager'].includes(actualProfile.tipo_usuario)) return;

    let brokerProfile: Profile | null = null;
    if (profileId) {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, email_real, nome, tipo_usuario, corretor_id, status, foto_url, nome_empresa, precisa_trocar_senha, is_admin_master, tema_sistema, equipe_orion, created_at, telefone')
        .eq('id', profileId)
        .maybeSingle();

      if (!error && data) {
        brokerProfile = data as Profile;
      }
    }

    if (!brokerProfile) {
      brokerProfile = await fetchCorretorViewProfile(corretorId, user.id);
    }

    setViewingProfile(brokerProfile);
    clearViewingStorage();
    window.sessionStorage.setItem('orion:viewing_corretor_id', corretorId);
    if (profileId) {
      window.sessionStorage.setItem('orion:viewing_profile_id', profileId);
    }
    router.push('/leads');
  };

  const startViewingAsGestor = async (gestorId: string) => {
    if (!user || actualProfile?.tipo_usuario !== 'admin') return;

    const gestorProfile = await fetchGestorViewProfile(gestorId);
    setViewingProfile(gestorProfile);
    clearViewingStorage();
    window.sessionStorage.setItem('orion:viewing_gestor_id', gestorId);
    router.push('/trafego');
  };

  const startViewingAsDesigner = async (designerId: string) => {
    if (!user || actualProfile?.tipo_usuario !== 'admin') return;

    const designerProfile = await fetchProfileViewProfile(designerId, 'designer', 'Designer nao encontrado.');
    setViewingProfile(designerProfile);
    clearViewingStorage();
    window.sessionStorage.setItem('orion:viewing_designer_id', designerId);
    router.push('/designer');
  };

  const startViewingAsAccount = async (accountId: string) => {
    if (!user || actualProfile?.tipo_usuario !== 'admin') return;

    const accountProfile = await fetchProfileViewProfile(accountId, 'account_manager', 'Account manager nao encontrado.');
    setViewingProfile(accountProfile);
    clearViewingStorage();
    window.sessionStorage.setItem('orion:viewing_account_id', accountId);
    router.push('/account');
  };

  const stopViewingAsCorretor = () => {
    const redirectByRole = actualProfile?.tipo_usuario === 'gestor_trafego'
      ? '/trafego/corretores'
      : actualProfile?.tipo_usuario === 'account_manager'
        ? '/account/corretores'
        : '/admin';
    setViewingProfile(null);
    clearViewingStorage();
    router.push(redirectByRole);
  };

  useEffect(() => {
    let active = true;

    const applySession = async (session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']) => {
      const requestId = ++sessionRequestRef.current;
      try {
        if (session?.user) {
          if (!active) return;
          setUser(session.user);
          const cachedProfile = readCachedProfile(session.user.id);
          if (cachedProfile) {
            setActualProfile(cachedProfile);
            setLoading(false);
          }
          const p = await fetchProfile(session.user.id, session.access_token);
          if (!active || requestId !== sessionRequestRef.current) return;
          setActualProfile((currentProfile) => p || currentProfile || cachedProfile);
        } else {
          if (!active) return;
          setUser(null);
          setActualProfile(null);
          setViewingProfile(null);
          clearViewingStorage();
          window.sessionStorage.removeItem('orion:selected_team');

          const currentPath = window.location.pathname;
          const publicPaths = [
            '/login',
            '/primeiro-acesso',
            '/resetar-senha',
            '/privacidade',
            '/termos',
            '/exclusao-de-dados',
          ];
          if (!publicPaths.includes(currentPath) && !currentPath.startsWith('/c/')) {
            router.push('/login');
          }
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    void withTimeout(
      supabase.auth.getSession(),
      AUTH_SESSION_TIMEOUT_MS,
      'Tempo esgotado ao iniciar a sessao.',
    )
      .then(({ data }) => applySession(data.session))
      .catch((error) => {
        console.error('Error recovering auth session:', error);
        if (active) setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') return;
      setTimeout(() => {
        void applySession(session);
      }, 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    async function restoreCorretorView() {
      if (!user || !actualProfile || !['admin', 'gestor_trafego', 'account_manager'].includes(actualProfile.tipo_usuario) || viewingProfile) return;

      const savedCorretorId = window.sessionStorage.getItem('orion:viewing_corretor_id');
      const savedProfileId = window.sessionStorage.getItem('orion:viewing_profile_id');
      const savedGestorId = window.sessionStorage.getItem('orion:viewing_gestor_id');
      const savedDesignerId = window.sessionStorage.getItem('orion:viewing_designer_id');
      const savedAccountId = window.sessionStorage.getItem('orion:viewing_account_id');
      if (!savedCorretorId && !savedGestorId && !savedDesignerId && !savedAccountId) return;

      try {
        if (savedCorretorId) {
          let brokerProfile: Profile | null = null;
          if (savedProfileId) {
            const { data, error } = await supabase
              .from('profiles')
              .select('id, email, email_real, nome, tipo_usuario, corretor_id, status, foto_url, nome_empresa, precisa_trocar_senha, is_admin_master, tema_sistema, equipe_orion, created_at, telefone')
              .eq('id', savedProfileId)
              .maybeSingle();

            if (!error && data) {
              brokerProfile = data as Profile;
            }
          }

          if (!brokerProfile) {
            brokerProfile = await fetchCorretorViewProfile(savedCorretorId, user.id);
          }

          setViewingProfile(brokerProfile);
        } else if (savedGestorId) {
          const gestorProfile = await fetchGestorViewProfile(savedGestorId);
          setViewingProfile(gestorProfile);
        } else if (savedDesignerId) {
          const designerProfile = await fetchProfileViewProfile(savedDesignerId, 'designer', 'Designer nao encontrado.');
          setViewingProfile(designerProfile);
        } else if (savedAccountId) {
          const accountProfile = await fetchProfileViewProfile(savedAccountId, 'account_manager', 'Account manager nao encontrado.');
          setViewingProfile(accountProfile);
        }
      } catch (error) {
        console.error('Erro ao restaurar visualização admin:', error);
        clearViewingStorage();
      }
    }

    void restoreCorretorView();
  }, [actualProfile, user, viewingProfile]);

  const signOut = async () => {
    try {
      await supabase.auth.signOut({ scope: 'global' });
    } catch (error) {
      console.error('Erro ao sair:', error);
    }
    setUser(null);
    setActualProfile(null);
    setViewingProfile(null);
    clearViewingStorage();
    window.sessionStorage.removeItem('orion:selected_team');
    router.replace('/login');
  };

  const profile = ['admin', 'gestor_trafego', 'account_manager'].includes(String(actualProfile?.tipo_usuario)) && viewingProfile
    ? viewingProfile
    : actualProfile;

  const isViewingAsCorretor = Boolean(['admin', 'gestor_trafego', 'account_manager'].includes(String(actualProfile?.tipo_usuario)) && BROKER_VIEW_ROLES.includes(String(viewingProfile?.tipo_usuario)));
  const isViewingAsGestor = Boolean(actualProfile?.tipo_usuario === 'admin' && viewingProfile?.tipo_usuario === 'gestor_trafego');
  const isViewingAsDesigner = Boolean(actualProfile?.tipo_usuario === 'admin' && viewingProfile?.tipo_usuario === 'designer');
  const isViewingAsAccount = Boolean(actualProfile?.tipo_usuario === 'admin' && viewingProfile?.tipo_usuario === 'account_manager');

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      actualProfile,
      loading,
      isViewingAsCorretor,
      isViewingAsGestor,
      isViewingAsDesigner,
      isViewingAsAccount,
      startViewingAsCorretor,
      startViewingAsGestor,
      startViewingAsDesigner,
      startViewingAsAccount,
      stopViewingAsCorretor,
      signOut,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
