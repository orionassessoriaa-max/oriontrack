'use client';

import { createContext, useContext, useEffect, useState } from 'react';
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
  startViewingAsCorretor: (corretorId: string) => Promise<void>;
  startViewingAsGestor: (gestorId: string) => Promise<void>;
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
  startViewingAsCorretor: async () => {},
  startViewingAsGestor: async () => {},
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
  const router = useRouter();

  const fetchProfile = async (userId: string) => {
    try {
      // Buscamos campos garantidos. Se houver erro de coluna status, o log detalhado avisará.
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, nome, tipo_usuario, corretor_id, status, created_at')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching profile details:', JSON.stringify(error, null, 2));
        
        // Tentativa de fallback sem o campo status se o erro for de coluna inexistente
        if (error.message?.includes('status') || error.code === 'PGRST202') {
          console.warn('Tentando carregar profile sem o campo status...');
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('profiles')
            .select('id, email, nome, tipo_usuario, corretor_id, created_at')
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
      .select('id, email, nome, tipo_usuario, corretor_id, status, created_at')
      .eq('id', gestorId)
      .eq('tipo_usuario', 'gestor_trafego')
      .maybeSingle();

    if (error || !data) {
      throw error || new Error('Gestor não encontrado.');
    }

    return data as Profile;
  };

  const startViewingAsCorretor = async (corretorId: string) => {
    if (!user || actualProfile?.tipo_usuario !== 'admin') return;

    const brokerProfile = await fetchCorretorViewProfile(corretorId, user.id);
    setViewingProfile(brokerProfile);
    window.sessionStorage.setItem('orion:viewing_corretor_id', corretorId);
    window.sessionStorage.removeItem('orion:viewing_gestor_id');
    router.push('/dashboard');
  };

  const startViewingAsGestor = async (gestorId: string) => {
    if (!user || actualProfile?.tipo_usuario !== 'admin') return;

    const gestorProfile = await fetchGestorViewProfile(gestorId);
    setViewingProfile(gestorProfile);
    window.sessionStorage.setItem('orion:viewing_gestor_id', gestorId);
    window.sessionStorage.removeItem('orion:viewing_corretor_id');
    router.push('/trafego/leads');
  };

  const stopViewingAsCorretor = () => {
    setViewingProfile(null);
    window.sessionStorage.removeItem('orion:viewing_corretor_id');
    window.sessionStorage.removeItem('orion:viewing_gestor_id');
    router.push('/admin');
  };

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
          setUser(session.user);
          const p = await fetchProfile(session.user.id);
          setActualProfile(p);
        } else {
          setUser(null);
          setActualProfile(null);
          setViewingProfile(null);
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setUser(session.user);
        const p = await fetchProfile(session.user.id);
        setActualProfile(p);
      } else {
        setUser(null);
        setActualProfile(null);
        setViewingProfile(null);
        window.sessionStorage.removeItem('orion:viewing_corretor_id');
        window.sessionStorage.removeItem('orion:viewing_gestor_id');

        const currentPath = window.location.pathname;
        if (currentPath !== '/login' && !currentPath.startsWith('/c/')) {
          router.push('/login');
        }
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    async function restoreCorretorView() {
      if (!user || actualProfile?.tipo_usuario !== 'admin' || viewingProfile) return;

      const savedCorretorId = window.sessionStorage.getItem('orion:viewing_corretor_id');
      const savedGestorId = window.sessionStorage.getItem('orion:viewing_gestor_id');
      if (!savedCorretorId && !savedGestorId) return;

      try {
        if (savedCorretorId) {
          const brokerProfile = await fetchCorretorViewProfile(savedCorretorId, user.id);
          setViewingProfile(brokerProfile);
        } else if (savedGestorId) {
          const gestorProfile = await fetchGestorViewProfile(savedGestorId);
          setViewingProfile(gestorProfile);
        }
      } catch (error) {
        console.error('Erro ao restaurar visualização admin:', error);
        window.sessionStorage.removeItem('orion:viewing_corretor_id');
        window.sessionStorage.removeItem('orion:viewing_gestor_id');
      }
    }

    void restoreCorretorView();
  }, [actualProfile, user, viewingProfile]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setActualProfile(null);
    setViewingProfile(null);
    window.sessionStorage.removeItem('orion:viewing_corretor_id');
    window.sessionStorage.removeItem('orion:viewing_gestor_id');
    router.push('/login');
  };

  const profile = actualProfile?.tipo_usuario === 'admin' && viewingProfile
    ? viewingProfile
    : actualProfile;

  const isViewingAsCorretor = Boolean(actualProfile?.tipo_usuario === 'admin' && viewingProfile?.tipo_usuario === 'corretor');
  const isViewingAsGestor = Boolean(actualProfile?.tipo_usuario === 'admin' && viewingProfile?.tipo_usuario === 'gestor_trafego');

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      actualProfile,
      loading,
      isViewingAsCorretor,
      isViewingAsGestor,
      startViewingAsCorretor,
      startViewingAsGestor,
      stopViewingAsCorretor,
      signOut,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
