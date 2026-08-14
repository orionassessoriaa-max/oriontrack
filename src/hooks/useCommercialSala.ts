'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export type SalaPeriod = 'hoje' | '7d' | '30d' | 'mes' | 'tudo';

export type SalaDddBucket = {
  ddd: string;
  cidade: string;
  leads: number;
  emVenda: number;
  perdidos: number;
  fechados: number;
};

export type SalaState = {
  uf: string;
  leads: number;
  emVenda: number;
  perdidos: number;
  fechados: number;
  ddds: SalaDddBucket[];
};

export type SalaLead = {
  id: string;
  nome: string | null;
  telefone: string | null;
  status: string;
  uf: string | null;
  ddd: string | null;
  cidade: string | null;
  sdr: string | null;
  mql: string;
  valor: number;
  at: string;
};

export type SalaReuniao = {
  id: string;
  nome: string | null;
  telefone: string | null;
  status: string;
  uf: string | null;
  sdr: string | null;
  closer: string | null;
  mql: string;
  valor: number;
  agendada_at: string;
  realizada: boolean;
  no_show: boolean;
  link: string | null;
};

export type SalaPayload = {
  period: string;
  range: { start: string; end: string };
  totals: { leads: number; emVenda: number; fechados: number; semOrigem: number; reunioesHoje: number };
  states: SalaState[];
  recent: SalaLead[];
  reunioes: SalaReuniao[];
  metas: {
    mes: string;
    meta_valor: number;
    meta_vendas: number;
    ticket_medio: number;
    vendido: number;
    emNegociacao: number;
    vendas: number;
  };
  updatedAt: string;
};

/** Lead recem chegado, ja com a chave que a animacao usa para nao se repetir. */
export type SalaArrival = { key: string; lead: SalaLead };

// A sala fica aberta o dia inteiro e cada busca varre os leads do mes. Quando o
// Realtime esta conectado ele e quem avisa, e o polling vira so uma rede de
// seguranca espacada; sem Realtime, ele assume o trabalho num ritmo mais curto.
const POLL_INTERVAL = 45000;
const POLL_INTERVAL_SEM_REALTIME = 20000;
// O evento do Postgres chega antes do commit ficar visivel para a API. Esperar
// um pouco evita buscar o payload sem o lead novo dentro.
const REALTIME_DEBOUNCE = 1200;
const MAX_ARRIVALS = 4;

type Api = (url: string, init?: RequestInit) => Promise<SalaPayload>;

export function useCommercialSala(api: Api, period: SalaPeriod) {
  const [data, setData] = useState<SalaPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [arrivals, setArrivals] = useState<SalaArrival[]>([]);
  const [live, setLive] = useState(false);

  const seenRef = useRef<Set<string> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const periodRef = useRef(period);
  const liveRef = useRef(false);
  const lastLoadRef = useRef(0);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    // Trocar o periodo recomeca a contagem do que ja foi visto, senao o proximo
    // payload chegaria inteiro como "lead novo".
    if (periodRef.current !== period) {
      periodRef.current = period;
      seenRef.current = null;
      setLoading(true);
    }
    inFlightRef.current = true;
    try {
      const payload = await api(`/api/comercial/sala?period=${period}`);
      setData(payload);
      setError(null);

      const incoming = payload.recent || [];
      if (seenRef.current === null) {
        // Primeira carga: o historico entra sem animar, senao a tela abre com
        // catorze leads subindo de uma vez.
        seenRef.current = new Set(incoming.map((lead) => lead.id));
      } else {
        const seen = seenRef.current;
        const fresh = incoming.filter((lead) => !seen.has(lead.id));
        fresh.forEach((lead) => seen.add(lead.id));
        if (fresh.length) {
          setArrivals((current) =>
            [...fresh.map((lead) => ({ key: `${lead.id}:${Date.now()}`, lead })), ...current].slice(0, MAX_ARRIVALS),
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar a sala.');
    } finally {
      inFlightRef.current = false;
      lastLoadRef.current = Date.now();
      setLoading(false);
    }
  }, [api, period]);

  // Mantem a sala sincronizada com o periodo selecionado.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    const scheduleReload = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void load(), REALTIME_DEBOUNCE);
    };

    // O Realtime respeita RLS, entao o evento pode nao chegar para todo mundo.
    // Ele serve para antecipar a busca: o numero certo vem sempre da API.
    const channel = supabase
      .channel('orion-comercial-sala')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comercial_leads' }, scheduleReload)
      .subscribe((status) => {
        liveRef.current = status === 'SUBSCRIBED';
        setLive(liveRef.current);
      });

    // Aba escondida nao busca nada: a sala costuma ficar num monitor de parede
    // atras de outras janelas, e nao adianta varrer o banco para ninguem ver.
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (liveRef.current && Date.now() - lastLoadRef.current < POLL_INTERVAL) return;
      void load();
    }, liveRef.current ? POLL_INTERVAL : POLL_INTERVAL_SEM_REALTIME);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const dismissArrival = useCallback((key: string) => {
    setArrivals((current) => current.filter((arrival) => arrival.key !== key));
  }, []);

  return { data, loading, error, arrivals, dismissArrival, refresh: load, live };
}
