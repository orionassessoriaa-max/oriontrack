'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import './wall.css';

type RankingRow = {
  id: string;
  nome: string;
  iniciais: string;
  papel: string;
  fechado: number;
  vendas: number;
  ligacoes: number;
  atendidas: number;
  reunioes: number;
};

type FeedRow = { at: string; tipo: 'venda' | 'reuniao' | 'lead' | 'ia'; texto: string };

type TvPayload = {
  mes: string;
  fechado: number;
  meta: number;
  falta: number;
  vendas: number;
  progresso: number;
  ritmo: { esperado: number; percentual: number; pontos_atras: number; dia_util: number };
  dias_uteis_restantes: number;
  por_dia: number;
  ligacoes?: { meta_por_sdr: number; meta_time: number; realizadas: number; atendidas: number; taxa_atendimento: number };
  ranking: RankingRow[];
  feed: FeedRow[];
};

const REFRESH_MS = 45_000;

/** ?demo=1 mostra o painel com numeros de exemplo, para posicionar a TV antes
 *  de ter movimento no mes. Nao consulta o banco. */
const DEMO: TvPayload = {
  mes: '2026-08',
  fechado: 288400,
  meta: 750000,
  falta: 461600,
  vendas: 12,
  progresso: 0.385,
  ritmo: { esperado: 457500, percentual: 0.61, pontos_atras: 22, dia_util: 14 },
  dias_uteis_restantes: 8,
  por_dia: 57700,
  ligacoes: { meta_por_sdr: 100, meta_time: 200, realizadas: 122, atendidas: 7, taxa_atendimento: 0.057 },
  ranking: [
    { id: '1', nome: 'Talita Vargas', iniciais: 'TV', papel: 'SDR', fechado: 126900, vendas: 5, ligacoes: 38, atendidas: 9, reunioes: 9 },
    { id: '2', nome: 'Carlos Eduardo', iniciais: 'CE', papel: 'SDR', fechado: 98200, vendas: 4, ligacoes: 24, atendidas: 5, reunioes: 6 },
  ],
  feed: [
    { at: '2026-08-20T17:29:00-03:00', tipo: 'venda', texto: 'Talita fechou Celebre Corretora · R$ 41.800' },
    { at: '2026-08-20T17:21:00-03:00', tipo: 'reuniao', texto: 'Reuniao com Ricardo Salles · Renan' },
    { at: '2026-08-20T17:08:00-03:00', tipo: 'lead', texto: 'Lead novo em PR · Guilherme Valcarenghi' },
    { at: '2026-08-20T16:56:00-03:00', tipo: 'ia', texto: 'Aline qualificou e repassou Camila Soares' },
  ],
};
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function money(value: number) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function clock(date: Date) {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value.replace('.', '') || '';
  const weekday = get('weekday');
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${get('day')} ${get('month')} · ${get('hour')}:${get('minute')}`;
}

function hourOf(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export default function WallPanel() {
  const [data, setData] = useState<TvPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [demo, setDemo] = useState(false);

  const load = useCallback(async () => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')) {
      setError(null);
      setDemo(true);
      setData(DEMO);
      return;
    }
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) {
      setError('Sessao expirada. Faca login neste navegador para o painel voltar.');
      return;
    }
    const response = await fetch('/api/comercial/sala/tv', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error || 'Nao consegui carregar o painel.');
      return;
    }
    setError(null);
    setData(payload);
  }, []);

  useEffect(() => {
    void load();
    const dataTimer = setInterval(() => void load(), REFRESH_MS);
    const clockTimer = setInterval(() => setNow(new Date()), 30_000);
    return () => { clearInterval(dataTimer); clearInterval(clockTimer); };
  }, [load]);

  const mesNome = data ? MESES[Number(data.mes.slice(5, 7)) - 1] : '';
  const progressPct = data ? Math.min(100, data.progresso * 100) : 0;
  const pacePct = data ? Math.min(100, data.ritmo.percentual * 100) : 0;
  const paceLabelPct = Math.min(92, Math.max(8, pacePct));
  const atras = data ? data.ritmo.pontos_atras : 0;
  // Meta de ligacao vem do banco; 100 por SDR e o combinado enquanto ninguem
  // preencher outro numero em comercial_metas.
  const ligacoes = data?.ligacoes || { meta_por_sdr: 100, meta_time: 100, realizadas: 0, atendidas: 0, taxa_atendimento: 0 };

  return (
    <div className="tv-root">
      <header className="tv-header">
        <div className="tv-brand">
          <div className="tv-sigil">K</div>
          <div>
            <b>KRIPTO HUNTERS</b>
            <span className="tv-legend">Orion Assessoria · Sala comercial</span>
          </div>
        </div>
        <div className="tv-live">
          {demo ? <span className="tv-warn">Numeros de exemplo</span> : null}
          {error ? <span className="tv-warn">{error}</span> : null}
          <span className="tv-dot" />
          <span className="tv-legend">Ao vivo</span>
          <span className="tv-clock">{clock(now)}</span>
        </div>
      </header>

      <main className="tv-main">
        <section className="tv-scoreboard">
          <div>
            <p className="tv-legend">Fechado em {mesNome || 'este mes'}</p>
            <p className="tv-amount"><small>R$</small>{money(data?.fechado || 0)}</p>
            <p className="tv-of">
              de R$ {money(data?.meta || 0)} · {data?.vendas || 0} {data?.vendas === 1 ? 'venda' : 'vendas'}
            </p>
          </div>
          <div className="tv-gap">
            <p className="tv-legend">Falta para bater</p>
            <p className="tv-gap-value"><small>R$</small> {money(data?.falta || 0)}</p>
            <p className="tv-note">
              {data?.dias_uteis_restantes || 0} dias uteis restantes.<br />
              <b>R$ {money(data?.por_dia || 0)} por dia</b> para fechar o mes.
            </p>
          </div>
        </section>

        <section className="tv-horizon">
          <span className="tv-pace-label" style={{ left: `${paceLabelPct}%` }}>
            Ritmo do dia util {data?.ritmo.dia_util || 0} ▸ R$ {money(data?.ritmo.esperado || 0)}
          </span>
          <div className="tv-track">
            <div className="tv-fill" style={{ width: `${progressPct}%` }} />
            <div className="tv-pace" style={{ left: `${pacePct}%` }} />
          </div>
          <div className="tv-scale">
            <span className="tv-legend">01 {(mesNome || '---').slice(0, 3)}</span>
            <span className="tv-legend">
              {atras > 0 ? `Voces estao ${atras} pontos atras do ritmo` : atras < 0 ? `Voces estao ${Math.abs(atras)} pontos na frente do ritmo` : 'No ritmo exato da meta'}
            </span>
            <span className="tv-legend">Fim do mes</span>
          </div>
        </section>

        <section className="tv-calls">
          <div>
            <p className="tv-legend">Ligacoes hoje</p>
            <p className="tv-calls-value">
              {ligacoes.realizadas}
              <small> de {ligacoes.meta_time}</small>
            </p>
            <div className="tv-calls-track">
              <div className="tv-calls-fill" style={{ width: `${Math.min(100, ligacoes.meta_time ? (ligacoes.realizadas / ligacoes.meta_time) * 100 : 0)}%` }} />
            </div>
          </div>
          <div>
            <p className="tv-legend">Atendidas</p>
            <p className="tv-calls-value tv-calls-ok">{ligacoes.atendidas}</p>
            <p className="tv-legend">{(ligacoes.taxa_atendimento * 100).toFixed(0)}% de atendimento</p>
          </div>
          <div>
            <p className="tv-legend">Meta por SDR</p>
            <p className="tv-calls-value">{ligacoes.meta_por_sdr}</p>
            <p className="tv-legend">ligacoes por dia</p>
          </div>
        </section>
      </main>

      <footer className="tv-footer">
        <section>
          <div className="tv-panel-head">
            <p className="tv-legend">Ranking de hoje</p>
            <p className="tv-legend">Fechado · reunioes · ligacoes · atendidas</p>
          </div>
          {data?.ranking.length ? (
            <table className="tv-table">
              <tbody>
                {data.ranking.slice(0, 4).map((row, index) => (
                  <tr key={row.id} className={index === 0 ? 'tv-lead' : undefined}>
                    <td className="tv-pos">{index + 1}</td>
                    <td>
                      <div className="tv-who">
                        <div className="tv-face">{row.iniciais}</div>
                        <div>
                          <div className="tv-name">{row.nome}</div>
                          <div className="tv-role">{row.papel}</div>
                        </div>
                      </div>
                    </td>
                    <td className="tv-num">R$ {money(row.fechado)}</td>
                    <td className="tv-sub"><b>{row.reunioes}</b> reunioes</td>
                    <td className="tv-sub">
                      <b className={row.ligacoes >= (data?.ligacoes?.meta_por_sdr || 100) ? 'tv-calls-ok' : undefined}>{row.ligacoes}</b>
                      /{data?.ligacoes?.meta_por_sdr || 100} ligacoes
                    </td>
                    <td className="tv-sub"><b className="tv-calls-ok">{row.atendidas}</b> atendidas</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="tv-empty">Nenhum SDR ativo no time.</p>
          )}
        </section>

        <section>
          <div className="tv-panel-head">
            <p className="tv-legend">Acontecendo agora</p>
            <p className="tv-legend">Ultimos eventos</p>
          </div>
          {data?.feed.length ? (
            <div className="tv-feed">
              {data.feed.map((event) => (
                <div key={`${event.at}-${event.texto}`} className={`tv-event ${event.tipo === 'venda' ? 'tv-win' : ''}`}>
                  <time>{hourOf(event.at)}</time>
                  <p>{event.texto}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="tv-empty">Sem movimento nas ultimas horas.</p>
          )}
        </section>
      </footer>
    </div>
  );
}
