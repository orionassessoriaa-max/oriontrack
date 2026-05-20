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
  startViewingAsCorretor: (corretorId: string) => Promise<void>;
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

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [actualProfile, setActualProfile] = useState<Profile | null>(null);
  const [viewingProfile, setViewingProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionRequestRef = useRef(0);
  const router = useRouter();

  const fetchProfile = async (userId: string) => {
    try {
      // Buscamos campos garantidos. Se houver erro de coluna status, o log detalhado avisará.
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, email_real, nome, tipo_usuario, corretor_id, status, foto_url, nome_empresa, precisa_trocar_senha, is_admin_master, tema_sistema, created_at')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching profile details:', JSON.stringify(error, null, 2));
        
        // Tentativa de fallback sem o campo status se o erro for de coluna inexistente
        if (error.message?.includes('status') || error.code === 'PGRST202') {
          console.warn('Tentando carregar profile sem o campo status...');
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('profiles')
            .select('id, email, email_real, nome, tipo_usuario, corretor_id, foto_url, nome_empresa, precisa_trocar_senha, is_admin_master, tema_sistema, created_at')
            .eq('id', userId)
            .maybeSingle();
          
          if (fallbackError) {
            console.error('Fallback error:', JSON.stringify(fallbackError, null, 2));
            return null;
          }
          return fallbackData as Profile;
        }
        
        return null;
      }
      return data as Profile;
    } catch (error) {
      console.error('Unexpected error fetching profile:', error);
      return null;
    }
  };

  const refreshProfile = async () => {
    if (user) {
      const p = await fetchProfile(user.id);
      setActualProfile(p);
    }
  };

  const fetchCorretorViewProfile = async (corretorId: string, adminUserId: string) => {
    const { data, error } = await supabase
      .from('corretores')
      .select('id, nome, email, status, created_at')
      .eq('id', corretorId)
      .maybeSingle();

    if (error || !data) {
      throw error || new Error('Corretor não encontrado.');
    }

    return {
      id: adminUserId,
      email: data.email,
      nome: data.nome,
      tipo_usuario: 'corretor',
      corretor_id: data.id,
      status: data.status === 'inativo' || data.status === 'inactive' ? 'inactive' : 'active',
      created_at: data.created_at || new Date().toISOString(),
    } as Profile;
  };

  const fetchGestorViewProfile = async (gestorId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, email_real, nome, tipo_usuario, corretor_id, status, foto_url, nome_empresa, precisa_trocar_senha, is_admin_master, tema_sistema, created_at')
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
      .select('id, email, email_real, nome, tipo_usuario, corretor_id, status, foto_url, nome_empresa, precisa_trocar_senha, is_admin_master, tema_sistema, created_at')
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
    window.sessionStorage.removeItem('orion:viewing_gestor_id');
    window.sessionStorage.removeItem('orion:viewing_designer_id');
    window.sessionStorage.removeItem('orion:viewing_account_id');
  };

  const startViewingAsCorretor = async (corretorId: string) => {
    if (!user || actualProfile?.tipo_usuario !== 'admin') return;

    const brokerProfile = await fetchCorretorViewProfile(corretorId, user.id);
    setViewingProfile(brokerProfile);
    clearViewingStorage();
    window.sessionStorage.setItem('orion:viewing_corretor_id', corretorId);
    router.push('/dashboard');
  };

  const startViewingAsGestor = async (gestorId: string) => {
    if (!user || actualProfile?.tipo_usuario !== 'admin') return;

    const gestorProfile = await fetchGestorViewProfile(gestorId);
    setViewingProfile(gestorProfile);
    clearViewingStorage();
    window.sessionStorage.setItem('orion:viewing_gestor_id', gestorId);
    router.push('/trafego/leads');
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
    setViewingProfile(null);
    clearViewingStorage();
    router.push('/admin');
  };

  useEffect(() => {
    let active = true;

    const applySession = async (session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']) => {
      const requestId = ++sessionRequestRef.current;
      try {
        if (session?.user) {
          if (!active) return;
          setUser(session.user);
          const p = await fetchProfile(session.user.id);
          if (!active || requestId !== sessionRequestRef.current) return;
          setActualProfile(p);
        } else {
          if (!active) return;
          setUser(null);
          setActualProfile(null);
          setViewingProfile(null);
          clearViewingStorage();

          const currentPath = window.location.pathname;
          const publicPaths = ['/login', '/primeiro-acesso', '/resetar-senha'];
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

    void supabase.auth.getSession().then(({ data }) => applySession(data.session));

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
      if (!user || actualProfile?.tipo_usuario !== 'admin' || viewingProfile) return;

      const savedCorretorId = window.sessionStorage.getItem('orion:viewing_corretor_id');
      const savedGestorId = window.sessionStorage.getItem('orion:viewing_gestor_id');
      const savedDesignerId = window.sessionStorage.getItem('orion:viewing_designer_id');
      const savedAccountId = window.sessionStorage.getItem('orion:viewing_account_id');
      if (!savedCorretorId && !savedGestorId && !savedDesignerId && !savedAccountId) return;

      try {
        if (savedCorretorId) {
          const brokerProfile = await fetchCorretorViewProfile(savedCorretorId, user.id);
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
    router.replace('/login');
  };

  const profile = actualProfile?.tipo_usuario === 'admin' && viewingProfile
    ? viewingProfile
    : actualProfile;

  const isViewingAsCorretor = Boolean(actualProfile?.tipo_usuario === 'admin' && viewingProfile?.tipo_usuario === 'corretor');
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
