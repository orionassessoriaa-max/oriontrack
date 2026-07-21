'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowUpRight, CalendarDays, CircleDollarSign, Clock3, RefreshCw, Target, UsersRound, WalletCards } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import { currency, percent } from '@/lib/comercial';

type Overview = {
  metrics: Record<string, number>;
  trend: Array<{ date: string; leads: number; mql: number; meetings: number; sales: number; revenue: number; investment: number }>;
  team: Array<{ id: string; role: string; name: string; photo: string | null; leads: number; mql: number; meetings: number; sales: number; revenue: number }>;
  states: Array<{ state: string; leads: number; active: number }>;
  updatedAt?: string;
};

function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function startOfMonth() { const date = new Date(); return isoDate(new Date(date.getFullYear(), date.getMonth(), 1)); }

function TrendChart({ rows }: { rows: Overview['trend'] }) {
  const width = 860;
  const height = 220;
  const padding = 24;
  const max = Math.max(1, ...rows.flatMap((row) => [row.leads, row.mql, row.meetings, row.sales]));
  const points = (key: 'leads' | 'mql' | 'meetings' | 'sales') => rows.map((row, index) => {
    const x = rows.length <= 1 ? width / 2 : padding + index * ((width - padding * 2) / (rows.length - 1));
    const y = height - padding - (row[key] / max) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  if (!rows.length) return <div className="kh-chart-empty"><Activity size={24} /><span>Os gráficos aparecerão quando os primeiros leads forem cadastrados.</span></div>;
  return (
    <div className="kh-chart-wrap" role="img" aria-label="Evolução de leads, MQLs, reuniões e vendas no período">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {[0, 1, 2, 3].map((line) => <line key={line} x1={padding} x2={width - padding} y1={padding + line * 54} y2={padding + line * 54} className="kh-gridline" />)}
        <polyline points={points('leads')} className="kh-line leads" />
        <polyline points={points('mql')} className="kh-line mql" />
        <polyline points={points('meetings')} className="kh-line meetings" />
        <polyline points={points('sales')} className="kh-line sales" />
      </svg>
      <div className="kh-chart-labels"><span>{new Date(`${rows[0].date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span><span>{new Date(`${rows.at(-1)?.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span></div>
    </div>
  );
}

const statePositions: Record<string, [number, number]> = {
  AC: [20, 20], RO: [29, 27], AM: [39, 20], RR: [48, 10], AP: [66, 13], PA: [57, 28], TO: [63, 42], MA: [76, 27], PI: [81, 39], CE: [88, 29], RN: [96, 32], PB: [96, 40], PE: [91, 48], AL: [91, 57], SE: [84, 63], BA: [76, 56], MT: [51, 58], GO: [62, 67], DF: [68, 61], MS: [51, 78], ES: [85, 75], MG: [72, 78], RJ: [78, 87], SP: [61, 89], PR: [54, 96], SC: [64, 104], RS: [53, 111],
};

function WeeklyMeetingsChart({ rows }: { rows: Overview['trend'] }) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - (6 - index));
    const key = isoDate(date); const row = rows.find((item) => item.date === key);
    return { key, label: date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''), value: row?.meetings || 0 };
  });
  const max = Math.max(1, ...days.map((day) => day.value));
  return <div className="kh-weekly-chart" aria-label="Reuniões agendadas nos últimos sete dias"><div className="kh-weekly-y"><span>{max}</span><span>{Math.ceil(max / 2)}</span><span>0</span></div><div className="kh-weekly-bars">{days.map((day) => <div className="kh-weekly-day" key={day.key}><div className="kh-weekly-track"><i style={{ height: `${day.value ? Math.max(10, (day.value / max) * 100) : 3}%` }}><b>{day.value}</b></i></div><span>{day.label}</span></div>)}</div></div>;
}

