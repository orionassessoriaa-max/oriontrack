'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BadgeCheck, Phone, Target, TrendingUp, Trophy, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import './overview.css';

type PersonRow = { id: string; name: string; initials: string; photo: string | null };
type OverviewPayload = {
  month: string;
  updatedAt: string;
  kripto: {
    revenue: { actual: number; goal: number };
    sales: { actual: number; goal: number };
    calls: { actual: number; goal: number; perSdrGoal: number; answered: number };
    noShow: { actual: number; limit: number; count: number; scheduled: number };
    conversion: { actual: number; goal: number; qualifiedMeetings: number };
    callsRanking: Array<PersonRow & { calls: number; answered: number; meetings: number }>;
    salesRanking: Array<PersonRow & { role: string; sales: number; revenue: number }>;
  };
  apollo: {
    revenue: { actual: number; goal: number; superGoal: number };
    salesCount: number;
    members: Array<PersonRow & { role: string; points: number }>;
    sales: Array<{ id: string; name: string; product: string; value: number; at: string }>;
  };
};

const REFRESH_MS = 20_000;
const ROTATION_MS = 5_000;
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const DEMO: OverviewPayload = {
  month: '2026-09',
  updatedAt: new Date().toISOString(),
  kripto: {
    revenue: { actual: 80_600, goal: 185_000 },
    sales: { actual: 11, goal: 25 },
    calls: { actual: 336, goal: 500, perSdrGoal: 100, answered: 68 },
    noShow: { actual: 17.4, limit: 20, count: 4, scheduled: 23 },
    conversion: { actual: 42.3, goal: 40, qualifiedMeetings: 26 },
    callsRanking: [
      { id: '1', name: 'Talita Vargas', initials: 'TV', photo: null, calls: 105, answered: 22, meetings: 14 },
      { id: '2', name: 'Carlos Eduardo', initials: 'CE', photo: null, calls: 92, answered: 18, meetings: 12 },
      { id: '3', name: 'Danilo', initials: 'DA', photo: null, calls: 78, answered: 16, meetings: 9 },
      { id: '4', name: 'Bruno', initials: 'BR', photo: null, calls: 61, answered: 12, meetings: 8 },
    ],
    salesRanking: [
      { id: '1', name: 'Alexandre', initials: 'AL', photo: null, role: 'closer', sales: 5, revenue: 40_600 },
      { id: '2', name: 'Carlos', initials: 'CA', photo: null, role: 'closer', sales: 3, revenue: 23_000 },
      { id: '3', name: 'Daniel', initials: 'DA', photo: null, role: 'closer', sales: 3, revenue: 17_000 },
    ],
  },
  apollo: {
    revenue: { actual: 18_400, goal: 30_000, superGoal: 50_000 },
    salesCount: 5,
    members: [
      { id: '1', name: 'Ewertton Herculano', initials: 'EH', photo: null, role: 'admin', points: 86 },
      { id: '2', name: 'Equipe de Tráfego', initials: 'ET', photo: null, role: 'gestor_trafego', points: 64 },
      { id: '3', name: 'Criação', initials: 'CR', photo: null, role: 'designer', points: 48 },
    ],
    sales: [
      { id: '1', name: 'Conexão Corretora', product: 'Gestão completa', value: 7_500, at: new Date().toISOString() },
      { id: '2', name: 'Unity', product: 'CRM Orion Track', value: 5_900, at: new Date().toISOString() },
      { id: '3', name: 'Invicta Saúde', product: 'Gestão de tráfego', value: 5_000, at: new Date().toISOString() },
    ],
  },
};

