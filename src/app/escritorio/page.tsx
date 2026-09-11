'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { montarEscritorio } from '@/lib/escritorio/planta';
import type { Escritorio, PessoaEscritorio } from '@/lib/escritorio/planta';

type Agente = {
  id: string;
  nome: string;
  papel: string;
  ativa: boolean;
  acao?: string | null;
  corretora?: string | null;
  corretor?: string | null;
  naoLidas?: number;
  em?: string | null;
};

type Carta = {
  id: string;
  titulo: string;
  mensagem: string;
  para: string | null;
  em: string;
  lida: boolean;
};

type Payload = { agentes: Agente[]; cartas: Carta[] };

/** Onde cada agente senta, e com que cara. */
const POSTO: Record<string, { mesa: string; cor: string; cabelo: string; pele: string }> = {
  aline:    { mesa: 'ia',      cor: '#d98fb0', cabelo: '#3a2118', pele: '#e8c49c' },
  apolo:    { mesa: 'ia',      cor: '#5fa3d9', cabelo: '#1f2a33', pele: '#d9a276' },
  carteiro: { mesa: 'correio', cor: '#c9a227', cabelo: '#2e2218', pele: '#e5b48a' },
};

function hora(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function EscritorioPage() {
  const { profile } = useAuth();
  const alvo = useRef<HTMLDivElement | null>(null);
  const motor = useRef<Escritorio | null>(null);
  const [cartas, setCartas] = useState<Carta[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [correioAberto, setCorreioAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const { data: sessao } = await supabase.auth.getSession();
      const token = sessao.session?.access_token;
      if (!token) return;
      const resposta = await fetch('/api/escritorio', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!resposta.ok) throw new Error('Não foi possível ler o escritório.');
      const dados = (await resposta.json()) as Payload;

      // So entra no escritorio quem esta trabalhando agora. Agente inativo fica
      // de fora em vez de aparecer parado numa mesa: o motor manda quem nao tem
      // mesa para o descanso, e boneco sentado com a tela acesa mentiria.
      const pessoas: PessoaEscritorio[] = (dados.agentes || [])
        .filter((a) => a.ativa && POSTO[a.id])
        .map((a) => ({
          id: a.id,
          nome: a.nome,
          papel: a.papel,
          mesa: POSTO[a.id].mesa,
          acao: a.acao || null,
          em: a.em || new Date().toISOString(),
          cor: POSTO[a.id].cor,
          cabelo: POSTO[a.id].cabelo,
          pele: POSTO[a.id].pele,
        }));

      const carteiro = (dados.agentes || []).find((a) => a.id === 'carteiro');
      const pendentes = carteiro?.naoLidas || 0;
      setNaoLidas(pendentes);
      setCartas(dados.cartas || []);
      motor.current?.aplicar({ pessoas, naoLidas: pendentes });
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao ler o escritório.');
    }
  }, []);

  useEffect(() => {
    motor.current = montarEscritorio(alvo.current);
    motor.current.aoClicarCorreio(() => setCorreioAberto(true));
    void carregar();
    const atual = motor.current;
    return () => { atual?.destruir(); motor.current = null; };
  }, [carregar]);

  // Tempo real de verdade: as duas tabelas juntas escrevem ~5 vezes por hora,
  // entao o banco fica quieto quase o tempo todo. Consulta em intervalo aqui
  // seria centenas de leituras por hora numa tela que fica aberta o dia inteiro.
  useEffect(() => {
    if (!profile?.id) return;
    const canal = supabase
      .channel('realtime:escritorio')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notificacoes' }, () => void carregar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lead_ai_sessions' }, () => void carregar())
      .subscribe();
    return () => { void supabase.removeChannel(canal); };
  }, [profile?.id, carregar]);

  // Rede de seguranca: se o Realtime cair, a tela nao congela para sempre.
  useEffect(() => {
    const t = window.setInterval(() => void carregar(), 120_000);
    return () => window.clearInterval(t);
  }, [carregar]);

  async function marcarLida(id: string) {
    setCartas((atuais) => atuais.map((c) => (c.id === id ? { ...c, lida: true } : c)));
    setNaoLidas((n) => Math.max(0, n - 1));
    try {
      const { data: sessao } = await supabase.auth.getSession();
      const token = sessao.session?.access_token;
      await fetch('/api/escritorio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id }),
      });
    } catch {
      void carregar();
    }
  }

  return (
    <InternalLayout>
      <div ref={alvo} />

      {erro ? <p style={{ margin: '12px 18px', color: '#b0450f', fontSize: 14 }}>{erro}</p> : null}

      {correioAberto ? (
        <div className="esc-correio-fundo" role="dialog" aria-label="Caixa de correio" onClick={() => setCorreioAberto(false)}>
          <div className="esc-correio" onClick={(e) => e.stopPropagation()}>
            <header>
              <strong>Caixa de correio</strong>
              <span>{naoLidas} não {naoLidas === 1 ? 'lida' : 'lidas'}</span>
              <button type="button" onClick={() => setCorreioAberto(false)} aria-label="Fechar">✕</button>
            </header>
            {cartas.length ? (
              <ul>
                {cartas.map((c) => (
                  <li key={c.id} className={c.lida ? 'lida' : ''}>
                    <div>
                      <b>{c.titulo}</b>
                      <time>{hora(c.em)}</time>
                    </div>
                    <p>{c.mensagem}</p>
                    {c.lida ? null : (
                      <button type="button" onClick={() => void marcarLida(c.id)}>Marcar como lida</button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="esc-vazio">Nenhuma carta por enquanto.</p>
            )}
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        .esc-correio-fundo {
          position: fixed; inset: 0; z-index: 120;
          display: grid; place-items: center;
          background: rgba(12, 14, 18, .55); padding: 20px;
        }
        .esc-correio {
          width: min(640px, 100%); max-height: 78vh; overflow: auto;
          border: 3px solid #23252a; background: #f6f7f4; color: #23252a;
        }
        .esc-correio > header {
          position: sticky; top: 0; display: flex; align-items: center; gap: 12px;
          border-bottom: 2px solid #23252a; background: #f6f7f4; padding: 14px 18px;
        }
        .esc-correio > header strong { flex: 1; font-size: 15px; }
        .esc-correio > header span { color: #6f7480; font-size: 13px; }
        .esc-correio > header button { border: 0; background: transparent; cursor: pointer; font-size: 16px; color: #6f7480; }
        .esc-correio ul { margin: 0; padding: 0; list-style: none; }
        .esc-correio li { display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid #c2c6bf; padding: 14px 18px; }
        .esc-correio li.lida { opacity: .55; }
        .esc-correio li > div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
        .esc-correio li b { font-size: 14px; }
        .esc-correio li time { color: #6f7480; font-size: 12px; white-space: nowrap; }
        .esc-correio li p { margin: 0; white-space: pre-line; font-size: 13.5px; line-height: 1.55; }
        .esc-correio li button {
          align-self: flex-start; border: 1px solid #23252a; background: transparent;
          cursor: pointer; padding: 5px 10px; font-size: 12px;
        }
        .esc-vazio { margin: 0; padding: 28px 18px; color: #6f7480; font-size: 14px; }
      `}</style>
    </InternalLayout>
  );
}