function StateMap({ states, selected, onSelect }: { states: Overview['states']; selected: string | null; onSelect: (state: string) => void }) {
  const values = new Map(states.map((item) => [item.state, item]));
  const max = Math.max(1, ...states.map((item) => item.leads));
  return <div className="kh-state-map" aria-label="Mapa de origem dos leads por estado"><div className="kh-map-canvas">{Object.entries(statePositions).map(([state, [x, y]]) => { const item = values.get(state); const intensity = item ? 0.25 + (item.leads / max) * 0.75 : 0.08; return <button type="button" key={state} className={`kh-state-node ${selected === state ? 'selected' : ''}`} style={{ left: `${x}%`, top: `${y}px`, '--state-intensity': intensity } as React.CSSProperties} onClick={() => onSelect(state)} aria-label={`${state}: ${item?.leads || 0} leads, ${item?.active || 0} ativos`}><span>{state}</span>{item && <b>{item.leads}</b>}</button>; })}</div></div>;
}

export default function CommercialDashboardPage() {
  const { api, role, currentProfileId, canViewMetaInvestment } = useCommercial();
  const [start, setStart] = useState(startOfMonth());
  const [end, setEnd] = useState(isoDate(new Date()));
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedState, setSelectedState] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await api(`/api/comercial/overview?start=${start}&end=${end}`)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro ao carregar indicadores.'); }
    finally { setLoading(false); }
  }, [api, end, start]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(timer); }, [load]);

  const m = data?.metrics || {};
  const selectedStateData = data?.states?.find((item) => item.state === selectedState);
  const primary = [
    ...(canViewMetaInvestment ? [{ label: 'Investimento', value: currency(m.investment), helper: 'No período selecionado', icon: WalletCards, tone: 'blue' }] : []),
    { label: 'Leads', value: String(m.leads || 0), helper: `${m.qualified || 0} qualificados`, icon: UsersRound, tone: 'cyan' },
    ...(canViewMetaInvestment ? [{ label: 'Custo por lead', value: currency(m.cpl), helper: `MQL ${currency(m.costPerMql)}`, icon: CircleDollarSign, tone: 'green' }] : []),
    { label: 'Reuniões', value: String(m.scheduled || 0), helper: `${m.realized || 0} realizadas`, icon: CalendarDays, tone: 'yellow' },
    { label: 'Clientes fechados', value: String(m.closed || 0), helper: canViewMetaInvestment ? `CAC ${currency(m.cac)}` : 'Vendas no período', icon: Target, tone: 'violet' },
  ];
  const funnel = [
    ['Leads', m.leads], ['MQLs', m.qualified], ['Agendadas', m.scheduled], ['Realizadas', m.realized], ['Qualificadas', m.qualifiedMeetings], ['Vendas', m.closed],
  ];
  const maxFunnel = Math.max(1, Number(m.leads || 0));
  const detailMetrics = useMemo(() => [
    ['Em negociação', currency(m.negotiation)], ['Faturamento', currency(m.revenue)], ['Ticket médio', currency(m.averageTicket)],
    ...(canViewMetaInvestment ? [
      ['ROI', percent(m.roi)], ['ROAS', `${Number(m.roas || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`],
      ['Custo por reunião', currency(m.costPerMeeting)], ['Custo por reunião qualificada', currency(m.costPerQualifiedMeeting)],
    ] : []),
    ['Conversão por leads', percent(m.conversionLeads)], ['Conversão por reuniões', percent(m.conversionMeetings)],
    ['Conversão por reuniões qualificadas', percent(m.conversionQualifiedMeetings)], ['Taxa de agendamento', percent(m.schedulingRate)],
    ['Agendamento qualificado', percent(m.qualifiedSchedulingRate)], ['No-show', String(m.noShow || 0)],
    ['Reuniões desqualificadas', String(m.disqualifiedMeetings || 0)], ['Tempo médio de fechamento', `${Number(m.averageCloseDays || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`],
  ], [canViewMetaInvestment, m]);

  return (
    <div>
      <header className="kh-page-head">
        <div><div className="kh-eyebrow">Performance comercial</div><h1>Visão geral</h1><p>Da entrada do lead ao faturamento, com os números reais da operação.</p></div>
        <div className="kh-actions kh-date-actions">
          <label><span>De</span><input className="kh-filter" type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
          <label><span>Até</span><input className="kh-filter" type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
          <button className="kh-icon-button" type="button" onClick={() => void load()} aria-label="Atualizar indicadores"><RefreshCw size={17} className={loading ? 'kh-spin' : ''} /></button>
        </div>
      </header>
      {error && <div className="kh-inline-error">{error}</div>}

      <section className={`kh-kpi-grid ${canViewMetaInvestment ? '' : 'restricted'}`} aria-label="Indicadores principais">
        {primary.map((item) => <article key={item.label} className={`kh-kpi ${item.tone}`}><div className="kh-kpi-icon"><item.icon size={19} /></div><span>{item.label}</span><strong>{loading ? '—' : item.value}</strong><small>{item.helper}</small></article>)}
      </section>

      <section className="kh-dashboard-grid">
        <article className="kh-panel kh-revenue-panel">
          <div className="kh-panel-header"><div><span>Resultado no período</span><h2>Receita e evolução comercial</h2></div><div className="kh-chart-legend"><span className="l1">Leads</span><span className="l2">MQL</span><span className="l3">Reuniões</span><span className="l4">Vendas</span></div></div>
          <div className="kh-revenue-hero"><div><span>Receita fechada</span><strong>{currency(m.revenue)}</strong></div><div><span>Em negociação</span><strong>{currency(m.negotiation)}</strong></div><ArrowUpRight size={26} /></div>
          <TrendChart rows={data?.trend || []} />
        </article>

        <article className="kh-panel kh-funnel-panel">
          <div className="kh-panel-header"><div><span>Conversão</span><h2>Funil comercial</h2></div><span>{percent(m.conversionLeads)} total</span></div>
          <div className="kh-funnel-list">{funnel.map(([label, value], index) => <div key={String(label)}><div><span>{label}</span><strong>{Number(value || 0)}</strong></div><div className="kh-progress"><i style={{ width: `${Math.max(Number(value || 0) ? 5 : 0, (Number(value || 0) / maxFunnel) * 100)}%` }} /></div>{index < funnel.length - 1 && <small>{Number(value || 0) ? percent((Number(funnel[index + 1][1] || 0) / Number(value || 1)) * 100) : '0,0%'}</small>}</div>)}</div>
        </article>
      </section>

      <section className="kh-live-grid">
        <article className="kh-panel kh-live-meetings"><div className="kh-panel-header"><div><span>Atualização automática a cada 30 segundos</span><h2>Reuniões da semana</h2></div><span className="kh-live-dot">Ao vivo</span></div><WeeklyMeetingsChart rows={data?.trend || []} /></article>
        <article className="kh-panel kh-origin-panel"><div className="kh-panel-header"><div><span>Origem geográfica dos leads</span><h2>Leads por estado</h2></div><span>{data?.states?.reduce((sum, item) => sum + item.leads, 0) || 0} mapeados</span></div><StateMap states={data?.states || []} selected={selectedState} onSelect={setSelectedState} />{selectedStateData ? <div className="kh-state-detail"><strong>{selectedStateData.state}</strong><span>{selectedStateData.leads} leads recebidos</span><b>{selectedStateData.active} ativos na Orion</b></div> : <div className="kh-state-hint">Selecione um estado para ver os leads recebidos e os que continuam ativos.</div>}</article>
      </section>

      <section className="kh-bottom-grid">
        <article className="kh-panel"><div className="kh-panel-header"><h2>Indicadores avançados</h2><span>Visão completa do período</span></div><div className="kh-detail-grid">{detailMetrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></article>
        <article className="kh-panel"><div className="kh-panel-header"><h2>Equipe comercial</h2><span>{role === 'coordenador' ? 'Visão da equipe' : 'Meu desempenho'}</span></div><div className="kh-team-list">{(data?.team || []).filter((member) => member.role !== 'coordenador' && (role === 'coordenador' || member.id === currentProfileId)).map((member) => <div key={member.id}><div className="kh-avatar">{member.name.split(' ').slice(0, 2).map((part) => part[0]).join('')}</div><div className="kh-team-name"><strong>{member.name}</strong><span>{member.role.toUpperCase()}</span></div><div><span>Leads</span><strong>{member.leads}</strong></div><div><span>Reuniões</span><strong>{member.meetings}</strong></div><div><span>Vendas</span><strong>{member.sales}</strong></div><div><span>Receita</span><strong>{currency(member.revenue)}</strong></div></div>)}{!data?.team?.some((member) => member.role !== 'coordenador') && <div className="kh-empty-row">Vincule o SDR e o closer na página Usuários.</div>}</div></article>
      </section>
    </div>
  );
}