function money(value: number) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function pct(value: number) {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function progress(actual: number, goal: number) {
  return goal > 0 ? Math.min(100, Math.max(0, (actual / goal) * 100)) : 0;
}

function Person({ row }: { row: PersonRow }) {
  return row.photo ? (
    // A URL vem do perfil e pode usar provedores diferentes; o avatar nao e conteudo principal da pagina.
    // eslint-disable-next-line @next/next/no-img-element
    <img className="ov-avatar" src={row.photo} alt="" />
  ) : <span className="ov-avatar ov-initials">{row.initials}</span>;
}

function MiniProgress({ value, target, inverse = false }: { value: number; target: number; inverse?: boolean }) {
  const width = inverse ? Math.min(100, (value / Math.max(target, 1)) * 100) : progress(value, target);
  const good = inverse ? value <= target : value >= target;
  return <span className="ov-mini-track"><span className={good ? 'is-good' : ''} style={{ width: `${width}%` }} /></span>;
}

function MainProgress({ actual, goal, superGoal }: { actual: number; goal: number; superGoal?: number }) {
  const range = superGoal || goal;
  const goalMarker = superGoal ? progress(goal, range) : 100;
  return (
    <div className="ov-progress-wrap" aria-label={`${Math.round(progress(actual, goal))}% da meta`}>
      <div className="ov-progress-track">
        <span className="ov-progress-fill" style={{ width: `${progress(actual, range)}%` }} />
        {superGoal ? <span className="ov-goal-marker" style={{ left: `${goalMarker}%` }}><b>Meta</b><small>R$ {money(goal)}</small></span> : null}
      </div>
      <div className="ov-progress-scale"><span>R$ 0</span><span>{superGoal ? 'Supermeta' : 'Meta do mês'} R$ {money(range)}</span></div>
    </div>
  );
}

function KriptoView({ data }: { data: OverviewPayload['kripto'] }) {
  const mainPct = progress(data.revenue.actual, data.revenue.goal);
  return (
    <div className="ov-view" aria-label="Overview Kripto Hunters">
      <section className="ov-hero">
        <div>
          <p className="ov-eyebrow">Resultado do mês</p>
          <p className="ov-money"><small>R$</small>{money(data.revenue.actual)} <em>/ R$ {money(data.revenue.goal)}</em></p>
        </div>
        <div className="ov-percent"><strong>{Math.round(mainPct)}%</strong><span>{data.sales.actual} de {data.sales.goal} vendas</span></div>
      </section>
      <MainProgress actual={data.revenue.actual} goal={data.revenue.goal} />
      <section className="ov-metrics">
        <article><Phone /><span><small>Ligações hoje</small><b>{data.calls.actual} <em>/ {data.calls.goal}</em></b><MiniProgress value={data.calls.actual} target={data.calls.goal} /></span></article>
        <article><BadgeCheck /><span><small>Atendidas hoje</small><b>{data.calls.answered}</b><em>{pct(data.calls.actual ? (data.calls.answered / data.calls.actual) * 100 : 0)} de atendimento</em></span></article>
        <article className={data.noShow.actual > data.noShow.limit ? 'is-alert' : ''}><Users /><span><small>No-show do mês</small><b>{pct(data.noShow.actual)} <em>/ máx. {data.noShow.limit}%</em></b><MiniProgress value={data.noShow.actual} target={data.noShow.limit} inverse /></span></article>
        <article><TrendingUp /><span><small>Conversão qualificada</small><b>{pct(data.conversion.actual)} <em>/ {data.conversion.goal}%</em></b><MiniProgress value={data.conversion.actual} target={data.conversion.goal} /></span></article>
      </section>
      <section className="ov-rank-grid">
        <div className="ov-panel">
          <div className="ov-panel-head"><span>SDR</span><span>Ligações · agendamentos</span></div>
          <div className="ov-list">
            {data.callsRanking.slice(0, 5).map((row, index) => <div className="ov-row" key={row.id}><span className="ov-rank">#{index + 1}</span><Person row={row} /><span className="ov-person"><b>{row.name}</b><small>{row.answered} atendidas</small></span><span className="ov-row-metric"><b className={row.calls >= data.calls.perSdrGoal ? 'is-good-text' : ''}>{row.calls}</b><small>/ {data.calls.perSdrGoal} calls</small></span><span className="ov-row-metric"><b>{row.meetings}</b><small>agendamentos</small></span></div>)}
            {!data.callsRanking.length ? <p className="ov-empty">Nenhum SDR ativo.</p> : null}
          </div>
        </div>
        <div className="ov-panel">
          <div className="ov-panel-head"><span>Fechamento</span><span>Receita · vendas</span></div>
          <div className="ov-list">
            {data.salesRanking.slice(0, 5).map((row, index) => <div className="ov-row" key={row.id}><span className="ov-rank">#{index + 1}</span><Person row={row} /><span className="ov-person"><b>{row.name}</b><small>{row.role === 'closer' ? 'Closer' : 'Comercial'}</small></span><span className="ov-row-metric ov-revenue"><b>R$ {money(row.revenue)}</b><small>{row.sales} {row.sales === 1 ? 'venda' : 'vendas'}</small></span></div>)}
            {!data.salesRanking.length ? <p className="ov-empty">Nenhuma venda registrada no mês.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function ApolloView({ data }: { data: OverviewPayload['apollo'] }) {
  const mainPct = progress(data.revenue.actual, data.revenue.goal);
  return (
    <div className="ov-view ov-apollo" aria-label="Overview Apollo">
      <section className="ov-hero">
        <div>
          <p className="ov-eyebrow">Vendas no mês</p>
          <p className="ov-money"><small>R$</small>{money(data.revenue.actual)} <em>/ R$ {money(data.revenue.goal)}</em></p>
        </div>
        <div className="ov-percent"><strong>{Math.round(mainPct)}%</strong><span>Supermeta R$ {money(data.revenue.superGoal)}</span></div>
      </section>
      <MainProgress actual={data.revenue.actual} goal={data.revenue.goal} superGoal={data.revenue.superGoal} />
      <section className="ov-metrics ov-apollo-metrics">
        <article><Target /><span><small>Meta do mês</small><b>R$ {money(data.revenue.goal)}</b><em>objetivo principal</em></span></article>
        <article><Trophy /><span><small>Supermeta</small><b>R$ {money(data.revenue.superGoal)}</b><em>próximo nível</em></span></article>
        <article><TrendingUp /><span><small>Vendas registradas</small><b>{data.salesCount}</b><em>neste mês</em></span></article>
        <article><Users /><span><small>Time Apollo</small><b>{data.members.length}</b><em>membros ativos</em></span></article>
      </section>
      <section className="ov-rank-grid">
        <div className="ov-panel">
          <div className="ov-panel-head"><span>Meu time</span><span>Ranking de pontos</span></div>
          <div className="ov-list">
            {data.members.slice(0, 5).map((row, index) => <div className="ov-row" key={row.id}><span className="ov-rank">#{index + 1}</span><Person row={row} /><span className="ov-person"><b>{row.name}</b><small>{row.role.replaceAll('_', ' ')}</small></span><span className="ov-row-metric ov-revenue"><b>{row.points}</b><small>pontos</small></span></div>)}
            {!data.members.length ? <p className="ov-empty">Nenhum membro no time Apollo.</p> : null}
          </div>
        </div>
        <div className="ov-panel">
          <div className="ov-panel-head"><span>Vendas do mês</span><span>Últimas entradas</span></div>
          <div className="ov-list">
            {data.sales.slice(0, 5).map((sale, index) => <div className="ov-row" key={sale.id}><span className="ov-rank">#{index + 1}</span><span className="ov-sale-icon">R$</span><span className="ov-person"><b>{sale.name}</b><small>{sale.product}</small></span><span className="ov-row-metric ov-revenue"><b>R$ {money(sale.value)}</b><small>fechado</small></span></div>)}
            {!data.sales.length ? <p className="ov-empty">Nenhuma venda registrada no mês.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

export default function OverviewBoard() {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [active, setActive] = useState<'kripto' | 'apollo'>('kripto');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [demo, setDemo] = useState(false);

  const load = useCallback(async () => {
    if (new URLSearchParams(window.location.search).has('demo')) {
      setDemo(true);
      setData(DEMO);
      return;
    }
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return setError('Sessão expirada. Entre novamente para carregar a Overview.');
    const response = await fetch('/api/overview', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || 'Não foi possível atualizar a Overview.');
    setData(payload);
    setError(null);
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const refresh = window.setInterval(() => void load(), REFRESH_MS);
    const rotate = window.setInterval(() => setActive((current) => current === 'kripto' ? 'apollo' : 'kripto'), ROTATION_MS);
    const clock = window.setInterval(() => setNow(new Date()), 1_000);
    return () => { window.clearTimeout(initial); window.clearInterval(refresh); window.clearInterval(rotate); window.clearInterval(clock); };
  }, [load]);

  const monthName = useMemo(() => data ? MONTHS[Number(data.month.slice(5, 7)) - 1] : '', [data]);
  const clockLabel = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(now);
  const switchView = () => setActive((current) => current === 'kripto' ? 'apollo' : 'kripto');

  return (
    <main className={`ov-root ov-${active}`}>
      <header className="ov-header">
        <div className="ov-brand"><span className="ov-logo">ORION</span><span><b>OVERVIEW</b><small>{active === 'kripto' ? 'KRIPTO HUNTERS' : 'TIME APOLLO'} · {monthName}</small></span></div>
        <div className="ov-status">
          {demo ? <span className="ov-demo">DADOS DE EXEMPLO</span> : null}
          {error ? <span className="ov-error">{error}</span> : null}
          <span className="ov-live-dot" /><span>AO VIVO</span><time>{clockLabel}</time>
        </div>
      </header>
      <button className="ov-switch ov-switch-left" onClick={switchView} aria-label="Mostrar painel anterior"><ArrowLeft /></button>
      <button className="ov-switch ov-switch-right" onClick={switchView} aria-label="Mostrar próximo painel"><ArrowRight /></button>
      <div className="ov-content" key={active}>
        {data ? (active === 'kripto' ? <KriptoView data={data.kripto} /> : <ApolloView data={data.apollo} />) : <div className="ov-loading"><span /><p>Carregando dados do mês</p></div>}
      </div>
      <footer className="ov-footer"><span className={active === 'kripto' ? 'active' : ''} /><span className={active === 'apollo' ? 'active' : ''} /><small>Troca automática a cada 5 segundos</small></footer>
    </main>
  );
}
