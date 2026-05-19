'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Corretor } from '@/types';

export function useCorretoresOptions() {
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCorretores = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      setLoading(false);
      setError('Sessao expirada.');
      return;
    }

    const response = await fetch('/api/corretores/options', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const payload = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(payload.error || 'Erro ao buscar corretores.');
      return;
    }

    setCorretores(payload.corretores || []);
  }, []);

  useEffect(() => {
    fetchCorretores();
  }, [fetchCorretores]);

  return { corretores, loading, error, refetch: fetchCorretores };
}
